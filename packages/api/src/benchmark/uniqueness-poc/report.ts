/**
 * Markdown report renderer for the uniqueness PoC.
 *
 * Output: a single self-contained `report.md` file per run that contains
 * the verdict, the full core analysis, every identity's full output, the
 * pairwise similarity matrix with pass/fail markers, and the LLM judge's
 * reasoning on borderline cases. Designed to be read end-to-end by a human
 * (or shared with a partner) without needing to look at any code or JSON.
 */

import type {
  RunResult,
  SimilarityResult,
  IdentityOutput,
  SimilarityStatus,
  TrinaryUniquenessVerdict,
} from "./types.js";
import { UNIQUENESS_THRESHOLDS } from "./types.js";
import { formatUsd } from "./pricing.js";

function statusBadge(status: SimilarityStatus): string {
  switch (status) {
    case "pass":
      return "✓ pass";
    case "borderline-cross-tenant":
      return "⚠ borderline";
    case "fail-cross-tenant":
      return "✗ FAIL";
  }
}

function verdictBadge(verdict: "PASS" | "BORDERLINE" | "FAIL"): string {
  switch (verdict) {
    case "PASS":
      return "✅ PASS";
    case "BORDERLINE":
      return "⚠️ BORDERLINE";
    case "FAIL":
      return "❌ FAIL";
  }
}

function trinaryVerdictBadge(v: TrinaryUniquenessVerdict | undefined): string {
  switch (v) {
    case "distinct_products":
      return "✅ distinct";
    case "reskinned_same_article":
      return "❌ reskinned";
    case "fabrication_risk":
      return "🚨 fabrication";
    default:
      return "—";
  }
}

