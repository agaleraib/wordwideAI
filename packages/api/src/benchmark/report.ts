/**
 * Per-document Markdown report generator for benchmark comparisons.
 *
 * Produces a detailed report with pipeline workflow, scorecards,
 * metric comparison, failure analysis, and qualitative insights.
 */

import type { ComparisonResult, MetricDelta } from "./types.js";
import type { AuditEntry } from "../pipeline/translation-engine.js";
import type { Scorecard, MetricScore } from "../scoring/scorecard.js";

/**
 * Format a single comparison result as a detailed Markdown report.
 */
export function formatDocumentReport(result: ComparisonResult): string {
  const sections: string[] = [];

  sections.push(formatHeader(result));
  sections.push(formatDocumentInfo(result));
  sections.push(formatPipelineWorkflow(result.aiAuditTrail));
  sections.push(formatScorecard("AI", result.aiScorecard));
  sections.push(formatScorecard("Human", result.humanScorecard));
  if (result.genericScorecard) {
    sections.push(formatScorecard("Generic LLM", result.genericScorecard));
  }
  sections.push(formatMetricComparison(result.metricDeltas, result.genericScorecard));
  sections.push(formatFailureAnalysis(result.aiScorecard, result.humanScorecard));
  sections.push(formatQualitativeAnalysis(result));
  sections.push(formatTimingSummary(result));

  return sections.join("\n\n---\n\n");
}

// --- Section Formatters ---

function formatHeader(result: ComparisonResult): string {
  return `# Benchmark Report: ${result.reportId}

| Field | Value |
|-------|-------|
| **Report ID** | ${result.reportId} |
| **Language** | ${result.language} |
| **Generated** | ${new Date().toISOString()} |`;
}

function formatDocumentInfo(result: ComparisonResult): string {
  const sourceWords = countWords(result.sourceText);
  const aiWords = result.aiTranslation ? countWords(result.aiTranslation) : 0;
  const humanWords = countWords(result.humanTranslation);

  return `## Document Info

| Property | Value |
|----------|-------|
| **Source word count** | ${sourceWords} |
| **AI translation word count** | ${aiWords} |
| **Human translation word count** | ${humanWords} |
| **AI/Source ratio** | ${aiWords > 0 ? (aiWords / sourceWords).toFixed(2) : "N/A"} |
| **Human/Source ratio** | ${(humanWords / sourceWords).toFixed(2)} |`;
}

function formatPipelineWorkflow(auditTrail: AuditEntry[]): string {
  if (auditTrail.length === 0) {
    return `## Pipeline Workflow

_No audit trail available (AI translation may have been skipped)._`;
  }

  const rows = auditTrail.map((entry, i) => {
    const duration = entry.durationMs !== undefined
      ? `${(entry.durationMs / 1000).toFixed(1)}s`
      : "—";
    const inputTokens = entry.tokens?.input !== undefined
      ? entry.tokens.input.toLocaleString()
      : "—";
    const outputTokens = entry.tokens?.output !== undefined
      ? entry.tokens.output.toLocaleString()
      : "—";
    const totalTokens = entry.tokens
      ? (entry.tokens.input + entry.tokens.output).toLocaleString()
      : "—";

    return `| ${i + 1} | ${entry.stage} | ${entry.agent} | ${duration} | ${inputTokens} | ${outputTokens} | ${totalTokens} |`;
  });

  // Compute totals
  let totalDuration = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let hasDuration = false;
  let hasTokens = false;

  for (const entry of auditTrail) {
    if (entry.durationMs !== undefined) {
      totalDuration += entry.durationMs;
      hasDuration = true;
    }
    if (entry.tokens) {
      totalInput += entry.tokens.input;
      totalOutput += entry.tokens.output;
      hasTokens = true;
    }
  }

  const totalRow = `| | **Total** | | ${hasDuration ? `**${(totalDuration / 1000).toFixed(1)}s**` : "—"} | ${hasTokens ? `**${totalInput.toLocaleString()}**` : "—"} | ${hasTokens ? `**${totalOutput.toLocaleString()}**` : "—"} | ${hasTokens ? `**${(totalInput + totalOutput).toLocaleString()}**` : "—"} |`;

  return `## Pipeline Workflow

| # | Stage | Agent | Duration | Input Tokens | Output Tokens | Total Tokens |
|---|-------|-------|----------|-------------|--------------|-------------|
${rows.join("\n")}
${totalRow}`;
}

