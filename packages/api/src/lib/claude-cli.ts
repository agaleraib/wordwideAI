/**
 * Claude CLI subprocess caller — runs `claude -p` instead of hitting the
 * Anthropic API directly, so long-lived programmatic calls (FinFlow test
 * reports today, live reports tomorrow) bill against the Claude Code
 * subscription / OAuth token instead of a per-token ANTHROPIC_API_KEY.
 *
 * Adapted from gobot's `src/lib/claude.ts` (same pattern: spawn the CLI,
 * strip API-routing env from the child process, parse the JSON result
 * envelope).
 *
 * Scope (intentional):
 *   - Plain text generation calls (Stage 1 FA agent + Stage 2 identity
 *     adaptation in the uniqueness PoC, and their future production
 *     equivalents in the content pipeline).
 *   - NOT structured-output calls. The judge, the narrative-state extractor,
 *     the scoring tool_use callers, etc. still need `tool_use` output which
 *     the CLI does not expose cleanly. Those stay on the SDK path.
 *
 * Contract parity with `Anthropic.messages.create`:
 *   input  → { model, systemPrompt, userMessage, maxTokens }
 *   output → { text, inputTokens, outputTokens, durationMs, costUsd }
 */

import { spawn } from "bun";
import { tmpdir } from "node:os";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const IS_MACOS = process.platform === "darwin";

/**
 * Environment variables that can redirect the CLI away from the
 * Keychain-backed subscription OAuth token. Any of these would silently
 * route a "subscription" call through a different backend — Bedrock,
 * Vertex, a custom proxy, Ollama, or a raw API key. Strip them all.
 *
 * Motivation: gobot's `.env` already sets ANTHROPIC_BASE_URL +
 * ANTHROPIC_AUTH_TOKEN for its local Ollama setup, and if FinFlow ever
 * shares a parent process with gobot (or loads the same .env by accident),
 * a naive strip of only ANTHROPIC_API_KEY lets the CLI silently route
 * FinFlow reports through Ollama. That's a security + billing regression
 * in one.
 */
const AUTH_ROUTING_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  // CLAUDECODE is gobot's marker for "parent is already Claude Code";
  // stripping it prevents nested-session confusion in the child.
  "CLAUDECODE",
] as const;

/**
 * Conservative approximation when translating a model-side max_tokens
 * budget into a post-hoc word cap. 1 token ≈ 0.75 English words. We use
 * this on the CLI path because `claude -p` does not expose max_tokens;
 * see the post-hoc truncation in `callClaudeCli`.
 */
const WORDS_PER_TOKEN = 0.75;

export interface ClaudeCliCallOptions {
  /** Full model ID (e.g. "claude-opus-4-6") or alias ("opus", "sonnet", "haiku"). */
  model: string;
  /** System prompt — replaces the CLI default system prompt via --system-prompt. */
  systemPrompt: string;
  /** User message content — piped via stdin to avoid arg-length limits. */
  userMessage: string;
  /**
   * Model-side max output budget. The CLI has no `--max-tokens` flag, so
   * the subprocess caller cannot enforce this at generation time the way
   * the SDK does. We approximate by post-hoc truncating the returned text
   * to `maxTokens * WORDS_PER_TOKEN` words. This is a conservative cap
   * that matches the SDK path's behavior within ~25% for prose output.
   * Set to `undefined` (or 0) to skip the cap entirely.
   */
  maxTokens?: number;
  /** Hard timeout (ms). Defaults to 10 minutes. */
  timeoutMs?: number;
  /**
   * Working directory for the subprocess. Defaults to os.tmpdir() so no
   * project CLAUDE.md is auto-loaded into the context, minimizing waste
   * tokens per call. Callers can override if they *want* project context.
   */
  cwd?: string;
  /**
   * Grace period (ms) between SIGTERM and SIGKILL when a timeout fires.
   * Defaults to 2s. Exposed for tests.
   */
  killGraceMs?: number;
}

export interface ClaudeCliCallResult {
  text: string;
  /**
   * Uncached prompt input tokens — matches the SDK path's
   * `response.usage.input_tokens` semantics (does NOT include
   * cache_creation or cache_read). The SDK's separate cache counters are
   * dropped on purpose so cost math stays consistent across backends.
   */
  inputTokens: number;
  outputTokens: number;
  /**
   * Wall-clock duration from spawn to envelope parse. Matches the SDK
   * path's `Date.now() - start` semantics, NOT the CLI's internal
   * `duration_ms` (which only covers the API turn inside the subprocess).
   */
  durationMs: number;
  /**
   * The CLI's own reported cost (`total_cost_usd` in the JSON envelope).
   * Under subscription auth this is a phantom number — what the API would
   * have charged if this were an API-key call. Marginal subscription
   * spend is $0. Passed through for transparency; callers that want
   * "what did we actually pay" should treat it as 0 under subscription.
   */
  cliReportedCostUsd: number;
  sessionId?: string;
  /** True if the model output exceeded `maxTokens * WORDS_PER_TOKEN` words and was truncated. */
  truncated?: boolean;
}

