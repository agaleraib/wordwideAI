/**
 * CLI entry point for the uniqueness PoC harness.
 *
 * Usage (from repo root):
 *   bun run packages/api/src/benchmark/uniqueness-poc/index.ts
 *   bun run packages/api/src/benchmark/uniqueness-poc/index.ts iran-strike
 *   bun run packages/api/src/benchmark/uniqueness-poc/index.ts iran-strike --full
 *   bun run packages/api/src/benchmark/uniqueness-poc/index.ts --all
 *
 * Flags:
 *   --full                        Also run reproducibility test (Stage 4) +
 *                                 persona-overlay differentiation test (Stage 5).
 *                                 Adds ~$0.50 in API calls.
 *   --all                         Run all three fixtures sequentially.
 *   --persist-narrative-state     Append Stage 6 outputs to the between-runs
 *                                 narrative-state store. Off by default so
 *                                 existing runs are byte-identical to today.
 *                                 Spec: docs/specs/2026-04-08-narrative-state-persistence.md
 *   --editorial-memory             Enable editorial memory (PostgresEditorialMemoryStore
 *                                 when DATABASE_URL_DEV is set, InMemoryEditorialMemoryStore
 *                                 otherwise). Also enabled by FINFLOW_EDITORIAL_MEMORY=1.
 *   --sequence <id>               Run an `EventSequence` fixture from
 *                                 fixtures/sequences/<id>.json end-to-end:
 *                                 walks steps 1..N-1 through Stage 6 only
 *                                 (persisting state between them), then
 *                                 runs full Stage 6 + Stage 7 on step N
 *                                 against the accumulated history.
 *   --identity <id>               Identity to use for Stages 4 (reproducibility),
 *                                 5 (persona differentiation), and 6 (cross-tenant
 *                                 matrix). Defaults to "in-house-journalist".
 *                                 Must match an IDENTITY_REGISTRY id. Rotate
 *                                 across events to widen identity coverage per
 *                                 Wave 4 iteration (docs/uniqueness-poc-analysis/
 *                                 2026-04-19-wave3.md §3).
 *
 * Output:
 *   uniqueness-poc-runs/<runId>/
 *     ├── report.md          ← the readable artifact (read this first)
 *     ├── core-analysis.md
 *     ├── outputs/<identity>.md (one per identity)
 *     ├── similarity-matrix.json
 *     └── raw-data.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  NewsEvent,
  ContentPersona,
  EventSequence,
  RunResult,
  RunManifest,
} from "./types.js";
import { runUniquenessPoc } from "./runner.js";
import { persistRun, RUNS_OUTPUT_ROOT } from "./persist.js";
import { IDENTITY_REGISTRY } from "./prompts/identities/index.js";
import { mkdirSync } from "node:fs";
import {
  FileSystemNarrativeStateStore,
  type NarrativeStateStore,
} from "./narrative-state-store.js";
import type { EditorialMemoryStore } from "../../memory/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const SEQUENCES_DIR = join(FIXTURES_DIR, "sequences");
const PERSONAS_DIR = join(__dirname, "personas");

/**
 * Walk up from this file looking for a `.env` file and load any keys from it
 * into process.env (without overwriting existing values). This makes the
 * harness work regardless of which directory it's run from — by default Bun
 * only auto-loads `.env` from the current working directory.
 *
 * Lazy clients in similarity.ts and llm-judge.ts read process.env *inside*
 * function calls (not at module load), so this top-level call runs in time.
 */
function loadDotEnvFromRepoRoot(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env) || !process.env[key]) {
          process.env[key] = value;
        }
      }
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const loadedFrom = loadDotEnvFromRepoRoot();

