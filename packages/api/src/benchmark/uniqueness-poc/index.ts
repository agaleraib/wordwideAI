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
 *   --full          Also run reproducibility test (Stage 4) + persona-overlay
 *                   differentiation test (Stage 5). Adds ~$0.50 in API calls.
 *   --all           Run all three fixtures sequentially.
 *
 * Output:
 *   uniqueness-poc-runs/<runId>/
 *     ├── report.md          ← the readable artifact (read this first)
 *     ├── core-analysis.md
 *     ├── outputs/<identity>.md (one per identity)
 *     ├── similarity-matrix.json
 *     └── raw-data.json
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NewsEvent, ContentPersona, RunResult } from "./types.js";
import { runUniquenessPoc } from "./runner.js";
import { renderReport } from "./report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const PERSONAS_DIR = join(__dirname, "personas");
const RUNS_OUTPUT_ROOT = join(__dirname, "..", "..", "..", "..", "..", "uniqueness-poc-runs");

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

function loadPersona(id: string): ContentPersona {
  const path = join(PERSONAS_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(`Persona not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as ContentPersona;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function persistRun(result: RunResult): string {
  const runDir = join(RUNS_OUTPUT_ROOT, result.runId);
  ensureDir(runDir);
  ensureDir(join(runDir, "outputs"));

  // The headline artifact
  writeFileSync(join(runDir, "report.md"), renderReport(result), "utf-8");

  // Convenience: each piece as its own file, organized by stage.
  //
  // Stage 2 — intra-tenant cross-identity: 6 different identities on the
  //           same core analysis, same notional broker. Filename uses the
  //           identity id (unique within this stage).
  // Stage 6 — cross-tenant: ONE identity (`in-house-journalist`) rendered
  //           under N different tenant personas. All 4 outputs have the
  //           same `identityId`, so filenames must include `personaId` to
  //           avoid clobbering each other.
  // Stage 7 — narrative-state A/B: same identity, 4 personas, TWO passes
  //           (control without state, treatment with state) on the second
  //           event. Filenames include stage + group + persona.
  writeFileSync(
    join(runDir, "core-analysis.md"),
    `# Core Analysis (FA Agent)\n\n${result.coreAnalysis.body}`,
    "utf-8",
  );

  // Stage 2 — intra-tenant cross-identity
  for (const output of result.identityOutputs) {
    writeFileSync(
      join(runDir, "outputs", `${output.identityId}.md`),
      `# ${output.identityName}\n\n*${output.wordCount} words*\n\n---\n\n${output.body}`,
      "utf-8",
    );
  }

  // Stage 6 — cross-tenant matrix (one file per persona)
  if (result.crossTenantMatrix) {
    const ct = result.crossTenantMatrix;
    for (let i = 0; i < ct.outputs.length; i++) {
      const output = ct.outputs[i]!;
      const persona = ct.personas[i]!;
      writeFileSync(
        join(
          runDir,
          "outputs",
          `stage6_${output.identityId}__${output.personaId ?? persona.id}.md`,
        ),
        `# ${output.identityName} — ${persona.name}\n\n` +
          `*${output.wordCount} words · ${persona.regionalVariant} · ${persona.brandVoice}*\n\n` +
          `---\n\n${output.body}`,
        "utf-8",
      );
    }
  }

  // Stage 7 — narrative-state control + treatment (one file per persona per group)
  if (result.narrativeStateTest) {
    const ns = result.narrativeStateTest;
    const writeGroup = (
      group: "control" | "treatment",
      outputs: typeof ns.controlOutputs,
    ): void => {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i]!;
        const personaId = output.personaId ?? `unknown-${i}`;
        const label = group === "control" ? "CONTROL (no narrative state)" : "TREATMENT (with narrative state)";
        writeFileSync(
          join(
            runDir,
            "outputs",
            `stage7_${group}_${output.identityId}__${personaId}.md`,
          ),
          `# ${output.identityName} — ${personaId} — ${label}\n\n` +
            `*${output.wordCount} words · event: ${ns.secondEvent.title}*\n\n` +
            `---\n\n${output.body}`,
          "utf-8",
        );
      }
    };
    writeGroup("control", ns.controlOutputs);
    writeGroup("treatment", ns.treatmentOutputs);
  }

  // Raw structured data for cross-run analysis
  writeFileSync(
    join(runDir, "similarity-matrix.json"),
    JSON.stringify(result.similarities, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "raw-data.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );

  return runDir;
}

async function runOne(fixtureId: string, full: boolean): Promise<RunResult> {
  const event = loadFixture(fixtureId);

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
  // (it has a paired continuation fixture, iran-retaliation, that makes a
  // realistic narrative thread)
  const narrativeContinuation =
    full && fixtureId === "iran-strike" ? loadFixture("iran-retaliation") : null;

  const opts = {
    event,
    ...(full && {
      withReproducibility: { identityId: "in-house-journalist", runs: 3 },
      withPersonaDifferentiation: {
        identityId: "in-house-journalist",
        personaA: allPersonas[0]!,
        personaB: allPersonas[1]!,
      },
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
  };

  const result = await runUniquenessPoc(opts);
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

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const all = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));

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

  ensureDir(RUNS_OUTPUT_ROOT);

  if (all) {
    const fixtures = ["iran-strike", "fed-rate-decision", "china-tariffs"];
    console.log(`[index] Running all ${fixtures.length} fixtures${full ? " with --full mode" : ""}...`);
    for (const id of fixtures) {
      await runOne(id, full);
    }
    return;
  }

  const fixtureId = positional[0] ?? "iran-strike";
  console.log(`[index] Running fixture: ${fixtureId}${full ? " (--full mode)" : ""}`);
  await runOne(fixtureId, full);
}

main().catch((err) => {
  console.error("[index] FATAL:", err);
  process.exit(1);
});
