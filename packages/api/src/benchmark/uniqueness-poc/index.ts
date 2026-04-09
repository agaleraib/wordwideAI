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
 *   --sequence <id>               Run an `EventSequence` fixture from
 *                                 fixtures/sequences/<id>.json end-to-end:
 *                                 walks steps 1..N-1 through Stage 6 only
 *                                 (persisting state between them), then
 *                                 runs full Stage 6 + Stage 7 on step N
 *                                 against the accumulated history.
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

import type {
  NewsEvent,
  ContentPersona,
  EventSequence,
  RunResult,
} from "./types.js";
import { runUniquenessPoc } from "./runner.js";
import { persistRun, RUNS_OUTPUT_ROOT } from "./persist.js";
import { mkdirSync } from "node:fs";
import {
  FileSystemNarrativeStateStore,
  type NarrativeStateStore,
} from "./narrative-state-store.js";

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
}

async function runOne(
  fixtureId: string,
  opts: RunOneOptions,
): Promise<RunResult> {
  const event = loadFixture(fixtureId);
  const { full } = opts;

  // In --full mode, load ALL FOUR personas for the cross-tenant matrix
  const allPersonas = full
    ? [
        loadPersona("broker-a"),
        loadPersona("broker-b"),
        loadPersona("broker-c"),
        loadPersona("broker-d"),
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

  const runOpts = {
    event,
    ...(full && {
      ...(opts.skipReproducibility
        ? {}
        : {
            withReproducibility: { identityId: "in-house-journalist", runs: 3 },
            withPersonaDifferentiation: {
              identityId: "in-house-journalist",
              personaA: allPersonas[0]!,
              personaB: allPersonas[1]!,
            },
          }),
      withCrossTenantMatrix: {
        identityId: "in-house-journalist",
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
  };

  const result = await runUniquenessPoc(runOpts);
  const dir = persistRun(result);

  console.log(`\n[index] Run complete.`);
  console.log(`[index] Report:        ${join(dir, "report.md")}`);
  console.log(`[index] Run dir:       ${dir}`);
  console.log(`[index] Intra-tenant verdict: ${result.verdict}`);
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

async function runSequence(sequenceId: string): Promise<void> {
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

    const result = await runOne(step.id, {
      full: true,
      store,
      fixtureNamespace: sequence.id,
      persistNarrativeState: true,
      // Steps 2..N read accumulated history into Stage 6 identity calls.
      // Step 1 starts from an empty store so there's nothing to read.
      readNarrativeStateInCrossTenant: i > 0,
      // Only the final step runs Stage 7 (the A/B continuity test).
      // Intermediate steps exist to accumulate history.
      skipNarrativeStateTest: !isFinal,
      // Intermediate steps skip Stage 4+5 to keep sequence cost down.
      // The final step runs them for the usual report.
      skipReproducibility: !isFinal,
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
  for (const personaFile of ["broker-a", "broker-b", "broker-c", "broker-d"]) {
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
  const sequenceFlagIndex = args.indexOf("--sequence");
  const sequenceId =
    sequenceFlagIndex >= 0 ? args[sequenceFlagIndex + 1] : undefined;
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    // Skip the value positional that immediately follows --sequence.
    if (sequenceFlagIndex >= 0 && i === sequenceFlagIndex + 1) return false;
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

  mkdirSync(RUNS_OUTPUT_ROOT, { recursive: true });

  if (sequenceFlagIndex >= 0) {
    if (!sequenceId) {
      console.error("ERROR: --sequence requires a sequence id, e.g. --sequence eur-usd-q2-2026");
      process.exit(1);
    }
    await runSequence(sequenceId);
    return;
  }

  // Lazily construct the store only when persistence is requested so we
  // don't touch the filesystem on default runs.
  const store = persistNarrativeState ? new FileSystemNarrativeStateStore() : undefined;

  if (all) {
    const fixtures = ["iran-strike", "fed-rate-decision", "china-tariffs"];
    console.log(`[index] Running all ${fixtures.length} fixtures${full ? " with --full mode" : ""}...`);
    for (const id of fixtures) {
      await runOne(id, { full, store, persistNarrativeState });
    }
    return;
  }

  const fixtureId = positional[0] ?? "iran-strike";
  console.log(`[index] Running fixture: ${fixtureId}${full ? " (--full mode)" : ""}${persistNarrativeState ? " [persist-narrative-state]" : ""}`);
  await runOne(fixtureId, { full, store, persistNarrativeState });
}

main().catch((err) => {
  console.error("[index] FATAL:", err);
  process.exit(1);
});
