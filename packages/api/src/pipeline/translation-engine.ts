/**
 * Translation Engine — orchestrates the full pipeline:
 *   translate → score → gate → arbiter → specialists → re-score → HITL
 *
 * Ported from finflow/engine/translation_engine.py.
 * This is the core of the translation quality pipeline.
 */

import { createHash } from "crypto";

import type { EventHandler, ProfileStore, TranslationStore } from "../lib/types.js";
import type { ClientProfile } from "../profiles/types.js";
import { getLanguageProfile, METRIC_CATEGORIES } from "../profiles/types.js";
import { scoreTranslationWithUsage } from "../agents/scoring-agent.js";
import { planCorrections, type CorrectionPlan } from "../agents/quality-arbiter.js";
import { translateWithProfile } from "../agents/translation-agent.js";
import { correctTerminology } from "../agents/specialists/terminology.js";
import { correctStyle } from "../agents/specialists/style.js";
import { correctStructure } from "../agents/specialists/structural.js";
import { correctLinguistic } from "../agents/specialists/linguistic.js";
import type { Scorecard } from "../scoring/scorecard.js";
import { scorecardToDict, scorecardSummary } from "../scoring/scorecard.js";
import type { FailedMetricData, SpecialistResult } from "../agents/specialists/shared.js";
import { emitEvent } from "./events.js";
import { enforceGlossary, checkCompliance, applyDeterministicReplacements, applyAlternativesMap } from "./glossary-patcher.js";

// --- Types ---

export interface AuditEntry {
  stage: string;
  agent: string;
  timestamp: string;
  durationMs?: number;
  tokens?: { input: number; output: number };
  inputHash?: string;
  outputHash?: string;
  reasoning?: string;
  scores?: Record<string, unknown>;
  plan?: Record<string, unknown>;
}

export interface EngineResult {
  clientId: string;
  language: string;
  sourceText: string;
  translatedText: string;
  scorecard: Scorecard;
  passed: boolean;
  revisionCount: number;
  escalatedToHitl: boolean;
  auditTrail: AuditEntry[];
}

// --- Helpers ---

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function now(): string {
  return new Date().toISOString();
}

// --- Engine ---

export interface TranslationEngineOptions {
  profileStore: ProfileStore;
  translationStore?: TranslationStore;
  onEvent?: EventHandler;
}

