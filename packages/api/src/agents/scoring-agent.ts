/**
 * Scoring Agent — orchestrates all 13 quality metrics.
 *
 * Ported from finflow/agents/scoring_agent.py.
 * Runs 6 deterministic metrics (code) + 7 LLM-judged metrics (tool_use).
 */

import type { ClientProfile } from "../profiles/types.js";
import {
  getLanguageProfile,
  getMetricWeight,
  METRIC_TO_CATEGORY,
} from "../profiles/types.js";
import { createScorecard, type Scorecard } from "../scoring/scorecard.js";
import {
  scoreGlossaryCompliance,
  scoreTermConsistency,
  scoreUntranslatedTerms,
  scoreNumericalAccuracy,
  scoreFormattingPreservation,
  scoreParagraphAlignment,
} from "../scoring/deterministic.js";
import { scoreLlmMetrics } from "../scoring/llm-judge.js";

export interface ScoringResult {
  scorecard: Scorecard;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Score a translation against all 13 metrics.
 */
export async function scoreTranslation(
  sourceText: string,
  translatedText: string,
  profile: ClientProfile,
  language: string,
  modelTier?: import("../lib/types.js").ModelTier,
): Promise<Scorecard> {
  const result = await scoreTranslationWithUsage(sourceText, translatedText, profile, language, modelTier);
  return result.scorecard;
}

/**
 * Score a translation and return token usage alongside the scorecard.
 */
export async function scoreTranslationWithUsage(
  sourceText: string,
  translatedText: string,
  profile: ClientProfile,
  language: string,
  modelTier?: import("../lib/types.js").ModelTier,
): Promise<ScoringResult> {
  const langProfile = getLanguageProfile(profile, language);
  const scoring = langProfile.scoring;
  const card = createScorecard(scoring.aggregateThreshold);

  // Deterministic metrics (code-based)
  card.metrics["glossary_compliance"] = scoreGlossaryCompliance(
    sourceText,
    translatedText,
    langProfile,
    scoring,
  );

  card.metrics["term_consistency"] = scoreTermConsistency(
    translatedText,
    langProfile,
    scoring,
    card.metrics["glossary_compliance"],
  );

  card.metrics["untranslated_terms"] = scoreUntranslatedTerms(
    sourceText,
    translatedText,
    langProfile,
    scoring,
  );

  card.metrics["numerical_accuracy"] = scoreNumericalAccuracy(
    sourceText,
    translatedText,
    scoring,
  );

  card.metrics["formatting_preservation"] = scoreFormattingPreservation(
    sourceText,
    translatedText,
    scoring,
  );

  card.metrics["paragraph_alignment"] = scoreParagraphAlignment(
    sourceText,
    translatedText,
    scoring,
  );

  // LLM-judged metrics (style + linguistic + brand voice)
  const llmResult = await scoreLlmMetrics(
    sourceText,
    translatedText,
    langProfile,
    language,
    scoring,
    modelTier,
  );

  for (const [name, score] of Object.entries(llmResult.metrics)) {
    card.metrics[name] = score;
  }

  // Compute aggregate
  computeAggregate(card, scoring);

  return { scorecard: card, usage: llmResult.usage };
}

function computeAggregate(
  card: Scorecard,
  scoring: { metricWeights: Record<string, number>; aggregateThreshold: number },
): void {
  if (Object.keys(card.metrics).length === 0) {
    card.passed = false;
    return;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [metricName, metricScore] of Object.entries(card.metrics)) {
    const weight = getMetricWeight(scoring as any, metricName);
    weightedSum += metricScore.score * weight;
    totalWeight += weight;

    if (!metricScore.passed) {
      card.failedMetrics.push(metricName);
      const cat = METRIC_TO_CATEGORY[metricName as keyof typeof METRIC_TO_CATEGORY];
      if (cat && !card.failedCategories.includes(cat)) {
        card.failedCategories.push(cat);
      }
    }
  }

  card.aggregateScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  card.passed =
    card.failedMetrics.length === 0 &&
    card.aggregateScore >= card.aggregateThreshold;
}
