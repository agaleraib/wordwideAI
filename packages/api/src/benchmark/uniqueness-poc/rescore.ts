/**
 * One-shot rescoring of an existing PoC run under the new two-axis judge
 * rubric (factual fidelity + presentation similarity).
 *
 * Read-only on an existing run directory. Does NOT regenerate any content.
 * Does NOT touch the production runner, llm-judge, or report code.
 *
 * Purpose
 * ───────
 * The single-axis "unique vs duplicate" rubric used by the production judge
 * conflates two things that should be independent:
 *
 *   1. Do both documents agree on the shared facts from the source FA/TA
 *      analysis? (levels, probabilities, direction, anchors — MUST be high)
 *   2. Do both documents read as different writers? (voice, structure,
 *      lead, emphasis, framing — SHOULD be different)
 *
 * Under the old rubric, faithful re-presentations of the same source
 * analysis get marked "duplicate" because they share levels and conclusions
 * — even though shared levels and shared conclusions are the REQUIRED state.
 * Conversely, a contrarian output that invents different probabilities or
 * contradicts the source's levels can get marked "unique" because it
 * diverges on the numbers — even though that's a fabrication, not a product
 * feature.
 *
 * This script re-judges the existing Stage 6 outputs with a rubric that
 * separates the two concerns, and emits a side-by-side comparison against
 * the original verdicts for every pair.
 *
 * Usage
 * ─────
 *   bun run packages/api/src/benchmark/uniqueness-poc/rescore.ts [<run-dir>]
 *
 * If <run-dir> is omitted, the most recently modified directory under
 * uniqueness-poc-runs/ is used. <run-dir> may be a name (resolved against
 * uniqueness-poc-runs/) or an absolute path.
 *
 * Output
 * ──────
 *   <run-dir>/report-rescored.md
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCostUsd } from "./pricing.js";
import type {
  RunResult,
  IdentityOutput,
  SimilarityResult,
  ContentPersona,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNS_OUTPUT_ROOT = join(__dirname, "..", "..", "..", "..", "..", "uniqueness-poc-runs");

/**
 * Walk up from this file looking for a `.env` file and load keys into
 * process.env (without overwriting existing values). Mirrors index.ts so
 * this script works regardless of cwd.
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

loadDotEnvFromRepoRoot();

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

// ───────────────────────────────────────────────────────────────────
// New two-axis judge prompt + tool schema
// ───────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are an editorial uniqueness judge for a financial content platform. You are evaluating two pieces of market analysis written for different brokers from the SAME underlying FA/TA source analysis.

Mental model
────────────
Imagine two analysts at two different firms, each subscribed to the same Bloomberg note. Both rephrase it for their own clients without modifying the substance of the analysis. Neither invents new levels, neither reassigns probabilities, neither reverses the directional call. Yet because they are different writers at different desks working on different days, their prose differs — different voice, different structure, different emphasis, different lead, different framing.

That is the target. You are scoring how close the pair is to that target, NOT how close the pair is by raw text overlap.

Two axes, scored independently
──────────────────────────────

AXIS 1 — Factual fidelity (agreement on shared facts)

  Treat as FACTS that MUST MATCH across both documents:
    • Price levels: support, resistance, stop-loss, take-profit, invalidation, pivot
    • Scenario probabilities and confidence figures
    • Directional call (long/short, bullish/bearish on the primary view)
    • Historical analogs and named events cited from the source
    • Factual anchors: cited prices, instruments, timeframes
    • The SET of transmission chains identified by the source analysis
      (the SET is a fact; which chain LEADS is framing, see below)
    • The ultimate directional conclusion

  Treat as FRAMING (not facts) — these are allowed to differ:
    • Which transmission chain leads vs is mentioned in passing
    • Which scenario gets the most space
    • Which level is foregrounded vs footnoted
    • Whether a given chain is rendered narratively or bulleted

  HIGH fidelity (0.9–1.0) is the EXPECTED and DESIRED state.
  LOW fidelity means one document invented, reassigned, or contradicted facts relative to the other. This is a RED FLAG (fabrication risk), NOT a sign of healthy uniqueness.

  HARD RULE: if either document contains a level, probability, stop, direction, or named historical analog that is contradicted or materially altered by the other, you MUST return verdict "fabrication_risk" regardless of any other score. A single invented level is not outweighed by good writing.

AXIS 2 — Presentation similarity (how alike the pair reads as prose)

  Score ONLY on:
    • Voice, tone, register, audience address
    • Which fact/chain/scenario leads; section order; emphasis
    • Sentence construction patterns, lexical choices, rhythm
    • Framing devices, analogies, metaphors
    • Reasoning style (narrative vs bulleted, Socratic vs declarative)
    • Structural choices (merged sections, headlines, callouts)
    • Lead paragraph, closing paragraph

  DO NOT let shared levels, probabilities, directional calls, historical analogs, or conclusions count toward presentation similarity. Those are fixed by the shared source and are IRRELEVANT to this axis.

  HIGH (0.8–1.0) = same writer, same voice, same structure. Failure.
  LOW  (0.0–0.4) = different writers at different desks. Target.

Calibration anchors for AXIS 2
──────────────────────────────
  0.0–0.2  Unmistakably distinct products. Different lead, different structure, different voice register, different framing — same facts, entirely different reading experience.
  0.3–0.5  Recognisably different voices, shared structural backbone. A discerning reader would notice kinship.
  0.6–0.8  Same article lightly reskinned. Voice varies but structure, emphasis, and lead are near-identical. Derivative.
  0.9–1.0  Effectively the same article with cosmetic variation.

Always explain reasoning by pointing to concrete passages. Quote briefly. If you mark factual fidelity below 0.9 or return "fabrication_risk", name every specific fact that diverges.`;

const JUDGE_TOOL = {
  name: "submit_uniqueness_verdict",
  description:
    "Submit a structured two-axis verdict on a pair of market-analysis documents produced from the same shared FA/TA source. Axis 1 measures factual fidelity (should be high). Axis 2 measures presentation similarity (should be low).",
  input_schema: {
    type: "object" as const,
    required: [
      "factualFidelity",
      "factualFidelityReasoning",
      "factualDivergences",
      "presentationSimilarity",
      "presentationSimilarityReasoning",
      "verdict",
    ],
    properties: {
      factualFidelity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Agreement on facts that must be shared: levels, probabilities, direction, anchors, set of transmission chains, conclusion. Expected near 1.0. Values below 0.9 indicate fabrication risk.",
      },
      factualFidelityReasoning: {
        type: "string",
        description: "1–3 sentences. Cite specific facts if fidelity < 1.0.",
      },
      factualDivergences: {
        type: "array",
        description:
          "Every material fact that differs between A and B. Empty if both documents are fully faithful. NON-EMPTY with kind ∈ {level, probability, direction, stop, historical_anchor} forces verdict = 'fabrication_risk'.",
        items: {
          type: "object",
          required: ["kind", "docA", "docB"],
          properties: {
            kind: {
              type: "string",
              enum: [
                "level",
                "probability",
                "direction",
                "stop",
                "confidence",
                "historical_anchor",
                "transmission_chain_set",
                "conclusion",
                "other",
              ],
            },
            docA: { type: "string", description: "What document A says." },
            docB: { type: "string", description: "What document B says." },
          },
        },
      },
      presentationSimilarity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How similar the prose reads — voice, structure, lead, emphasis, framing. IGNORE shared facts. Use the calibration anchors in the system prompt.",
      },
      presentationSimilarityReasoning: {
        type: "string",
        description: "1–3 sentences. Quote concrete passages that drove the score.",
      },
      verdict: {
        type: "string",
        enum: [
          "distinct_products",
          "reskinned_same_article",
          "fabrication_risk",
        ],
        description:
          "Trinary verdict. 'distinct_products' = fidelity ≥ 0.9 AND presentation < 0.5. 'reskinned_same_article' = fidelity ≥ 0.9 AND presentation ≥ 0.5. 'fabrication_risk' = fidelity < 0.9 OR hard-rule triggered by any level/probability/direction/stop/historical_anchor divergence.",
      },
    },
  },
};

// ───────────────────────────────────────────────────────────────────
// Types local to this script
// ───────────────────────────────────────────────────────────────────

interface FactualDivergence {
  kind: string;
  docA: string;
  docB: string;
}

interface TwoAxisVerdict {
  factualFidelity: number;
  factualFidelityReasoning: string;
  factualDivergences: FactualDivergence[];
  presentationSimilarity: number;
  presentationSimilarityReasoning: string;
  verdict: "distinct_products" | "reskinned_same_article" | "fabrication_risk";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface RescoredPair {
  sim: SimilarityResult;
  verdict: TwoAxisVerdict;
}

// ───────────────────────────────────────────────────────────────────
// Judge call
// ───────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

async function judge(
  nameA: string,
  contentA: string,
  nameB: string,
  contentB: string,
): Promise<TwoAxisVerdict> {
  const client = getClient();

  const userMessage = `Pair under review.

Both documents were written from the SAME underlying FA/TA source analysis, for two different brokers. Apply the two-axis rubric.

# Document A — ${nameA}

\`\`\`
${contentA}
\`\`\`

# Document B — ${nameB}

\`\`\`
${contentB}
\`\`\`

Submit your verdict via the submit_uniqueness_verdict tool.`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2048,
    system: JUDGE_SYSTEM_PROMPT,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool", name: "submit_uniqueness_verdict" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Judge did not return a tool_use block: ${JSON.stringify(response.content)}`,
    );
  }

  const input = toolUse.input as {
    factualFidelity: number;
    factualFidelityReasoning: string;
    factualDivergences: FactualDivergence[];
    presentationSimilarity: number;
    presentationSimilarityReasoning: string;
    verdict: TwoAxisVerdict["verdict"];
  };

  return {
    ...input,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: computeCostUsd(
      JUDGE_MODEL,
      response.usage.input_tokens,
      response.usage.output_tokens,
    ),
  };
}

// ───────────────────────────────────────────────────────────────────
// Run-directory resolution
// ───────────────────────────────────────────────────────────────────

function resolveRunDir(arg: string | undefined): string {
  if (arg) {
    if (arg.startsWith("/")) return arg;
    return join(RUNS_OUTPUT_ROOT, arg);
  }
  const entries = readdirSync(RUNS_OUTPUT_ROOT)
    .map((name) => ({ name, path: join(RUNS_OUTPUT_ROOT, name) }))
    .filter((e) => {
      try {
        return statSync(e.path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  if (entries.length === 0) {
    throw new Error(`No run directories in ${RUNS_OUTPUT_ROOT}`);
  }
  return entries[0]!.path;
}

// ───────────────────────────────────────────────────────────────────
// Pair → output resolution
// ───────────────────────────────────────────────────────────────────

/**
 * In Stage 6, `similarity.identityA/B` holds the persona NAME (see runner.ts
 * line 369–370). Each output carries `personaId`. We match by looking up
 * the persona id from its name, then finding the output with that personaId.
 */
