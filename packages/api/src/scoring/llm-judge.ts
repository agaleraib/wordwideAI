/**
 * LLM-as-judge metric scorers — ported from finflow/agents/scoring_agent.py.
 *
 * 6 subjective metrics evaluated by Claude via tool_use structured output.
 * This replaces the Python prototype's fragile find("{") JSON extraction.
 */

import type { MetricScore } from "./scorecard.js";
import type { LanguageProfile, ScoringConfig } from "../profiles/types.js";
import { runAgentStructured } from "../lib/anthropic.js";
import type { ModelTier } from "../lib/types.js";
import type { AgentConfig } from "../lib/types.js";

/** Schema for a single metric judgment from the LLM. */
interface MetricJudgment {
  score: number;
  reasoning: string;
  evidence: string[];
}

/** All 6 LLM-judged metrics returned in one call. */
interface JudgeOutput {
  formality_level: MetricJudgment;
  sentence_length_ratio: MetricJudgment;
  brand_voice_adherence: MetricJudgment;
  fluency: MetricJudgment;
  meaning_preservation: MetricJudgment;
  regional_variant: MetricJudgment;
}

const JUDGE_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    formality_level: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const, description: "Score 0-100" },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
    sentence_length_ratio: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
    brand_voice_adherence: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
    fluency: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
    meaning_preservation: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
    regional_variant: {
      type: "object" as const,
      properties: {
        score: { type: "number" as const },
        reasoning: { type: "string" as const },
        evidence: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["score", "reasoning", "evidence"],
    },
  },
  required: [
    "formality_level",
    "sentence_length_ratio",
    "brand_voice_adherence",
    "fluency",
    "meaning_preservation",
    "regional_variant",
  ],
};

function buildJudgePrompt(
  source: string,
  translation: string,
  lang: LanguageProfile,
  language: string,
): string {
  const brandRulesText =
    lang.brandRules.length > 0
      ? lang.brandRules.map((r) => `  - ${r}`).join("\n")
      : "  None specified";

  return `Evaluate this financial translation on the following metrics. Score each 0-100.

SOURCE TEXT (English):
---
${source}
---

TRANSLATION (${language}):
---
${translation}
---

CLIENT PROFILE:
- Formality target: level ${lang.tone.formalityLevel}/5 (${lang.tone.description})
- Target avg sentence length: ${lang.tone.avgSentenceLength} words (stddev: ${lang.tone.sentenceLengthStddev})
- Regional variant: ${lang.regionalVariant || "not specified"}
- Brand rules:
${brandRulesText}

METRICS TO EVALUATE:

1. **formality_level** (0-100): Does the translation match the target formality level? Score 100 if perfect match, deduct for each deviation.

2. **sentence_length_ratio** (0-100): Are sentence lengths consistent with the target average (${lang.tone.avgSentenceLength} words, stddev ${lang.tone.sentenceLengthStddev})? Score 100 if within 1 stddev.

3. **brand_voice_adherence** (0-100): Are ALL brand rules followed? Score 100 if all satisfied, deduct 20 per violation.

4. **fluency** (0-100): Does the translation read naturally in ${language}? No awkward phrasings, no calques from English.

5. **meaning_preservation** (0-100): Is the semantic meaning of every sentence preserved? No additions, omissions, or distortions.

6. **regional_variant** (0-100): Is the correct regional variant used consistently? Check vocabulary, grammar, spelling for ${lang.regionalVariant || language}.

Use the submit_scores tool to provide your evaluation.`;
}

export interface LlmJudgeResult {
  metrics: Record<string, MetricScore>;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Score all 6 LLM-judged metrics in a single call using tool_use.
 */
export async function scoreLlmMetrics(
  source: string,
  translation: string,
  lang: LanguageProfile,
  language: string,
  scoring: ScoringConfig,
  modelTier: ModelTier = "opus",
): Promise<LlmJudgeResult> {
  const config: AgentConfig = {
    name: "ScoringJudge",
    systemPrompt:
      "You are an expert financial translation quality assessor. " +
      "You evaluate translations with precision and objectivity. " +
      "Use the submit_scores tool to provide your structured evaluation.",
    model: modelTier,
    maxTokens: 4096,
  };

  const prompt = buildJudgePrompt(source, translation, lang, language);

  let scores: JudgeOutput;
  let llmUsage: { inputTokens: number; outputTokens: number } | undefined;
  try {
    const { result, usage } = await runAgentStructured(
      config,
      prompt,
      "submit_scores",
      "Submit structured quality scores for all 6 metrics",
      JUDGE_TOOL_SCHEMA,
      (input) => input as unknown as JudgeOutput,
    );
    scores = result;
    llmUsage = usage;
  } catch {
    // Fallback: return default scores if tool_use fails
    scores = defaultScores();
  }

  // Map to MetricScore objects
  const metricConfigs: Record<
    string,
    { category: string; detailContext: string }
  > = {
    formality_level: {
      category: "style",
      detailContext: `Target: level ${lang.tone.formalityLevel}/5 (${lang.tone.description})`,
    },
    sentence_length_ratio: {
      category: "style",
      detailContext: `Target avg: ${lang.tone.avgSentenceLength} words`,
    },
    brand_voice_adherence: {
      category: "style",
      detailContext: `Rules: ${lang.brandRules.slice(0, 3).join("; ")}`,
    },
    fluency: {
      category: "linguistic",
      detailContext: "Natural reading flow in target language",
    },
    meaning_preservation: {
      category: "linguistic",
      detailContext: "Semantic equivalence to source",
    },
    regional_variant: {
      category: "linguistic",
      detailContext: `Target variant: ${lang.regionalVariant || "unspecified"}`,
    },
  };

  const results: Record<string, MetricScore> = {};

  for (const [metricName, conf] of Object.entries(metricConfigs)) {
    const judgment = scores[metricName as keyof JudgeOutput];
    const numeric = judgment?.score ?? 75;
    const reasoning = judgment?.reasoning ?? "";
    const evidence = judgment?.evidence ?? [];
    const threshold = scoring.metricThresholds[metricName] ?? 85;

    results[metricName] = {
      name: metricName,
      category: conf.category,
      score: numeric,
      threshold,
      passed: numeric >= threshold,
      details: `${conf.detailContext}. ${reasoning}`,
      evidence: Array.isArray(evidence) ? evidence : [String(evidence)],
    };
  }

  return { metrics: results, usage: llmUsage };
}

function defaultScores(): JudgeOutput {
  const defaultJudgment: MetricJudgment = {
    score: 75,
    reasoning: "Failed to get LLM judgment",
    evidence: [],
  };
  return {
    formality_level: { ...defaultJudgment },
    sentence_length_ratio: { ...defaultJudgment },
    brand_voice_adherence: { ...defaultJudgment },
    fluency: { ...defaultJudgment },
    meaning_preservation: { ...defaultJudgment },
    regional_variant: { ...defaultJudgment },
  };
}
