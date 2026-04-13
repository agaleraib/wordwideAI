/**
 * Structural Specialist — fixes formatting preservation, numerical accuracy,
 * paragraph alignment.
 *
 * Ported from finflow/agents/structural_specialist.py.
 * Migrated from callAgentWithUsage + text parsing to runAgentStructured (tool_use).
 */

import { runAgentStructured } from "../../lib/anthropic.js";
import type { AgentConfig } from "../../lib/types.js";
import type { LanguageProfile } from "../../profiles/types.js";
import type { FailedMetricData, SpecialistResult } from "./shared.js";
import { buildEvidenceText } from "./shared.js";

const SYSTEM_PROMPT = `You are a structural correction specialist for financial translations.

YOUR SCOPE — ONLY fix these:
- Missing or broken formatting (headers, bullets, bold, numbered lists)
- Incorrect, missing, or altered numbers (prices, percentages, dates, quantities)
- Paragraph alignment issues (merged paragraphs, extra breaks)

YOU MUST NOT:
- Change word choices or terminology
- Adjust tone, formality, or sentence structure
- Rephrase for fluency or style
- Change regional language markers

You are a precision tool: restore the document's structural integrity without touching its language.
Your output must be the COMPLETE corrected translation.`;

const STRUCTURAL_CORRECTION_SCHEMA = {
  type: "object" as const,
  properties: {
    correctedText: {
      type: "string" as const,
      description:
        "The COMPLETE corrected translation with only structural fixes applied.",
    },
    reasoning: {
      type: "string" as const,
      description:
        "Brief list of what you changed and why (formatting fixes, number corrections, paragraph alignment).",
    },
  },
  required: ["correctedText", "reasoning"] as const,
};

function parseStructuralResult(input: Record<string, unknown>): {
  correctedText: string;
  reasoning: string;
} {
  return {
    correctedText: String(input.correctedText ?? ""),
    reasoning: String(input.reasoning ?? ""),
  };
}

export async function correctStructure(
  sourceText: string,
  translation: string,
  _langProfile: LanguageProfile,
  failedMetrics: Record<string, FailedMetricData>,
): Promise<SpecialistResult> {
  const evidenceText = buildEvidenceText(failedMetrics);

  const prompt = `Fix the structural issues in this financial translation.

SOURCE (English) — this is the structural reference:
---
${sourceText}
---

CURRENT TRANSLATION:
---
${translation}
---

SPECIFIC ISSUES DETECTED:
${evidenceText}

Instructions:
1. Compare the source document's structure (headers, bullets, numbered lists, bold text, horizontal rules) against the translation.
2. Restore any missing structural elements to match the source.
3. Verify EVERY number from the source appears in the translation — prices, percentages, dates, quantities must be preserved exactly.
4. Fix paragraph alignment: the translation should have a similar paragraph count and structure as the source.
5. Do NOT change any words, terminology, or phrasing — only fix structure and numbers.
6. Return the COMPLETE corrected translation.`;

  const config: AgentConfig = {
    name: "structural-specialist",
    systemPrompt: SYSTEM_PROMPT,
    model: "sonnet",
    maxTokens: 8192,
  };

  const { result, usage } = await runAgentStructured(
    config,
    prompt,
    "structural_correction",
    "Submit the structurally-corrected translation and reasoning.",
    STRUCTURAL_CORRECTION_SCHEMA as unknown as Record<string, unknown>,
    parseStructuralResult,
  );

  return {
    correctedText: result.correctedText,
    reasoning: result.reasoning,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}
