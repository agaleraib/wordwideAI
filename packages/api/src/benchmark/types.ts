/**
 * Benchmark pipeline types — calibration comparison between AI and human translations.
 */

import type { Scorecard } from "../scoring/scorecard.js";

// --- Config ---

export interface BenchmarkConfig {
  dataDir: string;
  clientId: string;
  language: string;
  outputDir: string;
  reportIds?: string[];
  skipAiTranslation?: boolean;
  extractProfile?: boolean;
  profileJson?: string;
}

// --- Document Discovery ---

export interface DocumentPair {
  reportId: string;
  sourceFile: string;
  humanFile: string;
  language: string;
}

// --- Comparison ---

export interface MetricDelta {
  metricName: string;
  aiScore: number;
  humanScore: number;
  delta: number;
  aiPassed: boolean;
  humanPassed: boolean;
  threshold: number;
}

export interface QualitativeAnalysis {
  summary: string;
  aiStrengths: string[];
  humanStrengths: string[];
  notableDiscrepancies: string[];
  calibrationInsights: string[];
}

export interface ComparisonResult {
  reportId: string;
  language: string;
  sourceText: string;
  humanTranslation: string;
  aiTranslation: string;
  humanScorecard: Scorecard;
  aiScorecard: Scorecard;
  metricDeltas: Record<string, MetricDelta>;
  qualitativeAnalysis: QualitativeAnalysis;
  timing: {
    aiPipelineMs: number;
    humanScoringMs: number;
    analysisMs: number;
  };
}

// --- Aggregation ---

export interface MetricAggregateStats {
  meanAiScore: number;
  meanHumanScore: number;
  meanDelta: number;
  stddevDelta: number;
  aiPassRate: number;
  humanPassRate: number;
  currentThreshold: number;
  suggestedThreshold?: number;
}

export type RecommendationType =
  | "threshold_adjustment"
  | "weight_adjustment"
  | "glossary_update"
  | "investigation_needed";

export interface CalibrationRecommendation {
  metric: string;
  type: RecommendationType;
  description: string;
  currentValue: number;
  suggestedValue?: number;
  confidence: "low" | "medium" | "high";
  evidence: string;
}

export interface AggregateReport {
  language: string;
  sampleCount: number;
  metricStats: Record<string, MetricAggregateStats>;
  overallAiPassRate: number;
  overallHumanPassRate: number;
  calibrationRecommendations: CalibrationRecommendation[];
  rawResults: ComparisonResult[];
}
