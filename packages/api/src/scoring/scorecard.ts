/**
 * Scorecard types — ported from finflow/agents/scoring_agent.py.
 *
 * Defines MetricScore and Scorecard as Zod schemas for type-safe
 * scoring results.
 */

import { z } from "zod";
import {
  METRIC_CATEGORIES,
  type MetricCategory,
  type MetricName,
} from "../profiles/types.js";

// --- Zod Schemas ---

export const MetricScoreSchema = z.object({
  name: z.string(),
  category: z.string(),
  score: z.number().int().min(0).max(100),
  threshold: z.number().int(),
  passed: z.boolean(),
  details: z.string().default(""),
  evidence: z.array(z.string()).default([]),
});

export type MetricScore = z.infer<typeof MetricScoreSchema>;

export const ScorecardSchema = z.object({
  metrics: z.record(z.string(), MetricScoreSchema).default({}),
  aggregateScore: z.number().default(0),
  aggregateThreshold: z.number().default(88),
  passed: z.boolean().default(false),
  failedMetrics: z.array(z.string()).default([]),
  failedCategories: z.array(z.string()).default([]),
});

export type Scorecard = z.infer<typeof ScorecardSchema>;

// --- Factory ---

export function createScorecard(aggregateThreshold: number): Scorecard {
  return {
    metrics: {},
    aggregateScore: 0,
    aggregateThreshold,
    passed: false,
    failedMetrics: [],
    failedCategories: [],
  };
}

// --- Serialization ---

export function scorecardToDict(card: Scorecard): Record<string, unknown> {
  return {
    metrics: Object.fromEntries(
      Object.entries(card.metrics).map(([name, m]) => [
        name,
        {
          score: m.score,
          threshold: m.threshold,
          passed: m.passed,
          category: m.category,
          details: m.details,
          evidence: m.evidence,
        },
      ]),
    ),
    aggregate_score: Math.round(card.aggregateScore * 10) / 10,
    aggregate_threshold: card.aggregateThreshold,
    passed: card.passed,
    failed_metrics: card.failedMetrics,
    failed_categories: card.failedCategories,
  };
}

// --- Summary ---

export function scorecardSummary(card: Scorecard): string {
  const lines: string[] = [];

  for (const [catName, metricNames] of Object.entries(METRIC_CATEGORIES)) {
    lines.push(`\n  ${catName.charAt(0).toUpperCase() + catName.slice(1)}:`);
    for (const name of metricNames) {
      const m = card.metrics[name];
      if (m) {
        const status = m.passed ? "PASS" : "FAIL";
        lines.push(
          `    ${name}: ${m.score}/100 (threshold: ${m.threshold}) ${status}`,
        );
      }
    }
  }

  lines.push(
    `\n  AGGREGATE: ${card.aggregateScore.toFixed(1)}/100 (threshold: ${card.aggregateThreshold})`,
  );
  lines.push(`  FAILED METRICS: ${card.failedMetrics.length}`);
  if (card.failedMetrics.length > 0) {
    lines.push(`  FAILED: ${card.failedMetrics.join(", ")}`);
  }
  lines.push(`  VERDICT: ${card.passed ? "PASS" : "FAIL"}`);

  return lines.join("\n");
}