function verdictBanner(result: RunResult): string {
  const lines: string[] = [];

  // The CROSS-TENANT verdict is the load-bearing test — show it first if present
  if (result.crossTenantMatrix) {
    lines.push(`## ${verdictBadge(result.crossTenantMatrix.verdict)} CROSS-TENANT VERDICT (the load-bearing test)`);
    lines.push("");
    lines.push(result.crossTenantMatrix.verdictReasoning);
    lines.push("");
    lines.push(
      `*Tested by running **${result.crossTenantMatrix.identityName}** on the same core analysis with **${result.crossTenantMatrix.personas.length} different broker personas** (${result.crossTenantMatrix.personas.map((p) => p.name).join(", ")}). This produces ${result.crossTenantMatrix.similarities.length} cross-tenant pairs against the strict 0.85 cosine / 0.40 ROUGE-L thresholds. This is the test that directly validates the architecture's load-bearing claim that two brokers picking the same identity get differentiated content.*`,
    );
    lines.push("");
    lines.push("### Cross-tenant similarity distribution");
    lines.push("");
    lines.push(
      `- **Cosine similarity**: mean ${result.crossTenantMatrix.meanCosine.toFixed(4)}, range ${result.crossTenantMatrix.minCosine.toFixed(4)} – ${result.crossTenantMatrix.maxCosine.toFixed(4)} (threshold: < 0.85)`,
    );
    lines.push(
      `- **ROUGE-L F1**:       mean ${result.crossTenantMatrix.meanRougeL.toFixed(4)}, range ${result.crossTenantMatrix.minRougeL.toFixed(4)} – ${result.crossTenantMatrix.maxRougeL.toFixed(4)} (threshold: < 0.40)`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Then the intra-tenant verdict (cross-identity matrix) — secondary
  lines.push(`## ${verdictBadge(result.verdict)} Intra-tenant cross-identity verdict (secondary)`);
  lines.push("");
  lines.push(result.verdictReasoning);
  lines.push("");
  lines.push(
    "*This is the matrix of pairwise comparisons between the 6 different identities below, all consuming the same core analysis. It tests a different question: \"if a single broker runs multiple identity pipelines on the same event, are the resulting products differentiated?\" Note: this matrix uses the strict cross-tenant thresholds (0.85 cosine), which is over-strict for an intra-tenant comparison — the spec actually allows 0.92 cosine for intra-tenant cross-pipeline. Read this verdict with that caveat.*",
  );
  lines.push("");

  return lines.join("\n");
}

function similarityMatrixTable(
  similarities: SimilarityResult[],
  outputs: IdentityOutput[],
): string {
  const lines: string[] = [];
  lines.push("| Pair | Cosine | ROUGE-L | Status | Fidelity | Presentation | Verdict |");
  lines.push("|---|---:|---:|---|---:|---:|---|");

  for (const sim of similarities) {
    const a = outputs.find((o) => o.identityId === sim.identityA);
    const b = outputs.find((o) => o.identityId === sim.identityB);
    const fidelity = sim.judgeFactualFidelity !== undefined ? sim.judgeFactualFidelity.toFixed(2) : "—";
    const presentation = sim.judgePresentationSimilarity !== undefined ? sim.judgePresentationSimilarity.toFixed(2) : "—";
    lines.push(
      `| ${a?.identityName} ↔ ${b?.identityName} | ${sim.cosineSimilarity.toFixed(4)} | ${sim.rougeL.toFixed(4)} | ${statusBadge(sim.status)} | ${fidelity} | ${presentation} | ${trinaryVerdictBadge(sim.judgeTrinaryVerdict)} |`,
    );
  }

  return lines.join("\n");
}

function readingGuide(): string {
  return `## How to read this report

This report is the output of a deliberately small proof-of-concept harness designed to test ONE thing: **does the same shared core analysis produce genuinely different content when adapted by different identity agents?** This is the load-bearing claim of the FinFlow content architecture.

When you read the six identity outputs below, ask yourself:

1. **Format and structure** — Does each piece have a recognizably different shape? Is the trading-desk alert actually terse and structured, or just a shorter article? Is the educator piece actually pedagogical, or just an article with subheadings? Is the senior-strategist piece actually institutional, or just a longer blog post?
2. **Voice and audience** — Could you read just two paragraphs of any piece and identify which identity wrote it? Does each piece sound like it was written for a different reader?
3. **Editorial choices** — Where does each piece START its narrative? Where does it END? What does it choose to emphasize from the underlying analysis? Two pieces with the same conclusions but different emphases are still genuinely unique.
4. **Cross-broker test** — Could a competitor's blog mistake any of these pieces for theirs? Would Google's duplicate-content detection flag any pair as substantially similar?
5. **The hard test** — Imagine all six pieces appearing in different brokers' blogs/Telegram channels/newsletters this morning, all responding to the same news event. Does the system look like a content engine producing one piece N ways, or like six different writers responding to the same news independently?

If the answer to #5 is "six different writers," the architecture is validated. If it looks like one piece reskinned, the architecture has a hole and we need to fix it before building further.

The similarity matrix at the end gives you the numerical bar. The thresholds are the v1 first-pass values from the uniqueness spec — they will be tuned in production, but they're a sensible starting bar.
`;
}

export function renderReport(result: RunResult): string {
  const { event, coreAnalysis, identityOutputs, similarities } = result;

  const lines: string[] = [];

  // ───────── Header ─────────
  lines.push(`# Uniqueness PoC — ${event.title}`);
  lines.push("");
  lines.push(`**Run ID:** \`${result.runId}\``);
  lines.push(`**Started:** ${result.startedAt}`);
  lines.push(`**Finished:** ${result.finishedAt}`);
  lines.push(`**Total duration:** ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`**Total cost:** ${formatUsd(result.totalCostUsd)}`);
  lines.push("");

  // ───────── Verdict ─────────
  lines.push(verdictBanner(result));
  lines.push("");
  lines.push(
    `**Thresholds (cross-tenant, from uniqueness spec §6):** cosine ≥ ${UNIQUENESS_THRESHOLDS.crossTenant.cosine} = FAIL, cosine ≥ ${UNIQUENESS_THRESHOLDS.crossTenant.cosine - UNIQUENESS_THRESHOLDS.crossTenant.cosineBorderlineMargin} = BORDERLINE, ROUGE-L ≥ ${UNIQUENESS_THRESHOLDS.crossTenant.rougeL} = FAIL.`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // ───────── Reading guide ─────────
  lines.push(readingGuide());
  lines.push("");
  lines.push("---");
  lines.push("");

  // ───────── Source event ─────────
  lines.push(`## The source event`);
  lines.push("");
  lines.push(`> **${event.title}**`);
  lines.push(`> *${event.source}, ${event.publishedAt}*`);
  lines.push("");
  lines.push(`**Topic analyzed:** ${event.topicName} (\`${event.topicId}\`)`);
  lines.push("");
  lines.push(`### Article body`);
  lines.push("");
  lines.push(event.body);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ───────── Core analysis ─────────
  lines.push(`## 1. Core analytical layer (FA agent)`);
  lines.push("");
  lines.push(
    `*This is the cached, shared analysis that all identity agents below consume. In production, this single piece would be reused by every tenant pipeline triggered on the same (event, topic, method) combination. ${coreAnalysis.outputTokens} output tokens, ${(coreAnalysis.durationMs / 1000).toFixed(1)}s, ${formatUsd(coreAnalysis.costUsd)}.*`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(coreAnalysis.body);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ───────── Identity outputs ─────────
  lines.push(`## 2. Identity adaptation layer — ${identityOutputs.length} outputs`);
  lines.push("");
  lines.push(
    "*Each output below was produced by a different identity agent, all consuming the SAME core analysis above. No identity agent reasoned about the underlying market — they only shaped the analysis for their target audience and format.*",
  );
  lines.push("");

  for (const out of identityOutputs) {
    lines.push(`### ${out.identityName}`);
    lines.push("");
    lines.push(
      `*${out.wordCount} words · ${out.model} · ${(out.durationMs / 1000).toFixed(1)}s · ${formatUsd(out.costUsd)}*`,
    );
    lines.push("");
    lines.push(out.body);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ───────── Similarity matrix ─────────
  lines.push(`## 3. Pairwise similarity matrix`);
  lines.push("");
  lines.push(
    `${identityOutputs.length} identities = ${similarities.length} pairwise comparisons. Each pair is checked against the cross-tenant uniqueness thresholds from the spec.`,
  );
  lines.push("");
  lines.push(similarityMatrixTable(similarities, identityOutputs));
  lines.push("");

  // ───────── Reproducibility ─────────
  if (result.reproducibility) {
    lines.push("---");
    lines.push("");
    lines.push(`## 4. Reproducibility test`);
    lines.push("");
    lines.push(
      `Same identity (\`${result.reproducibility.identityId}\`) run **${result.reproducibility.runs.length} times** on the same core analysis. This tests whether the identity agent produces stable output across independent runs (high mean cosine = high reproducibility).`,
    );
    lines.push("");
    lines.push(`- **Pairwise cosine mean:** ${result.reproducibility.pairwiseCosineMean.toFixed(4)}`);
    lines.push(`- **Pairwise cosine min:** ${result.reproducibility.pairwiseCosineMin.toFixed(4)}`);
    lines.push(`- **Pairwise cosine max:** ${result.reproducibility.pairwiseCosineMax.toFixed(4)}`);
    lines.push("");
    lines.push(
      `*A mean cosine close to 1.0 means each run is nearly identical (high stability). A mean cosine close to the cross-tenant FAIL threshold (0.85) means runs vary significantly — that's bad for trust but good for diversification.*`,
    );
    lines.push("");
  }

  // ───────── Persona differentiation ─────────
  if (result.personaDifferentiation) {
    const pd = result.personaDifferentiation;
    lines.push("---");
    lines.push("");
    lines.push(`## 5. Persona-overlay differentiation test`);
    lines.push("");
    lines.push(
      `Same identity (\`${pd.identityId}\`), same core analysis, but TWO different ContentPersona overlays applied. This tests whether two clients picking the same identity get genuinely differentiated content by the persona layer alone (before the conformance engine runs in production).`,
    );
    lines.push("");
    lines.push(`- **Persona A:** ${pd.personaA.name}`);
    lines.push(`- **Persona B:** ${pd.personaB.name}`);
    lines.push(`- **Cosine similarity:** ${pd.cosineSimilarity.toFixed(4)}`);
    lines.push(`- **ROUGE-L F1:** ${pd.rougeL.toFixed(4)}`);
    lines.push(
      `- **Differentiated:** ${pd.differentiated ? "✓ YES (below intra-tenant thresholds)" : "✗ NO (above intra-tenant thresholds — persona overlay alone is not enough)"}`,
    );
    lines.push("");
    lines.push(`### Output A (${pd.personaA.name})`);
    lines.push("");
    lines.push(pd.outputA.body);
    lines.push("");
    lines.push(`### Output B (${pd.personaB.name})`);
    lines.push("");
    lines.push(pd.outputB.body);
    lines.push("");
  }

  // ───────── Stage 6: cross-tenant matrix (the load-bearing test) ─────────
  if (result.crossTenantMatrix) {
    const ct = result.crossTenantMatrix;
    lines.push("---");
    lines.push("");
    lines.push(`## 6. Cross-tenant matrix — ${ct.identityName} × ${ct.personas.length} brokers`);
    lines.push("");
    lines.push(
      `**This is the load-bearing test of the architecture.** Same identity (\`${ct.identityName}\`), same core analysis from §1, but applied with ${ct.personas.length} different broker personas. This isolates the question: *do two brokers picking the same writer get genuinely different content?*`,
    );
    lines.push("");
    lines.push(
      `Each pair below is a cross-tenant comparison evaluated against the **strict cross-tenant thresholds** from the uniqueness spec: cosine < 0.85, ROUGE-L F1 < 0.40. This is the bar Google's duplicate-content detection cares about and the bar a discerning reader cares about.`,
    );
    lines.push("");

    // The 4 outputs in full
    lines.push(`### The ${ct.outputs.length} outputs`);
    lines.push("");
    for (let i = 0; i < ct.outputs.length; i++) {
      const output = ct.outputs[i]!;
      const persona = ct.personas[i]!;
      lines.push(`#### ${persona.name} — ${persona.regionalVariant}`);
      lines.push("");
      lines.push(
        `*${output.wordCount} words · ${output.model} · ${(output.durationMs / 1000).toFixed(1)}s · ${formatUsd(output.costUsd)}*`,
      );
      lines.push("");
      lines.push(`**Brand voice:** ${persona.brandVoice}`);
      lines.push("");
      lines.push(output.body);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    // Pairwise matrix
    lines.push(`### Cross-tenant pairwise similarity matrix`);
    lines.push("");
    lines.push(
      `${ct.personas.length} personas → ${ct.similarities.length} cross-tenant pairs. Each scored against the strict cross-tenant thresholds.`,
    );
    lines.push("");
    lines.push("| Pair | Cosine | ROUGE-L | Status | Fidelity | Presentation | Verdict |");
    lines.push("|---|---:|---:|---|---:|---:|---|");
    for (const sim of ct.similarities) {
      const fidelity = sim.judgeFactualFidelity !== undefined ? sim.judgeFactualFidelity.toFixed(2) : "—";
      const presentation = sim.judgePresentationSimilarity !== undefined ? sim.judgePresentationSimilarity.toFixed(2) : "—";
      lines.push(
        `| ${sim.identityA} ↔ ${sim.identityB} | ${sim.cosineSimilarity.toFixed(4)} | ${sim.rougeL.toFixed(4)} | ${statusBadge(sim.status)} | ${fidelity} | ${presentation} | ${trinaryVerdictBadge(sim.judgeTrinaryVerdict)} |`,
      );
    }
    lines.push("");

    // Per-pair judge reasoning + any factual divergences
    const judged = ct.similarities.filter((s) => s.judgeTrinaryVerdict);
    if (judged.length > 0) {
      lines.push("### Two-axis judge reasoning");
      lines.push("");
      for (const sim of judged) {
        lines.push(
          `**${sim.identityA} ↔ ${sim.identityB}** — ${trinaryVerdictBadge(sim.judgeTrinaryVerdict)} &nbsp;·&nbsp; fidelity ${sim.judgeFactualFidelity?.toFixed(2)} &nbsp;·&nbsp; presentation ${sim.judgePresentationSimilarity?.toFixed(2)}`,
        );
        lines.push("");
        if (sim.judgeFactualFidelityReasoning) {
          lines.push(`*Fidelity:* ${sim.judgeFactualFidelityReasoning}`);
          lines.push("");
        }
        if (sim.judgeFactualDivergences && sim.judgeFactualDivergences.length > 0) {
          lines.push(`*Factual divergences (${sim.judgeFactualDivergences.length}):*`);
          lines.push("");
          for (const d of sim.judgeFactualDivergences) {
            lines.push(`- \`${d.kind}\` — **A:** ${d.docA} &nbsp;·&nbsp; **B:** ${d.docB}`);
          }
          lines.push("");
        }
        if (sim.judgePresentationSimilarityReasoning) {
          lines.push(`*Presentation:* ${sim.judgePresentationSimilarityReasoning}`);
          lines.push("");
        }
      }
    }

    // Distribution stats
    lines.push("### Distribution statistics");
    lines.push("");
    lines.push("| Metric | Mean | Min | Max | Threshold |");
    lines.push("|---|---:|---:|---:|---:|");
    lines.push(
      `| Cosine | ${ct.meanCosine.toFixed(4)} | ${ct.minCosine.toFixed(4)} | ${ct.maxCosine.toFixed(4)} | < 0.85 |`,
    );
    lines.push(
      `| ROUGE-L F1 | ${ct.meanRougeL.toFixed(4)} | ${ct.minRougeL.toFixed(4)} | ${ct.maxRougeL.toFixed(4)} | < 0.40 |`,
    );
    lines.push("");
    lines.push(`### Cross-tenant verdict: ${verdictBadge(ct.verdict)}`);
    lines.push("");
    lines.push(ct.verdictReasoning);
    lines.push("");
  }

  // ───────── Stage 7: temporal narrative continuity ─────────
  if (result.narrativeStateTest) {
    const ns = result.narrativeStateTest;
    lines.push("---");
    lines.push("");
    lines.push(`## 7. Temporal narrative continuity test (Stage 7)`);
    lines.push("");
    lines.push(
      `**Hypothesis:** per-client narrative memory adds another differentiation layer on top of the static persona+tag layers. Mechanism: each persona's prior coverage of ${ns.secondEvent.topicName} (from Stage 6) is extracted into structured narrative state and injected as context when the same persona writes about a *continuation* event a few days later. The control group writes the second event with no narrative state; the treatment group writes the same second event with their respective narrative states injected.`,
    );
    lines.push("");
    lines.push(`**Second event used:** *${ns.secondEvent.title}* (${ns.secondEvent.source}, ${ns.secondEvent.publishedAt})`);
    lines.push("");

    // Headline numbers
    lines.push("### Headline differential");
    lines.push("");
    lines.push("| Metric | Control (no state) | Treatment (with state) | Improvement |");
    lines.push("|---|---:|---:|---:|");
    lines.push(
      `| **Cosine mean** | ${ns.controlMeanCosine.toFixed(4)} | ${ns.treatmentMeanCosine.toFixed(4)} | ${ns.cosineImprovement >= 0 ? "−" : "+"}${Math.abs(ns.cosineImprovement).toFixed(4)} ${ns.cosineImprovement > 0 ? "✅" : "❌"} |`,
    );
    lines.push(
      `| **ROUGE-L mean** | ${ns.controlMeanRougeL.toFixed(4)} | ${ns.treatmentMeanRougeL.toFixed(4)} | ${ns.rougeLImprovement >= 0 ? "−" : "+"}${Math.abs(ns.rougeLImprovement).toFixed(4)} ${ns.rougeLImprovement > 0 ? "✅" : "❌"} |`,
    );
    lines.push("");
    lines.push(`**Treatment verdict:** ${verdictBadge(ns.treatmentVerdict)} — ${ns.treatmentVerdictReasoning}`);
    lines.push("");
    lines.push(
      `*A positive cosine improvement means the narrative-state injection produced more cross-tenant differentiation than the control. A meaningful improvement (~0.03 or more) would validate temporal continuity as a real layer of the architecture that compounds with usage.*`,
    );
    lines.push("");

    // Extracted narrative states
    lines.push("### Extracted narrative state per persona (from Stage 6 outputs)");
    lines.push("");
    for (const ns_entry of ns.narrativeStates) {
      const e = ns_entry.state.recentEntries[0]!;
      lines.push(`#### ${ns_entry.personaName}`);
      lines.push("");
      lines.push(`- **Summary**: ${e.oneSentenceSummary}`);
      lines.push(`- **Directional view**: ${e.directionalView} (${e.directionalViewConfidence} confidence)`);
      if (e.keyThesisStatements.length > 0) {
        lines.push(`- **Key thesis statements**:`);
        for (const t of e.keyThesisStatements) {
          lines.push(`  - ${t}`);
        }
      }
      if (e.keyLevelsMentioned.length > 0) {
        lines.push(`- **Levels mentioned**: ${e.keyLevelsMentioned.join("; ")}`);
      }
      if (e.callsToActionUsed.length > 0) {
        lines.push(`- **CTAs used**: ${e.callsToActionUsed.join("; ")}`);
      }
      lines.push("");
    }

    // Pairwise matrices side by side
    lines.push("### Control matrix (no narrative state)");
    lines.push("");
    lines.push("| Pair | Cosine | ROUGE-L | Status |");
    lines.push("|---|---:|---:|---|");
    for (const sim of ns.controlSimilarities) {
      lines.push(
        `| ${sim.identityA} ↔ ${sim.identityB} | ${sim.cosineSimilarity.toFixed(4)} | ${sim.rougeL.toFixed(4)} | ${statusBadge(sim.status)} |`,
      );
    }
    lines.push("");

    lines.push("### Treatment matrix (with narrative state)");
    lines.push("");
    lines.push("| Pair | Cosine | ROUGE-L | Status |");
    lines.push("|---|---:|---:|---|");
    for (const sim of ns.treatmentSimilarities) {
      lines.push(
        `| ${sim.identityA} ↔ ${sim.identityB} | ${sim.cosineSimilarity.toFixed(4)} | ${sim.rougeL.toFixed(4)} | ${statusBadge(sim.status)} |`,
      );
    }
    lines.push("");

    // The treatment outputs in full so the reader can see them
    lines.push(`### Treatment outputs in full (with narrative state injected)`);
    lines.push("");
    lines.push(
      `*These are the second-event pieces written by each persona's journalist with their prior coverage as memory. The reader should be able to feel the narrative continuity — references to prior takes, consistent positioning, building on the established framing.*`,
    );
    lines.push("");
    for (let i = 0; i < ns.treatmentOutputs.length; i++) {
      const out = ns.treatmentOutputs[i]!;
      const persona = ns.narrativeStates[i]!;
      lines.push(`#### ${persona.personaName}`);
      lines.push("");
      lines.push(
        `*${out.wordCount} words · ${out.model} · ${(out.durationMs / 1000).toFixed(1)}s · ${formatUsd(out.costUsd)}*`,
      );
      lines.push("");
      lines.push(out.body);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // ───────── Cost summary ─────────
  lines.push("---");
  lines.push("");
  lines.push(`## Cost summary`);
  lines.push("");
  lines.push("| Stage | Calls | Cost |");
  lines.push("|---|---:|---:|");
  lines.push(`| Core analysis (Opus) | 1 | ${formatUsd(coreAnalysis.costUsd)} |`);
  const identityCost = identityOutputs.reduce((s, o) => s + o.costUsd, 0);
  lines.push(`| Identity adaptation × ${identityOutputs.length} (Sonnet) | ${identityOutputs.length} | ${formatUsd(identityCost)} |`);
  const judgeCost = similarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0);
  const judgeCount = similarities.filter((s) => s.judgeTrinaryVerdict).length;
  if (judgeCount > 0) {
    // Intra-tenant matrix still uses borderline gating (not load-bearing).
    // Cross-tenant judge cost is bundled into the crossTenantMatrix row below.
    lines.push(`| LLM judge (Haiku, intra-tenant borderline pairs) | ${judgeCount} | ${formatUsd(judgeCost)} |`);
  }
  if (result.personaDifferentiation) {
    const pdCost =
      result.personaDifferentiation.outputA.costUsd +
      result.personaDifferentiation.outputB.costUsd;
    lines.push(`| Persona differentiation test (Sonnet × 2) | 2 | ${formatUsd(pdCost)} |`);
  }
  if (result.crossTenantMatrix) {
    const ctCost =
      result.crossTenantMatrix.outputs.reduce((s, o) => s + o.costUsd, 0) +
      result.crossTenantMatrix.similarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0);
    const ctJudgeCount = result.crossTenantMatrix.similarities.filter((s) => s.judgeTrinaryVerdict).length;
    lines.push(
      `| **Cross-tenant matrix** (Sonnet × ${result.crossTenantMatrix.outputs.length} + Haiku judge × ${ctJudgeCount}) | ${result.crossTenantMatrix.outputs.length + ctJudgeCount} | ${formatUsd(ctCost)} |`,
    );
  }
  if (result.narrativeStateTest) {
    const ns = result.narrativeStateTest;
    const nsCost =
      ns.secondCoreAnalysis.costUsd +
      ns.narrativeStates.reduce(
        (s, e) => s + (e.state.recentEntries[0]?.extractionCostUsd ?? 0),
        0,
      ) +
      ns.controlOutputs.reduce((s, o) => s + o.costUsd, 0) +
      ns.treatmentOutputs.reduce((s, o) => s + o.costUsd, 0) +
      ns.controlSimilarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0) +
      ns.treatmentSimilarities.reduce((s, sim) => s + (sim.judgeCostUsd ?? 0), 0);
    const nsJudgeCount =
      ns.controlSimilarities.filter((s) => s.judgeTrinaryVerdict).length +
      ns.treatmentSimilarities.filter((s) => s.judgeTrinaryVerdict).length;
    lines.push(
      `| **Stage 7 narrative test** (1 Opus + 4 Haiku extractors + 8 Sonnet + ${nsJudgeCount} Haiku judges) | ${1 + 4 + 8 + nsJudgeCount} | ${formatUsd(nsCost)} |`,
    );
  }
  if (result.reproducibility) {
    lines.push(`| Reproducibility test (× ${result.reproducibility.runs.length}) | ${result.reproducibility.runs.length} | (not totaled) |`);
  }
  lines.push(`| **Total** | | **${formatUsd(result.totalCostUsd)}** |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `*Generated by \`packages/api/src/benchmark/uniqueness-poc\`. This is a proof-of-concept harness, not production code. For the architectural specifications it's testing, see \`docs/specs/2026-04-07-content-pipeline.md\` and \`docs/specs/2026-04-07-content-uniqueness.md\`.*`,
  );

  return lines.join("\n");
}
