/**
 * Shared utilities for specialist agents.
 */

export interface FailedMetricData {
  score: number;
  threshold: number;
  details: string;
  evidence: string[];
}

export interface SpecialistResult {
  correctedText: string;
  reasoning: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Build human-readable evidence text from failed metrics.
 */
export function buildEvidenceText(
  failedMetrics: Record<string, FailedMetricData>,
): string {
  const lines: string[] = [];
  for (const [metricName, data] of Object.entries(failedMetrics)) {
    lines.push(`  ${metricName}: scored ${data.score}/${data.threshold}`);
    if (data.details) {
      lines.push(`    → ${data.details}`);
    }
    for (const e of data.evidence) {
      lines.push(`    • ${e}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "  No specific evidence provided.";
}

/**
 * Parse specialist response into [correctedText, reasoning].
 */
export function parseSpecialistResponse(raw: string): [string, string] {
  if (raw.includes("---REASONING---")) {
    const parts = raw.split("---REASONING---", 2);
    return [(parts[0] ?? "").trim(), (parts[1] ?? "").trim()];
  }
  return [raw.trim(), ""];
}
