/**
 * Metric taxonomy — which metrics are deterministic vs LLM-judged.
 */

import type { MetricName } from "../profiles/types.js";

/** Metrics scored by code-based checks (no LLM needed). */
export const DETERMINISTIC_METRICS: MetricName[] = [
  "glossary_compliance",
  "term_consistency",
  "untranslated_terms",
  "numerical_accuracy",
  "formatting_preservation",
  "paragraph_alignment",
];

/** Metrics scored by LLM-as-judge. */
export const LLM_JUDGE_METRICS: MetricName[] = [
  "formality_level",
  "sentence_length_ratio",
  "passive_voice_ratio",
  "brand_voice_adherence",
  "fluency",
  "meaning_preservation",
  "regional_variant",
];
