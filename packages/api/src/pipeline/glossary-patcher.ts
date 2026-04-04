/**
 * Glossary Patcher — surgical glossary enforcement without text rewriting.
 *
 * Three layers:
 *   Layer 1: Deterministic regex (English terms left in text)
 *   Layer 2: Alternatives map lookup (known AI synonyms → glossary terms) [Branch B only]
 *   Layer 3: Haiku structured locator (JSON replacements for remaining misses)
 *   Layer 4: Haiku sentence-level grammar micro-fix (only modified sentences)
 *
 * Key principle: NEVER regenerate full text through an LLM.
 * All corrections are applied with string operations.
 */

import { runAgentStructured, callAgentWithUsage } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import type { ModelTier } from "../lib/types.js";

// --- Types ---

export interface PatcherResult {
  correctedText: string;
  replacements: Array<{
    find: string;
    replace: string;
    layer: string;
    termEn: string;
  }>;
  hitlTerms: Array<{
    en: string;
    expected: string;
    sourceContext: string;
    reason: string;
  }>;
  complianceBefore: number;
  complianceAfter: number;
  usage: { inputTokens: number; outputTokens: number };
}

interface MissedTerm {
  en: string;
  expected: string;
}

// --- Glossary Compliance Check (shared utility) ---

export interface ComplianceResult {
  matched: Array<{ en: string; es: string }>;
  missed: MissedTerm[];
  total: number;
  pct: number;
}

export function checkCompliance(
  sourceText: string,
  translation: string,
  glossary: Record<string, string>,
): ComplianceResult {
  const sourceLower = sourceText.toLowerCase();
  const transLower = translation.toLowerCase();
  const matched: Array<{ en: string; es: string }> = [];
  const missed: MissedTerm[] = [];

  for (const [en, es] of Object.entries(glossary)) {
    if (en.startsWith("_")) continue;
    if (sourceLower.includes(en.toLowerCase())) {
      if (transLower.includes(es.toLowerCase())) {
        matched.push({ en, es });
      } else {
        missed.push({ en, expected: es });
      }
    }
  }

  const total = Math.max(matched.length + missed.length, 1);
  return { matched, missed, total, pct: (matched.length / total) * 100 };
}

// --- Layer 1: Deterministic Regex Replacement ---

interface Layer1Result {
  text: string;
  fixed: Array<{ find: string; replace: string; termEn: string }>;
  remaining: MissedTerm[];
}

export function applyDeterministicReplacements(
  translation: string,
  missedTerms: MissedTerm[],
): Layer1Result {
  let text = translation;
  const fixed: Layer1Result["fixed"] = [];
  const remaining: MissedTerm[] = [];

  for (const term of missedTerms) {
    // Word-boundary regex for the English term in the Spanish text
    // Escape special regex chars in the term
    const escaped = term.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");

    const before = text;
    text = text.replace(regex, term.expected);

    if (text !== before) {
      fixed.push({ find: term.en, replace: term.expected, termEn: term.en });
    } else {
      remaining.push(term);
    }
  }

  return { text, fixed, remaining };
}

// --- Layer 2: Alternatives Map Lookup (deterministic) ---

interface Layer2Result {
  text: string;
  fixed: Array<{ find: string; replace: string; termEn: string }>;
  remaining: MissedTerm[];
}

export function applyAlternativesMap(
  translation: string,
  missedTerms: MissedTerm[],
  alternativesMap: Record<string, string[]>,
): Layer2Result {
  let text = translation;
  const fixed: Layer2Result["fixed"] = [];
  const remaining: MissedTerm[] = [];

  for (const term of missedTerms) {
    const alternatives = alternativesMap[term.en];
    if (!alternatives || alternatives.length === 0) {
      remaining.push(term);
      continue;
    }

    let found = false;
    for (const alt of alternatives) {
      const escaped = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const before = text;
      text = text.replace(regex, term.expected);
      if (text !== before) {
        fixed.push({ find: alt, replace: term.expected, termEn: term.en });
        found = true;
        break;
      }
    }

    if (!found) {
      remaining.push(term);
    }
  }

  return { text, fixed, remaining };
}

// --- Layer 3: LLM-as-Locator (Haiku/Sonnet structured output) ---

interface LocatorReplacement {
  english_term: string;
  found_in_translation: string;
  replacement: string;
  confidence: number;
}

const LOCATOR_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    replacements: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          english_term: {
            type: "string" as const,
            description: "The English glossary term",
          },
          found_in_translation: {
            type: "string" as const,
            description:
              "The EXACT text found in the Spanish translation that should be replaced (copy-paste exact match)",
          },
          replacement: {
            type: "string" as const,
            description: "The glossary-mandated replacement term",
          },
          confidence: {
            type: "number" as const,
            description:
              "0-1 confidence that the found text is the correct match for this term",
          },
        },
        required: [
          "english_term",
          "found_in_translation",
          "replacement",
          "confidence",
        ],
      },
    },
  },
  required: ["replacements"],
};

