/**
 * Advisor pipeline loop — replaces the TypeScript-orchestrated specialist
 * dispatch with a single Sonnet agentic session.
 *
 * Sonnet acts as a unified specialist, fixing terminology, style, structural,
 * and linguistic issues holistically. It has tools for scoring (Haiku) and
 * glossary enforcement (deterministic).
 */

import { runAgentLoop, type LoopTool } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import type { ClientProfile } from "../profiles/types.js";
import { getLanguageProfile } from "../profiles/types.js";
import { scoreTranslationWithUsage } from "../agents/scoring-agent.js";
import { enforceGlossary } from "./glossary-patcher.js";
import { scorecardSummary, scorecardToDict } from "../scoring/scorecard.js";
import type { Scorecard } from "../scoring/scorecard.js";
import { emitEvent } from "./events.js";
import type { EventHandler } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface AdvisorLoopResult {
  correctedText: string;
  reasoning: string;
  remainingIssues: string[];
  toolCallLog: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
  }>;
  usage: {
    sonnetInputTokens: number;
    sonnetOutputTokens: number;
    sonnetCacheReadTokens: number;
    sonnetCacheCreationTokens: number;
    haikuInputTokens: number;
    haikuOutputTokens: number;
  };
  turnCount: number;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a financial translation quality specialist. You fix translation issues across all domains: terminology, style, structure, and linguistics — in a single unified pass.

CORRECTION DOMAINS:
1. TERMINOLOGY: Glossary compliance, term consistency, untranslated terms.
2. STYLE: Formality level, sentence length, brand voice adherence.
3. STRUCTURAL: Formatting preservation, numerical accuracy, paragraph alignment.
4. LINGUISTIC: Fluency, meaning preservation, regional variant consistency.

RULES:
- Fix ALL domains holistically. Do not fix style at the expense of terminology.
- NEVER change glossary terms. If a specific financial term appears in the glossary, use the glossary form exactly.
- NEVER change numbers, percentages, prices, dates, or any numerical data.
- NEVER add or remove paragraph breaks, bullet points, or headers.
- When fixing fluency, preserve the meaning exactly. Rephrase for naturalness, do not alter semantics.
- When fixing formality, adjust tone without changing technical terminology.
- Regional variant must be consistent throughout (e.g., all vosotros OR all ustedes, never mixed).

WORKFLOW:
1. Analyze the scorecard to understand which metrics failed and why.
2. Make corrections addressing ALL failed metrics in a single pass.
3. Call enforce_glossary to ensure your corrections did not break glossary compliance.
4. Call score_translation to check your progress.
5. If metrics still fail and you can identify further improvements, iterate.
6. When satisfied or when further changes risk regressions, call submit_result.

IMPORTANT:
- Each score_translation call costs tokens. Do not score after trivial changes. Make substantive corrections, then check.
- You have a MAXIMUM of 6 tool calls total. Budget them wisely: typically 1 correction pass → 1 enforce_glossary → 1 score_translation → 1 submit_result (4 calls). Only iterate if the score shows clear remaining fixes.
- You MUST call submit_result before running out of tool calls. If you have used 4+ tool calls, call submit_result on your next turn with whatever corrections you have.
- If a metric cannot be improved without regressing another metric, note it in remaining_issues and submit.`;

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

function buildUserMessage(
  sourceText: string,
  currentTranslation: string,
  profile: ClientProfile,
  language: string,
  scorecard: Scorecard,
): string {
  const langProfile = getLanguageProfile(profile, language);
  const tone = langProfile.tone;
  const glossaryLines = Object.entries(langProfile.glossary)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 50) // cap to avoid huge prompts
    .map(([en, target]) => `  "${en}" → "${target}"`)
    .join("\n");

  const brandRules =
    langProfile.brandRules.length > 0
      ? langProfile.brandRules.map((r) => `  - ${r}`).join("\n")
      : "  None";

  const scoreSummary = scorecardSummary(scorecard);

  // Build detailed evidence for failed metrics
  const failedDetails: string[] = [];
  for (const [name, m] of Object.entries(scorecard.metrics)) {
    if (!m.passed) {
      failedDetails.push(`  ${name}: ${m.score}/${m.threshold} — ${m.details}`);
      for (const e of m.evidence) {
        failedDetails.push(`    • ${e}`);
      }
    }
  }

  return `Fix all quality issues in this financial translation.

SOURCE (English):
---
${sourceText.slice(0, 6000)}
---

CURRENT TRANSLATION (${langProfile.regionalVariant || language}):
---
${currentTranslation}
---

CLIENT PROFILE:
- Regional variant: ${langProfile.regionalVariant || language}
- Formality level: ${tone.formalityLevel}/5 (${tone.description})
- Target avg sentence length: ${tone.avgSentenceLength} words (±${tone.sentenceLengthStddev})
- Person preference: ${tone.personPreference} person
- Hedging frequency: ${tone.hedgingFrequency}
- Brand rules:
${brandRules}

GLOSSARY (exact translations required):
${glossaryLines}

CURRENT SCORECARD:
${scoreSummary}

FAILED METRICS — DETAILED EVIDENCE:
${failedDetails.join("\n")}

