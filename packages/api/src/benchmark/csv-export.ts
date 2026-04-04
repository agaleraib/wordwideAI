/**
 * CSV export utilities for benchmark metrics data.
 *
 * Produces CSV strings suitable for spreadsheet import and presentation use.
 */

import type { Scorecard } from "../scoring/scorecard.js";
import type { ComparisonResult } from "./types.js";

type Translator = "finflow" | "human" | "generic";

// ComparisonResult may gain a genericScorecard field from another agent.
// We type-narrow at runtime rather than modifying the shared type here.
interface ComparisonResultWithGeneric extends ComparisonResult {
  genericScorecard?: Scorecard;
}

function escapeCSVField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatRow(fields: readonly string[]): string {
  return fields.map(escapeCSVField).join(",");
}

function scorecardRows(
  scorecard: Scorecard,
  reportId: string,
  language: string,
  translator: Translator,
  timestamp: string,
): string[] {
  const rows: string[] = [];

  for (const metric of Object.values(scorecard.metrics)) {
    rows.push(
      formatRow([
        reportId,
        language,
        translator,
        metric.name,
        String(metric.score),
        String(metric.threshold),
        String(metric.passed),
        timestamp,
      ]),
    );
  }

  // Aggregate row
  rows.push(
    formatRow([
      reportId,
      language,
      translator,
      "_aggregate",
      String(scorecard.aggregateScore),
      String(scorecard.aggregateThreshold),
      String(scorecard.passed),
      timestamp,
    ]),
  );

  return rows;
}

/**
 * Export per-metric CSV rows for all comparison results.
 *
 * One row per metric per translator, plus an aggregate row per translator.
 */
export function exportMetricsCSV(
  results: ComparisonResult[],
  language: string,
): string {
  const header = "reportId,language,translator,metric_name,score,threshold,passed,timestamp";
  const rows: string[] = [header];
  const timestamp = new Date().toISOString();

  for (const result of results) {
    const r = result as ComparisonResultWithGeneric;

    rows.push(
      ...scorecardRows(r.aiScorecard, r.reportId, language, "finflow", timestamp),
    );
    rows.push(
      ...scorecardRows(r.humanScorecard, r.reportId, language, "human", timestamp),
    );

    if (r.genericScorecard) {
      rows.push(
        ...scorecardRows(r.genericScorecard, r.reportId, language, "generic", timestamp),
      );
    }
  }

  return rows.join("\n") + "\n";
}

/**
 * Export summary statistics CSV — one row per metric with mean scores and pass rates.
 */
export function exportSummaryCSV(
  results: ComparisonResult[],
  language: string,
): string {
  const header = "metric_name,finflow_mean,human_mean,generic_mean,finflow_pass_rate,human_pass_rate,generic_pass_rate,threshold";
  const rows: string[] = [header];

  if (results.length === 0) {
    return rows.join("\n") + "\n";
  }

  // Collect all metric names from the first result's AI scorecard
  const metricNames = Object.keys(results[0]!.aiScorecard.metrics);

  for (const metricName of metricNames) {
    let finflowSum = 0;
    let humanSum = 0;
    let genericSum = 0;
    let finflowPassCount = 0;
    let humanPassCount = 0;
    let genericPassCount = 0;
    let genericCount = 0;
    let threshold = 0;

    for (const result of results) {
      const r = result as ComparisonResultWithGeneric;

      const aiMetric = r.aiScorecard.metrics[metricName];
      const humanMetric = r.humanScorecard.metrics[metricName];

      if (aiMetric) {
        finflowSum += aiMetric.score;
        if (aiMetric.passed) finflowPassCount++;
        threshold = aiMetric.threshold;
      }

      if (humanMetric) {
        humanSum += humanMetric.score;
        if (humanMetric.passed) humanPassCount++;
      }

      if (r.genericScorecard) {
        const genericMetric = r.genericScorecard.metrics[metricName];
        if (genericMetric) {
          genericSum += genericMetric.score;
          if (genericMetric.passed) genericPassCount++;
          genericCount++;
        }
      }
    }

    const n = results.length;
    const finflowMean = (finflowSum / n).toFixed(1);
    const humanMean = (humanSum / n).toFixed(1);
    const genericMean = genericCount > 0 ? (genericSum / genericCount).toFixed(1) : "";
    const finflowPassRate = (finflowPassCount / n).toFixed(3);
    const humanPassRate = (humanPassCount / n).toFixed(3);
    const genericPassRate = genericCount > 0 ? (genericPassCount / genericCount).toFixed(3) : "";

    rows.push(
      formatRow([
        metricName,
        finflowMean,
        humanMean,
        genericMean,
        finflowPassRate,
        humanPassRate,
        genericPassRate,
        String(threshold),
      ]),
    );
  }

  return rows.join("\n") + "\n";
}
