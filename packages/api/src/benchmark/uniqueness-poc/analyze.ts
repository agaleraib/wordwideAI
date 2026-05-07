/**
 * Run analysis CLI — reads raw-data.json from a PoC run directory and produces
 * a structured analysis.md report.
 *
 * Usage:
 *   bun run poc:analyze <runDir>
 *   bun run poc:analyze <runDirA> --vs <runDirB>
 *
 * Spec: docs/specs/2026-04-13-run-analysis-report.md
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RunResult,
  RunManifest,
  SimilarityResult,
  NarrativeStateTestResult,
  CrossTenantMatrixResult,
} from "./types.js";
import { UNIQUENESS_THRESHOLDS } from "./types.js";
import {
  type BootstrapCiResult,
  type EventBlock,
  stratifiedClusteredBootstrapCi,
  pairedStratifiedBootstrap,
} from "./statistics.js";

// ─── Helpers ──────────────────────────────────────────────────────

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function verdictEmoji(v: string): string {
  switch (v) {
    case "PASS": return "✅";
    case "BORDERLINE": return "⚠️";
    case "FAIL": return "❌";
    default: return v;
  }
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(sq);
}

interface FabricationEntry {
  stage: string;
  pairId: string;
  identityA: string;
  identityB: string;
  fidelity: number | undefined;
  presentation: number | undefined;
  fidelityReasoning: string | undefined;
  divergences: Array<{ kind: string; docA: string; docB: string }>;
}

function collectFabrications(result: RunResult): FabricationEntry[] {
  const entries: FabricationEntry[] = [];
  const collect = (sims: SimilarityResult[], stage: string) => {
    for (const s of sims) {
      if (s.judgeTrinaryVerdict === "fabrication_risk") {
        entries.push({
          stage,
          pairId: s.pairId,
          identityA: s.identityA,
          identityB: s.identityB,
          fidelity: s.judgeFactualFidelity,
          presentation: s.judgePresentationSimilarity,
          fidelityReasoning: s.judgeFactualFidelityReasoning,
          divergences: (s.judgeFactualDivergences ?? []) as Array<{ kind: string; docA: string; docB: string }>,
        });
      }
    }
  };
  collect(result.similarities ?? [], "Intra-tenant");
  if (result.crossTenantMatrix) collect(result.crossTenantMatrix.similarities, "Stage 6 Cross-tenant");
  if (result.narrativeStateTest) {
    collect(result.narrativeStateTest.controlSimilarities, "Stage 7 Control");
    collect(result.narrativeStateTest.treatmentSimilarities, "Stage 7 Treatment");
  }
  return entries;
}

// ─── Renderers ──────────────────────────────────────────────────

function renderExecutiveSummary(r: RunResult): string {
  const lines: string[] = [];
  lines.push(`# Run Analysis — ${r.event.title}`);
  lines.push("");
  lines.push(`**Run ID:** \`${r.runId}\``);
  lines.push(`**Event:** ${r.event.title} (${r.event.source}, ${r.event.publishedAt})`);
  lines.push(`**Topic:** ${r.event.topicName} (\`${r.event.topicId}\`)`);
  lines.push(`**Duration:** ${fmtDuration(r.totalDurationMs)} | **Cost:** ${fmtUsd(r.totalCostUsd)}`);
  lines.push("");

  // Manifest (if present)
  // Manifest may be absent in old runs (predates 62dbced). The type says
  // required but the JSON cast doesn't enforce it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const m: RunManifest | undefined = r.manifest ?? undefined;
  if (m) {
    const stages = [1, 2, 3,
      ...(m.stagesEnabled.stage4 ? [4] : []),
      ...(m.stagesEnabled.stage5 ? [5] : []),
      ...(m.stagesEnabled.stage6 ? [6] : []),
      ...(m.stagesEnabled.stage7 ? [7] : []),
    ].join(", ");
    lines.push(`## Setup`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Git | \`${m.gitCommitHash ?? "unknown"}\` |`);
    lines.push(`| Runtime | ${m.runtime.name} ${m.runtime.version} |`);
    lines.push(`| Source | ${m.source} |`);
    lines.push(`| Memory backend | ${m.memoryBackend} |`);
    lines.push(`| Stages | ${stages} |`);
    lines.push(`| Personas | ${m.personaIds.join(", ") || "none"} |`);
    if (m.cliFlags.length > 0) lines.push(`| CLI flags | \`${m.cliFlags.join(" ")}\` |`);
    if (m.promptHashes) {
      const hashes = Object.entries(m.promptHashes).map(([id, h]) => `${id}:\`${h}\``).join(", ");
      lines.push(`| Prompt hashes | ${hashes} |`);
    }
    lines.push("");
  } else {
    lines.push(`> *No manifest — run predates manifest feature.*`);
    lines.push("");
  }

  // Verdicts
  lines.push(`## Verdicts`);
  lines.push("");
  lines.push(`| Stage | Verdict | Cosine Mean | ROUGE-L Mean | Threshold |`);
  lines.push(`|-------|---------|-------------|--------------|-----------|`);

  // Intra-tenant
  const intraCosines = r.similarities.map(s => s.cosineSimilarity);
  const intraRouges = r.similarities.map(s => s.rougeL);
  if (intraCosines.length > 0) {
    const mean = intraCosines.reduce((a, b) => a + b, 0) / intraCosines.length;
    const meanR = intraRouges.reduce((a, b) => a + b, 0) / intraRouges.length;
    lines.push(`| Identity-format diversity (no-persona, secondary) | ${verdictEmoji(r.verdict)} ${r.verdict} | ${fmt(mean)} | ${fmt(meanR)} | cosine < ${UNIQUENESS_THRESHOLDS.intraTenant.cosine} |`);
  }

  // Cross-tenant
  if (r.crossTenantMatrix) {
    const ct = r.crossTenantMatrix;
    lines.push(`| **Cross-tenant (primary)** | ${verdictEmoji(ct.verdict)} **${ct.verdict}** | **${fmt(ct.meanCosine)}** | **${fmt(ct.meanRougeL)}** | cosine < ${UNIQUENESS_THRESHOLDS.crossTenant.cosine} |`);
  }

  // Stage 7
  if (r.narrativeStateTest) {
    const ns = r.narrativeStateTest;
    lines.push(`| Stage 7 Treatment | ${verdictEmoji(ns.treatmentVerdict)} ${ns.treatmentVerdict} | ${fmt(ns.treatmentMeanCosine)} | ${fmt(ns.treatmentMeanRougeL)} | cosine < ${UNIQUENESS_THRESHOLDS.crossTenant.cosine} |`);
  }
  lines.push("");

  // Stage 7 headline differential
  if (r.narrativeStateTest) {
    const ns = r.narrativeStateTest;
    const improved = ns.cosineImprovement > 0;
    lines.push(`## Stage 7 A/B Headline`);
    lines.push("");
    lines.push(`| Metric | Control (narrative state) | Treatment (editorial memory) | Delta |`);
    lines.push(`|--------|--------------------------|------------------------------|-------|`);
    lines.push(`| Cosine mean | ${fmt(ns.controlMeanCosine)} | ${fmt(ns.treatmentMeanCosine)} | ${improved ? "↓" : "↑"} ${fmt(Math.abs(ns.cosineImprovement))} ${improved ? "✅ treatment more unique" : "❌ treatment more similar"} |`);
    lines.push(`| ROUGE-L mean | ${fmt(ns.controlMeanRougeL)} | ${fmt(ns.treatmentMeanRougeL)} | ${ns.rougeLImprovement > 0 ? "↓" : "↑"} ${fmt(Math.abs(ns.rougeLImprovement))} |`);
    lines.push("");
  }

  // Fabrication alert
  const fabs = collectFabrications(r);
  if (fabs.length > 0) {
    lines.push(`> **🚨 ${fabs.length} fabrication flag(s)** across stages: ${fabs.map(f => `${f.identityA} ↔ ${f.identityB} (${f.stage})`).join(", ")}. See Fabrication Deep-Dive below.`);
    lines.push("");
  }

  // Cost breakdown
  const coreCost = r.coreAnalysis.costUsd;
  const identityCost = r.identityOutputs.reduce((s, o) => s + o.costUsd, 0);
  const ctCost = r.crossTenantMatrix ? r.crossTenantMatrix.outputs.reduce((s, o) => s + o.costUsd, 0) : 0;
  const ctJudgeCost = r.crossTenantMatrix ? r.crossTenantMatrix.similarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0) : 0;
  let stage7Cost = 0;
  if (r.narrativeStateTest) {
    const ns = r.narrativeStateTest;
    stage7Cost = ns.secondCoreAnalysis.costUsd +
      ns.narrativeStates.reduce((s, n) => s + (n.state.recentEntries[0]?.extractionCostUsd ?? 0), 0) +
      ns.controlOutputs.reduce((s, o) => s + o.costUsd, 0) +
      ns.treatmentOutputs.reduce((s, o) => s + o.costUsd, 0) +
      ns.controlSimilarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0) +
      ns.treatmentSimilarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0);
  }

  lines.push(`## Cost Breakdown`);
  lines.push("");
  lines.push(`| Stage | Cost |`);
  lines.push(`|-------|------|`);
  lines.push(`| Core analysis (Opus) | ${fmtUsd(coreCost)} |`);
  lines.push(`| Identity adaptation (Stage 2) | ${fmtUsd(identityCost)} |`);
  if (r.crossTenantMatrix) lines.push(`| Cross-tenant generation (Stage 6) | ${fmtUsd(ctCost)} |`);
  if (r.crossTenantMatrix) lines.push(`| Cross-tenant judges (Stage 6) | ${fmtUsd(ctJudgeCost)} |`);
  if (r.narrativeStateTest) lines.push(`| Narrative continuity (Stage 7) | ${fmtUsd(stage7Cost)} |`);
  lines.push(`| **Total** | **${fmtUsd(r.totalCostUsd)}** |`);
  lines.push("");

  return lines.join("\n");
}

function renderStage6(ct: CrossTenantMatrixResult): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push("");
  lines.push(`## Stage 6 — Cross-Tenant Matrix`);
  lines.push("");
  lines.push(`**Verdict:** ${verdictEmoji(ct.verdict)} ${ct.verdict}`);
  lines.push(`**Reasoning:** ${ct.verdictReasoning}`);
  lines.push("");

  // Per-pair table
  lines.push(`### Per-Pair Breakdown`);
  lines.push("");
  lines.push(`| Pair | Cosine | ROUGE-L | Fidelity | Presentation | Verdict |`);
  lines.push(`|------|--------|---------|----------|--------------|---------|`);
  for (const s of ct.similarities) {
    const verdict = s.judgeTrinaryVerdict ?? "—";
    const vEmoji = verdict === "fabrication_risk" ? "🚨" : verdict === "reskinned_same_article" ? "⚠️" : verdict === "distinct_products" ? "✅" : "";
    lines.push(`| ${s.identityA} ↔ ${s.identityB} | ${fmt(s.cosineSimilarity)} | ${fmt(s.rougeL)} | ${s.judgeFactualFidelity != null ? fmt(s.judgeFactualFidelity, 2) : "—"} | ${s.judgePresentationSimilarity != null ? fmt(s.judgePresentationSimilarity, 2) : "—"} | ${vEmoji} ${verdict} |`);
  }
  lines.push("");

  // Distribution
  const cosines = ct.similarities.map(s => s.cosineSimilarity);
  const rouges = ct.similarities.map(s => s.rougeL);
  lines.push(`### Distribution`);
  lines.push("");
  lines.push(`| Metric | Mean | Min | Max | StdDev | Threshold |`);
  lines.push(`|--------|------|-----|-----|--------|-----------|`);
  lines.push(`| Cosine | ${fmt(ct.meanCosine)} | ${fmt(ct.minCosine)} | ${fmt(ct.maxCosine)} | ${fmt(stddev(cosines))} | < ${UNIQUENESS_THRESHOLDS.crossTenant.cosine} |`);
  lines.push(`| ROUGE-L | ${fmt(ct.meanRougeL)} | ${fmt(ct.minRougeL)} | ${fmt(ct.maxRougeL)} | ${fmt(stddev(rouges))} | < ${UNIQUENESS_THRESHOLDS.crossTenant.rougeL} |`);
  lines.push("");

  // Judge failures
  if (ct.judgeFailures.length > 0) {
    lines.push(`> ⚠️ ${ct.judgeFailures.length} judge pair(s) skipped due to errors — aggregate stats computed over subset.`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderStage7(ns: NarrativeStateTestResult): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push("");
  lines.push(`## Stage 7 — A/B Comparison (narrative state vs editorial memory)`);
  lines.push("");
  lines.push(`**Second event:** ${ns.secondEvent.title} (${ns.secondEvent.source}, ${ns.secondEvent.publishedAt})`);
  lines.push(`**Treatment verdict:** ${verdictEmoji(ns.treatmentVerdict)} ${ns.treatmentVerdict} — ${ns.treatmentVerdictReasoning}`);
  lines.push("");

  // Headline differential
  const improved = ns.cosineImprovement > 0;
  lines.push(`### Headline Differential`);
  lines.push("");
  lines.push(`| Metric | Control (narrative state) | Treatment (editorial memory) | Delta |`);
  lines.push(`|--------|--------------------------|------------------------------|-------|`);
  lines.push(`| Cosine mean | ${fmt(ns.controlMeanCosine)} | ${fmt(ns.treatmentMeanCosine)} | ${improved ? "↓" : "↑"} ${fmt(Math.abs(ns.cosineImprovement))} ${improved ? "✅" : "❌"} |`);
  lines.push(`| ROUGE-L mean | ${fmt(ns.controlMeanRougeL)} | ${fmt(ns.treatmentMeanRougeL)} | ${ns.rougeLImprovement > 0 ? "↓" : "↑"} ${fmt(Math.abs(ns.rougeLImprovement))} |`);
  lines.push("");

  // Per-pair delta
  lines.push(`### Per-Pair Delta`);
  lines.push("");
  lines.push(`| Pair | Control Cosine | Treatment Cosine | Delta | Improved? |`);
  lines.push(`|------|---------------|-----------------|-------|-----------|`);
  for (let i = 0; i < ns.controlSimilarities.length; i++) {
    const ctrl = ns.controlSimilarities[i]!;
    const treat = ns.treatmentSimilarities[i]!;
    const delta = ctrl.cosineSimilarity - treat.cosineSimilarity;
    const imp = delta > 0;
    lines.push(`| ${ctrl.identityA} ↔ ${ctrl.identityB} | ${fmt(ctrl.cosineSimilarity)} | ${fmt(treat.cosineSimilarity)} | ${imp ? "↓" : "↑"} ${fmt(Math.abs(delta))} | ${imp ? "✅ yes" : "❌ no"} |`);
  }
  lines.push("");

  // Per-persona context
  lines.push(`### Per-Persona Memory Context`);
  lines.push("");
  for (const nsEntry of ns.narrativeStates) {
    const entry = nsEntry.state.recentEntries[0];
    lines.push(`#### ${nsEntry.personaName}`);
    lines.push("");
    if (entry) {
      lines.push(`- **Summary:** ${entry.oneSentenceSummary}`);
      lines.push(`- **Directional view:** ${entry.directionalView} (${entry.directionalViewConfidence})`);
      if (entry.keyThesisStatements.length > 0) {
        lines.push(`- **Key thesis:**`);
        for (const t of entry.keyThesisStatements) lines.push(`  - ${t}`);
      }
      if (entry.keyLevelsMentioned.length > 0) {
        lines.push(`- **Levels:** ${entry.keyLevelsMentioned.join("; ")}`);
      }
    }
    lines.push("");
  }

  // Per-persona output comparison
  lines.push(`### Per-Persona Output Comparison`);
  lines.push("");
  for (let i = 0; i < ns.narrativeStates.length; i++) {
    const persona = ns.narrativeStates[i]!;
    const ctrl = ns.controlOutputs[i]!;
    const treat = ns.treatmentOutputs[i]!;
    lines.push(`#### ${persona.personaName}`);
    lines.push("");
    lines.push(`| | Control | Treatment |`);
    lines.push(`|---|---------|-----------|`);
    lines.push(`| Words | ${ctrl.wordCount} | ${treat.wordCount} |`);
    lines.push(`| Model | ${ctrl.model} | ${treat.model} |`);
    lines.push(`| Cost | ${fmtUsd(ctrl.costUsd)} | ${fmtUsd(treat.costUsd)} |`);
    lines.push(`| Duration | ${fmtDuration(ctrl.durationMs)} | ${fmtDuration(treat.durationMs)} |`);
    lines.push("");
  }

  // Control matrix
  lines.push(`### Control Matrix`);
  lines.push("");
  lines.push(`| Pair | Cosine | ROUGE-L | Verdict |`);
  lines.push(`|------|--------|---------|---------|`);
  for (const s of ns.controlSimilarities) {
    const v = s.judgeTrinaryVerdict ?? "—";
    const e = v === "fabrication_risk" ? "🚨" : v === "reskinned_same_article" ? "⚠️" : v === "distinct_products" ? "✅" : "";
    lines.push(`| ${s.identityA} ↔ ${s.identityB} | ${fmt(s.cosineSimilarity)} | ${fmt(s.rougeL)} | ${e} ${v} |`);
  }
  lines.push("");

  // Treatment matrix
  lines.push(`### Treatment Matrix`);
  lines.push("");
  lines.push(`| Pair | Cosine | ROUGE-L | Verdict |`);
  lines.push(`|------|--------|---------|---------|`);
  for (const s of ns.treatmentSimilarities) {
    const v = s.judgeTrinaryVerdict ?? "—";
    const e = v === "fabrication_risk" ? "🚨" : v === "reskinned_same_article" ? "⚠️" : v === "distinct_products" ? "✅" : "";
    lines.push(`| ${s.identityA} ↔ ${s.identityB} | ${fmt(s.cosineSimilarity)} | ${fmt(s.rougeL)} | ${e} ${v} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function renderFabrications(fabs: FabricationEntry[]): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push("");
  lines.push(`## Fabrication Deep-Dive`);
  lines.push("");

  if (fabs.length === 0) {
    lines.push(`No fabrication flags in this run.`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`**${fabs.length} pair(s) flagged as FABRICATION_RISK:**`);
  lines.push("");

  for (const f of fabs) {
    lines.push(`### 🚨 ${f.identityA} ↔ ${f.identityB} (${f.stage})`);
    lines.push("");
    lines.push(`**Fidelity:** ${f.fidelity != null ? fmt(f.fidelity, 2) : "—"} | **Presentation:** ${f.presentation != null ? fmt(f.presentation, 2) : "—"}`);
    lines.push("");

    if (f.fidelityReasoning) {
      lines.push(`**Judge fidelity reasoning:**`);
      lines.push(`> ${f.fidelityReasoning.split("\n").join("\n> ")}`);
      lines.push("");
    }

    if (f.divergences.length > 0) {
      lines.push(`**Factual divergences (${f.divergences.length}):**`);
      lines.push("");
      for (const d of f.divergences) {
        lines.push(`- **\`${d.kind}\`**`);
        lines.push(`  - **Doc A:** ${d.docA}`);
        lines.push(`  - **Doc B:** ${d.docB}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderMetrics(r: RunResult): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push("");
  lines.push(`## Metrics`);
  lines.push("");

  // Similarity distributions
  const renderDist = (label: string, sims: SimilarityResult[]) => {
    if (sims.length === 0) return;
    const cosines = sims.map(s => s.cosineSimilarity);
    const rouges = sims.map(s => s.rougeL);
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    lines.push(`### ${label} (${sims.length} pairs)`);
    lines.push("");
    lines.push(`| Metric | Mean | Min | Max | StdDev |`);
    lines.push(`|--------|------|-----|-----|--------|`);
    lines.push(`| Cosine | ${fmt(mean(cosines))} | ${fmt(Math.min(...cosines))} | ${fmt(Math.max(...cosines))} | ${fmt(stddev(cosines))} |`);
    lines.push(`| ROUGE-L | ${fmt(mean(rouges))} | ${fmt(Math.min(...rouges))} | ${fmt(Math.max(...rouges))} | ${fmt(stddev(rouges))} |`);
    lines.push("");
  };

  renderDist("Intra-tenant", r.similarities);
  if (r.crossTenantMatrix) renderDist("Cross-tenant (Stage 6)", r.crossTenantMatrix.similarities);
  if (r.narrativeStateTest) {
    renderDist("Stage 7 Control", r.narrativeStateTest.controlSimilarities);
    renderDist("Stage 7 Treatment", r.narrativeStateTest.treatmentSimilarities);
  }

  // Judge verdict summary
  lines.push(`### Judge Verdict Summary`);
  lines.push("");
  const countVerdicts = (sims: SimilarityResult[]) => {
    let distinct = 0, reskinned = 0, fabrication = 0, noJudge = 0;
    for (const s of sims) {
      switch (s.judgeTrinaryVerdict) {
        case "distinct_products": distinct++; break;
        case "reskinned_same_article": reskinned++; break;
        case "fabrication_risk": fabrication++; break;
        default: noJudge++; break;
      }
    }
    return { distinct, reskinned, fabrication, noJudge };
  };

  lines.push(`| Stage | ✅ Distinct | ⚠️ Reskinned | 🚨 Fabrication | No judge |`);
  lines.push(`|-------|-------------|--------------|----------------|----------|`);

  const intraV = countVerdicts(r.similarities);
  lines.push(`| Intra-tenant | ${intraV.distinct} | ${intraV.reskinned} | ${intraV.fabrication} | ${intraV.noJudge} |`);

  if (r.crossTenantMatrix) {
    const ctV = countVerdicts(r.crossTenantMatrix.similarities);
    lines.push(`| Cross-tenant | ${ctV.distinct} | ${ctV.reskinned} | ${ctV.fabrication} | ${ctV.noJudge} |`);
  }
  if (r.narrativeStateTest) {
    const ctrlV = countVerdicts(r.narrativeStateTest.controlSimilarities);
    const treatV = countVerdicts(r.narrativeStateTest.treatmentSimilarities);
    lines.push(`| Stage 7 Control | ${ctrlV.distinct} | ${ctrlV.reskinned} | ${ctrlV.fabrication} | ${ctrlV.noJudge} |`);
    lines.push(`| Stage 7 Treatment | ${treatV.distinct} | ${treatV.reskinned} | ${treatV.fabrication} | ${treatV.noJudge} |`);
  }
  lines.push("");

  // Thresholds reference
  lines.push(`### Threshold Reference`);
  lines.push("");
  lines.push(`| Scope | Cosine FAIL | Cosine BORDERLINE | ROUGE-L FAIL |`);
  lines.push(`|-------|-------------|-------------------|--------------|`);
  lines.push(`| Cross-tenant | ≥ ${UNIQUENESS_THRESHOLDS.crossTenant.cosine} | ≥ ${fmt(UNIQUENESS_THRESHOLDS.crossTenant.cosine - UNIQUENESS_THRESHOLDS.crossTenant.cosineBorderlineMargin, 2)} | ≥ ${UNIQUENESS_THRESHOLDS.crossTenant.rougeL} |`);
  lines.push(`| Intra-tenant | ≥ ${UNIQUENESS_THRESHOLDS.intraTenant.cosine} | ≥ ${fmt(UNIQUENESS_THRESHOLDS.intraTenant.cosine - UNIQUENESS_THRESHOLDS.intraTenant.cosineBorderlineMargin, 2)} | ≥ ${UNIQUENESS_THRESHOLDS.intraTenant.rougeL} |`);
  lines.push("");

  return lines.join("\n");
}

// ─── Single Run Analysis ───────────────────────────────────────

function renderSingleRunAnalysis(result: RunResult): string {
  const sections: string[] = [];

  sections.push(renderExecutiveSummary(result));

  if (result.crossTenantMatrix) {
    sections.push(renderStage6(result.crossTenantMatrix));
  }

  if (result.narrativeStateTest) {
    sections.push(renderStage7(result.narrativeStateTest));
  }

  sections.push(renderFabrications(collectFabrications(result)));
  sections.push(renderMetrics(result));

  return sections.join("\n");
}

// ─── WM3 Writeup Renderer (Wave M, audit §5.4 + §6 + §4.10.4) ──

/**
 * Locate the wave-writeup template file. Walks up from this module looking
 * for `docs/uniqueness-poc-analysis/_template.md`. Returns `null` when the
 * template can't be found (the writeup mode then bails with a clear error).
 */
