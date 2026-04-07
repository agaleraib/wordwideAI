/**
 * CSV export — 3 separate files for Excel analysis.
 *
 * 1. docs.csv — 1 row per document (summary + costs)
 * 2. phases.csv — 1 row per pipeline phase per document (tokens, cost, timing, model)
 * 3. metrics.csv — 1 row per metric per translator per document (scores)
 */

import type { Scorecard } from "../scoring/scorecard.js";
import type { ComparisonResult } from "./types.js";
import type { AuditEntry } from "../pipeline/translation-engine.js";

// --- Pricing ---

const PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  sonnet: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  haiku: { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
};

function inferModel(agent: string): string {
  if (agent.toLowerCase().includes("haiku")) return "haiku";
  if (agent.toLowerCase().includes("sonnet")) return "sonnet";
  if (agent.toLowerCase().includes("gpt")) return "gpt-4o";
  return "opus";
}

function tokenCost(
  tokensIn: number,
  tokensOut: number,
  model: string,
): number {
  const rates = PRICING[model] ?? PRICING["opus"]!;
  return tokensIn * rates.input + tokensOut * rates.output;
}

// --- Helpers ---

function esc(value: string | number | boolean | undefined): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(fields: Array<string | number | boolean | undefined>): string {
  return fields.map(esc).join(",");
}

// --- 1. docs.csv ---

export function exportDocsCsv(
  results: ComparisonResult[],
  language: string,
  runId: string,
): string {
  const header = row([
    "run_id",
    "report_id",
    "language",
    "timestamp",
    "source_words",
    "ai_words",
    "human_words",
    "generic_words",
    "finflow_aggregate",
    "human_aggregate",
    "generic_aggregate",
    "finflow_passed_count",
    "human_passed_count",
    "generic_passed_count",
    "finflow_passed",
    "human_passed",
    "generic_passed",
    "total_tokens_in",
    "total_tokens_out",
    "total_cost_usd",
    "total_duration_ms",
    "ai_pipeline_ms",
    "human_scoring_ms",
    "generic_ms",
    "analysis_ms",
    "correction_rounds",
    "hitl_terms_count",
    "glossary_terms_relevant",
    "glossary_matched",
    "glossary_missed",
    "patcher_replacements",
  ]);

  const rows: string[] = [header];
  const timestamp = new Date().toISOString();

  for (const r of results) {
    // Count words
    const srcWords = r.sourceText.split(/\s+/).length;
    const aiWords = r.aiTranslation.split(/\s+/).length;
    const humanWords = r.humanTranslation.split(/\s+/).length;
    const genericWords = r.genericTranslation
      ? r.genericTranslation.split(/\s+/).length
      : "";

    // Aggregate tokens/cost from audit trail
    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0;
    let correctionRounds = 0;
    let patcherReplacements = 0;

    for (const entry of r.aiAuditTrail) {
      if (entry.tokens) {
        totalIn += entry.tokens.input;
        totalOut += entry.tokens.output;
        const model = inferModel(entry.agent);
        totalCost += tokenCost(entry.tokens.input, entry.tokens.output, model);
      }
      if (entry.stage === "scoring" && entry.reasoning?.includes("Round")) {
        const roundMatch = entry.reasoning.match(/Round (\d+)/);
        if (roundMatch) {
          correctionRounds = Math.max(
            correctionRounds,
            parseInt(roundMatch[1]!, 10),
          );
        }
      }
      if (entry.stage === "glossary_patcher") {
        const repMatch = entry.reasoning?.match(/(\d+) terms fixed/);
        if (repMatch) patcherReplacements = parseInt(repMatch[1]!, 10);
      }
    }

    // Glossary stats from metricDeltas
    const glossaryDelta = r.metricDeltas["glossary_compliance"];
    const glossaryScore = glossaryDelta?.aiScore ?? 0;
    const glossaryTotal = r.aiScorecard.metrics["glossary_compliance"]
      ? Math.round(
          (glossaryScore / 100) *
            (r.aiScorecard.metrics["glossary_compliance"].score > 0 ? 100 : 1),
        )
      : 0;

    // Passed counts
    const finflowPassedCount =
      13 - r.aiScorecard.failedMetrics.length;
    const humanPassedCount =
      13 - r.humanScorecard.failedMetrics.length;
    const genericPassedCount = r.genericScorecard
      ? 13 - r.genericScorecard.failedMetrics.length
      : "";

    rows.push(
      row([
        runId,
        r.reportId,
        language,
        timestamp,
        srcWords,
        aiWords,
        humanWords,
        genericWords,
        Math.round(r.aiScorecard.aggregateScore * 10) / 10,
        Math.round(r.humanScorecard.aggregateScore * 10) / 10,
        r.genericScorecard
          ? Math.round(r.genericScorecard.aggregateScore * 10) / 10
          : "",
        finflowPassedCount,
        humanPassedCount,
        genericPassedCount,
        r.aiScorecard.passed,
        r.humanScorecard.passed,
        r.genericScorecard ? r.genericScorecard.passed : "",
        totalIn,
        totalOut,
        Math.round(totalCost * 10000) / 10000,
        r.timing.aiPipelineMs +
          r.timing.humanScoringMs +
          r.timing.analysisMs +
          (r.timing.genericMs ?? 0),
        r.timing.aiPipelineMs,
        r.timing.humanScoringMs,
        r.timing.genericMs ?? "",
        r.timing.analysisMs,
        correctionRounds,
        r.qualitativeAnalysis.calibrationInsights?.length ?? 0,
        "", // glossary_terms_relevant — filled if available
        "", // glossary_matched
        "", // glossary_missed
        patcherReplacements,
      ]),
    );
  }

  return rows.join("\n") + "\n";
}