function loadFixture(id: string): NewsEvent {
  const path = join(FIXTURES_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as NewsEvent;
}

/**
 * Load a sequence fixture. Two shapes are supported:
 *
 *   1. Inline: `{ id, title, topicId, steps: NewsEvent[] }`
 *   2. Refs:   `{ id, title, topicId, stepRefs: string[] }` — each ref is a
 *      single-event fixture filename stem under `fixtures/`, which is loaded
 *      and inlined into `steps` in order.
 *
 * The in-memory `EventSequence` type always carries `steps`; `stepRefs` is a
 * file-level convenience for authoring sequences without duplicating prose.
 */
function loadSequence(id: string): EventSequence {
  const path = join(SEQUENCES_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Sequence fixture not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    id: string;
    title: string;
    topicId: string;
    steps?: NewsEvent[];
    stepRefs?: string[];
  };

  let steps: NewsEvent[];
  if (Array.isArray(raw.steps) && raw.steps.length > 0) {
    steps = raw.steps;
  } else if (Array.isArray(raw.stepRefs) && raw.stepRefs.length > 0) {
    steps = raw.stepRefs.map((ref) => loadFixture(ref));
  } else {
    throw new Error(
      `Sequence ${id}: must provide either non-empty "steps" or non-empty "stepRefs"`,
    );
  }

  if (steps.length < 2) {
    throw new Error(
      `Sequence ${id}: requires at least 2 steps for a multi-event continuity test; got ${steps.length}`,
    );
  }

  return { id: raw.id, title: raw.title, topicId: raw.topicId, steps };
}

function loadPersona(id: string): ContentPersona {
  const path = join(PERSONAS_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Persona not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as ContentPersona;
}

// `persistRun` lives in `./persist.js` — shared with the playground HTTP
// route so CLI runs and playground runs land on disk with the exact same
// filesystem layout. Any change to the on-disk format should happen there.

// ─── Manifest builder ────────────────────────────────────────────

function getGitCommitHash(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function detectRuntime(): { name: string; version: string } {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isBun = typeof globalThis.Bun !== "undefined";
  return { name: isBun ? "bun" : "node", version: process.version };
}

function computePromptHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const reg of IDENTITY_REGISTRY) {
    const hash = createHash("sha256").update(reg.definition.systemPrompt).digest("hex").slice(0, 8);
    hashes[reg.definition.id] = hash;
  }
  return hashes;
}

function buildManifest(opts: {
  source: "cli" | "dashboard";
  memoryBackend: RunManifest["memoryBackend"];
  stagesEnabled: RunManifest["stagesEnabled"];
  cliFlags: string[];
  fixtureId: string;
  eventIds: string[];
  personaIds: string[];
  identityIds: string[];
  editorialMemoryState?: RunManifest["editorialMemoryState"];
  sequenceId?: string | null;
  sequenceStep?: number | null;
  sequenceStepCount?: number | null;
}): RunManifest {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    gitCommitHash: getGitCommitHash(),
    source: opts.source,
    runtime: detectRuntime(),
    memoryBackend: opts.memoryBackend,
    editorialMemoryState: opts.editorialMemoryState ?? null,
    stagesEnabled: opts.stagesEnabled,
    cliFlags: opts.cliFlags,
    fixtureId: opts.fixtureId,
    eventIds: opts.eventIds,
    personaIds: opts.personaIds,
    identityIds: opts.identityIds,
    sequenceId: opts.sequenceId ?? null,
    sequenceStep: opts.sequenceStep ?? null,
    sequenceStepCount: opts.sequenceStepCount ?? null,
    promptHashes: computePromptHashes(),
  };
}

interface RunOneOptions {
  full: boolean;
  /** Turn on Stage 6 write-back into the narrative-state store. */
  persistNarrativeState?: boolean;
  /** Sequence mode: also read accumulated state into Stage 6 identity calls. */
  readNarrativeStateInCrossTenant?: boolean;
  /** Store instance to use; when provided, takes precedence over persist-only mode. */
  store?: NarrativeStateStore;
  /** Fixture namespace override — defaults to `fixtureId`. */
  fixtureNamespace?: string;
  /** Skip Stage 7 (used by intermediate steps of a sequence). */
  skipNarrativeStateTest?: boolean;
  /** Skip Stage 4 reproducibility and Stage 5 persona-differentiation (used by sequence intermediate steps). */
  skipReproducibility?: boolean;
  /** Editorial memory store — when provided, injects editorial context into identity calls. */
  editorialMemory?: EditorialMemoryStore;
  /** Memory backend type for manifest. */
  memoryBackend: RunManifest["memoryBackend"];
  /** Raw CLI flags for manifest. */
  cliFlags: string[];
  /** Sequence metadata for manifest. */
  sequenceId?: string | null;
  sequenceStep?: number | null;
  sequenceStepCount?: number | null;
  /**
   * Identity to use for Stage 4/5/6. Defaults to "in-house-journalist" for
   * backward compatibility. Must be a registered identity id — validated at
   * CLI arg parse time, not here.
   */
  identity?: string;
}

