/**
 * Linguistic Specialist — polishes fluency, validates meaning preservation,
 * enforces regional variant correctness.
 *
 * Ported from finflow/agents/linguistic_specialist.py.
 * Migrated from callAgentWithUsage + text parsing to runAgentStructured (tool_use).
 */

import { runAgentStructured } from "../../lib/anthropic.js";
import type { AgentConfig } from "../../lib/types.js";
import type { LanguageProfile } from "../../profiles/types.js";
import type { FailedMetricData, SpecialistResult } from "./shared.js";
import { buildEvidenceText } from "./shared.js";

const SYSTEM_PROMPT = `You are a linguistic quality specialist for financial translations. You are effectively a native-speaker editor performing the final polish.

YOUR SCOPE — ONLY fix these:
- Awkward phrasings, calques from English, unnatural sentence flow
- Meaning distortions (additions, omissions, mistranslations of non-glossary content)
- Regional variant inconsistencies (mixing es-ES with es-AR markers, wrong verb forms, wrong spelling conventions)

YOU MUST NOT:
- Change glossary terms — financial terminology has been verified by a terminology specialist
- Change the tone or formality level — that has been set by a style specialist
- Change document structure, numbers, or formatting — that has been verified by a structural specialist
- Add content, opinions, or interpretations not present in the source

Think of yourself as the final native-speaker review. The translation is already terminologically correct, properly styled, and structurally sound. You are making it READ like it was originally written in the target language.

Your output must be the COMPLETE corrected translation.`;

const LINGUISTIC_CORRECTION_SCHEMA = {
  type: "object" as const,
  properties: {
    correctedText: {
      type: "string" as const,
      description:
        "The COMPLETE corrected translation with only linguistic/fluency fixes applied.",
    },
    reasoning: {
      type: "string" as const,
      description:
        "Brief list of what you changed and why (fluency improvements, meaning fixes, regional variant corrections).",
    },
  },
  required: ["correctedText", "reasoning"] as const,
};

function parseLinguisticResult(input: Record<string, unknown>): {
  correctedText: string;
  reasoning: string;
} {
  return {
    correctedText: String(input.correctedText ?? ""),
    reasoning: String(input.reasoning ?? ""),
  };
}

const VARIANT_GUIDES: Record<string, string> = {
  "es-ES":
    "Use vosotros forms, ceceo/distincion, coger/pillar vocabulary. Avoid Latin American terms.",
  "es-AR":
    "Use voseo (vos + modified conjugations), Argentine vocabulary (laburo, posta). No vosotros.",
  "es-MX":
    "Use ustedes (no vosotros), Mexican vocabulary. Formal register standard.",
  "es-CO":
    "Use usted/ustedes, Colombian vocabulary. Very formal register typical.",
  "en-GB":
    "Use British spelling (-ise, -our, -re), British vocabulary (flat, lift, fortnight).",
  "en-US":
    "Use American spelling (-ize, -or, -er), American vocabulary.",
  "en-ZA":
    "Use South African English conventions, blend of British spelling with local terms.",
};

export async function correctLinguistic(
  sourceText: string,
  translation: string,
  langProfile: LanguageProfile,
  language: string,
  failedMetrics: Record<string, FailedMetricData>,
): Promise<SpecialistResult> {
  const variant = langProfile.regionalVariant || language;
  const evidenceText = buildEvidenceText(failedMetrics);
  const variantGuidance = VARIANT_GUIDES[variant]
    ? `VARIANT GUIDANCE: ${VARIANT_GUIDES[variant]}`
    : "";

  const prompt = `Polish the linguistic quality of this financial translation.

SOURCE (English):
---
${sourceText}
---

CURRENT TRANSLATION (${variant}):
---
${translation}
---

TARGET REGIONAL VARIANT: ${variant}
${variantGuidance}

SPECIFIC ISSUES DETECTED:
${evidenceText}

Instructions:
1. Read the translation as a native ${variant} speaker would. Fix any phrasing that sounds unnatural, forced, or like a literal translation from English.
2. Verify meaning preservation: compare each paragraph's meaning against the source. Fix any semantic distortions, omissions, or additions.
3. Ensure consistent regional variant usage throughout:
   - Vocabulary must match ${variant} conventions
   - Grammar (verb forms, pronouns) must be consistent
   - Spelling conventions must match the variant
4. PRESERVE all glossary terms, brand-specific language, numbers, and formatting exactly as they appear.
5. PRESERVE the current tone and formality level.
6. Return the COMPLETE corrected translation.`;

  const config: AgentConfig = {
    name: "linguistic-specialist",
    systemPrompt: SYSTEM_PROMPT,
    model: "sonnet",
    maxTokens: 8192,
  };

  const { result, usage } = await runAgentStructured(
    config,
    prompt,
    "linguistic_correction",
    "Submit the linguistically-corrected translation and reasoning.",
    LINGUISTIC_CORRECTION_SCHEMA as unknown as Record<string, unknown>,
    parseLinguisticResult,
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
