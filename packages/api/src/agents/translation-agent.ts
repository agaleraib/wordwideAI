/**
 * Translation Agent — translates financial reports using client-specific glossaries.
 *
 * Ported from finflow/agents/translation_agent.py.
 * This is WordwideFX's core differentiator: 15 years of financial translation
 * expertise encoded in glossaries and tone profiles.
 */

import { runAgent } from "../lib/anthropic.js";
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

// --- System Prompt ---

function buildSystemPrompt(
  lang: LanguageProfile,
  language: string,
  clientName: string,
): string {
  const brandRules =
    lang.brandRules.length > 0
      ? lang.brandRules.map((r) => `  - ${r}`).join("\n")
      : "  None specified";
  const compliance =
    lang.compliancePatterns.length > 0
      ? lang.compliancePatterns.map((p) => `  - ${p}`).join("\n")
      : "  None specified";
  const forbidden =
    lang.forbiddenTerms.length > 0
      ? lang.forbiddenTerms.map((t) => `  - ${t}`).join("\n")
      : "  None";
  const tone = lang.tone;

  return `You are a senior financial translator at WordwideFX with 15 years of experience translating forex, CFD, and commodity market analysis for institutional broker clients.

TARGET LANGUAGE: ${langName(language)} (${language})
REGIONAL VARIANT: ${lang.regionalVariant || language}

CLIENT: ${clientName}

TONE PROFILE:
- Formality: ${tone.formalityLevel}/5 — ${tone.description}
- Target avg sentence length: ${tone.avgSentenceLength} words
- Target passive voice usage: ${tone.passiveVoiceTargetPct}%
- Person preference: ${tone.personPreference}
- Hedging frequency: ${tone.hedgingFrequency}

BRAND RULES:
${brandRules}

COMPLIANCE PATTERNS:
${compliance}

FORBIDDEN TERMS:
${forbidden}

CRITICAL INSTRUCTIONS:
1. You MUST use the provided glossary for ALL financial terms. These are client-approved translations that must not be changed.
2. Maintain the analytical structure and formatting (headers, bullet points, numbers).
3. Do NOT translate proper nouns (OANDA, EUR/USD, RSI, MACD, etc.) unless the glossary provides a specific translation.
4. Match the tone profile EXACTLY — formality level ${tone.formalityLevel}/5.
5. Preserve all numerical values, percentages, and price levels exactly.
6. Translate disclaimer text accurately — compliance depends on it.
7. Use the ${lang.regionalVariant || language} regional variant consistently — vocabulary, grammar, spelling must all match.
8. NEVER use forbidden terms. Find approved alternatives.
9. Target sentence length: ~${tone.avgSentenceLength} words average.
10. Passive voice should be approximately ${tone.passiveVoiceTargetPct}% of sentences.

GLOSSARY (you MUST use these exact translations):
${JSON.stringify(lang.glossary, null, 2)}

RESPONSE FORMAT:
Respond with ONLY the translated text. Do not add commentary, explanations, or notes.
Preserve all original formatting (headers, bullet points, etc.).`;
}

// --- Translation ---

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

  onEvent?.({
    stage: "translation",
    status: "loading_profile",
    message: `Loading profile for ${profile.clientName} (${targetLanguage})...`,
    timestamp: new Date().toISOString(),
  });

  const config: AgentConfig = {
    name: "TranslationAgent",
    systemPrompt: buildSystemPrompt(langProfile, targetLanguage, profile.clientName),
    model: "opus",
    maxTokens: 8192,
  };

  const prompt = `Translate the following financial analysis report into ${langName(targetLanguage)} (${langProfile.regionalVariant || targetLanguage} variant).

---
${sourceText}
---`;

  onEvent?.({
    stage: "translation",
    status: "translating",
    message: `Translating to ${langName(targetLanguage)} (${Object.keys(langProfile.glossary).length} glossary terms, variant: ${langProfile.regionalVariant || "default"})...`,
    timestamp: new Date().toISOString(),
  });

  const response = await runAgent(config, prompt, onChunk);
  result.translatedText = response.content;

  // Glossary compliance check
  onEvent?.({
    stage: "translation",
    status: "checking_glossary",
    message: "Verifying glossary compliance...",
    timestamp: new Date().toISOString(),
  });

  const compliance = checkGlossaryCompliance(
    sourceText,
    result.translatedText,
    langProfile.glossary,
  );
  result.glossaryTermsUsed = compliance.used;
  result.glossaryTermsTotal = compliance.total;
  result.glossaryCompliancePct = compliance.pct;
  result.termsMatched = compliance.matched;
  result.termsMissed = compliance.missed;

  onEvent?.({
    stage: "translation",
    status: "complete",
    message: `Translation complete. Glossary compliance: ${result.glossaryCompliancePct.toFixed(1)}%`,
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