function locateWriteupTemplate(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "docs", "uniqueness-poc-analysis", "_template.md");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Build per-event cell blocks from a run's cross-tenant similarity matrix.
 * Each "event" is the run itself — a single-event run produces one block, so
 * the bootstrap will (correctly) refuse to run inferentially and the
 * `descriptiveOnly` flag will fire. The same builder is used by the
 * two-baseline block when historical and freshly-rerun runs are paired.
 *
 * Cell shape is the SimilarityResult — the statistic functions in the
 * writeup pull `cosineSimilarity` / `judgeFactualFidelity` /
 * `judgeTrinaryVerdict` directly off it.
 */
function buildEventBlocks(result: RunResult): EventBlock<SimilarityResult>[] {
  const cells = result.crossTenantMatrix?.similarities ?? [];
  // Use eventId from the run's event field. A single run is one event.
  return [{ eventId: result.event.id, cells }];
}

/** Mean cosine across cells in an event. */
function statCosineMean(cells: SimilarityResult[]): number {
  if (cells.length === 0) return 0;
  return cells.reduce((acc, c) => acc + c.cosineSimilarity, 0) / cells.length;
}

/** Count of `fabrication_risk` verdicts in an event. */
function statFabricationCount(cells: SimilarityResult[]): number {
  return cells.filter((c) => c.judgeTrinaryVerdict === "fabrication_risk").length;
}