/**
 * Run one event end-to-end.
 *
 * Accepts either a loaded `NewsEvent` (sequence mode, where the sequence
 * runner already has the event in hand) or a fixture filename stem (single
 * runs + `--all` mode, where we look up the fixture by filename). The
 * filename-stem overload always hits disk via `loadFixture`; the event
 * overload skips disk entirely.
 *
 * Both overloads were previously collapsed into `(fixtureId: string)` but
 * that broke sequences because a sequence step's `.id` field is the
 * NewsEvent's internal id (e.g. `"iran-strike-2026-04-07"`), NOT the
 * filename stem (`"iran-strike"`), so the re-load would throw.
 */
async function runOne(
  eventOrFixtureId: NewsEvent | string,
  opts: RunOneOptions,
): Promise<RunResult> {
  const event =
    typeof eventOrFixtureId === "string"
      ? loadFixture(eventOrFixtureId)
      : eventOrFixtureId;
  // Prefer the original filename stem (if called with a string) and fall
  // back to the event's internal id. Used for (a) the "auto-load paired
  // continuation fixture" check below, (b) the narrative state store
  // namespace. For sequence steps, the event's internal id doubles as the
  // namespace because the sequence runner already sets
  // `opts.fixtureNamespace` to the sequence id.
  const fixtureId = typeof eventOrFixtureId === "string" ? eventOrFixtureId : event.id;
  const { full } = opts;

  // In --full mode, load ALL SIX personas for the cross-tenant matrix.
  // Distribution across structural variants: a=v1, b=v2, c=v3, d=v1, e=v2, f=v3.
  // Yields 2 same-variant pairs per event (a↔d v1, b↔e v2, c↔f v3) vs 1 pre-Wave 4.
  const allPersonas = full
    ? [
        loadPersona("broker-a"),
        loadPersona("broker-b"),
        loadPersona("broker-c"),
        loadPersona("broker-d"),
        loadPersona("broker-e"),
        loadPersona("broker-f"),
      ]
    : [];

  // Stage 7 — narrative state test only fires for the iran-strike fixture
  // when running solo (it has a paired continuation fixture, iran-retaliation,
  // that makes a realistic narrative thread). Sequences handle Stage 7 at
  // their final step via `skipNarrativeStateTest = false` on the last call.
  const narrativeContinuation =
    full && !opts.skipNarrativeStateTest && fixtureId === "iran-strike"
      ? loadFixture("iran-retaliation")
      : null;

  const hasStage4 = full && !opts.skipReproducibility;
  const hasStage6 = full && allPersonas.length >= 2;
  const hasStage7 = !!narrativeContinuation;
  const eventIds = [event.id];
  if (narrativeContinuation) eventIds.push(narrativeContinuation.id);

  const manifest = buildManifest({
    source: "cli",
    memoryBackend: opts.memoryBackend,
    stagesEnabled: {
      stage1: true,
      stage2: true,
      stage3: true,
      stage4: !!hasStage4,
      stage5: !!hasStage4,
      stage6: !!hasStage6,
      stage7: hasStage7,
    },
    cliFlags: opts.cliFlags,
    fixtureId,
    eventIds,
    personaIds: allPersonas.map((p) => p.id),
    identityIds: [opts.identity ?? "in-house-journalist"],
    sequenceId: opts.sequenceId,
    sequenceStep: opts.sequenceStep,
    sequenceStepCount: opts.sequenceStepCount,
  });

  const runOpts = {
    event,
    manifest,
    ...(full && {
      ...(opts.skipReproducibility
        ? {}
        : {
            withReproducibility: { identityId: opts.identity ?? "in-house-journalist", runs: 3 },
            withPersonaDifferentiation: {
              identityId: opts.identity ?? "in-house-journalist",
              personaA: allPersonas[0]!,
              personaB: allPersonas[1]!,
            },
          }),
      withCrossTenantMatrix: {
        identityId: opts.identity ?? "in-house-journalist",
        personas: allPersonas,
      },
      ...(narrativeContinuation && {
        withNarrativeStateTest: {
          secondEvent: narrativeContinuation,
          priorPublishedAt: event.publishedAt,
        },
      }),
    }),
    store: opts.store,
    fixtureId: opts.fixtureNamespace ?? fixtureId,
    persistNarrativeState: opts.persistNarrativeState,
    readNarrativeStateInCrossTenant: opts.readNarrativeStateInCrossTenant,
    editorialMemory: opts.editorialMemory,
  };

  const result = await runUniquenessPoc(runOpts);
  const dir = persistRun(result);

  console.log(`\n[index] Run complete.`);
  console.log(`[index] Report:        ${join(dir, "report.md")}`);
  console.log(`[index] Run dir:       ${dir}`);
  console.log(`[index] Identity-format diversity verdict (no-persona): ${result.verdict}`);
  if (result.crossTenantMatrix) {
    console.log(`[index] STAGE 6 cross-tenant: ${result.crossTenantMatrix.verdict} (cosine mean ${result.crossTenantMatrix.meanCosine.toFixed(4)})`);
  }
  if (result.narrativeStateTest) {
    const ns = result.narrativeStateTest;
    console.log(`[index] STAGE 7 narrative continuity:`);
    console.log(`[index]   control   cosine mean: ${ns.controlMeanCosine.toFixed(4)}`);
    console.log(`[index]   treatment cosine mean: ${ns.treatmentMeanCosine.toFixed(4)}`);
    console.log(`[index]   IMPROVEMENT (control - treatment): ${ns.cosineImprovement.toFixed(4)} ${ns.cosineImprovement > 0 ? "(treatment more unique ✓)" : "(no improvement ✗)"}`);
    console.log(`[index]   treatment verdict: ${ns.treatmentVerdict}`);
  }
  console.log(`[index] Cost:          $${result.totalCostUsd.toFixed(4)}`);
  console.log(`[index] Duration:      ${(result.totalDurationMs / 1000).toFixed(1)}s`);

  return result;
}

