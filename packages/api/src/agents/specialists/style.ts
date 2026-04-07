/**
 * Style & Voice Specialist — fixes formality, sentence structure,
 * and brand voice adherence.
 *
 * Ported from finflow/agents/style_specialist.py.
 */

import { callAgentWithUsage } from "../../lib/anthropic.js";
import type { LanguageProfile } from "../../profiles/types.js";
import type { FailedMetricData, SpecialistResult } from "./shared.js";
import { buildEvidenceText, parseSpecialistResponse } from "./shared.js";

const SYSTEM_PROMPT = `You are a style and voice correction specialist for financial translations.

YOUR SCOPE — ONLY fix these:
- Formality level (too casual or too stiff for the client's target)
- Sentence length (too long or too short vs. client preference)
- Brand voice rule violations (specific client rules)

YOU MUST NOT:
- Change glossary terms — if a specific financial term is used, KEEP IT EXACTLY as-is
- Change numbers, percentages, prices, or any numerical data
- Change document structure (headers, bullets, paragraph breaks)
- Fix fluency issues or meaning problems — that is another specialist's job
- Change regional variant markers (vosotros/ustedes, spelling conventions)

When rewriting for style, you are adjusting HOW something is said, not WHAT is said.
Your output must be the COMPLETE corrected translation.`;

export async function correctStyle(
  sourceText: string,
  translation: string,
  langProfile: LanguageProfile,
  failedMetrics: Record<string, FailedMetricData>,
): Promise<SpecialistResult> {
  const tone = langProfile.tone;
  const brandRules =
    langProfile.brandRules.length > 0
      ? langProfile.brandRules.map((r) => `  - ${r}`).join("\n")
      : "  None";

  const evidenceText = buildEvidenceText(failedMetrics);

  const prompt = `Fix the style and voice in this financial translation.

SOURCE (English):
---
${sourceText}
---

CURRENT TRANSLATION:
---
${translation}
---

CLIENT STYLE PROFILE:
- Formality level: ${tone.formalityLevel}/5 (${tone.description})
- Target avg sentence length: ${tone.avgSentenceLength} words (±${tone.sentenceLengthStddev})
- Person preference: ${tone.personPreference} person
- Hedging frequency: ${tone.hedgingFrequency}
- Brand rules:
${brandRules}

SPECIFIC ISSUES DETECTED:
${evidenceText}

Instructions:
1. Adjust formality to match level ${tone.formalityLevel}/5.
2. If sentences are too long/short, split or combine to match target length (~${tone.avgSentenceLength} words).
3. Fix any brand rule violations.
4. PRESERVE all glossary terms exactly as they appear.
5. PRESERVE all numbers, formatting, and paragraph structure.
6. Return the COMPLETE corrected translation.

After the translation, add a line "---REASONING---" followed by a brief list of what you changed and why.`;

  const result = await callAgentWithUsage("opus", SYSTEM_PROMPT, prompt, 8192);
  const [correctedText, reasoning] = parseSpecialistResponse(result.text);
  return { correctedText, reasoning, usage: result.usage };
}