export async function runTranslationEngine(
  sourceText: string,
  clientId: string,
  language: string,
  options: TranslationEngineOptions,
  onChunk?: (text: string) => void,
): Promise<EngineResult> {
  const { profileStore, translationStore, onEvent } = options;
  const audit: AuditEntry[] = [];

  // 1. Load profile
  emitEvent(onEvent, "profile", "loading", `Loading profile for ${clientId}...`);
  const profile = await profileStore.load(clientId);
  if (!profile) {
    throw new Error(
      `No profile found for client '${clientId}'. ` +
        "Create a profile first.",
    );
  }

  const langProfile = getLanguageProfile(profile as ClientProfile, language);
  const maxRounds = langProfile.scoring.maxRevisionAttempts;

  // 2. Initial translation
  emitEvent(onEvent, "translation", "starting", "Translating document...");
  const translationStart = Date.now();
  const translationResult = await translateWithProfile(
    sourceText,
    language,
    profile as ClientProfile,
    onChunk,
    onEvent,
  );
  const translationMs = Date.now() - translationStart;
  let currentText = translationResult.translatedText;

  audit.push({
    stage: "translation",
    agent: "TranslationAgent (Opus)",
    timestamp: now(),
    durationMs: translationMs,
    tokens: translationResult.usage
      ? { input: translationResult.usage.inputTokens, output: translationResult.usage.outputTokens }
      : undefined,
    inputHash: hash(sourceText),
    outputHash: hash(currentText),
    reasoning: `Initial translation. Glossary compliance: ${translationResult.glossaryCompliancePct.toFixed(1)}%`,
  });

  // 3. Score
  emitEvent(
    onEvent,
    "scoring",
    "starting",
    "Scoring translation against 13 metrics...",
  );
  const scoringStart = Date.now();
  let scoringResult = await scoreTranslationWithUsage(
    sourceText,
    currentText,
    profile as ClientProfile,
    language,
  );
  const scoringMs = Date.now() - scoringStart;
  let scorecard = scoringResult.scorecard;

  audit.push({
    stage: "scoring",
    agent: "ScoringAgent (Opus)",
    timestamp: now(),
    durationMs: scoringMs,
    tokens: scoringResult.usage
      ? { input: scoringResult.usage.inputTokens, output: scoringResult.usage.outputTokens }
      : undefined,
    scores: scorecardToDict(scorecard),
    reasoning: `Aggregate: ${scorecard.aggregateScore.toFixed(1)}/${scorecard.aggregateThreshold}. Failed: ${JSON.stringify(scorecard.failedMetrics)}`,
  });

  emitEvent(onEvent, "scoring", "complete", scorecardSummary(scorecard));

  // 4. Surgical glossary enforcement (before gate check)
  const glossaryPatchResult = await enforceGlossary(
    sourceText,
    currentText,
    langProfile.glossary,
    language,
    { skipGrammarFix: true }, // specialists will handle grammar
  );

  if (glossaryPatchResult.replacements.length > 0) {
    currentText = glossaryPatchResult.correctedText;
    emitEvent(
      onEvent,
      "glossary_patcher",
      "complete",
      `Surgical glossary fix: ${glossaryPatchResult.complianceBefore.toFixed(0)}% → ${glossaryPatchResult.complianceAfter.toFixed(0)}%. ` +
        `${glossaryPatchResult.replacements.length} replacements, ${glossaryPatchResult.hitlTerms.length} HITL.`,
    );

    audit.push({
      stage: "glossary_patcher",
      agent: "GlossaryPatcher (deterministic + Haiku)",
      timestamp: now(),
      reasoning: `${glossaryPatchResult.replacements.length} terms fixed: ${glossaryPatchResult.replacements.map((r) => r.termEn).join(", ")}`,
      tokens: glossaryPatchResult.usage.inputTokens > 0
        ? { input: glossaryPatchResult.usage.inputTokens, output: glossaryPatchResult.usage.outputTokens }
        : undefined,
    });

    // Update glossary metrics deterministically (no Opus re-score needed)
    // The patcher only changes glossary terms — other metrics are unaffected
    const glossaryMetric = scorecard.metrics["glossary_compliance"];
    if (glossaryMetric) {
      const newScore = Math.round(glossaryPatchResult.complianceAfter);
      glossaryMetric.score = newScore;
      glossaryMetric.passed = newScore >= glossaryMetric.threshold;
      glossaryMetric.details = `Post-patcher: ${glossaryPatchResult.complianceAfter.toFixed(1)}%`;
    }

    emitEvent(onEvent, "scoring", "updated", `Glossary updated to ${glossaryPatchResult.complianceAfter.toFixed(0)}% (deterministic, no re-score needed)`);
  }

  // 5. Gate check
  if (scorecard.passed) {
    emitEvent(
      onEvent,
      "gate",
      "passed",
      "All metrics pass. Translation complete.",
    );
    const result = buildResult(
      clientId,
      language,
      sourceText,
      currentText,
      scorecard,
      true,
      0,
      false,
      audit,
    );
    await persist(translationStore, result);
    return result;
  }

  // 5. Correction loop
  let previousScorecard: Scorecard | undefined;

  for (let roundNum = 1; roundNum <= maxRounds; roundNum++) {
    emitEvent(
      onEvent,
      "correction",
      "starting",
      `Correction round ${roundNum}/${maxRounds}. Failed categories: ${JSON.stringify(scorecard.failedCategories)}`,
    );

    // Arbiter decides
    emitEvent(
      onEvent,
      "arbiter",
      "routing",
      "Quality Arbiter analyzing scorecard...",
    );
    const arbiterStart = Date.now();
    const plan = await planCorrections(
      scorecard,
      roundNum,
      previousScorecard,
    );
    const arbiterMs = Date.now() - arbiterStart;

    audit.push({
      stage: "arbiter",
      agent: "QualityArbiter (Haiku)",
      timestamp: now(),
      durationMs: arbiterMs,
      plan: planToDict(plan),
      reasoning: plan.rationale,
    });

    emitEvent(
      onEvent,
      "arbiter",
      "decided",
      `Plan: ${JSON.stringify(plan.correctionSequence)}. Conflicts: ${JSON.stringify(plan.conflictRisks)}`,
    );

    // Check for HITL escalation
    if (plan.escalateToHitl) {
      emitEvent(onEvent, "hitl", "escalated", plan.escalationReason);
      const result = buildResult(
        clientId,
        language,
        sourceText,
        currentText,
        scorecard,
        false,
        roundNum,
        true,
        audit,
      );
      await persist(translationStore, result);
      return result;
    }

    // Run specialists in sequence
    for (const specialistName of plan.correctionSequence) {
      emitEvent(
        onEvent,
        "specialist",
        "running",
        `${specialistName.charAt(0).toUpperCase() + specialistName.slice(1)} Specialist correcting...`,
      );

      // Gather failed metrics for this category
      const failedForCategory: Record<string, FailedMetricData> = {};
      const categoryMetrics =
        METRIC_CATEGORIES[specialistName as keyof typeof METRIC_CATEGORIES];
      if (categoryMetrics) {
        for (const mName of categoryMetrics) {
          const m = scorecard.metrics[mName];
          if (m && !m.passed) {
            failedForCategory[mName] = {
              score: m.score,
              threshold: m.threshold,
              details: m.details,
              evidence: m.evidence,
            };
          }
        }
      }

      if (Object.keys(failedForCategory).length === 0) continue;

      const specialistStart = Date.now();
      const specialistResult = await runSpecialist(
        specialistName,
        sourceText,
        currentText,
        langProfile,
        language,
        failedForCategory,
      );
      const specialistMs = Date.now() - specialistStart;

      audit.push({
        stage: specialistName,
        agent: `${specialistName.charAt(0).toUpperCase() + specialistName.slice(1)}Specialist (Sonnet)`,
        timestamp: now(),
        durationMs: specialistMs,
        tokens: specialistResult.usage
          ? { input: specialistResult.usage.inputTokens, output: specialistResult.usage.outputTokens }
          : undefined,
        inputHash: hash(currentText),
        outputHash: hash(specialistResult.correctedText),
        reasoning: specialistResult.reasoning.slice(0, 500),
      });

      currentText = specialistResult.correctedText;

      // Glossary guard: re-apply patcher replacements if specialist undid them
      if (glossaryPatchResult.replacements.length > 0) {
        const preGuard = checkCompliance(sourceText, currentText, langProfile.glossary);
        if (preGuard.missed.length > 0) {
          // Try deterministic re-application using cached replacements
          for (const rep of glossaryPatchResult.replacements) {
            if (!currentText.toLowerCase().includes(rep.replace.toLowerCase())) {
              // Term was undone — try to re-apply
              const escaped = rep.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const regex = new RegExp(escaped, "gi");
              currentText = currentText.replace(regex, rep.replace);
            }
          }

          const postGuard = checkCompliance(sourceText, currentText, langProfile.glossary);
          const recovered = preGuard.missed.length - postGuard.missed.length;
          if (recovered > 0) {
            emitEvent(
              onEvent,
              "glossary_guard",
              "recovered",
              `Glossary guard: recovered ${recovered} terms after ${specialistName} specialist.`,
            );
          }
        }
      }

      emitEvent(
        onEvent,
        "specialist",
        "complete",
        `${specialistName.charAt(0).toUpperCase() + specialistName.slice(1)} Specialist done.`,
      );
    }

    // Re-score after all specialists
    emitEvent(
      onEvent,
      "scoring",
      "re-scoring",
      `Re-scoring after round ${roundNum}...`,
    );
    previousScorecard = scorecard;
    const reScoringStart = Date.now();
    scoringResult = await scoreTranslationWithUsage(
      sourceText,
      currentText,
      profile as ClientProfile,
      language,
    );
    const reScoringMs = Date.now() - reScoringStart;
    scorecard = scoringResult.scorecard;

    audit.push({
      stage: "scoring",
      agent: "ScoringAgent (Opus)",
      timestamp: now(),
      durationMs: reScoringMs,
      tokens: scoringResult.usage
        ? { input: scoringResult.usage.inputTokens, output: scoringResult.usage.outputTokens }
        : undefined,
      scores: scorecardToDict(scorecard),
      reasoning: `Round ${roundNum} re-score. Aggregate: ${scorecard.aggregateScore.toFixed(1)}. Failed: ${JSON.stringify(scorecard.failedMetrics)}`,
    });

    emitEvent(
      onEvent,
      "scoring",
      "complete",
      `Round ${roundNum}: ${scorecard.aggregateScore.toFixed(1)}/${scorecard.aggregateThreshold}`,
    );

    if (scorecard.passed) {
      emitEvent(
        onEvent,
        "gate",
        "passed",
        `All metrics pass after ${roundNum} correction round(s).`,
      );
      const result = buildResult(
        clientId,
        language,
        sourceText,
        currentText,
        scorecard,
        true,
        roundNum,
        false,
        audit,
      );
      await persist(translationStore, result);
      return result;
    }
  }

  // Exhausted all rounds — escalate to HITL
  emitEvent(
    onEvent,
    "hitl",
    "escalated",
    `Max correction rounds (${maxRounds}) exhausted. HITL required.`,
  );

  const result = buildResult(
    clientId,
    language,
    sourceText,
    currentText,
    scorecard,
    false,
    maxRounds,
    true,
    audit,
  );
  await persist(translationStore, result);
  return result;
}

