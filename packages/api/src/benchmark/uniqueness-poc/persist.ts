/**
 * Shared persistence helpers for uniqueness PoC runs.
 *
 * Both the CLI (`index.ts`) and the playground HTTP route (`routes/poc.ts`)
 * call into this module so runs land on disk in `uniqueness-poc-runs/<runId>/`
 * with a consistent structure. Every file written here is human-readable
 * (markdown for prose, pretty-printed JSON for structured data) so the
 * `analyze-uniqueness-run` skill can operate on CLI runs and playground
 * runs interchangeably.
 *
 * Layout:
 *
 *   uniqueness-poc-runs/<runId>/
 *     ├── report.md                  ← markdown rollup (Compare only)
 *     ├── core-analysis.md           ← the Stage 1 Opus FA body
 *     ├── raw-data.json              ← the full RunResult or SoloRunResult
 *     ├── similarity-matrix.json     ← intra-tenant similarities (Compare only)
 *     └── outputs/
 *         ├── <identity>.md                         ← Stage 2 (Compare, 6 files)
 *         ├── stage6_<identity>__<persona>.md       ← Stage 6 cross-pipeline
 *         ├── stage7_{control|treatment}_<identity>__<persona>.md  ← Stage 7
 *         └── solo_<identity>__<persona>.md         ← Solo mode output
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RunResult, NewsEvent, IdentityOutput } from "./types.js";
import { renderReport } from "./report.js";

// Resolve the runs output root relative to this module so the helper works
// regardless of the caller's cwd. Same layout the CLI has used since v0.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const RUNS_OUTPUT_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "uniqueness-poc-runs",
);

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/**
 * Write a Compare-mode `RunResult` to disk.
 *
 * Produces `report.md`, `core-analysis.md`, `raw-data.json`,
 * `similarity-matrix.json`, and one file per output under `outputs/`.
 * Returns the absolute path of the run directory.
 */
export function persistRun(result: RunResult): string {
  const runDir = join(RUNS_OUTPUT_ROOT, result.runId);
  ensureDir(runDir);
  ensureDir(join(runDir, "outputs"));

  // The headline artifact
  writeFileSync(join(runDir, "report.md"), renderReport(result), "utf-8");

  writeFileSync(
    join(runDir, "core-analysis.md"),
    `# Core Analysis (FA Agent)\n\n${result.coreAnalysis.body}`,
    "utf-8",
  );

  // Stage 2 — intra-tenant cross-identity (6 different identities)
  for (const output of result.identityOutputs) {
    writeFileSync(
      join(runDir, "outputs", `${output.identityId}.md`),
      `# ${output.identityName}\n\n*${output.wordCount} words*\n\n---\n\n${output.body}`,
      "utf-8",
    );
  }

  // Stage 6 — cross-pipeline matrix (one file per persona)
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

  // Stage 7 — narrative-state control + treatment
  if (result.narrativeStateTest) {
    const ns = result.narrativeStateTest;
    const writeGroup = (
      group: "control" | "treatment",
      outputs: typeof ns.controlOutputs,
    ): void => {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i]!;
        const personaId = output.personaId ?? `unknown-${i}`;
        const label =
          group === "control"
            ? "CONTROL (no narrative state)"
            : "TREATMENT (with narrative state)";
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

/**
 * Solo-mode result shape. Kept as a local interface mirror here (rather than
 * imported from `routes/poc.ts`) so this module stays independent of the
 * HTTP layer. The canonical `SoloRunResult` in `routes/poc.ts` is a
 * structural subtype of this — assignable at the call site via normal
 * TypeScript structural typing.
 */
export interface PersistableSoloRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  event: NewsEvent;
  coreAnalysisBody: string;
  personaId: string;
  output: IdentityOutput;
  totalCostUsd: number;
  totalDurationMs: number;
}

/**
 * Write a Solo-mode run to disk. Different shape than `persistRun` because
 * Solo skips Stage 2 / Stage 6 / Stage 7 and only produces one output.
 */
export function persistSoloRun(result: PersistableSoloRunResult): string {
  const runDir = join(RUNS_OUTPUT_ROOT, result.runId);
  ensureDir(runDir);
  ensureDir(join(runDir, "outputs"));

  // Minimal report: metadata + core analysis + single output
  const reportLines: string[] = [];
  reportLines.push(`# Solo run — ${result.event.title}`);
  reportLines.push("");
  reportLines.push(`**Run id:** \`${result.runId}\``);
  reportLines.push(`**Started:** ${result.startedAt}`);
  reportLines.push(`**Finished:** ${result.finishedAt}`);
  reportLines.push(
    `**Duration:** ${(result.totalDurationMs / 1000).toFixed(1)}s`,
  );
  reportLines.push(`**Cost:** $${result.totalCostUsd.toFixed(4)}`);
  reportLines.push(`**Persona:** ${result.personaId}`);
  reportLines.push(
    `**Identity:** ${result.output.identityName} (\`${result.output.identityId}\`)`,
  );
  reportLines.push("");
  reportLines.push("---");
  reportLines.push("");
  reportLines.push("## Core Analysis (FA Agent)");
  reportLines.push("");
  reportLines.push(result.coreAnalysisBody);
  reportLines.push("");
  reportLines.push("---");
  reportLines.push("");
  reportLines.push(`## ${result.output.identityName} output`);
  reportLines.push("");
  reportLines.push(
    `*${result.output.wordCount} words · ${result.output.model} · ${(result.output.durationMs / 1000).toFixed(1)}s · $${result.output.costUsd.toFixed(4)}*`,
  );
  reportLines.push("");
  reportLines.push(result.output.body);
  reportLines.push("");

  writeFileSync(join(runDir, "report.md"), reportLines.join("\n"), "utf-8");

  writeFileSync(
    join(runDir, "core-analysis.md"),
    `# Core Analysis (FA Agent)\n\n${result.coreAnalysisBody}`,
    "utf-8",
  );

  // Single output file under outputs/
  writeFileSync(
    join(
      runDir,
      "outputs",
      `solo_${result.output.identityId}__${result.personaId}.md`,
    ),
    `# ${result.output.identityName} — ${result.personaId} — SOLO\n\n` +
      `*${result.output.wordCount} words · ${result.output.model} · ${(result.output.durationMs / 1000).toFixed(1)}s · $${result.output.costUsd.toFixed(4)}*\n\n` +
      `---\n\n${result.output.body}`,
    "utf-8",
  );

  writeFileSync(
    join(runDir, "raw-data.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );

  return runDir;
}
