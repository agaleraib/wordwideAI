/**
 * Consistency Benchmark — proves FinFlow produces identical terminology
 * across multiple runs while generic LLM drifts.
 *
 * Runs the same document N times through:
 *   1. FinFlow pipeline (with profile + glossary)
 *   2. Generic LLM (unconstrained, no profile)
 *
 * Measures per-term consistency: does the same English term get the same
 * Spanish translation every time?
 *
 * Usage:
 *   bun run src/benchmark/consistency-test.ts \
 *     --source "/path/to/Original/AM050515.docx" \
 *     --brand-json ./profiles/ironfx-brand.json \
 *     --glossary-json ./profiles/ironfx-glossary-es-v2.json \
 *     --language es \
 *     --runs 5 \
 *     --output-dir ./consistency-results
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";

import { runAgent, callAgentWithUsage } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import { mergeProfile } from "./profile-merge.js";
import { readDocument } from "./docx-reader.js";
import { getLanguageProfile } from "../profiles/types.js";

// --- Types ---

interface TermOccurrence {
  en: string;
  translations: string[]; // one per run
  uniqueTranslations: number;
  consistent: boolean;
}

interface ConsistencyResult {
  translator: "finflow" | "generic";
  runs: number;
  totalTermsTracked: number;
  consistentTerms: number;
  driftingTerms: number;
  consistencyRate: number;
  termDetails: TermOccurrence[];
}

// --- Term extraction ---

/**
 * For each glossary term found in the source, find what Spanish text
 * appears near the corresponding position in the translation.
 * Uses a simple approach: find the glossary target term (or known variants)
 * in the translation.
 */
function extractTermTranslations(
  sourceText: string,
  translation: string,
  glossary: Record<string, string>,
): Map<string, string> {
  const sourceLower = sourceText.toLowerCase();
  const transLower = translation.toLowerCase();
  const results = new Map<string, string>();

  for (const [en, es] of Object.entries(glossary)) {
    if (en.startsWith("_")) continue;
    if (!sourceLower.includes(en.toLowerCase())) continue;

    // Check if the expected translation appears
    if (transLower.includes(es.toLowerCase())) {
      results.set(en, es);
      continue;
    }

    // If not, try to find what the translator wrote instead
    // Extract a 100-char window around where the English term appears in the source,
    // then find the corresponding area in the translation by matching nearby numbers/proper nouns
    const enIdx = sourceLower.indexOf(en.toLowerCase());
    const nearbyContext = sourceText.slice(
      Math.max(0, enIdx - 50),
      enIdx + en.length + 50,
    );

    // Find numbers near the term as anchors
    const numbers = nearbyContext.match(/\d+[.,]?\d*/g);
    if (numbers && numbers.length > 0) {
      for (const num of numbers) {
        const transIdx = translation.indexOf(num);
        if (transIdx >= 0) {
          // Extract the surrounding Spanish text as the "translation" of this term
          const window = translation.slice(
            Math.max(0, transIdx - 80),
            transIdx + 80,
          );
          results.set(en, `[near:${num}] ${window.slice(0, 60).trim()}`);
          break;
        }
      }
    }

    // If we still don't have it, mark as unknown
    if (!results.has(en)) {
      results.set(en, "[not found]");
    }
  }

  return results;
}

// --- Arg Parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        config[arg.slice(2)] = next;
        i++;
      }
    }
  }

  const source = config["source"];
  const brandJson = config["brand-json"];
  const glossaryJson = config["glossary-json"];
  const language = config["language"];
  const runs = parseInt(config["runs"] ?? "5", 10);
  const outputDir = config["output-dir"] ?? "./consistency-results";

  if (!source || !brandJson || !glossaryJson || !language) {
    console.error(
      "Usage: bun run src/benchmark/consistency-test.ts --source <.docx> --brand-json <path> --glossary-json <path> --language <lang> [--runs N] [--output-dir <path>]",
    );
    process.exit(1);
  }

  return { source, brandJson, glossaryJson, language, runs, outputDir };
}

// --- Translation functions ---

const LANG_NAMES: Record<string, string> = {
  es: "Spanish", de: "German", fr: "French", pt: "Portuguese",
};

