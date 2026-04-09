/**
 * Claude CLI subprocess caller — runs `claude -p` instead of hitting the
 * Anthropic API directly, so long-lived programmatic calls (FinFlow test
 * reports today, live reports tomorrow) bill against the Claude Code
 * subscription / OAuth token instead of a per-token ANTHROPIC_API_KEY.
 *
 * Adapted from gobot's `src/lib/claude.ts` (same pattern: spawn the CLI,
 * strip ANTHROPIC_API_KEY from env to force subscription auth, parse the
 * JSON result envelope).
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

export interface ClaudeCliCallOptions {
  /** Full model ID (e.g. "claude-opus-4-6") or alias ("opus", "sonnet", "haiku"). */
  model: string;
  /** System prompt — replaces the CLI default system prompt via --system-prompt. */
  systemPrompt: string;
  /** User message content — piped via stdin to avoid arg-length limits. */
  userMessage: string;
  /**
   * Advisory only — the CLI doesn't expose max_tokens, but we keep the
   * parameter for call-site parity with the SDK wrapper.
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
}

export interface ClaudeCliCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /**
   * The CLI's own reported cost (`total_cost_usd` in the JSON envelope).
   * Under subscription auth this is a phantom number — what the API would
   * have charged if this were an API-key call — so the caller may choose
   * to ignore it and compute its own cost from the token counts, or treat
   * it as 0 for subscription spend. We pass it through for transparency.
   */
  cliReportedCostUsd: number;
  sessionId?: string;
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
  type: string;
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

/**
 * Call `claude -p` as a subprocess and return the text + usage.
 *
 * Auth: ANTHROPIC_API_KEY is stripped from the child env so the CLI falls
 * back to its Keychain-stored OAuth token (`claude setup-token`). If the
 * parent process does not have a valid Claude Code subscription set up,
 * this will fail at the subprocess level.
 */
export async function callClaudeCli(
  options: ClaudeCliCallOptions,
): Promise<ClaudeCliCallResult> {
  const {
    model,
    systemPrompt,
    userMessage,
    timeoutMs = 10 * 60 * 1000,
    cwd = tmpdir(),
  } = options;

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--system-prompt",
    systemPrompt,
    // Keep the subprocess lean: no skills, no tool use, no settings drift.
    "--disable-slash-commands",
    "--tools",
    "",
    "--no-session-persistence",
  ];

  // On macOS, wrap with caffeinate so long FA calls don't stall if the
  // laptop tries to idle-sleep mid-run.
  const cmd = IS_MACOS
    ? ["/usr/bin/caffeinate", "-i", CLAUDE_PATH, ...args]
    : [CLAUDE_PATH, ...args];

  // Strip ANTHROPIC_API_KEY and CLAUDECODE so the CLI uses subscription
  // OAuth instead of per-token API billing.
  const {
    ANTHROPIC_API_KEY: _apiKey,
    CLAUDECODE: _cc,
    ...cleanEnv
  } = process.env;

  const start = Date.now();

  const proc = spawn({
    cmd,
    cwd,
    env: {
      ...cleanEnv,
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
      PATH: process.env.PATH || "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(userMessage);
  proc.stdin.end();

  let stderrOutput = "";
  const stderrDrain = (async () => {
    try {
      stderrOutput = await new Response(proc.stderr).text();
    } catch {
      /* ignore */
    }
  })();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  let stdoutText: string;
  try {
    stdoutText = await new Response(proc.stdout).text();
  } finally {
    clearTimeout(timeoutId);
    await stderrDrain;
  }

  const exitCode = await proc.exited;

  if (timedOut) {
    throw new ClaudeCliError(
      `claude -p timed out after ${timeoutMs}ms`,
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
      `claude -p returned non-JSON output: ${(err as Error).message}. First 300 chars: ${stdoutText.slice(0, 300)}`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  if (envelope.is_error || envelope.subtype !== "success") {
    throw new ClaudeCliError(
      `claude -p reported error: ${envelope.subtype ?? "unknown"} — ${envelope.result?.slice(0, 300) ?? "(no result)"}`,
      stderrOutput.slice(0, 1000),
      exitCode,
    );
  }

  const text = envelope.result ?? "";
  const inputTokens =
    (envelope.usage?.input_tokens ?? 0) +
    (envelope.usage?.cache_creation_input_tokens ?? 0) +
    (envelope.usage?.cache_read_input_tokens ?? 0);
  const outputTokens = envelope.usage?.output_tokens ?? 0;

  return {
    text,
    inputTokens,
    outputTokens,
    durationMs: envelope.duration_ms ?? Date.now() - start,
    cliReportedCostUsd: envelope.total_cost_usd ?? 0,
    sessionId: envelope.session_id,
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
