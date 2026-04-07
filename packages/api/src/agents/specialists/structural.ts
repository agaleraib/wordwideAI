/**
 * Structural Specialist — fixes formatting preservation, numerical accuracy,
 * paragraph alignment.
 *
 * Ported from finflow/agents/structural_specialist.py.
 */

import { callAgentWithUsage } from "../../lib/anthropic.js";
import type { LanguageProfile } from "../../profiles/types.js";
import type { FailedMetricData, SpecialistResult } from "./shared.js";
import { buildEvidenceText, parseSpecialistResponse } from "./shared.js";

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
6. Return the COMPLETE corrected translation.

After the translation, add a line "---REASONING---" followed by a brief list of what you changed and why.`;

  const result = await callAgentWithUsage("opus", SYSTEM_PROMPT, prompt, 8192);
  const [correctedText, reasoning] = parseSpecialistResponse(result.text);
  return { correctedText, reasoning, usage: result.usage };
}