async function runSequence(sequenceId: string, seqOpts: { memoryBackend: RunManifest["memoryBackend"]; cliFlags: string[]; identity?: string }): Promise<void> {
  const sequence = loadSequence(sequenceId);
  console.log(
    `[index] Loaded sequence ${sequence.id}: "${sequence.title}" (${sequence.steps.length} steps, topicId=${sequence.topicId})`,
  );

  // Topic consistency check — every step must share the sequence's topicId
  // since the store is keyed on it. Otherwise state written at step 1 will
  // never be read at step 2.
  for (const step of sequence.steps) {
    if (step.topicId !== sequence.topicId) {
      throw new Error(
        `Sequence ${sequence.id}: step ${step.id} has topicId=${step.topicId} but sequence.topicId=${sequence.topicId}. All steps must share the sequence topic.`,
      );
    }
  }

  const store = new FileSystemNarrativeStateStore();
  const results: RunResult[] = [];

  for (let i = 0; i < sequence.steps.length; i++) {
    const step = sequence.steps[i]!;
    const isFinal = i === sequence.steps.length - 1;
    const stepLabel = `step ${i + 1}/${sequence.steps.length}`;

    console.log(
      `\n[index] ═══════════════════════════════════════════════════════════════`,
    );
    console.log(
      `[index] SEQUENCE ${sequence.id} — ${stepLabel}: ${step.id} — ${step.title}`,
    );
    console.log(
      `[index] ═══════════════════════════════════════════════════════════════\n`,
    );

    // Pass the loaded NewsEvent directly — step.id is the event's internal
    // id (e.g. "iran-strike-2026-04-07"), which doesn't match the filename
    // stem "iran-strike" that loadFixture would look for.
    const result = await runOne(step, {
      full: true,
      store,
      fixtureNamespace: sequence.id,
      persistNarrativeState: true,
      readNarrativeStateInCrossTenant: i > 0,
      skipNarrativeStateTest: !isFinal,
      skipReproducibility: !isFinal,
      memoryBackend: seqOpts.memoryBackend,
      cliFlags: seqOpts.cliFlags,
      sequenceId: sequence.id,
      sequenceStep: i + 1,
      sequenceStepCount: sequence.steps.length,
      identity: seqOpts.identity,
    });
    results.push(result);
  }

  // Sequence-level summary
  console.log(
    `\n[index] ═══════════════════════════════════════════════════════════════`,
  );
  console.log(`[index] SEQUENCE ${sequence.id} COMPLETE`);
  console.log(
    `[index] ═══════════════════════════════════════════════════════════════`,
  );
  const totalCost = results.reduce((sum, r) => sum + r.totalCostUsd, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.totalDurationMs, 0);
  console.log(`[index] Steps run:     ${results.length}`);
  console.log(`[index] Total cost:    $${totalCost.toFixed(4)}`);
  console.log(`[index] Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  const finalResult = results[results.length - 1]!;
  if (finalResult.crossTenantMatrix) {
    console.log(
      `[index] Final Stage 6:  ${finalResult.crossTenantMatrix.verdict} (cosine mean ${finalResult.crossTenantMatrix.meanCosine.toFixed(4)})`,
    );
  }
  if (finalResult.narrativeStateTest) {
    const ns = finalResult.narrativeStateTest;
    console.log(
      `[index] Final Stage 7:  treatment ${ns.treatmentVerdict}, cosine improvement ${ns.cosineImprovement.toFixed(4)}`,
    );
  }

  // Per-persona entry count after the run, for quick sanity
  for (const personaFile of ["broker-a", "broker-b", "broker-c", "broker-d", "broker-e", "broker-f"]) {
    const persona = loadPersona(personaFile);
    const state = await store.get(sequence.id, persona.id, sequence.topicId);
    const count = state?.recentEntries.length ?? 0;
    console.log(
      `[index]   ${persona.id.padEnd(28)} → ${count} entr${count === 1 ? "y" : "ies"} in store`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const all = args.includes("--all");
  const persistNarrativeState = args.includes("--persist-narrative-state");
  const useEditorialMemory =
    args.includes("--editorial-memory") ||
    process.env["FINFLOW_EDITORIAL_MEMORY"] === "1";
  const sequenceFlagIndex = args.indexOf("--sequence");
  const sequenceId =
    sequenceFlagIndex >= 0 ? args[sequenceFlagIndex + 1] : undefined;
  const identityFlagIndex = args.indexOf("--identity");
  const identityArg =
    identityFlagIndex >= 0 ? args[identityFlagIndex + 1] : undefined;
  if (identityFlagIndex >= 0 && !identityArg) {
    console.error("ERROR: --identity requires an id, e.g. --identity trading-desk");
    process.exit(1);
  }
  if (identityArg && !IDENTITY_REGISTRY.some((r) => r.definition.id === identityArg)) {
    const valid = IDENTITY_REGISTRY.map((r) => r.definition.id).join(", ");
    console.error(`ERROR: --identity "${identityArg}" is not a registered identity. Valid: ${valid}`);
    process.exit(1);
  }
  const identity = identityArg;
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    // Skip the value positional that immediately follows --sequence or --identity.
    if (sequenceFlagIndex >= 0 && i === sequenceFlagIndex + 1) return false;
    if (identityFlagIndex >= 0 && i === identityFlagIndex + 1) return false;
    return true;
  });

  if (loadedFrom) {
    console.log(`[index] Loaded env from ${loadedFrom}`);
  } else {
    console.log("[index] No .env file found by walking up from the script location.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is not set. Add it to .env at the repo root.");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY is not set. Add it to .env at the repo root.");
    console.error("(Required for text-embedding-3-small calls used in the uniqueness gate.)");
    process.exit(1);
  }

  // Editorial memory store — lazily instantiated only when the flag is set.
  // Uses PostgresEditorialMemoryStore when DATABASE_URL_DEV or DATABASE_URL is
  // available, otherwise falls back to InMemoryEditorialMemoryStore.
  let editorialMemory: EditorialMemoryStore | undefined;
  let memoryBackendType: RunManifest["memoryBackend"] = "none";
  if (useEditorialMemory) {
    const dbUrl =
      process.env["DATABASE_URL_DEV"] ?? process.env["DATABASE_URL"];
    if (dbUrl) {
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const postgres = (await import("postgres")).default;
      const schema = await import("../../db/schema/editorial-memory.js");
      const { PostgresEditorialMemoryStore } = await import(
        "../../memory/postgres-store.js"
      );
      const { OpenAIEmbeddingService } = await import(
        "../../memory/openai-embeddings.js"
      );
      const client = postgres(dbUrl);
      const db = drizzle(client, { schema });
      editorialMemory = new PostgresEditorialMemoryStore({
        db,
        embeddings: new OpenAIEmbeddingService(),
      });
      memoryBackendType = "editorial-memory-postgres";
      console.log(
        `[index] Editorial memory: PostgresEditorialMemoryStore (${dbUrl.replace(/\/\/.*@/, "//***@")})`,
      );
    } else {
      const { InMemoryEditorialMemoryStore } = await import(
        "../../memory/in-memory-store.js"
      );
      const { OpenAIEmbeddingService } = await import(
        "../../memory/openai-embeddings.js"
      );
      editorialMemory = new InMemoryEditorialMemoryStore({
        embeddings: new OpenAIEmbeddingService(),
      });
      memoryBackendType = "editorial-memory-inmemory";
      console.log(
        "[index] Editorial memory: InMemoryEditorialMemoryStore (no DATABASE_URL — facts will not persist between runs)",
      );
    }
  }

  mkdirSync(RUNS_OUTPUT_ROOT, { recursive: true });

  if (sequenceFlagIndex >= 0) {
    if (!sequenceId) {
      console.error("ERROR: --sequence requires a sequence id, e.g. --sequence eur-usd-q2-2026");
      process.exit(1);
    }
    await runSequence(sequenceId, { memoryBackend: memoryBackendType, cliFlags: args.filter((a) => a.startsWith("--")), identity });
    return;
  }

  // Lazily construct the store only when persistence is requested so we
  // don't touch the filesystem on default runs.
  const store = persistNarrativeState ? new FileSystemNarrativeStateStore() : undefined;

  if (all) {
    const fixtures = ["iran-strike", "fed-rate-decision", "china-tariffs"];
    console.log(`[index] Running all ${fixtures.length} fixtures${full ? " with --full mode" : ""}${identity ? ` [identity=${identity}]` : ""}...`);
    for (const id of fixtures) {
      await runOne(id, { full, store, persistNarrativeState, editorialMemory, memoryBackend: memoryBackendType, cliFlags: args.filter((a) => a.startsWith("--")), identity });
    }
    return;
  }

  const fixtureId = positional[0] ?? "iran-strike";
  console.log(`[index] Running fixture: ${fixtureId}${full ? " (--full mode)" : ""}${persistNarrativeState ? " [persist-narrative-state]" : ""}${editorialMemory ? " [editorial-memory]" : ""}${identity ? ` [identity=${identity}]` : ""}`);
  await runOne(fixtureId, { full, store, persistNarrativeState, editorialMemory, memoryBackend: memoryBackendType, cliFlags: args.filter((a) => a.startsWith("--")), identity });
}

main().catch((err) => {
  console.error("[index] FATAL:", err);
  process.exit(1);
});