// --- Specialist Dispatch ---

async function runSpecialist(
  name: string,
  sourceText: string,
  translation: string,
  langProfile: ReturnType<typeof getLanguageProfile>,
  language: string,
  failedMetrics: Record<string, FailedMetricData>,
): Promise<SpecialistResult> {
  switch (name) {
    case "terminology":
      return correctTerminology(sourceText, translation, langProfile, failedMetrics);
    case "style":
      return correctStyle(sourceText, translation, langProfile, failedMetrics);
    case "structural":
      return correctStructure(sourceText, translation, langProfile, failedMetrics);
    case "linguistic":
      return correctLinguistic(
        sourceText,
        translation,
        langProfile,
        language,
        failedMetrics,
      );
    default:
      return { correctedText: translation, reasoning: `Unknown specialist: ${name}` };
  }
}

// --- Helpers ---

function buildResult(
  clientId: string,
  language: string,
  sourceText: string,
  translatedText: string,
  scorecard: Scorecard,
  passed: boolean,
  revisionCount: number,
  escalatedToHitl: boolean,
  auditTrail: AuditEntry[],
): EngineResult {
  return {
    clientId,
    language,
    sourceText,
    translatedText,
    scorecard,
    passed,
    revisionCount,
    escalatedToHitl,
    auditTrail,
  };
}

function planToDict(plan: CorrectionPlan): Record<string, unknown> {
  return {
    failed_categories: plan.failedCategories,
    correction_sequence: plan.correctionSequence,
    rationale: plan.rationale,
    conflict_risks: plan.conflictRisks,
    escalate_to_hitl: plan.escalateToHitl,
    escalation_reason: plan.escalationReason,
  };
}

async function persist(
  store: TranslationStore | undefined,
  result: EngineResult,
): Promise<void> {
  if (!store) return;
  try {
    await store.saveTranslation({
      clientId: result.clientId,
      language: result.language,
      sourceHash: hash(result.sourceText),
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      scorecard: scorecardToDict(result.scorecard),
      aggregateScore: result.scorecard.aggregateScore,
      passed: result.passed,
      revisionCount: result.revisionCount,
      escalatedToHitl: result.escalatedToHitl,
      auditTrail: result.auditTrail.map((a) => ({ ...a }) as Record<string, unknown>),
    });
  } catch {
    // Don't fail the translation if persistence fails
  }
}
