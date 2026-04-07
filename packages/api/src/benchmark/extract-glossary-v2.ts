/**
 * Glossary Extractor v2 — frequency-based extraction with validation.
 *
 * 1. Process each document pair independently (Haiku per pair)
 * 2. Aggregate: count frequency of each en→es mapping across all docs
 * 3. Filter: keep only mappings with >60% consistency
 * 4. Back-translate flagged terms to verify correctness
 * 5. Domain-validate low-confidence entries
 *
 * Usage:
 *   bun run src/benchmark/extract-glossary-v2.ts \
 *     --data-dir "/path/to/IronFX/05-May-2015" \
 *     --language es \
 *     --output ./profiles/ironfx-glossary-es-v2.json
 */

import { runAgentStructured, callAgentWithUsage } from "../lib/anthropic.js";
import type { AgentConfig } from "../lib/types.js";
import { discoverDocumentPairs, readDocument } from "./docx-reader.js";
import {
  DEFAULT_METRIC_THRESHOLDS,
  DEFAULT_AGGREGATE_THRESHOLD,
  DEFAULT_MAX_REVISION_ATTEMPTS,
} from "../profiles/types.js";

// --- Types ---

interface TermMapping {
  en: string;
  es: string;
}

interface TermFrequency {
  en: string;
  translations: Map<string, number>; // es translation → count
  docsWithTerm: number; // how many docs contain the English term
}

interface ValidatedTerm {
  en: string;
  es: string;
  frequency: number; // how many docs used this translation
  totalDocs: number; // how many docs contained the English term
  consistency: number; // frequency / totalDocs
  backTranslation?: string;
  backTranslationMatch: boolean;
  domainValid?: boolean;
  flag?: string;
  /** All alternative translations found across documents (before validation) */
  rawAlternatives: Array<{ es: string; count: number }>;
  /** Validated synonyms — alternatives that passed back-translation */
  validSynonyms: string[];
}

// --- Per-document extraction (Haiku) ---

const PER_DOC_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    terms: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          en: {
            type: "string" as const,
            description: "English source term (lowercase, as it appears in the source)",
          },
          es: {
            type: "string" as const,
            description: "Spanish translation used in this document",
          },
        },
        required: ["en", "es"],
      },
      description: "All financial term mappings found in this document pair",
    },
  },
  required: ["terms"],
};

async function extractFromOnePair(
  source: string,
  translation: string,
  pairIndex: number,
): Promise<TermMapping[]> {
  const config: AgentConfig = {
    name: "GlossaryExtractorPerDoc",
    systemPrompt: `You are a financial terminology extractor. Given an English source document and its Spanish translation, identify all financial term mappings.

Extract ONLY terms you can clearly see in BOTH the source AND translation:
- Financial jargon (support level, resistance, bullish, bearish, etc.)
- Economic indicators (CPI, GDP, PMI, etc.) and their Spanish equivalents
- Central bank names and their translations
- Chart patterns (double bottom, head and shoulders, etc.)
- Market phrases (rate hike, quantitative easing, etc.)
- Client-specific phrases and section headers

For each term, extract the EXACT English phrase from the source and the EXACT Spanish translation used. Do not infer — only extract what you can see in both texts.`,
    model: "haiku",
    maxTokens: 4096,
  };

  // Truncate if very long to stay within Haiku context
  const maxChars = 8000;
  const srcTrunc = source.length > maxChars ? source.slice(0, maxChars) : source;
  const transTrunc = translation.length > maxChars ? translation.slice(0, maxChars) : translation;

  const { result } = await runAgentStructured(
    config,
    `ENGLISH SOURCE:\n---\n${srcTrunc}\n---\n\nSPANISH TRANSLATION:\n---\n${transTrunc}\n---\n\nExtract all financial term mappings found in both texts.`,
    "extract_terms",
    "Extract English→Spanish financial term mappings from this document pair",
    PER_DOC_TOOL_SCHEMA,
    (input) => input as { terms: TermMapping[] },
  );

  return result.terms ?? [];
}

// --- Aggregation ---