/** Count of `distinct_products` verdicts (the SHIP-grade outcome) in an event. */
function statDistinctCount(cells: SimilarityResult[]): number {
  return cells.filter((c) => c.judgeTrinaryVerdict === "distinct_products").length;
}

/** Count of `reskinned_same_article` verdicts in an event. */
function statReskinnedCount(cells: SimilarityResult[]): number {
  return cells.filter((c) => c.judgeTrinaryVerdict === "reskinned_same_article").length;
}

function fmtCi(result: BootstrapCiResult, decimals = 4): string {
  const lo = result.ci[0].toFixed(decimals);
  const hi = result.ci[1].toFixed(decimals);
  return `[${lo}, ${hi}]`;
}

function fmtNEvents(result: BootstrapCiResult): string {
  return `${result.nClusters}${result.descriptiveOnly ? " (descriptive only)" : ""}`;
}

function renderReproducibilityReceiptForTemplate(r: RunResult): string {
  const repro = r.manifest.reproducibility;
  if (!repro) {
    return "*(none — this run was produced before the WM1 reproducibility receipt was added; re-run under the current code to populate.)*";
  }
  const lines: string[] = [];
  lines.push("```yaml");
  lines.push("models:");
  lines.push(`  fa: ${repro.models.fa}`);
  lines.push(`  identity: ${repro.models.identity}`);
  lines.push(`  judge: ${repro.models.judge}`);
  lines.push(`  embedding: ${repro.models.embedding}`);
  lines.push(`  conformance: ${repro.models.conformance}`);
  lines.push("promptVersions:");
  lines.push(`  judge: ${repro.promptVersions.judge}`);
  lines.push(`  judgeHash: ${repro.promptVersions.judgeHash}`);
  lines.push(`  fa: ${repro.promptVersions.fa}`);
  lines.push(`  conformance: ${repro.promptVersions.conformance ?? "null"}`);
  lines.push(`fixtureHash: ${repro.fixtureHash}`);
  lines.push(`packageHash: ${repro.packageHash ?? "null"}`);
  const overrideKeys = Object.keys(repro.temperatureOverrides);
  if (overrideKeys.length === 0) {
    lines.push("temperatureOverrides: {}");
  } else {
    lines.push("temperatureOverrides:");
    for (const key of overrideKeys) {
      lines.push(`  ${key}: ${repro.temperatureOverrides[key]}`);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

interface WriteupOpts {
  /** Primary run directory whose `raw-data.json` drives the writeup. */
  runDir: string;
  /** Optional historical baseline run directory (most recent prior wave). */
  historicalDir?: string;
  /**
   * Optional freshly-rerun baseline directory — the prior variant re-executed
   * under the current reproducibility receipt. When both `historical` and
   * `fresh-rerun` are supplied, the two-baseline block is fully populated;
   * otherwise the block surfaces the "two-baseline rule waived" caveat.
   */
  freshRerunDir?: string;
}

/**
 * Auto-fill the wave-writeup template (audit §6 checklist) using:
 *
 *   - Run's `raw-data.json`         → OEC + secondary metrics + receipt
 *   - WM2 statistics primitives     → stratified-clustered-bootstrap CIs
 *   - Optional historical / fresh-rerun runs → two-baseline block
 *
 * The writeup is a stub on a single-event run (N_events = 1 → descriptive
 * only) — this is the audit's intended behaviour, not a bug. Multi-event
 * waves will populate properly once the wave executes ≥3 events on a fixed
 * bench.
 */
function renderWriteup(result: RunResult, opts: WriteupOpts): string {
  const templatePath = locateWriteupTemplate();
  if (!templatePath) {
    throw new Error(
      "renderWriteup: docs/uniqueness-poc-analysis/_template.md not found by walking up from analyze.ts",
    );
  }
  let template = readFileSync(templatePath, "utf-8");

  // ───── OEC: fabrication_risk count per audit §4.10.4 example ─────
  const eventBlocks = buildEventBlocks(result);
  const oecResult = stratifiedClusteredBootstrapCi({
    eventBlocks,
    statistic: statFabricationCount,
    estimand: "Mean fabrication_risk count per event across the bench",
    iters: 10_000,
    seed: 42,
  });

  // ───── Secondary metrics ─────
  const distinctResult = stratifiedClusteredBootstrapCi({
    eventBlocks,
    statistic: statDistinctCount,
    estimand: "Mean distinct_products count per event across the bench",
    iters: 10_000,
    seed: 42,
  });
  const reskinnedResult = stratifiedClusteredBootstrapCi({
    eventBlocks,
    statistic: statReskinnedCount,
    estimand: "Mean reskinned_same_article count per event across the bench",
    iters: 10_000,
    seed: 42,
  });
  const cosineResult = stratifiedClusteredBootstrapCi({
    eventBlocks,
    statistic: statCosineMean,
    estimand: "Mean cosine similarity per event across the bench",
    iters: 10_000,
    seed: 42,
  });

  const secondaryRows: string[] = [];
  secondaryRows.push(
    `| distinct_products | ${distinctResult.pointEstimate.toFixed(2)} | ${fmtCi(distinctResult, 2)} | ${fmtNEvents(distinctResult)} | ${distinctResult.estimand} | Must not regress > 1 with CI clearance |`,
  );
  secondaryRows.push(
    `| reskinned_same_article | ${reskinnedResult.pointEstimate.toFixed(2)} | ${fmtCi(reskinnedResult, 2)} | ${fmtNEvents(reskinnedResult)} | ${reskinnedResult.estimand} | Must not regress > 1 with CI clearance |`,
  );
  secondaryRows.push(
    `| cross_tenant_cosine | ${cosineResult.pointEstimate.toFixed(4)} | ${fmtCi(cosineResult, 4)} | ${fmtNEvents(cosineResult)} | ${cosineResult.estimand} | Lower is more uniqueness — diagnostic |`,
  );

  // ───── Pre-registration ─────
  // Pre-registration is sourced from the wave spec, not raw-data.json. The
  // template substitutes a stub when the caller didn't supply --pre-reg-yaml.
  // Surfacing the stub explicitly is the audit's "no missing pre-reg slips"
  // rule — readers should never wonder whether the spec carried the block.
  const preRegStub = `# (No pre-registration block was supplied via --pre-reg-yaml.\n#  Per audit §6, the wave's verdict is NOT decision-grade until\n#  the spec's §5.3 / §4.10.4 block is pinned and re-rendered.)`;

  // ───── Two-baseline block ─────
  let twoBaselineBlock: string;
  if (!opts.historicalDir && !opts.freshRerunDir) {
    twoBaselineBlock = "*(single-baseline run; two-baseline rule waived — surface as a limitation in the spec writeup.)*";
  } else if (opts.historicalDir && !opts.freshRerunDir) {
    const histResult = loadRunResult(opts.historicalDir);
    twoBaselineBlock = [
      "**Historical baseline only (freshly-rerun baseline waived):**",
      "",
      `- **Historical run id:** \`${histResult.runId}\` (event: ${histResult.event.id})`,
      `- **Historical OEC point estimate:** ${statFabricationCount(histResult.crossTenantMatrix?.similarities ?? [])} fabrication_risk pairs`,
      "",
      "*(Per audit §4.4.4: without the freshly-rerun baseline, the wave cannot separate \"variant moved things\" from \"model/prompt drift moved things.\" Add a freshly-rerun run before treating the verdict as actionable.)*",
    ].join("\n");
  } else if (opts.historicalDir && opts.freshRerunDir) {
    const histResult = loadRunResult(opts.historicalDir);
    const freshResult = loadRunResult(opts.freshRerunDir);
    const histBlocks = buildEventBlocks(histResult);
    const freshBlocks = buildEventBlocks(freshResult);
    const driftCi = pairedStratifiedBootstrap({
      controlBlocks: histBlocks,
      treatmentBlocks: freshBlocks,
      statistic: statFabricationCount,
      estimand:
        "Drift in OEC (fabrication_risk count) between historical baseline and freshly-rerun baseline",
      iters: 10_000,
      seed: 42,
    });
    twoBaselineBlock = [
      `**Historical run:** \`${histResult.runId}\` (event: ${histResult.event.id})`,
      `**Freshly-rerun:** \`${freshResult.runId}\` (event: ${freshResult.event.id})`,
      "",
      `**Drift on OEC (fresh − historical):** ${driftCi.pointEstimate.toFixed(2)}, 95% CI ${fmtCi(driftCi, 2)} (N_events = ${driftCi.nClusters}${driftCi.descriptiveOnly ? ", descriptive only" : ""})`,
      "",
      "*If the drift CI does NOT cross zero, the variant's apparent effect is contaminated by model/prompt drift — debug before evaluating the variant per audit §4.4.4.*",
    ].join("\n");
  } else {
    // Only freshRerunDir was supplied (no historical) — degraded mode
    twoBaselineBlock = "*(only `--fresh-rerun` was supplied without `--historical`; cannot compute drift. Supply both or neither.)*";
  }

  // ───── Tier 2 inter-rater (filled when WM6 lands; placeholder for now) ─────
  const tier2Block = "*(WM6 inter-rater check not yet present in this run's `raw-data.json.tier2`; placeholder rendered until WM6 ships.)*";

  // ───── Effect sizes (placeholder — needs control vs treatment runs) ─────
  const effectSizesBlock =
    "*(no control vs treatment arms supplied to `analyze.ts --writeup`; surface effect sizes after running the variant against a freshly-rerun baseline and aligning event sets.)*";

  // ───── Verdict ─────
  const oecPoint = oecResult.pointEstimate;
  let verdict: string;
  let verdictJustification: string;
  if (oecResult.descriptiveOnly) {
    verdict = "DESCRIPTIVE-ONLY (no decision)";
    verdictJustification = `N_events = ${oecResult.nClusters} < 3. Per audit §5.2, no decision-grade verdict is permitted on this run alone. Re-run on the full pre-registered bench (≥3 events) before evaluating SHIP / ITERATE / ABANDON.`;
  } else {
    verdict = "(map to pre-registered rule)";
    verdictJustification = `OEC point estimate ${oecPoint.toFixed(2)}, 95% CI ${fmtCi(oecResult, 2)}. Map to the spec's pre-registered ship/iterate/abandon rule before declaring a verdict.`;
  }

  const descriptiveOnlyBanner = oecResult.descriptiveOnly
    ? `> **Descriptive only** — N_events = ${oecResult.nClusters} < 3. CI shown is empirical min/max of the per-event statistic, NOT an inferential interval. Per audit §5.2 this run is NOT decision-grade on its own.`
    : "";

  // ───── Substitute ─────
  const replacements: Record<string, string> = {
    WAVE_TITLE: `Run ${result.runId}`,
    SPEC_PATH: "(supply via the wave spec — not stored in raw-data.json)",
    RUN_ID: result.runId,
    WAVE_LABEL: result.manifest.sequenceId ?? "(non-sequence run)",
    PRE_REGISTRATION_BLOCK: preRegStub,
    REPRODUCIBILITY_RECEIPT: renderReproducibilityReceiptForTemplate(result),
    OEC_NAME: "fabrication_risk count",
    OEC_POINT: oecPoint.toFixed(2),
    OEC_CI: fmtCi(oecResult, 2),
    OEC_N_EVENTS: fmtNEvents(oecResult),
    OEC_ESTIMAND: oecResult.estimand,
    OEC_VERDICT: verdict,
    OEC_DESCRIPTIVE_ONLY_BANNER: descriptiveOnlyBanner,
    SECONDARY_METRICS_TABLE: secondaryRows.join("\n"),
    TWO_BASELINE_BLOCK: twoBaselineBlock,
    TIER2_INTER_RATER_BLOCK: tier2Block,
    EFFECT_SIZES_BLOCK: effectSizesBlock,
    VERDICT: verdict,
    VERDICT_JUSTIFICATION: verdictJustification,
  };

  for (const [key, value] of Object.entries(replacements)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return template;
}

// ─── CLI ──────────────────────────────────────────────────────

function loadRunResult(dir: string): RunResult {
  const rawPath = join(dir, "raw-data.json");
  if (!existsSync(rawPath)) {
    throw new Error(`raw-data.json not found in ${dir}`);
  }
  return JSON.parse(readFileSync(rawPath, "utf-8")) as RunResult;
}

/**
 * Pull a single `--flag value` argument out of an argv slice. Returns
 * `undefined` when the flag is absent. Throws when the flag appears at the
 * end of argv with no value following.
 */
function popFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`Usage:`);
    console.log(`  poc:analyze <runDir>                                  Single run deep-dive`);
    console.log(`  poc:analyze <runDirA> --vs <runDirB>                   A/B delta report`);
    console.log(`  poc:analyze <runDir> --writeup [--out <path>]          Wave M writeup template auto-fill`);
    console.log(`                       [--historical <runDir>]           Historical baseline for two-baseline rule`);
    console.log(`                       [--fresh-rerun <runDir>]          Freshly-rerun baseline (audit §4.4.4)`);
    process.exit(0);
  }

  const vsIndex = args.indexOf("--vs");
  const writeupIndex = args.indexOf("--writeup");

  if (writeupIndex >= 0) {
    // ─── Wave M writeup mode ───
    const dirArg = args[0];
    if (!dirArg || dirArg.startsWith("--")) {
      console.error("ERROR: --writeup requires a primary run directory as the first positional arg");
      process.exit(1);
    }
    const runDir = resolve(dirArg);
    console.log(`[analyze] Loading ${runDir}/raw-data.json (writeup mode)...`);
    const result = loadRunResult(runDir);

    let historicalDir: string | undefined;
    let freshRerunDir: string | undefined;
    let outPath: string | undefined;
    try {
      const histRaw = popFlagValue(args, "--historical");
      const freshRaw = popFlagValue(args, "--fresh-rerun");
      const outRaw = popFlagValue(args, "--out");
      historicalDir = histRaw ? resolve(histRaw) : undefined;
      freshRerunDir = freshRaw ? resolve(freshRaw) : undefined;
      outPath = outRaw ? resolve(outRaw) : undefined;
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const writeup = renderWriteup(result, {
      runDir,
      historicalDir,
      freshRerunDir,
    });

    const finalOut = outPath ?? join(runDir, "writeup.md");
    writeFileSync(finalOut, writeup);
    console.log(`[analyze] Writeup written: ${finalOut}`);
    return;
  }

  if (vsIndex >= 0) {
    // A/B delta mode
    const dirAArg = args[0];
    const dirBArg = args[vsIndex + 1];
    if (!dirAArg || !dirBArg) {
      console.error("ERROR: --vs requires two run directories: <runDirA> --vs <runDirB>");
      process.exit(1);
    }
    const dirA = resolve(dirAArg);
    const dirB = resolve(dirBArg);
    console.error(`[analyze] A/B delta mode: not yet implemented (Phase 2)`);
    console.error(`[analyze]   Run A: ${dirA}`);
    console.error(`[analyze]   Run B: ${dirB}`);
    process.exit(1);
  }

  // Single run mode
  const dir = resolve(args[0]!);
  console.log(`[analyze] Loading ${dir}/raw-data.json...`);
  const result = loadRunResult(dir);
  const report = renderSingleRunAnalysis(result);

  const outPath = join(dir, "analysis.md");
  writeFileSync(outPath, report);
  console.log(`[analyze] Written: ${outPath}`);
  console.log("");
  console.log(report);
}

main();