async function translateFinFlow(
  sourceText: string,
  glossaryRef: string,
  language: string,
  regionalVariant: string,
  tone: { formalityLevel: number; description: string; personPreference: string; hedgingFrequency: string },
): Promise<string> {
  const langName = LANG_NAMES[language] ?? language;
  const config: AgentConfig = {
    name: "TranslationAgent",
    systemPrompt: `You are a senior financial translator specializing in forex, CFD, and commodity market analysis. Translate into natural, fluent ${langName} (${regionalVariant} variant).

STYLE GUIDANCE:
- Formality: ${tone.formalityLevel}/5 — ${tone.description}
- Person preference: ${tone.personPreference}
- Hedging frequency: ${tone.hedgingFrequency}

GLOSSARY REFERENCE (prefer these translations where they fit naturally):
${glossaryRef}

When a glossary term appears in the source, prefer the glossary translation if it reads naturally. Do not force awkward phrasing to match the glossary.

RULES:
1. Produce natural, idiomatic ${langName}. Fluency is the top priority.
2. Preserve all numerical values, percentages, and price levels exactly.
3. Maintain the document structure (paragraphs, headers, bullet points).
4. Preserve all hedging language (may, could, might, likely).
5. Use the ${regionalVariant} regional variant consistently.

Respond with ONLY the translated text. No commentary.`,
    model: "opus",
    maxTokens: 8192,
  };

  const response = await runAgent(
    config,
    `Translate this financial analysis report:\n\n---\n${sourceText}\n---`,
  );
  return response.content;
}

async function translateGeneric(
  sourceText: string,
  language: string,
): Promise<string> {
  const langName = LANG_NAMES[language] ?? language;
  const { text } = await callAgentWithUsage(
    "opus",
    `You are a professional financial translator. Translate to ${langName} (${language}-ES).`,
    `Translate the following financial document:\n${sourceText}`,
    8192,
    0,
  );
  return text;
}

// --- Main ---