function aggregateTerms(
  allExtractions: TermMapping[][],
): Map<string, TermFrequency> {
  const termMap = new Map<string, TermFrequency>();

  for (const docTerms of allExtractions) {
    // Track which English terms appeared in this doc (deduplicate per doc)
    const seenInDoc = new Set<string>();

    for (const t of docTerms) {
      const enKey = t.en.toLowerCase().trim();
      const esVal = t.es.toLowerCase().trim();

      if (!termMap.has(enKey)) {
        termMap.set(enKey, {
          en: t.en.trim(),
          translations: new Map(),
          docsWithTerm: 0,
        });
      }

      const entry = termMap.get(enKey)!;
      // Use the casing from the first occurrence
      if (!entry.translations.has(esVal)) {
        entry.translations.set(esVal, 0);
      }
      entry.translations.set(esVal, entry.translations.get(esVal)! + 1);

      if (!seenInDoc.has(enKey)) {
        seenInDoc.add(enKey);
        entry.docsWithTerm++;
      }
    }
  }

  return termMap;
}

function selectBestTranslations(
  termMap: Map<string, TermFrequency>,
  minConsistency: number = 0.6,
  minDocs: number = 2,
): ValidatedTerm[] {
  const results: ValidatedTerm[] = [];

  for (const [, freq] of termMap) {
    if (freq.docsWithTerm < minDocs) continue;

    // Pick the most frequent translation
    let bestEs = "";
    let bestCount = 0;
    for (const [es, count] of freq.translations) {
      if (count > bestCount) {
        bestCount = count;
        bestEs = es;
      }
    }

    const consistency = bestCount / freq.docsWithTerm;
    if (consistency < minConsistency) continue;

    const rawAlternatives = [...freq.translations.entries()]
      .filter(([es]) => es !== bestEs)
      .sort(([, a], [, b]) => b - a)
      .map(([es, count]) => ({ es, count }));

    const altDisplay = rawAlternatives.map((a) => `${a.es} (${a.count}x)`);

    results.push({
      en: freq.en,
      es: bestEs,
      frequency: bestCount,
      totalDocs: freq.docsWithTerm,
      consistency,
      backTranslationMatch: false, // filled later
      rawAlternatives,
      validSynonyms: [], // filled by validateSynonyms()
      flag: altDisplay.length > 0
        ? `Alternatives: ${altDisplay.join(", ")}`
        : undefined,
    });
  }

  // Sort by consistency desc, then frequency desc
  results.sort((a, b) => b.consistency - a.consistency || b.frequency - a.frequency);
  return results;
}

// --- Back-translation validation ---

async function backTranslateTerms(
  terms: ValidatedTerm[],
): Promise<void> {
  // Batch all terms in one Haiku call
  const termList = terms.map((t) => `  "${t.es}" (Spanish)`).join("\n");

  const result = await callAgentWithUsage(
    "haiku",
    `You are a financial terminology translator. For each Spanish financial term below, provide the standard English equivalent. Return one line per term in the format: "spanish term" → "english term"`,
    `Translate these Spanish financial terms back to English:\n${termList}`,
    4096,
    0,
  );

  const lines = result.text.split("\n").filter((l) => l.includes("→"));
  for (const line of lines) {
    const match = line.match(/"([^"]+)"\s*→\s*"([^"]+)"/);
    if (!match) continue;
    const [, es, backEn] = match;

    // Find the matching term
    for (const t of terms) {
      if (t.es.toLowerCase() === es?.toLowerCase()) {
        t.backTranslation = backEn;
        t.backTranslationMatch =
          backEn?.toLowerCase().includes(t.en.toLowerCase()) ||
          t.en.toLowerCase().includes(backEn?.toLowerCase() ?? "");
        if (!t.backTranslationMatch) {
          t.flag = (t.flag ? t.flag + " | " : "") +
            `BACK-TRANSLATION MISMATCH: "${t.es}" → "${backEn}" (expected "${t.en}")`;
        }
        break;
      }
    }
  }
}

// --- Synonym validation ---

