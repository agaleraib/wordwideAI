/**
 * Translation Agent — two-phase approach:
 *   Phase 1: Translate naturally for maximum fluency (minimal constraints)
 *   Phase 2: Apply glossary enforcement (focused pass, glossary only)
 *
 * This split prevents the "prompt overload" problem where stuffing glossary +
 * brand rules + tone into one prompt degrades fluency without achieving
 * good glossary compliance. Benchmark showed unconstrained Opus matches
 * ChatGPT 5.4 fluency (92 vs 93), while constrained drops to 78.
 */

import { runAgent, callAgentWithUsage } from "../lib/anthropic.js";
import type { AgentConfig, EventHandler } from "../lib/types.js";
import type { ClientProfile, LanguageProfile } from "../profiles/types.js";
import { getLanguageProfile } from "../profiles/types.js";

// --- Types ---

export interface TranslationResult {
  language: string;
  translatedText: string;
  glossaryTermsUsed: number;
  glossaryTermsTotal: number;
  glossaryCompliancePct: number;
  termsMatched: Array<{ en: string; translated: string }>;
  termsMissed: Array<{ en: string; expected: string }>;
  usage?: { inputTokens: number; outputTokens: number };
}

// --- Language Names ---

const LANG_NAMES: Record<string, string> = {
  es: "Spanish",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  pt: "Portuguese",
  de: "German",
  fr: "French",
  ar: "Arabic",
  it: "Italian",
  ko: "Korean",
  tr: "Turkish",
  ru: "Russian",
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

// --- Phase 1: Natural Translation (fluency first) ---

function buildNaturalPrompt(
  lang: LanguageProfile,
  language: string,
  clientName: string,
): string {
  const tone = lang.tone;

  return `You are a senior financial translator specializing in forex, CFD, and commodity market analysis. Translate into natural, fluent ${langName(language)} (${lang.regionalVariant || language} variant).

CLIENT: ${clientName}

STYLE GUIDANCE:
- Formality: ${tone.formalityLevel}/5 — ${tone.description}
- Person preference: ${tone.personPreference}
- Hedging frequency: ${tone.hedgingFrequency}

RULES:
1. Produce natural, idiomatic ${langName(language)}. Fluency is the top priority.
2. Preserve all numerical values, percentages, and price levels exactly.
3. Maintain the document structure (paragraphs, headers, bullet points).
4. Do NOT translate proper nouns, currency pairs (EUR/USD), or technical indicator abbreviations (RSI, MACD) unless you know the standard ${langName(language)} equivalent.
5. Use the ${lang.regionalVariant || language} regional variant consistently.

Respond with ONLY the translated text. No commentary.`;
}

// --- Phase 2: Glossary Enforcement ---

function buildGlossaryPrompt(
  glossaryEntries: string,
  missedCount: number,
  language: string,
): string {
  return `You are a terminology correction specialist for financial translations into ${langName(language)}.

The translation below has ${missedCount} glossary terms that are WRONG or MISSING. I will give you the ENGLISH SOURCE, the CURRENT TRANSLATION, and the GLOSSARY CORRECTIONS needed.

GLOSSARY CORRECTIONS (English term → required ${langName(language)} translation):
${glossaryEntries}

YOUR TASK:
1. Use the English source to locate where each glossary term appears in context.
2. Find the corresponding passage in the translation.
3. Replace the incorrect/missing translation with the glossary-mandated term.
4. If the English term was left untranslated in the ${langName(language)} text, replace it with the glossary term.
5. Adjust surrounding grammar minimally if needed, but do NOT rewrite or restyle the text.

Output the COMPLETE corrected translation.`;
}

// --- Main ---

export async function translateWithProfile(
  sourceText: string,
  targetLanguage: string,
  profile: ClientProfile,
  onChunk?: (text: string) => void,
  onEvent?: EventHandler,
): Promise<TranslationResult> {
  const langProfile = getLanguageProfile(profile, targetLanguage);
  const result: TranslationResult = {
    language: targetLanguage,
    translatedText: "",
    glossaryTermsUsed: 0,
    glossaryTermsTotal: 0,
    glossaryCompliancePct: 0,
    termsMatched: [],
    termsMissed: [],
  };

  // Filter glossary to source-relevant terms
  const sourceLower = sourceText.toLowerCase();
  const fullGlossary = langProfile.glossary;
  const relevantGlossary: Record<string, string> = {};
  for (const [en, translated] of Object.entries(fullGlossary)) {
    if (en.startsWith("_")) continue;
    if (sourceLower.includes(en.toLowerCase())) {
      relevantGlossary[en] = translated;
    }
  }
  const relevantCount = Object.keys(relevantGlossary).length;
  const totalCount = Object.keys(fullGlossary).filter((k) => !k.startsWith("_")).length;

  onEvent?.({
    stage: "translation",
    status: "loading_profile",
    message: `Loading profile for ${profile.clientName} (${targetLanguage}). ${relevantCount}/${totalCount} glossary terms relevant to source.`,
    timestamp: new Date().toISOString(),
  });

  // --- Phase 1: Natural translation ---
  onEvent?.({
    stage: "translation",
    status: "phase1_translating",
    message: `Phase 1: Natural translation to ${langName(targetLanguage)} (fluency first)...`,
    timestamp: new Date().toISOString(),
  });

  const phase1Config: AgentConfig = {
    name: "TranslationAgent",
    systemPrompt: buildNaturalPrompt(langProfile, targetLanguage, profile.clientName),
    model: "opus",
    maxTokens: 8192,
  };

  const phase1Prompt = `Translate the following financial analysis report into ${langName(targetLanguage)} (${langProfile.regionalVariant || targetLanguage} variant).

---
${sourceText}
---`;

  const phase1Response = await runAgent(phase1Config, phase1Prompt, onChunk);
  let currentText = phase1Response.content;
  let totalInputTokens = phase1Response.usage?.inputTokens ?? 0;
  let totalOutputTokens = phase1Response.usage?.outputTokens ?? 0;

  // Check glossary compliance after phase 1
  const phase1Compliance = checkGlossaryCompliance(
    sourceText,
    currentText,
    fullGlossary,
  );

  onEvent?.({
    stage: "translation",
    status: "phase1_complete",
    message: `Phase 1 done. Glossary: ${phase1Compliance.pct.toFixed(0)}% (${phase1Compliance.used}/${phase1Compliance.total}). Missed: ${phase1Compliance.missed.length} terms.`,
    timestamp: new Date().toISOString(),
  });

  // --- Phase 2: Glossary enforcement (only if there are missed terms) ---
  if (phase1Compliance.missed.length > 0) {
    onEvent?.({
      stage: "translation",
      status: "phase2_glossary",
      message: `Phase 2: Applying ${phase1Compliance.missed.length} glossary corrections...`,
      timestamp: new Date().toISOString(),
    });

    const glossaryEntries = phase1Compliance.missed
      .map((m) => `  "${m.en}" → must be translated as "${m.expected}"`)
      .join("\n");

    const phase2Response = await callAgentWithUsage(
      "opus",
      buildGlossaryPrompt(glossaryEntries, phase1Compliance.missed.length, targetLanguage),
      `ENGLISH SOURCE:\n---\n${sourceText}\n---\n\nCURRENT TRANSLATION:\n---\n${currentText}\n---\n\nApply all ${phase1Compliance.missed.length} glossary corrections listed above. Output the complete corrected translation.`,
      8192,
      0,
    );

    currentText = phase2Response.text;
    totalInputTokens += phase2Response.usage?.inputTokens ?? 0;
    totalOutputTokens += phase2Response.usage?.outputTokens ?? 0;
  }

  result.translatedText = currentText;
  result.usage = { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };

  // Final compliance check
  const finalCompliance = checkGlossaryCompliance(
    sourceText,
    currentText,
    fullGlossary,
  );
  result.glossaryTermsUsed = finalCompliance.used;
  result.glossaryTermsTotal = finalCompliance.total;
  result.glossaryCompliancePct = finalCompliance.pct;
  result.termsMatched = finalCompliance.matched;
  result.termsMissed = finalCompliance.missed;

  onEvent?.({
    stage: "translation",
    status: "complete",
    message: `Translation complete. Final glossary: ${result.glossaryCompliancePct.toFixed(1)}% (${result.glossaryTermsUsed}/${result.glossaryTermsTotal}).`,
    timestamp: new Date().toISOString(),
  });

  return result;
}

// --- Glossary Compliance Check ---

interface ComplianceResult {
  used: number;
  total: number;
  pct: number;
  matched: Array<{ en: string; translated: string }>;
  missed: Array<{ en: string; expected: string }>;
}

function checkGlossaryCompliance(
  sourceText: string,
  translatedText: string,
  glossary: Record<string, string>,
): ComplianceResult {
  const sourceLower = sourceText.toLowerCase();
  const translatedLower = translatedText.toLowerCase();

  const matched: Array<{ en: string; translated: string }> = [];
  const missed: Array<{ en: string; expected: string }> = [];

  for (const [englishTerm, translatedTerm] of Object.entries(glossary)) {
    if (englishTerm.startsWith("_")) continue;

    if (sourceLower.includes(englishTerm.toLowerCase())) {
      if (translatedLower.includes(translatedTerm.toLowerCase())) {
        matched.push({ en: englishTerm, translated: translatedTerm });
      } else {
        missed.push({ en: englishTerm, expected: translatedTerm });
      }
    }
  }

  const total = Math.max(matched.length + missed.length, 1);

  return {
    used: matched.length,
    total,
    pct: (matched.length / total) * 100,
    matched,
    missed,
  };
}