async function main() {
  const config = parseArgs();
  const reportId = basename(config.source, ".docx");

  console.log("=== Consistency Benchmark ===");
  console.log(`  Document: ${reportId}`);
  console.log(`  Language: ${config.language}`);
  console.log(`  Runs: ${config.runs}`);
  console.log("");

  // Load
  const profile = await mergeProfile(config.brandJson, config.glossaryJson);
  const langProfile = getLanguageProfile(profile, config.language);
  const sourceText = await readDocument(config.source);

  // Build glossary ref for FinFlow prompt
  const sourceLower = sourceText.toLowerCase();
  const relevant: Record<string, string> = {};
  for (const [en, es] of Object.entries(langProfile.glossary)) {
    if (!en.startsWith("_") && sourceLower.includes(en.toLowerCase())) {
      relevant[en] = es;
    }
  }
  const glossaryRef = Object.entries(relevant)
    .sort(([a], [b]) => b.length - a.length)
    .map(([en, es]) => `  "${en}" → "${es}"`)
    .join("\n");

  console.log(`  Source words: ${sourceText.split(/\s+/).length}`);
  console.log(`  Glossary terms relevant: ${Object.keys(relevant).length}`);
  console.log("");

  if (!existsSync(config.outputDir)) mkdirSync(config.outputDir, { recursive: true });

  // Run FinFlow N times
  console.log(`--- FinFlow (${config.runs} runs) ---`);
  const finflowTranslations: string[] = [];
  for (let i = 1; i <= config.runs; i++) {
    process.stdout.write(`  Run ${i}/${config.runs}...`);
    const start = Date.now();
    const text = await translateFinFlow(
      sourceText,
      glossaryRef,
      config.language,
      langProfile.regionalVariant,
      langProfile.tone,
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    finflowTranslations.push(text);
    console.log(` done (${elapsed}s, ${text.split(/\s+/).length} words)`);

    writeFileSync(
      join(config.outputDir, `${reportId}-finflow-run${i}.txt`),
      text,
    );
  }

  // Run Generic N times
  console.log("");
  console.log(`--- Generic LLM (${config.runs} runs) ---`);
  const genericTranslations: string[] = [];
  for (let i = 1; i <= config.runs; i++) {
    process.stdout.write(`  Run ${i}/${config.runs}...`);
    const start = Date.now();
    const text = await translateGeneric(sourceText, config.language);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    genericTranslations.push(text);
    console.log(` done (${elapsed}s, ${text.split(/\s+/).length} words)`);

    writeFileSync(
      join(config.outputDir, `${reportId}-generic-run${i}.txt`),
      text,
    );
  }

  // Analyze consistency
  console.log("");
  console.log("--- Analyzing consistency ---");

  function analyzeConsistency(
    translations: string[],
    translator: "finflow" | "generic",
  ): ConsistencyResult {
    const termDetails: TermOccurrence[] = [];

    for (const [en, es] of Object.entries(relevant)) {
      const translationsForTerm: string[] = [];

      for (const trans of translations) {
        const transLower = trans.toLowerCase();
        if (transLower.includes(es.toLowerCase())) {
          translationsForTerm.push(es);
        } else {
          // Find what was used instead — check for the term near known anchors
          const map = extractTermTranslations(sourceText, trans, { [en]: es });
          translationsForTerm.push(map.get(en) ?? "[variant]");
        }
      }

      const unique = new Set(translationsForTerm);
      termDetails.push({
        en,
        translations: translationsForTerm,
        uniqueTranslations: unique.size,
        consistent: unique.size === 1,
      });
    }

    const consistent = termDetails.filter((t) => t.consistent).length;
    const drifting = termDetails.filter((t) => !t.consistent).length;

    return {
      translator,
      runs: translations.length,
      totalTermsTracked: termDetails.length,
      consistentTerms: consistent,
      driftingTerms: drifting,
      consistencyRate:
        termDetails.length > 0 ? consistent / termDetails.length : 1,
      termDetails,
    };
  }

  const finflowResult = analyzeConsistency(finflowTranslations, "finflow");
  const genericResult = analyzeConsistency(genericTranslations, "generic");

  // Print results
  console.log("");
  console.log("=== RESULTS ===");
  console.log("");
  console.log(
    "Translator".padEnd(12) +
      "Runs".padStart(6) +
      "Terms".padStart(7) +
      "Consistent".padStart(12) +
      "Drifting".padStart(10) +
      "Rate".padStart(8),
  );
  console.log("-".repeat(55));
  console.log(
    "FinFlow".padEnd(12) +
      String(finflowResult.runs).padStart(6) +
      String(finflowResult.totalTermsTracked).padStart(7) +
      String(finflowResult.consistentTerms).padStart(12) +
      String(finflowResult.driftingTerms).padStart(10) +
      `${(finflowResult.consistencyRate * 100).toFixed(1)}%`.padStart(8),
  );
  console.log(
    "Generic".padEnd(12) +
      String(genericResult.runs).padStart(6) +
      String(genericResult.totalTermsTracked).padStart(7) +
      String(genericResult.consistentTerms).padStart(12) +
      String(genericResult.driftingTerms).padStart(10) +
      `${(genericResult.consistencyRate * 100).toFixed(1)}%`.padStart(8),
  );

  // Show drifting terms
  const genericDrifters = genericResult.termDetails.filter((t) => !t.consistent);
  if (genericDrifters.length > 0) {
    console.log("");
    console.log(`--- Generic LLM: ${genericDrifters.length} drifting terms ---`);
    for (const t of genericDrifters.slice(0, 20)) {
      const unique = [...new Set(t.translations)];
      console.log(`  "${t.en}": ${unique.map((u) => `"${u.slice(0, 40)}"`).join(" | ")}`);
    }
  }

  const finflowDrifters = finflowResult.termDetails.filter((t) => !t.consistent);
  if (finflowDrifters.length > 0) {
    console.log("");
    console.log(`--- FinFlow: ${finflowDrifters.length} drifting terms ---`);
    for (const t of finflowDrifters.slice(0, 20)) {
      const unique = [...new Set(t.translations)];
      console.log(`  "${t.en}": ${unique.map((u) => `"${u.slice(0, 40)}"`).join(" | ")}`);
    }
  }

  // Save full results
  const outputData = {
    reportId,
    language: config.language,
    runs: config.runs,
    timestamp: new Date().toISOString(),
    finflow: {
      consistencyRate: finflowResult.consistencyRate,
      consistentTerms: finflowResult.consistentTerms,
      driftingTerms: finflowResult.driftingTerms,
      totalTerms: finflowResult.totalTermsTracked,
      drifters: finflowDrifters.map((t) => ({
        en: t.en,
        variants: [...new Set(t.translations)],
      })),
    },
    generic: {
      consistencyRate: genericResult.consistencyRate,
      consistentTerms: genericResult.consistentTerms,
      driftingTerms: genericResult.driftingTerms,
      totalTerms: genericResult.totalTermsTracked,
      drifters: genericDrifters.map((t) => ({
        en: t.en,
        variants: [...new Set(t.translations)],
      })),
    },
  };

  const jsonPath = join(config.outputDir, `${reportId}-consistency.json`);
  writeFileSync(jsonPath, JSON.stringify(outputData, null, 2));

  // CSV for presentation
  const csvRows = ["term,finflow_consistent,generic_consistent,generic_variants"];
  for (const en of Object.keys(relevant)) {
    const fTerm = finflowResult.termDetails.find((t) => t.en === en);
    const gTerm = genericResult.termDetails.find((t) => t.en === en);
    const gVariants = gTerm ? [...new Set(gTerm.translations)].length : 0;
    csvRows.push(
      `"${en}",${fTerm?.consistent ?? ""},${gTerm?.consistent ?? ""},${gVariants}`,
    );
  }
  const csvPath = join(config.outputDir, `${reportId}-consistency.csv`);
  writeFileSync(csvPath, csvRows.join("\n") + "\n");

  console.log("");
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
  console.log(`  Translations: ${config.outputDir}/${reportId}-*.txt`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
