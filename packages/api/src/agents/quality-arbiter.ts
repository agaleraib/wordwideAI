/**
 * Quality Arbiter — reads scorecards and routes to specialist agents.
 *
 * Ported from finflow/agents/quality_arbiter.py.
 * Uses tool_use for structured output instead of JSON-in-text parsing.
 * Includes deterministic fallback if LLM routing fails.
 */

import { runAgentStructured } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import { METRIC_CATEGORIES } from "../profiles/types.js";
import type { Scorecard } from "../scoring/scorecard.js";

// --- Types ---

export interface CorrectionPlan {
  failedCategories: string[];
  correctionSequence: string[];
  rationale: string;
  conflictRisks: string[];
  escalateToHitl: boolean;
  escalationReason: string;
}

// --- Tool Schema ---

const CORRECTION_PLAN_SCHEMA = {
  type: "object" as const,
  properties: {
    failed_categories: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    correction_sequence: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    rationale: { type: "string" as const },
    conflict_risks: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    escalate_to_hitl: { type: "boolean" as const },
    escalation_reason: { type: "string" as const },
  },
  required: [
    "failed_categories",
    "correction_sequence",
    "rationale",
    "conflict_risks",
    "escalate_to_hitl",
    "escalation_reason",
  ],
};

// --- Default sequence: most mechanical first, most nuanced last ---

const DEFAULT_SEQUENCE = [
  "terminology",
  "style",
  "structural",
  "linguistic",
];

// --- Arbiter ---

export async function planCorrections(
  scorecard: Scorecard,
  roundNumber: number = 1,
  previousScorecard?: Scorecard,
): Promise<CorrectionPlan> {
  if (scorecard.failedCategories.length === 0) {
    return {
      failedCategories: [],
      correctionSequence: [],
      rationale: "All metrics pass. No corrections needed.",
      conflictRisks: [],
      escalateToHitl: false,
      escalationReason: "",
    };
  }

  const prompt = buildPrompt(scorecard, roundNumber, previousScorecard);

  const config: AgentConfig = {
    name: "QualityArbiter",
    systemPrompt:
      "You are a translation quality routing system. " +
      "You analyze scorecards and decide which specialist agents should correct the translation. " +
      "Use the submit_plan tool to provide your routing decision.",
    model: "haiku",
    maxTokens: 1024,
  };

  try {
    const { result } = await runAgentStructured(
      config,
      prompt,
      "submit_plan",
      "Submit the correction routing plan",
      CORRECTION_PLAN_SCHEMA,
      (input) => ({
        failedCategories:
          (input["failed_categories"] as string[]) ??
          scorecard.failedCategories,
        correctionSequence:
          (input["correction_sequence"] as string[]) ?? [],
        rationale: (input["rationale"] as string) ?? "",
        conflictRisks: (input["conflict_risks"] as string[]) ?? [],
        escalateToHitl: (input["escalate_to_hitl"] as boolean) ?? false,
        escalationReason: (input["escalation_reason"] as string) ?? "",
      }),
    );
    return result;
  } catch {
    // Fallback: deterministic routing
    return deterministicPlan(scorecard, roundNumber, previousScorecard);
  }
}

function buildPrompt(
  scorecard: Scorecard,
  roundNumber: number,
  previous?: Scorecard,
): string {
  const metricsSummary: string[] = [];
  for (const [catName, metricNames] of Object.entries(METRIC_CATEGORIES)) {
    let catFailed = false;
    for (const mName of metricNames) {
      const m = scorecard.metrics[mName];
      if (m) {
        const status = m.passed ? "PASS" : "FAIL";
        metricsSummary.push(`  ${mName}: ${m.score}/${m.threshold} ${status}`);
        if (!m.passed) catFailed = true;
      }
    }
    if (catFailed) {
      metricsSummary.push(`  >> Category '${catName}' needs correction`);
    }
  }

  let improvementText = "";
  if (previous) {
    improvementText = "\n\nPREVIOUS ROUND COMPARISON:\n";
    for (const mName of scorecard.failedMetrics) {
      const prevScore = previous.metrics[mName];
      const currScore = scorecard.metrics[mName];
      if (prevScore && currScore) {
        const delta = currScore.score - prevScore.score;
        const direction =
          delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
        improvementText += `  ${mName}: ${prevScore.score} → ${currScore.score} (${direction}, ${delta > 0 ? "+" : ""}${delta})\n`;
      }
    }
  }

  return `Analyze this translation scorecard and determine the correction plan.

ROUND: ${roundNumber} of 2
AGGREGATE: ${scorecard.aggregateScore.toFixed(1)}/${scorecard.aggregateThreshold}

METRICS:
${metricsSummary.join("\n")}

FAILED CATEGORIES: ${JSON.stringify(scorecard.failedCategories)}
${improvementText}

SPECIALIST AGENTS AVAILABLE:
- "terminology": Fixes glossary_compliance, term_consistency, untranslated_terms
- "style": Fixes formality_level, sentence_length_ratio, brand_voice_adherence
- "structural": Fixes formatting_preservation, numerical_accuracy, paragraph_alignment
- "linguistic": Fixes fluency, meaning_preservation, regional_variant

RULES:
1. Only invoke specialists for categories that FAILED.
2. Default order: terminology → style → structural → linguistic (mechanical first, nuanced last).
3. Reorder if the scorecard suggests a different priority (e.g., if meaning_preservation is critically low, linguistic should go before style).
4. If round 2 and no improvement (or regression), recommend HITL escalation.
5. Flag conflict risks (e.g., style rewrite may undo terminology fixes).

Use the submit_plan tool to provide your routing decision.`;
}

/**
 * Deterministic fallback if LLM routing fails.
 */
function deterministicPlan(
  scorecard: Scorecard,
  roundNumber: number,
  previous?: Scorecard,
): CorrectionPlan {
  const sequence = DEFAULT_SEQUENCE.filter((cat) =>
    scorecard.failedCategories.includes(cat),
  );

  let escalate = false;
  let escalationReason = "";

  if (roundNumber >= 2 && previous) {
    let improved = false;
    for (const mName of scorecard.failedMetrics) {
      const prev = previous.metrics[mName];
      const curr = scorecard.metrics[mName];
      if (prev && curr && curr.score > prev.score) {
        improved = true;
        break;
      }
    }
    if (!improved) {
      escalate = true;
      escalationReason =
        "No improvement after correction round. Human review needed.";
    }
  }

  return {
    failedCategories: scorecard.failedCategories,
    correctionSequence: sequence,
    rationale:
      "Deterministic fallback: mechanical corrections first, nuanced last.",
    conflictRisks:
      sequence.includes("terminology") && sequence.includes("style")
        ? ["Style rewrite may re-introduce non-glossary terms"]
        : [],
    escalateToHitl: escalate,
    escalationReason,
  };
}