function formatScorecard(label: string, scorecard: Scorecard): string {
  const rows = Object.entries(scorecard.metrics).map(([name, metric]) => {
    const status = metric.passed ? "PASS" : "**FAIL**";
    return `| ${name} | ${metric.category} | ${metric.score} | ${metric.threshold} | ${status} |`;
  });

  const verdict = scorecard.passed ? "PASS" : "FAIL";

  return `## ${label} Scorecard

| Metric | Category | Score | Threshold | Status |
|--------|----------|-------|-----------|--------|
${rows.join("\n")}

**Aggregate**: ${scorecard.aggregateScore.toFixed(1)} / ${scorecard.aggregateThreshold} — **${verdict}**
${scorecard.failedMetrics.length > 0 ? `\n**Failed metrics**: ${scorecard.failedMetrics.join(", ")}` : ""}`;
}

function formatMetricComparison(deltas: Record<string, MetricDelta>, genericScorecard?: Scorecard): string {
  const entries = Object.values(deltas);
  if (entries.length === 0) {
    return `## Metric Comparison

_No metric deltas available._`;
  }

  const hasGeneric = genericScorecard !== undefined;

  const rows = entries.map((d) => {
    const deltaStr = d.delta >= 0 ? `+${d.delta.toFixed(1)}` : d.delta.toFixed(1);
    const aiStatus = d.aiPassed ? "PASS" : "FAIL";
    const humanStatus = d.humanPassed ? "PASS" : "FAIL";
    let row = `| ${d.metricName} | ${d.aiScore} | ${d.humanScore}`;
    if (hasGeneric) {
      const gMetric = genericScorecard.metrics[d.metricName];
      const gScore = gMetric ? String(gMetric.score) : "—";
      const gStatus = gMetric ? (gMetric.passed ? "PASS" : "FAIL") : "—";
      row += ` | ${gScore}`;
      row += ` | ${deltaStr} | ${d.threshold} | ${aiStatus} | ${humanStatus} | ${gStatus} |`;
    } else {
      row += ` | ${deltaStr} | ${d.threshold} | ${aiStatus} | ${humanStatus} |`;
    }
    return row;
  });

  // Summary stats
  const avgDelta = entries.reduce((sum, d) => sum + d.delta, 0) / entries.length;
  const aiPassCount = entries.filter((d) => d.aiPassed).length;
  const humanPassCount = entries.filter((d) => d.humanPassed).length;

  let summaryLine = `**Summary**: Avg delta ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)} | AI pass ${aiPassCount}/${entries.length} | Human pass ${humanPassCount}/${entries.length}`;

  if (hasGeneric) {
    const genericPassCount = entries.filter((d) => {
      const gMetric = genericScorecard.metrics[d.metricName];
      return gMetric?.passed === true;
    }).length;
    summaryLine += ` | Generic pass ${genericPassCount}/${entries.length}`;

    const title = `## Metric Comparison (AI vs Human vs Generic)`;
    const header = `| Metric | AI Score | Human Score | Generic Score | Delta (AI-Human) | Threshold | AI | Human | Generic |
|--------|----------|-------------|---------------|------------------|-----------|----|-------|---------|`;

    return `${title}

${header}
${rows.join("\n")}

${summaryLine}`;
  }

  return `## Metric Comparison (AI vs Human)

| Metric | AI Score | Human Score | Delta | Threshold | AI | Human |
|--------|----------|-------------|-------|-----------|----|-------|
${rows.join("\n")}

${summaryLine}`;
}