export async function locateReplacements(
  sourceText: string,
  translation: string,
  missedTerms: MissedTerm[],
  language: string,
  model: ModelTier = "haiku",
): Promise<{
  replacements: LocatorReplacement[];
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (missedTerms.length === 0) {
    return { replacements: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const termList = missedTerms
    .map((t) => `  "${t.en}" → should be "${t.expected}"`)
    .join("\n");

  const config: AgentConfig = {
    name: "GlossaryLocator",
    systemPrompt: `You are a terminology locator for financial translations. Your job is to find where specific English terms were translated in a Spanish text and identify the EXACT Spanish text that needs to be replaced.

For each term listed, find what the translator wrote instead of the glossary-mandated term. Return the EXACT string as it appears in the translation (copy-paste precision — the string must be findable with ctrl+F).

Do NOT return the full translation. Only return the replacement mappings.`,
    model,
    maxTokens: 2048,
  };

  const userMessage = `ENGLISH SOURCE (for context):
---
${sourceText.slice(0, 4000)}
---

SPANISH TRANSLATION (search in this text):
---
${translation}
---

TERMS TO LOCATE (find what was written instead of the glossary term):
${termList}

For each term, find the EXACT Spanish text that corresponds to it and return as structured replacements.`;

  const { result, usage } = await runAgentStructured(
    config,
    userMessage,
    "locate_replacements",
    "Identify exact text spans in the translation that need glossary term replacement",
    LOCATOR_TOOL_SCHEMA,
    (input) => input as { replacements: LocatorReplacement[] },
  );

  return {
    replacements: result.replacements ?? [],
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}

export function applyLocatorReplacements(
  translation: string,
  replacements: LocatorReplacement[],
  confidenceThreshold: number = 0.8,
): {
  text: string;
  applied: Array<{ find: string; replace: string; termEn: string }>;
  lowConfidence: Array<{ en: string; expected: string; confidence: number }>;
} {
  let text = translation;
  const applied: Array<{ find: string; replace: string; termEn: string }> = [];
  const lowConfidence: Array<{
    en: string;
    expected: string;
    confidence: number;
  }> = [];

  for (const r of replacements) {
    if (r.confidence < confidenceThreshold) {
      lowConfidence.push({
        en: r.english_term,
        expected: r.replacement,
        confidence: r.confidence,
      });
      continue;
    }

    if (text.includes(r.found_in_translation)) {
      text = text.replace(r.found_in_translation, r.replacement);
      applied.push({
        find: r.found_in_translation,
        replace: r.replacement,
        termEn: r.english_term,
      });
    }
  }

  return { text, applied, lowConfidence };
}

// --- Layer 4: Grammar Micro-Fix ---

export async function grammarMicroFix(
  text: string,
  replacements: Array<{ find: string; replace: string }>,
  model: ModelTier = "haiku",
): Promise<{
  text: string;
  fixedSentences: number;
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (replacements.length === 0) {
    return { text, fixedSentences: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  // Split text preserving separators (including paragraph breaks)
  const parts = text.split(/((?<=[.!?])\s+)/);
  // parts = [sentence, separator, sentence, separator, ...]
  const sentences: string[] = [];
  const separators: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) sentences.push(parts[i] ?? "");
    else separators.push(parts[i] ?? " ");
  }

  // Find sentences that were modified by replacements
  const modifiedIndices: number[] = [];
  for (const r of replacements) {
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i]?.includes(r.replace)) {
        if (!modifiedIndices.includes(i)) modifiedIndices.push(i);
      }
    }
  }

  if (modifiedIndices.length === 0) {
    return { text, fixedSentences: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  // Send only modified sentences for grammar check
  const sentencesToFix = modifiedIndices.map((i) => ({
    index: i,
    sentence: sentences[i],
  }));

  const sentenceList = sentencesToFix
    .map((s, idx) => `${idx + 1}. ${s.sentence}`)
    .join("\n");

  const result = await callAgentWithUsage(
    model,
    `Fix ONLY grammar issues (article gender, preposition, verb agreement) in these Spanish sentences. Do NOT rephrase, restructure, or change terminology. Output each corrected sentence on a new line, numbered to match.`,
    `Fix grammar if needed:\n${sentenceList}`,
    2048,
    0,
  );

  // Parse numbered responses
  const fixedLines = result.text.split("\n").filter((l) => l.match(/^\d+\./));
  let fixedCount = 0;

  for (let i = 0; i < Math.min(fixedLines.length, sentencesToFix.length); i++) {
    const fixedLine = fixedLines[i];
    const sentenceInfo = sentencesToFix[i];
    if (!fixedLine || !sentenceInfo?.sentence) continue;

    const fixed = fixedLine.replace(/^\d+\.\s*/, "").trim();
    const original = sentenceInfo.sentence;

    // Safety: reject if too many characters changed (beyond the replacement)
    const maxExtraChars = 15;
    const lengthDiff = Math.abs(fixed.length - original.length);
    if (lengthDiff <= maxExtraChars && fixed !== original) {
      sentences[sentenceInfo.index] = fixed;
      fixedCount++;
    }
  }

  // Rejoin with original separators (preserving paragraph breaks)
  let rejoined = "";
  for (let i = 0; i < sentences.length; i++) {
    rejoined += sentences[i];
    if (i < separators.length) rejoined += separators[i];
  }

  return {
    text: rejoined,
    fixedSentences: fixedCount,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

// --- Main: Full Patcher Pipeline ---

export interface PatcherOptions {
  alternativesMap?: Record<string, string[]>;
  locatorModel?: ModelTier;
  grammarModel?: ModelTier;
  confidenceThreshold?: number;
  skipGrammarFix?: boolean;
}

export async function enforceGlossary(
  sourceText: string,
  translation: string,
  glossary: Record<string, string>,
  language: string,
  options: PatcherOptions = {},
): Promise<PatcherResult> {
  const {
    alternativesMap,
    locatorModel = "haiku",
    grammarModel = "haiku",
    confidenceThreshold = 0.8,
    skipGrammarFix = false,
  } = options;

  let totalIn = 0;
  let totalOut = 0;

  // Compliance before
  const before = checkCompliance(sourceText, translation, glossary);
  const allReplacements: PatcherResult["replacements"] = [];
  const hitlTerms: PatcherResult["hitlTerms"] = [];

  let currentText = translation;
  let remaining = before.missed;

  // Layer 1: Deterministic regex
  const layer1 = applyDeterministicReplacements(currentText, remaining);
  currentText = layer1.text;
  remaining = layer1.remaining;
  for (const f of layer1.fixed) {
    allReplacements.push({ ...f, layer: "regex" });
  }

  // Layer 2: Alternatives map (if provided)
  if (alternativesMap && remaining.length > 0) {
    const layer2 = applyAlternativesMap(currentText, remaining, alternativesMap);
    currentText = layer2.text;
    remaining = layer2.remaining;
    for (const f of layer2.fixed) {
      allReplacements.push({ ...f, layer: "alternatives" });
    }
  }

  // Layer 3: LLM locator (for remaining terms)
  if (remaining.length > 0) {
    const locator = await locateReplacements(
      sourceText,
      currentText,
      remaining,
      language,
      locatorModel,
    );
    totalIn += locator.usage.inputTokens;
    totalOut += locator.usage.outputTokens;

    const applied = applyLocatorReplacements(
      currentText,
      locator.replacements,
      confidenceThreshold,
    );
    currentText = applied.text;
    for (const a of applied.applied) {
      allReplacements.push({ ...a, layer: "locator" });
    }

    // Low confidence → HITL
    for (const lc of applied.lowConfidence) {
      const idx = sourceText.toLowerCase().indexOf(lc.en.toLowerCase());
      const ctx = idx >= 0
        ? sourceText.slice(Math.max(0, idx - 60), idx + lc.en.length + 60).replace(/\n/g, " ")
        : "";
      hitlTerms.push({
        en: lc.en,
        expected: lc.expected,
        sourceContext: ctx,
        reason: `Low confidence (${lc.confidence}) — needs human review`,
      });
    }

    // Terms not found by locator at all → HITL
    const locatedTerms = new Set(
      locator.replacements.map((r) => r.english_term.toLowerCase()),
    );
    for (const r of remaining) {
      if (!locatedTerms.has(r.en.toLowerCase())) {
        const idx = sourceText.toLowerCase().indexOf(r.en.toLowerCase());
        const ctx = idx >= 0
          ? sourceText.slice(Math.max(0, idx - 60), idx + r.en.length + 60).replace(/\n/g, " ")
          : "";
        hitlTerms.push({
          en: r.en,
          expected: r.expected,
          sourceContext: ctx,
          reason: "Locator could not identify replacement",
        });
      }
    }
  }

  // Layer 4: Grammar micro-fix on modified sentences (skip if post-correction-loop)
  if (allReplacements.length > 0 && !skipGrammarFix) {
    const grammar = await grammarMicroFix(
      currentText,
      allReplacements.map((r) => ({ find: r.find, replace: r.replace })),
      grammarModel,
    );
    currentText = grammar.text;
    totalIn += grammar.usage.inputTokens;
    totalOut += grammar.usage.outputTokens;
  }

  // Compliance after
  const after = checkCompliance(sourceText, currentText, glossary);

  return {
    correctedText: currentText,
    replacements: allReplacements,
    hitlTerms,
    complianceBefore: before.pct,
    complianceAfter: after.pct,
    usage: { inputTokens: totalIn, outputTokens: totalOut },
  };
}
