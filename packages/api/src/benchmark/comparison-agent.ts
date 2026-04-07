/**
 * Comparison Agent — qualitative diff between AI and human translations.
 *
 * Sonnet-tier for cost efficiency (runs once per document in benchmark).
 * Produces structured analysis: strengths, discrepancies, calibration insights.
 */

import { runAgentStructured } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import { scorecardToDict, type Scorecard } from "../scoring/scorecard.js";
import type { QualitativeAnalysis } from "./types.js";

// --- Tool Schema ---

const ANALYSIS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string" as const,
      description:
        "2-3 sentence overview of key differences between AI and human translations",
    },
    aiStrengths: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Areas where the AI translation is stronger than the human",
    },
    humanStrengths: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Areas where the human translation is stronger than the AI",
    },
    notableDiscrepancies: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "Specific text-level differences with examples (quote both versions)",
    },
    calibrationInsights: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "Insights for recalibrating quality metrics and thresholds based on the comparison",
    },
  },
  required: [
    "summary",
    "aiStrengths",
    "humanStrengths",
    "notableDiscrepancies",
    "calibrationInsights",
  ],
};

// --- System Prompt ---

const SYSTEM_PROMPT_BASE = `You are a senior translation quality analyst at WordwideFX. You are comparing an AI-generated translation against a professional human translation of the same financial document.

Your role is NOT to judge which translation is "better" overall. Instead:
1. Identify concrete, specific differences between the two translations
2. Explain WHY the scores differ for each metric (with text examples)
3. Assess whether the scoring thresholds are well-calibrated based on the human translator's output
4. If the human translator consistently scores below a threshold, that threshold may be too strict for real-world financial translation

Be precise. Quote specific phrases from both translations. Focus on patterns, not one-off word choices.`;

const SYSTEM_PROMPT_GENERIC = `You are a senior translation quality analyst at WordwideFX. You are comparing THREE translations of the same financial document: a FinFlow AI pipeline translation, a professional human translation, and an unconstrained generic LLM translation (no client profile, no quality loop).

Your role is NOT to judge which translation is "better" overall. Instead:
1. Identify concrete, specific differences between all three translations
2. Explain WHY the scores differ for each metric (with text examples)
3. Assess whether the scoring thresholds are well-calibrated based on the human translator's output
4. If the human translator consistently scores below a threshold, that threshold may be too strict for real-world financial translation
5. Highlight where the FinFlow pipeline's profile-driven approach adds measurable value over a generic LLM that has no client context

Be precise. Quote specific phrases from all translations. Focus on patterns, not one-off word choices.`;

// --- Main ---

export interface GenericComparisonData {
  translation: string;
  scorecard: Scorecard;
}

export async function analyzeComparison(
  sourceText: string,
  humanTranslation: string,
  aiTranslation: string,
  humanScorecard: Scorecard,
  aiScorecard: Scorecard,
  language: string,
  generic?: GenericComparisonData,
): Promise<QualitativeAnalysis> {
  const config: AgentConfig = {
    name: "ComparisonAgent",
    systemPrompt: generic ? SYSTEM_PROMPT_GENERIC : SYSTEM_PROMPT_BASE,
    model: "sonnet",
    maxTokens: 4096,
  };

  // Truncate texts if very long to stay within context
  const maxChars = 6000;
  const truncate = (t: string) =>
    t.length > maxChars ? t.slice(0, maxChars) + "\n[...truncated]" : t;

  const genericSection = generic
    ? `\n## Generic LLM Translation (${language})
${truncate(generic.translation)}

## Generic LLM Scorecard
${JSON.stringify(scorecardToDict(generic.scorecard), null, 2)}
`
    : "";

  const analysisScope = generic
    ? "Analyze the differences between all three translations (FinFlow AI, Human, Generic LLM). Focus on metrics where scores diverge significantly (delta > 10 points) and on metrics where the human fails the threshold. Highlight where the FinFlow pipeline adds value over a generic unconstrained LLM."
    : "Analyze the differences. Focus on metrics where scores diverge significantly (delta > 10 points) and on metrics where the human fails the threshold.";

  const userMessage = `## Source Text (English)
${truncate(sourceText)}

## Human Translation (${language})
${truncate(humanTranslation)}

## AI Translation (${language})
${truncate(aiTranslation)}
${genericSection}
## Human Scorecard
${JSON.stringify(scorecardToDict(humanScorecard), null, 2)}

## AI Scorecard
${JSON.stringify(scorecardToDict(aiScorecard), null, 2)}

${analysisScope}`;

  const { result } = await runAgentStructured(
    config,
    userMessage,
    "analyze_comparison",
    "Produce a structured qualitative analysis comparing AI and human translations",
    ANALYSIS_TOOL_SCHEMA,
    (input) => input as unknown as QualitativeAnalysis,
  );

  return {
    summary: result.summary ?? "",
    aiStrengths: result.aiStrengths ?? [],
    humanStrengths: result.humanStrengths ?? [],
    notableDiscrepancies: result.notableDiscrepancies ?? [],
    calibrationInsights: result.calibrationInsights ?? [],
  };
}