function formatFailureAnalysis(
  aiScorecard: Scorecard,
  humanScorecard: Scorecard,
): string {
  const failures: string[] = [];

  // Collect all unique failed metrics from both scorecards
  const allFailed = new Set<string>([
    ...aiScorecard.failedMetrics,
    ...humanScorecard.failedMetrics,
  ]);

  if (allFailed.size === 0) {
    return `## Failure Analysis

All metrics passed for both AI and Human translations.`;
  }

  for (const metricName of allFailed) {
    const aiMetric = aiScorecard.metrics[metricName];
    const humanMetric = humanScorecard.metrics[metricName];
    const lines: string[] = [];

    lines.push(`### ${metricName}`);
    lines.push("");

    if (aiMetric && !aiMetric.passed) {
      lines.push(`**AI** — Score: ${aiMetric.score}/${aiMetric.threshold} (FAIL)`);
      if (aiMetric.details) {
        lines.push(`- Details: ${aiMetric.details}`);
      }
      if (aiMetric.evidence.length > 0) {
        lines.push("- Evidence:");
        for (const e of aiMetric.evidence.slice(0, 5)) {
          lines.push(`  - ${e}`);
        }
      }
      lines.push("");
    }

    if (humanMetric && !humanMetric.passed) {
      lines.push(`**Human** — Score: ${humanMetric.score}/${humanMetric.threshold} (FAIL)`);
      if (humanMetric.details) {
        lines.push(`- Details: ${humanMetric.details}`);
      }
      if (humanMetric.evidence.length > 0) {
        lines.push("- Evidence:");
        for (const e of humanMetric.evidence.slice(0, 5)) {
          lines.push(`  - ${e}`);
        }
      }
    }

    failures.push(lines.join("\n"));
  }

  return `## Failure Analysis

${failures.join("\n\n")}`;
}

function formatQualitativeAnalysis(result: ComparisonResult): string {
  const qa = result.qualitativeAnalysis;

  const sections: string[] = [];
  sections.push("## Qualitative Analysis");
  sections.push("");

  if (qa.summary) {
    sections.push(`**Summary**: ${qa.summary}`);
    sections.push("");
  }

  if (qa.aiStrengths.length > 0) {
    sections.push("### AI Strengths");
    for (const s of qa.aiStrengths) {
      sections.push(`- ${s}`);
    }
    sections.push("");
  }

  if (qa.humanStrengths.length > 0) {
    sections.push("### Human Strengths");
    for (const s of qa.humanStrengths) {
      sections.push(`- ${s}`);
    }
    sections.push("");
  }

  if (qa.notableDiscrepancies.length > 0) {
    sections.push("### Notable Discrepancies");
    for (const d of qa.notableDiscrepancies) {
      sections.push(`- ${d}`);
    }
    sections.push("");
  }

  if (qa.calibrationInsights.length > 0) {
    sections.push("### Calibration Insights");
    for (const c of qa.calibrationInsights) {
      sections.push(`- ${c}`);
    }
  }

  return sections.join("\n");
}

function formatTimingSummary(result: ComparisonResult): string {
  const { aiPipelineMs, humanScoringMs, analysisMs } = result.timing;
  const totalMs = aiPipelineMs + humanScoringMs + analysisMs;

  const rows: string[] = [];
  rows.push(`| AI Pipeline | ${formatMs(aiPipelineMs)} | ${pct(aiPipelineMs, totalMs)} |`);
  rows.push(`| Human Scoring | ${formatMs(humanScoringMs)} | ${pct(humanScoringMs, totalMs)} |`);
  rows.push(`| Comparison Analysis | ${formatMs(analysisMs)} | ${pct(analysisMs, totalMs)} |`);
  rows.push(`| **Total** | **${formatMs(totalMs)}** | **100%** |`);

  // Per-agent breakdown from audit trail
  let agentBreakdown = "";
  if (result.aiAuditTrail.length > 0) {
    const agentRows = result.aiAuditTrail
      .filter((e) => e.durationMs !== undefined)
      .map((e) => {
        const dur = e.durationMs as number;
        return `| ${e.agent} | ${e.stage} | ${formatMs(dur)} | ${pct(dur, aiPipelineMs)} |`;
      });

    if (agentRows.length > 0) {
      agentBreakdown = `

### Per-Agent Breakdown (within AI Pipeline)

| Agent | Stage | Duration | % of Pipeline |
|-------|-------|----------|---------------|
${agentRows.join("\n")}`;
    }
  }

  return `## Timing Summary

| Phase | Duration | % of Total |
|-------|----------|-----------|
${rows.join("\n")}${agentBreakdown}`;
}

// --- Utilities ---

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}
