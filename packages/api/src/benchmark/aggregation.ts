/**
 * Aggregation — compute statistics across N comparison results
 * and generate calibration recommendations.
 */

import { ALL_METRICS } from "../profiles/types.js";
import type { ClientProfile } from "../profiles/types.js";
import { getLanguageProfile } from "../profiles/types.js";
import type {
  ComparisonResult,
  AggregateReport,
  MetricAggregateStats,
  CalibrationRecommendation,
} from "./types.js";

// --- Statistics ---

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((s, v) => s + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

// --- Aggregate ---

export function aggregateResults(
  results: ComparisonResult[],
  language: string,
  profile: ClientProfile,
): AggregateReport {
  const langProfile = getLanguageProfile(profile, language);
  const thresholds = langProfile.scoring.metricThresholds;

  const metricStats: Record<string, MetricAggregateStats> = {};

  for (const metric of ALL_METRICS) {
    const aiScores: number[] = [];
    const humanScores: number[] = [];
    const deltas: number[] = [];
    let aiPass = 0;
    let humanPass = 0;

    for (const r of results) {
      const delta = r.metricDeltas[metric];
      if (!delta) continue;

      aiScores.push(delta.aiScore);
      humanScores.push(delta.humanScore);
      deltas.push(delta.delta);
      if (delta.aiPassed) aiPass++;
      if (delta.humanPassed) humanPass++;
    }

    const n = aiScores.length;
    if (n === 0) continue;

    const meanDelta = mean(deltas);
    const threshold = thresholds[metric] ?? 0;

    const stats: MetricAggregateStats = {
      meanAiScore: Math.round(mean(aiScores) * 10) / 10,
      meanHumanScore: Math.round(mean(humanScores) * 10) / 10,
      meanDelta: Math.round(meanDelta * 10) / 10,
      stddevDelta: Math.round(stddev(deltas, meanDelta) * 10) / 10,
      aiPassRate: Math.round((aiPass / n) * 100) / 100,
      humanPassRate: Math.round((humanPass / n) * 100) / 100,
      currentThreshold: threshold,
    };

    metricStats[metric] = stats;
  }

  // Overall pass rates (all 13 metrics must pass)
  let aiFullPass = 0;
  let humanFullPass = 0;
  for (const r of results) {
    if (r.aiScorecard.passed) aiFullPass++;
    if (r.humanScorecard.passed) humanFullPass++;
  }

  const recommendations = generateRecommendations(metricStats);

  return {
    language,
    sampleCount: results.length,
    metricStats,
    overallAiPassRate:
      results.length > 0
        ? Math.round((aiFullPass / results.length) * 100) / 100
        : 0,
    overallHumanPassRate:
      results.length > 0
        ? Math.round((humanFullPass / results.length) * 100) / 100
        : 0,
    calibrationRecommendations: recommendations,
    rawResults: results,
  };
}

// --- Calibration Recommendations ---

function generateRecommendations(
  stats: Record<string, MetricAggregateStats>,
): CalibrationRecommendation[] {
  const recs: CalibrationRecommendation[] = [];

  for (const [metric, s] of Object.entries(stats)) {
    // Human translators fail > 50% → threshold likely too strict
    if (s.humanPassRate < 0.5) {
      const suggested = Math.round(s.meanHumanScore - s.stddevDelta);
      recs.push({
        metric,
        type: "threshold_adjustment",
        description: `Human translators fail ${metric} ${Math.round((1 - s.humanPassRate) * 100)}% of the time. ` +
          `Threshold of ${s.currentThreshold} may be too aggressive. ` +
          `Human mean score: ${s.meanHumanScore}.`,
        currentValue: s.currentThreshold,
        suggestedValue: Math.max(suggested, 50),
        confidence: s.humanPassRate < 0.25 ? "high" : "medium",
        evidence: `humanPassRate=${s.humanPassRate}, meanHumanScore=${s.meanHumanScore}, meanDelta=${s.meanDelta}`,
      });
    }

    // AI systematically outscores human by > 15 points → verify scoring
    if (s.meanDelta > 15) {
      recs.push({
        metric,
        type: "investigation_needed",
        description: `AI outscores humans by ${s.meanDelta} points on average for ${metric}. ` +
          `This may indicate the metric favors AI-generated text or the scoring is not calibrated to human output.`,
        currentValue: s.currentThreshold,
        confidence: s.meanDelta > 25 ? "high" : "medium",
        evidence: `meanAiScore=${s.meanAiScore}, meanHumanScore=${s.meanHumanScore}, meanDelta=${s.meanDelta}`,
      });
    }

    // High variance → metric is inconsistent
    if (s.stddevDelta > 20) {
      recs.push({
        metric,
        type: "investigation_needed",
        description: `High variance in ${metric} delta (stddev=${s.stddevDelta}). ` +
          `The metric may behave inconsistently across different document types.`,
        currentValue: s.currentThreshold,
        confidence: "medium",
        evidence: `stddevDelta=${s.stddevDelta}, meanDelta=${s.meanDelta}`,
      });
    }

    // Both AI and human consistently pass with room to spare → threshold may be too lenient
    if (
      s.aiPassRate > 0.95 &&
      s.humanPassRate > 0.95 &&
      s.meanAiScore > s.currentThreshold + 15 &&
      s.meanHumanScore > s.currentThreshold + 15
    ) {
      recs.push({
        metric,
        type: "threshold_adjustment",
        description: `Both AI and human easily pass ${metric} (AI mean: ${s.meanAiScore}, human mean: ${s.meanHumanScore}, ` +
          `threshold: ${s.currentThreshold}). Consider raising the threshold for tighter quality control.`,
        currentValue: s.currentThreshold,
        suggestedValue: Math.round(
          Math.min(s.meanAiScore, s.meanHumanScore) - 5,
        ),
        confidence: "low",
        evidence: `aiPassRate=${s.aiPassRate}, humanPassRate=${s.humanPassRate}`,
      });
    }
  }

  // Sort: high confidence first
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  recs.sort(
    (a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence],
  );

  return recs;
}

// --- Markdown Report ---

export function formatAggregateReport(report: AggregateReport): string {
  const lines: string[] = [];

  lines.push(`# Calibration Report — ${report.language.toUpperCase()}`);
  lines.push("");
  lines.push(`**Samples:** ${report.sampleCount}`);
  lines.push(
    `**Overall Pass Rate:** AI ${Math.round(report.overallAiPassRate * 100)}% | Human ${Math.round(report.overallHumanPassRate * 100)}%`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Metric table
  lines.push("## Per-Metric Comparison");
  lines.push("");
  lines.push(
    "| Metric | AI Mean | Human Mean | Delta | AI Pass% | Human Pass% | Threshold | Status |",
  );
  lines.push(
    "|--------|---------|------------|-------|----------|-------------|-----------|--------|",
  );

  for (const metric of ALL_METRICS) {
    const s = report.metricStats[metric];
    if (!s) continue;

    const status =
      s.humanPassRate >= 0.8
        ? "Calibrated"
        : s.humanPassRate >= 0.5
          ? "Review"
          : "Adjust";
    const icon =
      status === "Calibrated" ? "OK" : status === "Review" ? "??" : "!!";

    lines.push(
      `| ${metric} | ${s.meanAiScore} | ${s.meanHumanScore} | ${s.meanDelta > 0 ? "+" : ""}${s.meanDelta} | ${Math.round(s.aiPassRate * 100)}% | ${Math.round(s.humanPassRate * 100)}% | ${s.currentThreshold} | ${icon} ${status} |`,
    );
  }

  lines.push("");

  // Recommendations
  if (report.calibrationRecommendations.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Calibration Recommendations");
    lines.push("");

    for (const rec of report.calibrationRecommendations) {
      const conf = rec.confidence.toUpperCase();
      lines.push(`### [${conf}] ${rec.metric} — ${rec.type}`);
      lines.push("");
      lines.push(rec.description);
      if (rec.suggestedValue !== undefined) {
        lines.push(
          `**Current:** ${rec.currentValue} → **Suggested:** ${rec.suggestedValue}`,
        );
      }
      lines.push(`*Evidence: ${rec.evidence}*`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `*Generated ${new Date().toISOString()} — FinFlow Calibration Benchmark*`,
  );

  return lines.join("\n");
}