function findOutputByPersonaName(
  outputs: IdentityOutput[],
  personas: ContentPersona[],
  personaName: string,
): IdentityOutput {
  const persona = personas.find((p) => p.name === personaName);
  if (!persona) {
    throw new Error(
      `No persona named "${personaName}" in personas: ${personas.map((p) => p.name).join(", ")}`,
    );
  }
  const output = outputs.find((o) => o.personaId === persona.id);
  if (!output) {
    throw new Error(
      `No output with personaId "${persona.id}" in outputs: ${outputs.map((o) => o.personaId).join(", ")}`,
    );
  }
  return output;
}

// ───────────────────────────────────────────────────────────────────
// Re-score a stage (every pair, not just borderline)
// ───────────────────────────────────────────────────────────────────

async function rescoreStage(
  stageName: string,
  outputs: IdentityOutput[],
  personas: ContentPersona[],
  similarities: SimilarityResult[],
): Promise<RescoredPair[]> {
  console.log(`[rescore] ${stageName}: judging ${similarities.length} pair(s)...`);
  const results: RescoredPair[] = [];
  for (const sim of similarities) {
    const outA = findOutputByPersonaName(outputs, personas, sim.identityA);
    const outB = findOutputByPersonaName(outputs, personas, sim.identityB);
    const verdict = await judge(sim.identityA, outA.body, sim.identityB, outB.body);
    results.push({ sim, verdict });
    const divergenceNote =
      verdict.factualDivergences.length > 0
        ? ` (${verdict.factualDivergences.length} divergence${verdict.factualDivergences.length === 1 ? "" : "s"})`
        : "";
    console.log(
      `[rescore]   ${sim.identityA} ↔ ${sim.identityB}: ` +
        `fidelity=${verdict.factualFidelity.toFixed(2)} ` +
        `presentation=${verdict.presentationSimilarity.toFixed(2)} ` +
        `→ ${verdict.verdict}${divergenceNote}`,
    );
  }
  return results;
}

