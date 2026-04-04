/**
 * Benchmark runner — runs a single comparison between AI and human translations.
 *
 * Flow:
 *   1. Read source + human translation from .docx
 *   2. Run AI translation pipeline → AI scorecard
 *   3. Score human translation → human scorecard
 *   4. Compute per-metric deltas
 *   5. Run comparison agent → qualitative analysis
 */

import type { ClientProfile } from "../profiles/types.js";
import { ALL_METRICS } from "../profiles/types.js";
import type { ProfileStore } from "../lib/types.js";
import { runTranslationEngine } from "../pipeline/translation-engine.js";
import { scoreTranslation } from "../agents/scoring-agent.js";
import { readDocument } from "./docx-reader.js";
import { analyzeComparison } from "./comparison-agent.js";
import type { DocumentPair, ComparisonResult, MetricDelta } from "./types.js";

export interface RunComparisonOptions {
  skipAiTranslation?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * Run a full comparison for one document pair.
 */
export async function runComparison(
  pair: DocumentPair,
  profile: ClientProfile,
  profileStore: ProfileStore,
  options: RunComparisonOptions = {},
): Promise<ComparisonResult> {
  const { skipAiTranslation, onProgress } = options;

  // 1. Read documents
  onProgress?.(`  Reading ${pair.reportId}...`);
  const sourceText = await readDocument(pair.sourceFile);
  const humanTranslation = await readDocument(pair.humanFile);

  // 2. AI translation pipeline (or skip)
  let aiTranslation = "";
  let aiScorecardResult;
  let aiMs = 0;

  if (!skipAiTranslation) {
    onProgress?.(`  Running AI pipeline for ${pair.reportId}...`);
    const aiStart = Date.now();
    const engineResult = await runTranslationEngine(
      sourceText,
      profile.clientId,
      pair.language,
      { profileStore },
    );
    aiMs = Date.now() - aiStart;
    aiTranslation = engineResult.translatedText;
    aiScorecardResult = engineResult.scorecard;
    onProgress?.(
      `  AI pipeline done: ${engineResult.scorecard.aggregateScore.toFixed(1)}/${engineResult.scorecard.aggregateThreshold} ` +
        `(${engineResult.passed ? "PASS" : "FAIL"}, ${engineResult.revisionCount} rounds)`,
    );
  } else {
    onProgress?.(`  Skipping AI pipeline (--skip-ai)`);
  }

  // 3. Score human translation
  onProgress?.(`  Scoring human translation...`);
  const humanStart = Date.now();
  const humanScorecard = await scoreTranslation(
    sourceText,
    humanTranslation,
    profile,
    pair.language,
  );
  const humanMs = Date.now() - humanStart;
  onProgress?.(
    `  Human score: ${humanScorecard.aggregateScore.toFixed(1)}/${humanScorecard.aggregateThreshold} ` +
      `(${humanScorecard.passed ? "PASS" : "FAIL"})`,
  );

  // If we skipped AI, score the human text as "AI" too (for delta = 0 baseline)
  const aiScorecard = aiScorecardResult ?? humanScorecard;

  // 4. Compute deltas
  const metricDeltas: Record<string, MetricDelta> = {};
  for (const metric of ALL_METRICS) {
    const ai = aiScorecard.metrics[metric];
    const human = humanScorecard.metrics[metric];
    if (!ai || !human) continue;

    metricDeltas[metric] = {
      metricName: metric,
      aiScore: ai.score,
      humanScore: human.score,
      delta: ai.score - human.score,
      aiPassed: ai.passed,
      humanPassed: human.passed,
      threshold: ai.threshold,
    };
  }

  // 5. Qualitative analysis
  let analysisMs = 0;
  let qualitativeAnalysis;

  if (!skipAiTranslation) {
    onProgress?.(`  Running comparison analysis...`);
    const analysisStart = Date.now();
    qualitativeAnalysis = await analyzeComparison(
      sourceText,
      humanTranslation,
      aiTranslation,
      humanScorecard,
      aiScorecard,
      pair.language,
    );
    analysisMs = Date.now() - analysisStart;
  } else {
    qualitativeAnalysis = {
      summary: "AI translation skipped — human-only scoring mode.",
      aiStrengths: [],
      humanStrengths: [],
      notableDiscrepancies: [],
      calibrationInsights: [],
    };
  }

  return {
    reportId: pair.reportId,
    language: pair.language,
    sourceText,
    humanTranslation,
    aiTranslation,
    humanScorecard,
    aiScorecard,
    metricDeltas,
    qualitativeAnalysis,
    timing: {
      aiPipelineMs: aiMs,
      humanScoringMs: humanMs,
      analysisMs,
    },
  };
}