export class ClaudeCliError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

interface ClaudeCliResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

// ───────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests — no subprocess involvement)
// ───────────────────────────────────────────────────────────────────

/**
 * Build the argv for `claude -p`. Pure — no spawning.
 */
export function buildCliArgs(opts: {
  model: string;
  systemPrompt: string;
}): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    opts.model,
    "--system-prompt",
    opts.systemPrompt,
    // Keep the subprocess lean: no skills, no tool use, no settings drift.
    "--disable-slash-commands",
    "--tools",
    "",
    "--no-session-persistence",
  ];
}

/**
 * Build the child process env. Pure — takes a parent env dict and
 * returns a scrubbed copy. Strips every auth-routing env var so the CLI
 * cannot be redirected away from subscription OAuth, and ensures
 * HOME/USER/PATH are present (with a sane fallback for USER because a
 * blank USER breaks macOS Keychain lookups the same way gobot hit).
 */
export function buildChildEnv(
  parentEnv: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const stripSet = new Set<string>(AUTH_ROUTING_ENV_KEYS);
  for (const [k, v] of Object.entries(parentEnv)) {
    if (stripSet.has(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  // Explicit presence guarantees — the CLI and its Keychain lookup both
  // depend on these. A blank USER silently breaks OAuth on macOS.
  out.HOME = parentEnv.HOME || "";
  out.PATH = parentEnv.PATH || "";
  const user = parentEnv.USER || parentEnv.LOGNAME;
  if (user && user.trim()) {
    out.USER = user;
  } else {
    // Don't guess a username. Fail loud later if Keychain needs it; a
    // made-up value would just produce a confusing auth error.
    delete out.USER;
  }
  return out;
}

/**
 * Word-count truncation to approximate a max_tokens budget. Pure.
 * Splits on whitespace, keeps the first `wordCap` words, reattaches the
 * original trailing whitespace of the last kept word so markdown
 * paragraph breaks are preserved when possible.
 */
export function truncateToWordCap(
  text: string,
  wordCap: number,
): { text: string; truncated: boolean } {
  if (wordCap <= 0) return { text, truncated: false };
  // Count words without building the full array unless we need to truncate.
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= wordCap) return { text, truncated: false };
  // Rebuild with original whitespace up to the cap: walk the source
  // string and track word boundaries.
  let wordsSeen = 0;
  let cutIndex = text.length;
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    wordsSeen++;
    if (wordsSeen === wordCap) {
      cutIndex = match.index + match[0].length;
      break;
    }
  }
  return { text: text.slice(0, cutIndex), truncated: true };
}

/**
 * Decide whether the CLI's JSON envelope represents a successful call.
 * Pure.
 *
 * Gotcha guarded here: the CLI's `type: "result"` envelope sometimes
 * omits `subtype` entirely on legitimate successes. The previous
 * implementation required `subtype === "success"` and therefore rejected
 * those. Correct rule: treat as success unless `is_error === true` or
 * an explicit non-success `subtype` is present.
 */
export function isEnvelopeSuccess(envelope: ClaudeCliResultEnvelope): boolean {
  if (envelope.is_error === true) return false;
  if (envelope.subtype !== undefined && envelope.subtype !== "success") {
    return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────
// Subprocess caller
// ───────────────────────────────────────────────────────────────────

interface DeadlineRaceResult<T> {
  timedOut: boolean;
  value?: T;
}

function raceWithDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
): { promise: Promise<DeadlineRaceResult<T>>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const promise = new Promise<DeadlineRaceResult<T>>((resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Call `claude -p` as a subprocess and return the text + usage.
 *
 * Auth: all auth-routing env vars (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 * ANTHROPIC_BASE_URL, CLAUDE_CODE_OAUTH_TOKEN, Bedrock/Vertex toggles, …)
 * are stripped from the child env so the CLI is forced to fall back to
 * its Keychain-stored OAuth token. If the parent process does not have a
 * valid `claude setup-token` configured, this will fail at the
 * subprocess level with a "not logged in" style error.
 */
export async function callClaudeCli(
  options: ClaudeCliCallOptions,
): Promise<ClaudeCliCallResult> {
  const {
    model,
    systemPrompt,
    userMessage,
    maxTokens,
    timeoutMs = 10 * 60 * 1000,
    cwd = tmpdir(),
    killGraceMs = 2_000,
  } = options;

  const args = buildCliArgs({ model, systemPrompt });

  // On macOS, wrap with caffeinate so long FA calls don't stall if the
  // laptop tries to idle-sleep mid-run.
  const cmd = IS_MACOS
    ? ["/usr/bin/caffeinate", "-i", CLAUDE_PATH, ...args]
    : [CLAUDE_PATH, ...args];

  const env = buildChildEnv(process.env);

  const start = Date.now();
  const proc = spawn({
    cmd,
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Always-cleanup tracking. Any throw path below must end up in the
  // finally to kill + await the process instead of leaking it.
  let killed = false;
  const killProcess = async (reason: "timeout" | "error") => {
    if (killed) return;
    killed = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    // Grace period, then SIGKILL if still alive.
    await new Promise((r) => setTimeout(r, killGraceMs));
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    void reason; // for future logging hooks
  };

  // Stdin write can reject if the child died before reading; swallow,
  // the stdout/stderr path will surface the real error.
  try {
    proc.stdin.write(userMessage);
    proc.stdin.end();
  } catch {
    /* ignore — handled by stdout/exit path */
  }

  // Drain stderr in the background so it's available when we throw.
  let stderrOutput = "";
  const stderrDrain = (async () => {
    try {
      stderrOutput = await new Response(proc.stderr).text();
    } catch {
      /* ignore */
    }
  })();

  const stdoutPromise = new Response(proc.stdout).text();
  const race = raceWithDeadline(stdoutPromise, timeoutMs);

  let stdoutText = "";
  let timedOut = false;
  let callerError: unknown;

  try {
    const result = await race.promise;
    timedOut = result.timedOut;
    if (!timedOut && result.value !== undefined) {
      stdoutText = result.value;
    }
  } catch (err) {
    callerError = err;
  } finally {
    race.cancel();
  }

  if (timedOut || callerError) {
    await killProcess(timedOut ? "timeout" : "error");
  }

  // Always wait for the process to fully exit so we don't leak it, and
  // so the exit code is available for error messages.
  let exitCode: number | null = null;
  try {
    exitCode = await proc.exited;
  } catch {
    /* ignore */
  }
  await stderrDrain;

  if (timedOut) {
    throw new ClaudeCliError(
      `claude -p timed out after ${timeoutMs}ms`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  if (callerError) {
    throw new ClaudeCliError(
      `claude -p stdout read failed: ${
        callerError instanceof Error ? callerError.message : String(callerError)
      }`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  if (!stdoutText.trim()) {
    throw new ClaudeCliError(
      `claude -p returned empty output (exit ${exitCode})`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  let envelope: ClaudeCliResultEnvelope;
  try {
    envelope = JSON.parse(stdoutText) as ClaudeCliResultEnvelope;
  } catch (err) {
    throw new ClaudeCliError(
      `claude -p returned non-JSON output: ${
        (err as Error).message
      }. First 300 chars: ${stdoutText.slice(0, 300)}`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  if (!isEnvelopeSuccess(envelope)) {
    throw new ClaudeCliError(
      `claude -p reported error: subtype=${
        envelope.subtype ?? "(none)"
      } is_error=${envelope.is_error === true} — ${
        envelope.result?.slice(0, 300) ?? "(no result)"
      }`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  const rawText = envelope.result ?? "";
  if (!rawText.trim()) {
    // Success envelope with empty result is a silent-failure mode. Fail
    // loud so a downstream Stage 2 / wordCount path never sees "".
    throw new ClaudeCliError(
      `claude -p success envelope contained empty result text`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  // Post-hoc word cap to approximate the SDK's max_tokens budget.
  // Rough because the CLI does not expose max_tokens at generation time,
  // but keeps broker-report word counts comparable across backends.
  let text = rawText;
  let truncated = false;
  if (maxTokens && maxTokens > 0) {
    const wordCap = Math.floor(maxTokens * WORDS_PER_TOKEN);
    const capped = truncateToWordCap(rawText, wordCap);
    text = capped.text;
    truncated = capped.truncated;
  }

  // Match SDK semantics: input_tokens = prompt tokens, excluding cache
  // creation/read. Do NOT sum the cache counters — doing so inflates
  // cost math by 5-10× on cache-warm calls and makes cross-backend cost
  // comparisons meaningless.
  const inputTokens = envelope.usage?.input_tokens ?? 0;
  const outputTokens = envelope.usage?.output_tokens ?? 0;

  return {
    text,
    inputTokens,
    outputTokens,
    // Wall-clock: the CLI's internal duration_ms omits subprocess
    // spawn/teardown. Use our own clock for parity with the SDK path.
    durationMs: Date.now() - start,
    cliReportedCostUsd: envelope.total_cost_usd ?? 0,
    sessionId: envelope.session_id,
    truncated,
  };
}

/**
 * Feature flag: route uniqueness-PoC report generation (Stage 1 + Stage 2)
 * through the CLI subprocess instead of the SDK. Set
 * `FINFLOW_USE_CLAUDE_CLI=1` in the environment to opt in per-run.
 *
 * Kept as a function (not a captured constant) so toggling the env var
 * inside tests or between sequential invocations takes effect without a
 * process restart.
 */
export function isClaudeCliEnabled(): boolean {
  const flag = process.env.FINFLOW_USE_CLAUDE_CLI;
  if (!flag) return false;
  return flag === "1" || flag.toLowerCase() === "true";
}