// ───────────────────────────────────────────────────────────────────
// Report rendering
// ───────────────────────────────────────────────────────────────────

function verdictBadge(verdict: TwoAxisVerdict["verdict"]): string {
  switch (verdict) {
    case "distinct_products":
      return "✅ distinct";
    case "reskinned_same_article":
      return "❌ reskinned";
    case "fabrication_risk":
      return "🚨 fabrication";
  }
}

function renderStageSection(
  stageTitle: string,
  stageDescription: string,
  rescored: RescoredPair[],
): string[] {
  const lines: string[] = [];
  lines.push(`## ${stageTitle}`);
  lines.push("");
  lines.push(stageDescription);
  lines.push("");

  // Summary stats
  const counts = {
    distinct: rescored.filter((r) => r.verdict.verdict === "distinct_products").length,
    reskinned: rescored.filter((r) => r.verdict.verdict === "reskinned_same_article").length,
    fabrication: rescored.filter((r) => r.verdict.verdict === "fabrication_risk").length,
  };
  const n = rescored.length;
  const meanFidelity = rescored.reduce((a, b) => a + b.verdict.factualFidelity, 0) / n;
  const meanPresentation =
    rescored.reduce((a, b) => a + b.verdict.presentationSimilarity, 0) / n;
  const meanRawCosine = rescored.reduce((a, b) => a + b.sim.cosineSimilarity, 0) / n;
  const meanRawRouge = rescored.reduce((a, b) => a + b.sim.rougeL, 0) / n;

  lines.push("**Summary:**");
  lines.push("");
  lines.push(`- Raw (unmasked) cosine mean: **${meanRawCosine.toFixed(4)}**`);
  lines.push(`- Raw ROUGE-L mean: **${meanRawRouge.toFixed(4)}**`);
  lines.push(
    `- Factual fidelity mean: **${meanFidelity.toFixed(2)}** (target ≥ 0.9 — lower = fabrication risk)`,
  );
  lines.push(
    `- Presentation similarity mean: **${meanPresentation.toFixed(2)}** (target < 0.5 — this is the uniqueness axis)`,
  );
  lines.push(
    `- Verdicts: **${counts.distinct} distinct** / **${counts.reskinned} reskinned** / **${counts.fabrication} fabrication_risk**`,
  );
  lines.push("");

  // Overview table
  lines.push(
    "| Pair | Cosine (raw) | ROUGE-L (raw) | Old verdict | Fidelity | Presentation | New verdict |",
  );
  lines.push("|---|---:|---:|---|---:|---:|---|");
  for (const { sim, verdict } of rescored) {
    const oldVerdict = sim.judgeVerdict ?? "_(not judged)_";
    lines.push(
      `| ${sim.identityA} ↔ ${sim.identityB} | ${sim.cosineSimilarity.toFixed(4)} | ${sim.rougeL.toFixed(4)} | ${oldVerdict} | ${verdict.factualFidelity.toFixed(2)} | ${verdict.presentationSimilarity.toFixed(2)} | ${verdictBadge(verdict.verdict)} |`,
    );
  }
  lines.push("");

  // Per-pair detail
  for (const { sim, verdict } of rescored) {
    lines.push(`### ${sim.identityA} ↔ ${sim.identityB}`);
    lines.push("");
    lines.push(`**Verdict:** \`${verdict.verdict}\` ${verdictBadge(verdict.verdict)}`);
    lines.push("");
    lines.push(
      `**Factual fidelity:** ${verdict.factualFidelity.toFixed(2)} &nbsp;·&nbsp; **Presentation similarity:** ${verdict.presentationSimilarity.toFixed(2)}`,
    );
    lines.push("");
    lines.push(`**Fidelity reasoning:**`);
    lines.push("");
    lines.push(`> ${verdict.factualFidelityReasoning}`);
    lines.push("");
    if (verdict.factualDivergences.length > 0) {
      lines.push(`**Factual divergences (${verdict.factualDivergences.length}):**`);
      lines.push("");
      for (const d of verdict.factualDivergences) {
        lines.push(`- \`${d.kind}\` — **A:** ${d.docA} &nbsp;·&nbsp; **B:** ${d.docB}`);
      }
      lines.push("");
    }
    lines.push(`**Presentation reasoning:**`);
    lines.push("");
    lines.push(`> ${verdict.presentationSimilarityReasoning}`);
    lines.push("");
    if (sim.judgeReasoning) {
      lines.push(`<details><summary>Original single-axis judge reasoning</summary>`);
      lines.push("");
      lines.push(`**Old verdict:** \`${sim.judgeVerdict ?? "n/a"}\``);
      lines.push("");
      lines.push(`> ${sim.judgeReasoning}`);
      lines.push("");
      lines.push(`</details>`);
      lines.push("");
    }
  }

  return lines;
}