Fix all failing metrics while preserving passing ones. Return the COMPLETE corrected translation.`;
}

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

function buildTools(
  sourceText: string,
  profile: ClientProfile,
  language: string,
  onEvent?: EventHandler,
): { tools: LoopTool[]; haikuUsage: { input: number; output: number } } {
  const langProfile = getLanguageProfile(profile, language);
  const haikuUsage = { input: 0, output: 0 };

  const scoreTranslationTool: LoopTool = {
    name: "score_translation",
    description:
      "Score the current translation against all 13 quality metrics (6 deterministic + 7 LLM-judge on Haiku). Returns the full scorecard. Use after making substantive corrections to check progress.",
    inputSchema: {
      type: "object",
      properties: {
        corrected_text: {
          type: "string",
          description: "The current corrected translation text to score.",
        },
      },
      required: ["corrected_text"],
    },
    execute: async (input) => {
      emitEvent(onEvent, "advisor", "scoring", "In-loop progress check (Haiku)...");
      const result = await scoreTranslationWithUsage(
        sourceText,
        String(input.corrected_text),
        profile,
        language,
        "haiku",
      );
      if (result.usage) {
        haikuUsage.input += result.usage.inputTokens;
        haikuUsage.output += result.usage.outputTokens;
      }
      const summary = scorecardSummary(result.scorecard);
      emitEvent(
        onEvent,
        "advisor",
        "score_result",
        `Progress: ${result.scorecard.aggregateScore.toFixed(1)}/${result.scorecard.aggregateThreshold}`,
      );
      return {
        aggregateScore: result.scorecard.aggregateScore,
        aggregateThreshold: result.scorecard.aggregateThreshold,
        passed: result.scorecard.passed,
        failedMetrics: result.scorecard.failedMetrics,
        summary,
      };
    },
  };

  const enforceGlossaryTool: LoopTool = {
    name: "enforce_glossary",
    description:
      "Run deterministic glossary enforcement on the current translation. Returns corrected text with glossary terms fixed and a list of replacements. Call after corrections to ensure glossary compliance.",
    inputSchema: {
      type: "object",
      properties: {
        corrected_text: {
          type: "string",
          description: "The current corrected translation text.",
        },
      },
      required: ["corrected_text"],
    },
    execute: async (input) => {
      emitEvent(onEvent, "advisor", "glossary", "Enforcing glossary...");
      const result = await enforceGlossary(
        sourceText,
        String(input.corrected_text),
        langProfile.glossary,
        language,
        { skipGrammarFix: true },
      );
      emitEvent(
        onEvent,
        "advisor",
        "glossary",
        `Glossary: ${result.complianceBefore.toFixed(0)}% → ${result.complianceAfter.toFixed(0)}%. ${result.replacements.length} replacements.`,
      );
      return {
        correctedText: result.correctedText,
        complianceBefore: result.complianceBefore,
        complianceAfter: result.complianceAfter,
        replacementCount: result.replacements.length,
        replacements: result.replacements.slice(0, 10).map((r) => ({
          find: r.find,
          replace: r.replace,
        })),
      };
    },
  };

  const submitResultTool: LoopTool = {
    name: "submit_result",
    description:
      "Submit the final corrected translation. Call when all fixable issues are addressed or further changes risk regressions.",
    inputSchema: {
      type: "object",
      properties: {
        corrected_text: {
          type: "string",
          description: "The COMPLETE final corrected translation.",
        },
        reasoning: {
          type: "string",
          description: "Summary of all corrections made and remaining issues.",
        },
        remaining_issues: {
          type: "array",
          items: { type: "string" },
          description: "Metric failures that could not be fixed, if any.",
        },
      },
      required: ["corrected_text", "reasoning", "remaining_issues"],
    },
    execute: async (input) => input, // terminal — no side effects
  };

  return {
    tools: [scoreTranslationTool, enforceGlossaryTool, submitResultTool],
    haikuUsage,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runAdvisorLoop(
  sourceText: string,
  currentTranslation: string,
  profile: ClientProfile,
  language: string,
  scorecard: Scorecard,
  onEvent?: EventHandler,
): Promise<AdvisorLoopResult> {
  emitEvent(onEvent, "advisor", "starting", "Advisor session analyzing scorecard...");

  const userMessage = buildUserMessage(
    sourceText,
    currentTranslation,
    profile,
    language,
    scorecard,
  );

  const { tools, haikuUsage } = buildTools(sourceText, profile, language, onEvent);

  const config: AgentConfig = {
    name: "advisor-loop",
    systemPrompt: SYSTEM_PROMPT,
    model: "sonnet",
    maxTokens: 8192,
  };

  emitEvent(onEvent, "advisor", "correcting", "Advisor making corrections...");

  const { result, toolCallLog, usage, turnCount } = await runAgentLoop(
    config,
    userMessage,
    tools,
    "submit_result",
    (input) => ({
      correctedText: String(input.corrected_text ?? ""),
      reasoning: String(input.reasoning ?? ""),
      remainingIssues: Array.isArray(input.remaining_issues)
        ? (input.remaining_issues as string[])
        : [],
    }),
    { maxToolRounds: 6 },
  );

  emitEvent(onEvent, "advisor", "submitting", "Advisor submitted final correction.");

  return {
    correctedText: result.correctedText,
    reasoning: result.reasoning,
    remainingIssues: result.remainingIssues,
    toolCallLog,
    usage: {
      sonnetInputTokens: usage.inputTokens,
      sonnetOutputTokens: usage.outputTokens,
      sonnetCacheReadTokens: usage.cacheReadInputTokens,
      sonnetCacheCreationTokens: usage.cacheCreationInputTokens,
      haikuInputTokens: haikuUsage.input,
      haikuOutputTokens: haikuUsage.output,
    },
    turnCount,
  };
}