// --- 2. phases.csv ---

export function exportPhasesCsv(
  results: ComparisonResult[],
  language: string,
  runId: string,
): string {
  const header = row([
    "run_id",
    "report_id",
    "language",
    "phase_order",
    "phase",
    "agent",
    "model",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "duration_ms",
    "phase_result",
  ]);

  const rows: string[] = [header];

  for (const r of results) {
    for (const [idx, entry] of r.aiAuditTrail.entries()) {
      const model = inferModel(entry.agent);
      const tokIn = entry.tokens?.input ?? 0;
      const tokOut = entry.tokens?.output ?? 0;
      const cost = tokenCost(tokIn, tokOut, model);

      // Extract a brief result from reasoning
      let phaseResult = "";
      if (entry.reasoning) {
        // Truncate to something useful
        phaseResult = entry.reasoning.slice(0, 150).replace(/\n/g, " ");
      }

      rows.push(
        row([
          runId,
          r.reportId,
          language,
          idx + 1,
          entry.stage,
          entry.agent,
          model,
          tokIn,
          tokOut,
          Math.round(cost * 10000) / 10000,
          entry.durationMs ?? "",
          phaseResult,
        ]),
      );
    }

    // Add human scoring phase
    rows.push(
      row([
        runId,
        r.reportId,
        language,
        r.aiAuditTrail.length + 1,
        "human_scoring",
        "ScoringAgent (Opus)",
        "opus",
        "",
        "",
        "",
        r.timing.humanScoringMs,
        `Human aggregate: ${r.humanScorecard.aggregateScore.toFixed(1)}`,
      ]),
    );

    // Add generic translation phase if present
    if (r.genericScorecard && r.timing.genericMs) {
      rows.push(
        row([
          runId,
          r.reportId,
          language,
          r.aiAuditTrail.length + 2,
          "generic_translation_and_scoring",
          "Generic LLM",
          "opus",
          "",
          "",
          "",
          r.timing.genericMs,
          `Generic aggregate: ${r.genericScorecard.aggregateScore.toFixed(1)}`,
        ]),
      );
    }

    // Add comparison analysis phase
    rows.push(
      row([
        runId,
        r.reportId,
        language,
        r.aiAuditTrail.length + 3,
        "comparison_analysis",
        "ComparisonAgent (Sonnet)",
        "sonnet",
        "",
        "",
        "",
        r.timing.analysisMs,
        "Qualitative analysis",
      ]),
    );
  }

  return rows.join("\n") + "\n";
}

// --- 3. metrics.csv ---