// ───────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runDir = resolveRunDir(process.argv[2]);
  console.log(`[rescore] Run directory: ${runDir}`);

  const rawPath = join(runDir, "raw-data.json");
  const raw = JSON.parse(readFileSync(rawPath, "utf-8")) as RunResult;
  console.log(`[rescore] Loaded ${rawPath}`);
  console.log(`[rescore] Event: ${raw.event.title}`);

  const lines: string[] = [];
  lines.push(`# Rescored report — ${raw.runId}`);
  lines.push("");
  lines.push(`**Event:** ${raw.event.title}`);
  lines.push(`**Original run started:** ${raw.startedAt}`);
  lines.push(`**Rescored at:** ${new Date().toISOString()}`);
  lines.push(`**Original report:** [\`report.md\`](./report.md)`);
  lines.push("");
  lines.push(
    "This report re-judges the existing run's Stage 6 outputs under a new two-axis rubric. **No text was regenerated.** Only the judge was re-run with the new prompt.",
  );
  lines.push("");
  lines.push(`## The new rubric in one paragraph`);
  lines.push("");
  lines.push(
    "The old single-axis rubric (`unique` vs `duplicate`) conflated two independent concerns: agreement on shared facts and similarity of prose presentation. Under the new rubric these are scored separately. **Factual fidelity** (expected ≥ 0.9) measures agreement on levels, probabilities, directional calls, historical anchors, and transmission chains — facts that MUST be shared across personas because they come from the same source FA/TA analysis. A low score here is a fabrication red flag, not a win. **Presentation similarity** (target < 0.5) measures how alike the prose reads — voice, structure, lead, emphasis, framing — while explicitly ignoring shared facts. This is the actual uniqueness metric. The mental model is two analysts at different firms rephrasing the same Bloomberg note for their respective clients: facts identical, prose different.",
  );
  lines.push("");
  lines.push(`## Verdict legend`);
  lines.push("");
  lines.push(
    "- ✅ **distinct_products** — fidelity ≥ 0.9 AND presentation < 0.5. Both writers faithful to the source; prose genuinely differs. This is the target.",
  );
  lines.push(
    "- ❌ **reskinned_same_article** — fidelity ≥ 0.9 AND presentation ≥ 0.5. Both writers faithful to the source; but prose is too similar. This is the tunable failure mode.",
  );
  lines.push(
    "- 🚨 **fabrication_risk** — fidelity < 0.9 OR any level/probability/direction/stop/historical-anchor divergence. At least one writer invented or contradicted facts from the source. **This is an alarm, not a uniqueness win.**",
  );
  lines.push("");

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalPairs = 0;

  if (raw.crossTenantMatrix) {
    const rescored = await rescoreStage(
      "Stage 6 — cross-tenant matrix",
      raw.crossTenantMatrix.outputs,
      raw.crossTenantMatrix.personas,
      raw.crossTenantMatrix.similarities,
    );
    for (const r of rescored) {
      totalCost += r.verdict.costUsd;
      totalInputTokens += r.verdict.inputTokens;
      totalOutputTokens += r.verdict.outputTokens;
      totalPairs += 1;
    }
    lines.push(
      ...renderStageSection(
        "Stage 6 — cross-tenant matrix",
        "The load-bearing cross-tenant test: one identity (`in-house-journalist`), N personas, shared universal core analysis, pairwise matrix.",
        rescored,
      ),
    );
  } else {
    console.log(`[rescore] No crossTenantMatrix in raw-data.json — skipping Stage 6`);
  }

  lines.push("---");
  lines.push("");
  lines.push("## Rescoring cost");
  lines.push("");
  lines.push(`- Pairs judged: **${totalPairs}**`);
  lines.push(`- Input tokens: ${totalInputTokens.toLocaleString()}`);
  lines.push(`- Output tokens: ${totalOutputTokens.toLocaleString()}`);
  lines.push(`- Total cost: **$${totalCost.toFixed(4)}** (${JUDGE_MODEL})`);
  lines.push("");

  const outPath = join(runDir, "report-rescored.md");
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`[rescore] Wrote ${outPath}`);
  console.log(`[rescore] Total cost: $${totalCost.toFixed(4)} across ${totalPairs} pairs`);
}

main().catch((err) => {
  console.error("[rescore] FATAL:", err);
  process.exit(1);
});
