/**
 * Shared types for the FinFlow agent system.
 *
 * Adapted from GoBot's agent patterns (autonomee/gobot src/agents/base.ts).
 * Stripped of personal context; adds tool_use for structured output.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

// --- Agent System ---

export type ModelTier = "haiku" | "sonnet" | "opus";
export type ReasoningStyle = "CoT" | "ReAct" | "RoT";

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  model: ModelTier;
  reasoning?: ReasoningStyle;
  maxTokens: number;
  tools?: Tool[];
}

export interface AgentResponse {
  agentName: string;
  content: string;
  toolResults?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
}

// --- Pipeline Events ---

export interface PipelineEvent {
  stage: string;
  status: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type EventHandler = (event: PipelineEvent) => void;

// --- Store Interfaces (DB-agnostic) ---

export interface ProfileStore {
  load(clientId: string): Promise<ClientProfileData | null>;
  save(profile: ClientProfileData): Promise<void>;
  list(): Promise<ProfileSummary[]>;
  delete(clientId: string): Promise<boolean>;
}

export interface TranslationStore {
  saveTranslation(result: TranslationRecord): Promise<string>;
}

export interface GlossaryCorrectionStore {
  saveCorrection(correction: GlossaryCorrection): Promise<void>;
}

// --- Store Data Types ---

export interface ClientProfileData {
  clientId: string;
  clientName: string;
  sourceLanguage: string;
  languages: Record<string, LanguageProfileData>;
  createdAt: string;
  updatedAt: string;
}

export interface LanguageProfileData {
  regionalVariant: string;
  glossary: Record<string, string>;
  forbiddenTerms: string[];
  tone: ToneProfileData;
  brandRules: string[];
  compliancePatterns: string[];
  scoring: ScoringConfigData;
}

export interface ToneProfileData {
  formalityLevel: number;
  description: string;
  avgSentenceLength: number;
  sentenceLengthStddev: number;
  personPreference: string;
  hedgingFrequency: string;
}

export interface ScoringConfigData {
  metricThresholds: Record<string, number>;
  aggregateThreshold: number;
  metricWeights: Record<string, number>;
  maxRevisionAttempts: number;
}

export interface ProfileSummary {
  clientId: string;
  clientName: string;
  languages: string[];
}

export interface TranslationRecord {
  clientId: string;
  language: string;
  sourceHash: string;
  sourceText: string;
  translatedText: string;
  scorecard: Record<string, unknown>;
  aggregateScore: number;
  passed: boolean;
  revisionCount: number;
  escalatedToHitl: boolean;
  auditTrail: Record<string, unknown>[];
}

export interface GlossaryCorrection {
  languageProfileId: string;
  englishTerm: string;
  originalTranslation: string;
  correctedTranslation: string;
  correctedBy: string;
  correctionSource: string;
}