async function validateSynonyms(
  terms: ValidatedTerm[],
): Promise<void> {
  // Collect all alternatives that need validation
  const toValidate: Array<{ termEn: string; altEs: string }> = [];
  for (const t of terms) {
    for (const alt of t.rawAlternatives) {
      if (alt.es !== t.es) {
        toValidate.push({ termEn: t.en, altEs: alt.es });
      }
    }
  }

  if (toValidate.length === 0) return;

  // Back-translate all alternatives in one batch
  const altList = toValidate.map((v) => `  "${v.altEs}" (Spanish, for English "${v.termEn}")`).join("\n");

  const result = await callAgentWithUsage(
    "haiku",
    `You are a financial terminology translator. For each Spanish term below, translate it back to English. Return one line per term: "spanish term" → "english term"`,
    `Translate these Spanish financial terms back to English:\n${altList}`,
    4096,
    0,
  );

  const lines = result.text.split("\n").filter((l) => l.includes("→"));

  // Parse results and match to terms
  for (const line of lines) {
    const match = line.match(/"([^"]+)"\s*→\s*"([^"]+)"/);
    if (!match) continue;
    const [, es, backEn] = match;
    if (!es || !backEn) continue;

    // Find which term+alternative this belongs to
    for (const v of toValidate) {
      if (v.altEs.toLowerCase() === es.toLowerCase()) {
        // Check if back-translation matches the English term
        const matches =
          backEn.toLowerCase().includes(v.termEn.toLowerCase()) ||
          v.termEn.toLowerCase().includes(backEn.toLowerCase());

        if (matches) {
          // Valid synonym — add to the term
          const term = terms.find((t) => t.en.toLowerCase() === v.termEn.toLowerCase());
          if (term && !term.validSynonyms.includes(v.altEs)) {
            term.validSynonyms.push(v.altEs);
          }
        }
        break;
      }
    }
  }

  // Log summary
  let totalSynonyms = 0;
  for (const t of terms) totalSynonyms += t.validSynonyms.length;
  console.log(`  Validated ${totalSynonyms} synonyms across ${terms.filter((t) => t.validSynonyms.length > 0).length} terms`);
}

// --- Domain validation ---

async function domainValidateTerms(
  terms: ValidatedTerm[],
): Promise<void> {
  // Only validate terms with flags or low consistency
  const toValidate = terms.filter(
    (t) => !t.backTranslationMatch || t.consistency < 0.8,
  );

  if (toValidate.length === 0) return;

  const termList = toValidate
    .map((t) => `  "${t.en}" → "${t.es}"`)
    .join("\n");

  const result = await callAgentWithUsage(
    "sonnet",
    `You are a senior financial translator specializing in Spanish (es-ES) financial markets terminology. For each English→Spanish mapping below, assess if the Spanish term is the CORRECT and STANDARD translation in financial trading/analysis context.

Reply with one line per term:
- CORRECT: if the translation is standard financial Spanish
- WRONG: "correct term" — if the translation is incorrect, provide the right one
- ACCEPTABLE: if valid but not the most common choice`,
    `Validate these financial term translations:\n${termList}`,
    4096,
    0,
  );

  const lines = result.text.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    for (const t of toValidate) {
      if (line.toLowerCase().includes(t.en.toLowerCase()) ||
          line.toLowerCase().includes(t.es.toLowerCase())) {
        if (line.includes("WRONG")) {
          t.domainValid = false;
          t.flag = (t.flag ? t.flag + " | " : "") + `DOMAIN: ${line.trim()}`;
        } else if (line.includes("ACCEPTABLE")) {
          t.domainValid = true;
          t.flag = (t.flag ? t.flag + " | " : "") + `DOMAIN: ${line.trim()}`;
        } else {
          t.domainValid = true;
        }
        break;
      }
    }
  }
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

  const dataDir = config["data-dir"];
  const language = config["language"];
  const output = config["output"] ?? "./glossary-v2.json";

  if (!dataDir || !language) {
    console.error("Usage: bun run src/benchmark/extract-glossary-v2.ts --data-dir <path> --language <lang> [--output <path>]");
    process.exit(1);
  }

  return { dataDir, language, output };
}

// --- Main ---

