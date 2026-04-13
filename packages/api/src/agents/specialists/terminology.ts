/**
 * Terminology Specialist — fixes glossary compliance, term consistency,
 * untranslated terms.
 *
 * Ported from finflow/agents/terminology_specialist.py.
 * Narrow mandate: correct terminology only, preserve everything else.
 *
 * TODO: migrate from callAgentWithUsage + text parsing to runAgentStructured (tool_use).
 *       See style.ts for the target pattern.
 */

import { callAgentWithUsage } from "../../lib/anthropic.js";
import type { LanguageProfile } from "../../profiles/types.js";
import type { FailedMetricData, SpecialistResult } from "./shared.js";
import { buildEvidenceText, parseSpecialistResponse } from "./shared.js";

const SYSTEM_PROMPT = `You are a terminology correction specialist for financial translations.

YOUR SCOPE — ONLY fix these:
- Incorrect glossary term translations (replace with the correct term from the glossary)
- Inconsistent terminology (same source term translated differently in different places)
- Financial terms left untranslated when a translation exists in the glossary

YOU MUST NOT:
- Change the tone, formality, or writing style
- Restructure sentences or paragraphs
- Change numbers, formatting, or layout
- "Improve" fluency or readability — that is another specialist's job
- Add or remove content

Your output must be the COMPLETE corrected translation. Not a diff, not a summary — the full text with only terminology fixes applied.`;

export async function correctTerminology(
  sourceText: string,
  translation: string,
  langProfile: LanguageProfile,
  failedMetrics: Record<string, FailedMetricData>,
): Promise<SpecialistResult> {
  // Build glossary context — only terms relevant to the source
  const sourceLower = sourceText.toLowerCase();
  const relevantGlossary: Record<string, string> = {};
  for (const [enTerm, targetTerm] of Object.entries(langProfile.glossary)) {
    if (enTerm.startsWith("_")) continue;
    if (sourceLower.includes(enTerm.toLowerCase())) {
      relevantGlossary[enTerm] = targetTerm;
    }
  }

  const glossaryLines = Object.entries(relevantGlossary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([en, target]) => `  "${en}" → "${target}"`)
    .join("\n");

  const evidenceText = buildEvidenceText(failedMetrics);

  const prompt = `Fix the terminology in this financial translation.

SOURCE (English):
---
${sourceText}
---

CURRENT TRANSLATION:
---
${translation}
---

GLOSSARY (these EXACT translations must be used):
${glossaryLines}

SPECIFIC ISSUES DETECTED:
${evidenceText}

Instructions:
1. Find every instance where a glossary term was translated incorrectly or left untranslated.
2. Replace with the exact glossary translation.
3. Ensure the same source term is translated the same way throughout.
4. Do NOT change anything else — preserve tone, structure, formatting, sentence flow.
5. Return the COMPLETE corrected translation.

After the translation, add a line "---REASONING---" followed by a brief list of what you changed and why.`;

  const result = await callAgentWithUsage("sonnet", SYSTEM_PROMPT, prompt, 8192);
  const [correctedText, reasoning] = parseSpecialistResponse(result.text);
  return { correctedText, reasoning, usage: result.usage };
}