export function exportMetricsCsv(
  results: ComparisonResult[],
  language: string,
  runId: string,
): string {
  const header = row([
    "run_id",
    "report_id",
    "language",
    "translator",
    "metric_name",
    "category",
    "score",
    "threshold",
    "passed",
    "weight",
    "details",
  ]);

  const rows: string[] = [header];

  for (const r of results) {
    // FinFlow metrics
    for (const [name, metric] of Object.entries(r.aiScorecard.metrics)) {
      rows.push(
        row([
          runId,
          r.reportId,
          language,
          "finflow",
          name,
          metric.category,
          metric.score,
          metric.threshold,
          metric.passed,
          "", // weight — could be added from profile
          metric.details.slice(0, 200),
        ]),
      );
    }
    // FinFlow aggregate
    rows.push(
      row([
        runId,
        r.reportId,
        language,
        "finflow",
        "_aggregate",
        "",
        Math.round(r.aiScorecard.aggregateScore * 10) / 10,
        r.aiScorecard.aggregateThreshold,
        r.aiScorecard.passed,
        "",
        `Failed: ${r.aiScorecard.failedMetrics.join(", ") || "none"}`,
      ]),
    );

    // Human metrics
    for (const [name, metric] of Object.entries(r.humanScorecard.metrics)) {
      rows.push(
        row([
          runId,
          r.reportId,
          language,
          "human",
          name,
          metric.category,
          metric.score,
          metric.threshold,
          metric.passed,
          "",
          metric.details.slice(0, 200),
        ]),
      );
    }
    // Human aggregate
    rows.push(
      row([
        runId,
        r.reportId,
        language,
        "human",
        "_aggregate",
        "",
        Math.round(r.humanScorecard.aggregateScore * 10) / 10,
        r.humanScorecard.aggregateThreshold,
        r.humanScorecard.passed,
        "",
        `Failed: ${r.humanScorecard.failedMetrics.join(", ") || "none"}`,
      ]),
    );

    // Generic metrics (if present)
    if (r.genericScorecard) {
      for (const [name, metric] of Object.entries(
        r.genericScorecard.metrics,
      )) {
        rows.push(
          row([
            runId,
            r.reportId,
            language,
            "generic",
            name,
            metric.category,
            metric.score,
            metric.threshold,
            metric.passed,
            "",
            metric.details.slice(0, 200),
          ]),
        );
      }
      // Generic aggregate
      rows.push(
        row([
          runId,
          r.reportId,
          language,
          "generic",
          "_aggregate",
          "",
          Math.round(r.genericScorecard.aggregateScore * 10) / 10,
          r.genericScorecard.aggregateThreshold,
          r.genericScorecard.passed,
          "",
          `Failed: ${r.genericScorecard.failedMetrics.join(", ") || "none"}`,
        ]),
      );
    }
  }

  return rows.join("\n") + "\n";
}

// --- Legacy exports (keep backward compat) ---

export function exportMetricsCSV(
  results: ComparisonResult[],
  language: string,
): string {
  return exportMetricsCsv(results, language, new Date().toISOString());
}

export function exportSummaryCSV(
  results: ComparisonResult[],
  language: string,
): string {
  // Build summary from the new metrics format
  const header =
    "metric_name,finflow_mean,human_mean,generic_mean,finflow_pass_rate,human_pass_rate,generic_pass_rate,threshold";
  const rows: string[] = [header];

  if (results.length === 0) return rows.join("\n") + "\n";

  const metricNames = Object.keys(results[0]!.aiScorecard.metrics);

  for (const metricName of metricNames) {
    let fSum = 0,
      hSum = 0,
      gSum = 0,
      fPass = 0,
      hPass = 0,
      gPass = 0,
      gCount = 0,
      threshold = 0;

    for (const r of results) {
      const ai = r.aiScorecard.metrics[metricName];
      const hu = r.humanScorecard.metrics[metricName];
      if (ai) {
        fSum += ai.score;
        if (ai.passed) fPass++;
        threshold = ai.threshold;
      }
      if (hu) {
        hSum += hu.score;
        if (hu.passed) hPass++;
      }
      if (r.genericScorecard) {
        const ge = r.genericScorecard.metrics[metricName];
        if (ge) {
          gSum += ge.score;
          if (ge.passed) gPass++;
          gCount++;
        }
      }
    }

    const n = results.length;
    rows.push(
      row([
        metricName,
        (fSum / n).toFixed(1),
        (hSum / n).toFixed(1),
        gCount > 0 ? (gSum / gCount).toFixed(1) : "",
        (fPass / n).toFixed(3),
        (hPass / n).toFixed(3),
        gCount > 0 ? (gPass / gCount).toFixed(3) : "",
        threshold,
      ]),
    );
  }

  return rows.join("\n") + "\n";
}