async function main() {
  const config = parseArgs();

  console.log("=== Glossary Extractor v2 ===");
  console.log(`  Data: ${config.dataDir}`);
  console.log(`  Language: ${config.language}`);
  console.log("");

  // Discover pairs
  const pairs = await discoverDocumentPairs(config.dataDir, config.language);
  console.log(`Found ${pairs.length} document pairs`);
  console.log("");

  // Step 1: Extract from each pair independently
  console.log("Step 1: Per-document extraction (Haiku)...");
  const allExtractions: TermMapping[][] = [];

  for (const [i, pair] of pairs.entries()) {
    process.stdout.write(`  [${i + 1}/${pairs.length}] ${pair.reportId}...`);
    const source = await readDocument(pair.sourceFile);
    const translation = await readDocument(pair.humanFile);
    const terms = await extractFromOnePair(source, translation, i);
    allExtractions.push(terms);
    console.log(` ${terms.length} terms`);
  }

  // Step 2: Aggregate
  console.log("");
  console.log("Step 2: Aggregating...");
  const termMap = aggregateTerms(allExtractions);
  console.log(`  Unique English terms: ${termMap.size}`);

  const validated = selectBestTranslations(termMap, 0.5, 2);
  console.log(`  Terms passing frequency filter: ${validated.length}`);
  console.log("");

  // Step 3: Back-translation
  console.log("Step 3: Back-translation validation...");
  await backTranslateTerms(validated);
  const backMismatches = validated.filter((t) => !t.backTranslationMatch);
  console.log(`  Mismatches: ${backMismatches.length}`);
  console.log("");

  // Step 4: Synonym validation
  console.log("Step 4: Synonym validation (Haiku)...");
  await validateSynonyms(validated);
  console.log("");

  // Step 5: Domain validation (on flagged terms)
  console.log("Step 5: Domain validation (Sonnet)...");
  await domainValidateTerms(validated);
  const domainInvalid = validated.filter((t) => t.domainValid === false);
  console.log(`  Invalid: ${domainInvalid.length}`);
  console.log("");

  // Separate into verified and flagged
  const verified = validated.filter(
    (t) => t.backTranslationMatch && t.domainValid !== false && t.consistency >= 0.6,
  );
  const flagged = validated.filter(
    (t) => !t.backTranslationMatch || t.domainValid === false || t.consistency < 0.6,
  );

  console.log("=== RESULTS ===");
  console.log(`  Verified terms: ${verified.length}`);
  console.log(`  Flagged for review: ${flagged.length}`);
  console.log("");

  // Build output glossary (primary terms only — for compliance checker)
  const glossary: Record<string, string> = {};
  for (const t of verified) {
    glossary[t.en] = t.es;
  }

  // Build synonyms map (for enriched compliance checking)
  const glossarySynonyms: Record<string, string[]> = {};
  for (const t of verified) {
    if (t.validSynonyms.length > 0) {
      glossarySynonyms[t.en] = t.validSynonyms;
    }
  }

  const totalSynonyms = Object.values(glossarySynonyms).reduce((s, arr) => s + arr.length, 0);
  console.log(`  Terms with synonyms: ${Object.keys(glossarySynonyms).length}`);
  console.log(`  Total validated synonyms: ${totalSynonyms}`);
  console.log("");

  // Build output file
  const outputData = {
    language: config.language,
    regionalVariant: `${config.language}-ES`,
    extractionMethod: "v2-frequency-validated",
    stats: {
      documentPairs: pairs.length,
      uniqueTermsFound: termMap.size,
      verifiedTerms: verified.length,
      flaggedTerms: flagged.length,
      termsWithSynonyms: Object.keys(glossarySynonyms).length,
      totalSynonyms,
    },
    glossary,
    glossarySynonyms,
    flaggedForReview: flagged.map((t) => ({
      en: t.en,
      es: t.es,
      frequency: `${t.frequency}/${t.totalDocs}`,
      consistency: `${(t.consistency * 100).toFixed(0)}%`,
      backTranslation: t.backTranslation,
      flag: t.flag,
    })),
    toneOverrides: {},
    scoring: {
      metricThresholds: { ...DEFAULT_METRIC_THRESHOLDS },
      aggregateThreshold: DEFAULT_AGGREGATE_THRESHOLD,
      metricWeights: {
        glossary_compliance: 3.0,
        term_consistency: 2.0,
        numerical_accuracy: 3.0,
        untranslated_terms: 2.0,
        meaning_preservation: 2.0,
        fluency: 1.0,
        formality_level: 1.0,
        brand_voice_adherence: 1.5,
        regional_variant: 1.0,
        formatting_preservation: 1.0,
        paragraph_alignment: 1.0,
        sentence_length_ratio: 0.5,
      },
      maxRevisionAttempts: DEFAULT_MAX_REVISION_ATTEMPTS,
    },
  };

  await Bun.write(config.output, JSON.stringify(outputData, null, 2));
  console.log(`Written to: ${config.output}`);

  // Print flagged terms
  if (flagged.length > 0) {
    console.log("");
    console.log("=== FLAGGED FOR REVIEW ===");
    for (const t of flagged) {
      console.log(`  "${t.en}" → "${t.es}" (${t.frequency}/${t.totalDocs} docs, ${(t.consistency * 100).toFixed(0)}%)`);
      if (t.flag) console.log(`    ${t.flag}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
