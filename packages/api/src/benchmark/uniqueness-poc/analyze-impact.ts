/**
 * Editorial Memory Impact Report — focused analysis of whether editorial memory
 * improves cross-tenant content divergence compared to narrative state.
 *
 * This report answers ONE question: "Did editorial memory make content across
 * tenants more unique?" It does NOT compare outputs within the same tenant
 * (we expect those to be similar). It compares the cross-tenant similarity
 * matrices: control group (narrative state) vs treatment group (editorial memory).
 *
 * Usage:
 *   bun run poc:analyze:impact <runDir>
 *
 * Output: editorial-memory-impact.md in the run directory + stdout
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  RunResult,
  RunManifest,
  SimilarityResult,
  NarrativeStateTestResult,
} from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(sq);
}

// ─── Report Renderer ──────────────────────────────────────────────

function renderImpactReport(r: RunResult): string {
  const ns = r.narrativeStateTest;
  if (!ns) {
    return [
      "# Editorial Memory Impact Report",
      "",
      "**No Stage 7 data.** This run did not include a narrative continuity test.",
      "Run with `--full --editorial-memory` to generate the A/B comparison.",
    ].join("\n");
  }

  const lines: string[] = [];

  // ─── Header ───
  lines.push(`# Editorial Memory Impact Report`);
  lines.push("");
  lines.push(`> **Question:** Does editorial memory (vector DB) produce more cross-tenant`);
  lines.push(`> content divergence than the narrative state extractor?`);
  lines.push("");
  lines.push(`**Run:** \`${r.runId}\``);
  lines.push(`**Event 1 (Stage 6):** ${r.event.title}`);
  lines.push(`**Event 2 (Stage 7):** ${ns.secondEvent.title}`);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const m: RunManifest | undefined = r.manifest ?? undefined;
  if (m) {
    lines.push(`**Memory backend:** ${m.memoryBackend} | **Runtime:** ${m.runtime.name} ${m.runtime.version} | **Git:** \`${m.gitCommitHash ?? "?"}\``);
  }
  lines.push("");

  // ─── Verdict ───
  const improved = ns.cosineImprovement > 0;
  const improvementPct = ns.controlMeanCosine > 0
    ? ns.cosineImprovement / ns.controlMeanCosine
    : 0;
  const pairsImproved = ns.controlSimilarities.filter((ctrl, i) => {
    const treat = ns.treatmentSimilarities[i];
    return treat && ctrl.cosineSimilarity > treat.cosineSimilarity;
  }).length;
  const totalPairs = ns.controlSimilarities.length;

  lines.push(`## Verdict`);
  lines.push("");
  if (improved) {
    lines.push(`### ✅ Editorial memory improves cross-tenant divergence`);
    lines.push("");
    lines.push(`Treatment (editorial memory) produced **${pct(improvementPct)} lower cosine similarity** across tenant pairs than control (narrative state). ${pairsImproved} of ${totalPairs} pairs improved.`);
  } else {
    lines.push(`### ❌ Editorial memory did NOT improve cross-tenant divergence`);
    lines.push("");
    lines.push(`Treatment (editorial memory) produced **${pct(Math.abs(improvementPct))} higher cosine similarity** (more similar, worse). ${pairsImproved} of ${totalPairs} pairs improved.`);
  }
  lines.push("");

  // ─── Headline Numbers ───
  lines.push(`## Cross-Tenant Divergence: Control vs Treatment`);
  lines.push("");
  lines.push(`*Lower cosine = more unique content across tenants. That's the goal.*`);
  lines.push("");
  lines.push(`| Metric | Control (narrative state) | Treatment (editorial memory) | Delta | Direction |`);
  lines.push(`|--------|--------------------------|------------------------------|-------|-----------|`);
  lines.push(`| **Cosine mean** | ${fmt(ns.controlMeanCosine)} | ${fmt(ns.treatmentMeanCosine)} | **${fmt(Math.abs(ns.cosineImprovement))}** | ${improved ? "↓ more unique ✅" : "↑ more similar ❌"} |`);
  lines.push(`| ROUGE-L mean | ${fmt(ns.controlMeanRougeL)} | ${fmt(ns.treatmentMeanRougeL)} | ${fmt(Math.abs(ns.rougeLImprovement))} | ${ns.rougeLImprovement > 0 ? "↓ ✅" : "↑ ❌"} |`);
  lines.push("");

  const ctrlCosines = ns.controlSimilarities.map(s => s.cosineSimilarity);
  const treatCosines = ns.treatmentSimilarities.map(s => s.cosineSimilarity);
  lines.push(`| | Control | Treatment |`);
  lines.push(`|---|---------|-----------|`);
  lines.push(`| Cosine stddev | ${fmt(stddev(ctrlCosines))} | ${fmt(stddev(treatCosines))} |`);
  lines.push(`| Cosine min | ${fmt(Math.min(...ctrlCosines))} | ${fmt(Math.min(...treatCosines))} |`);
  lines.push(`| Cosine max | ${fmt(Math.max(...ctrlCosines))} | ${fmt(Math.max(...treatCosines))} |`);
  lines.push("");

  // ─── Per-Pair Delta ───
  lines.push(`## Per-Pair Breakdown`);
  lines.push("");
  lines.push(`*Each row is a cross-tenant pair. The delta shows whether editorial memory made that pair's content more unique (↓) or more similar (↑).*`);
  lines.push("");
  lines.push(`| Tenant A | Tenant B | Control | Treatment | Delta | Improved? |`);
  lines.push(`|----------|----------|---------|-----------|-------|-----------|`);
  for (let i = 0; i < ns.controlSimilarities.length; i++) {
    const ctrl = ns.controlSimilarities[i]!;
    const treat = ns.treatmentSimilarities[i]!;
    const delta = ctrl.cosineSimilarity - treat.cosineSimilarity;
    const imp = delta > 0;
    lines.push(`| ${ctrl.identityA} | ${ctrl.identityB} | ${fmt(ctrl.cosineSimilarity)} | ${fmt(treat.cosineSimilarity)} | ${imp ? "↓" : "↑"} ${fmt(Math.abs(delta))} | ${imp ? "✅" : "❌"} |`);
  }
  lines.push("");

  // Count verdicts
  const ctrlFabs = ns.controlSimilarities.filter(s => s.judgeTrinaryVerdict === "fabrication_risk").length;
  const treatFabs = ns.treatmentSimilarities.filter(s => s.judgeTrinaryVerdict === "fabrication_risk").length;
  lines.push(`| | Control | Treatment |`);
  lines.push(`|---|---------|-----------|`);
  lines.push(`| Pairs improved | — | ${pairsImproved}/${totalPairs} |`);
  lines.push(`| Fabrication flags | ${ctrlFabs} | ${treatFabs} |`);
  lines.push("");

  if (treatFabs > 0) {
    lines.push(`> ⚠️ ${treatFabs} treatment pair(s) flagged as fabrication risk. Editorial memory improved divergence but some personas are inventing facts. This needs to be fixed independently — it's a persona guardrail issue, not an editorial memory issue.`);
    lines.push("");
  }

  // ─── Why: What Was Injected ───
  lines.push(`## What Each Tenant Remembered`);
  lines.push("");
  lines.push(`*The control group received extracted narrative state (structured summary of prior coverage). The treatment group received editorial memory from the vector DB (accumulated editorial facts). The difference in what was injected explains why cross-tenant divergence changed.*`);
  lines.push("");

  for (const nsEntry of ns.narrativeStates) {
    const entry = nsEntry.state.recentEntries[0];
    lines.push(`### ${nsEntry.personaName}`);
    lines.push("");
    lines.push(`**Narrative state (control):**`);
    if (entry) {
      lines.push(`- View: ${entry.directionalView} (${entry.directionalViewConfidence})`);
      lines.push(`- Summary: ${entry.oneSentenceSummary}`);
      if (entry.keyThesisStatements.length > 0) {
        lines.push(`- Thesis: ${entry.keyThesisStatements[0]!}`);
        if (entry.keyThesisStatements.length > 1) {
          lines.push(`  *(+ ${entry.keyThesisStatements.length - 1} more)*`);
        }
      }
      if (entry.keyLevelsMentioned.length > 0) {
        lines.push(`- Key levels: ${entry.keyLevelsMentioned.slice(0, 3).join("; ")}${entry.keyLevelsMentioned.length > 3 ? " ..." : ""}`);
      }
    } else {
      lines.push(`- *(no narrative state extracted)*`);
    }
    lines.push("");
  }

  // ─── Per-Tenant A vs B ───
  lines.push(`## Per-Tenant: Control vs Treatment Output`);
  lines.push("");
  lines.push(`*Same tenant, same event, different memory system. We expect high similarity — the value is seeing what editorial memory changed in each tenant's output.*`);
  lines.push("");

  for (let i = 0; i < ns.narrativeStates.length; i++) {
    const persona = ns.narrativeStates[i]!;
    const ctrl = ns.controlOutputs[i]!;
    const treat = ns.treatmentOutputs[i]!;

    lines.push(`### ${persona.personaName}`);
    lines.push("");
    lines.push(`| | Control (narrative state) | Treatment (editorial memory) |`);
    lines.push(`|---|--------------------------|------------------------------|`);
    lines.push(`| Words | ${ctrl.wordCount} | ${treat.wordCount} |`);
    lines.push(`| Duration | ${(ctrl.durationMs / 1000).toFixed(1)}s | ${(treat.durationMs / 1000).toFixed(1)}s |`);
    lines.push(`| Cost | ${fmtUsd(ctrl.costUsd)} | ${fmtUsd(treat.costUsd)} |`);
    lines.push("");

    // Show first ~200 chars of each output as a preview of voice/framing
    const ctrlPreview = ctrl.body.replace(/\n/g, " ").slice(0, 300).trim();
    const treatPreview = treat.body.replace(/\n/g, " ").slice(0, 300).trim();
    lines.push(`**Control opening:**`);
    lines.push(`> ${ctrlPreview}...`);
    lines.push("");
    lines.push(`**Treatment opening:**`);
    lines.push(`> ${treatPreview}...`);
    lines.push("");
  }

  // ─── Interpretation ───
  lines.push(`## Interpretation`);
  lines.push("");

  if (improved) {
    lines.push(`Editorial memory reduced cross-tenant cosine similarity by ${fmt(Math.abs(ns.cosineImprovement))} (${pct(Math.abs(improvementPct))}). This means the 4 tenants' articles became more differentiated when using editorial memory vs the narrative state extractor.`);
    lines.push("");
    lines.push(`**Why this matters:** The narrative state extractor captures the shared factual skeleton (thesis, levels, probabilities) that anchors all tenants to the same framing. Editorial memory captures per-tenant editorial facts that diverge naturally — different positions taken, different emphasis, different editorial voice accumulated over time.`);
    lines.push("");
    if (pairsImproved < totalPairs) {
      const worsePairs = ns.controlSimilarities
        .map((ctrl, i) => ({ ctrl, treat: ns.treatmentSimilarities[i]! }))
        .filter(({ ctrl, treat }) => ctrl.cosineSimilarity <= treat.cosineSimilarity);
      lines.push(`**Note:** ${totalPairs - pairsImproved} pair(s) got worse: ${worsePairs.map(({ ctrl }) => `${ctrl.identityA} ↔ ${ctrl.identityB}`).join(", ")}. This may indicate those tenants' editorial memory contained similar facts (e.g., both took the same position on EUR/USD).`);
      lines.push("");
    }
    lines.push(`**Next step:** Run a sequence (3-5 events) to prove editorial memory's effect compounds over time — divergence should widen with each accumulated article.`);
  } else {
    lines.push(`Editorial memory did not improve cross-tenant divergence in this run. The narrative state extractor produced more differentiation.`);
    lines.push("");
    lines.push(`**Possible causes:**`);
    lines.push(`- Editorial memory may have captured similar facts across tenants (all took the same bearish EUR/USD view)`);
    lines.push(`- With only one prior article per tenant, there isn't enough accumulated editorial history to create meaningful divergence`);
    lines.push(`- The editorial memory rendering may be injecting the factual skeleton (same problem as narrative state) rather than editorial stance`);
  }
  lines.push("");

  return lines.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`Usage: poc:analyze:impact <runDir>`);
    console.log(`Produces editorial-memory-impact.md — focused on whether editorial memory improved cross-tenant divergence.`);
    process.exit(0);
  }

  const dir = resolve(args[0]!);
  const rawPath = join(dir, "raw-data.json");
  if (!existsSync(rawPath)) {
    console.error(`ERROR: raw-data.json not found in ${dir}`);
    process.exit(1);
  }

  console.log(`[impact] Loading ${rawPath}...`);
  const result = JSON.parse(readFileSync(rawPath, "utf-8")) as RunResult;
  const report = renderImpactReport(result);

  const outPath = join(dir, "editorial-memory-impact.md");
  writeFileSync(outPath, report);
  console.log(`[impact] Written: ${outPath}`);
  console.log("");
  console.log(report);
}

main();
