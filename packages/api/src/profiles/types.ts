/**
 * Client profile Zod schemas — ported from finflow/profiles/models.py.
 *
 * These define the client personalization layer: glossaries, tone profiles,
 * scoring thresholds, and brand rules per language.
 */

import { z } from "zod";

// --- Metric Taxonomy ---

export const ALL_METRICS = [
  // Terminology
  "glossary_compliance",
  "term_consistency",
  "untranslated_terms",
  // Style & Voice
  "formality_level",
  "sentence_length_ratio",
  "passive_voice_ratio",
  "brand_voice_adherence",
  // Structural Fidelity
  "formatting_preservation",
  "numerical_accuracy",
  "paragraph_alignment",
  // Linguistic Quality
  "fluency",
  "meaning_preservation",
  "regional_variant",
] as const;

export type MetricName = (typeof ALL_METRICS)[number];

export const METRIC_CATEGORIES = {
  terminology: [
    "glossary_compliance",
    "term_consistency",
    "untranslated_terms",
  ],
  style: [
    "formality_level",
    "sentence_length_ratio",
    "passive_voice_ratio",
    "brand_voice_adherence",
  ],
  structural: [
    "formatting_preservation",
    "numerical_accuracy",
    "paragraph_alignment",
  ],
  linguistic: ["fluency", "meaning_preservation", "regional_variant"],
} as const satisfies Record<string, readonly MetricName[]>;

export type MetricCategory = keyof typeof METRIC_CATEGORIES;

/** Reverse lookup: metric name -> category */
export const METRIC_TO_CATEGORY: Record<MetricName, MetricCategory> =
  Object.entries(METRIC_CATEGORIES).reduce(
    (acc, [cat, metrics]) => {
      for (const m of metrics) {
        acc[m as MetricName] = cat as MetricCategory;
      }
      return acc;
    },
    {} as Record<MetricName, MetricCategory>,
  );

// --- Default Thresholds ---

export const DEFAULT_METRIC_THRESHOLDS: Record<MetricName, number> = {
  glossary_compliance: 95,
  term_consistency: 90,
  untranslated_terms: 95,
  formality_level: 85,
  sentence_length_ratio: 80,
  passive_voice_ratio: 80,
  brand_voice_adherence: 95,
  formatting_preservation: 90,
  numerical_accuracy: 100,
  paragraph_alignment: 85,
  fluency: 85,
  meaning_preservation: 90,
  regional_variant: 90,
};

export const DEFAULT_AGGREGATE_THRESHOLD = 88;
export const DEFAULT_MAX_REVISION_ATTEMPTS = 2;

// --- Zod Schemas ---

export const ToneProfileSchema = z.object({
  formalityLevel: z.number().int().min(1).max(5).default(4),
  description: z.string().default("professional, formal"),
  passiveVoiceTargetPct: z.number().default(25.0),
  avgSentenceLength: z.number().default(22.0),
  sentenceLengthStddev: z.number().default(6.0),
  personPreference: z.enum(["first", "second", "third"]).default("third"),
  hedgingFrequency: z.enum(["low", "moderate", "high"]).default("moderate"),
});

export type ToneProfile = z.infer<typeof ToneProfileSchema>;

export const ScoringConfigSchema = z.object({
  metricThresholds: z
    .record(z.string(), z.number())
    .default({ ...DEFAULT_METRIC_THRESHOLDS }),
  aggregateThreshold: z.number().default(DEFAULT_AGGREGATE_THRESHOLD),
  metricWeights: z.record(z.string(), z.number()).default({}),
  maxRevisionAttempts: z.number().default(DEFAULT_MAX_REVISION_ATTEMPTS),
});

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

export const LanguageProfileSchema = z.object({
  regionalVariant: z.string().default(""),
  glossary: z.record(z.string(), z.string()).default({}),
  forbiddenTerms: z.array(z.string()).default([]),
  tone: ToneProfileSchema.default({}),
  brandRules: z.array(z.string()).default([]),
  compliancePatterns: z.array(z.string()).default([]),
  scoring: ScoringConfigSchema.default({}),
});

export type LanguageProfile = z.infer<typeof LanguageProfileSchema>;

export const ClientProfileSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  sourceLanguage: z.string().default("en"),
  languages: z.record(z.string(), LanguageProfileSchema).default({}),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type ClientProfile = z.infer<typeof ClientProfileSchema>;

// --- Helpers ---

/**
 * Get the weight for a metric. If no custom weights, all equal.
 */
export function getMetricWeight(
  config: ScoringConfig,
  metric: string,
): number {
  if (Object.keys(config.metricWeights).length === 0) {
    return 1.0 / ALL_METRICS.length;
  }
  const total = Object.values(config.metricWeights).reduce((a, b) => a + b, 0);
  return total > 0 ? (config.metricWeights[metric] ?? 0) / total : 0;
}

/**
 * Get language profile for a client, creating default if missing.
 */
export function getLanguageProfile(
  profile: ClientProfile,
  language: string,
): LanguageProfile {
  if (!profile.languages[language]) {
    profile.languages[language] = LanguageProfileSchema.parse({});
  }
  return profile.languages[language]!;
}
