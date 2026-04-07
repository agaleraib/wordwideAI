/**
 * Profile Extraction CLI — extract client brand/glossary profiles from test data.
 *
 * Mode 1: Brand extraction (source docs only)
 *   bun run src/benchmark/extract.ts \
 *     --data-dir "/path/to/data" \
 *     --client-id ironfx \
 *     --output-dir ./profiles \
 *     --brand-only
 *
 * Mode 2: Per-language glossary extraction
 *   bun run src/benchmark/extract.ts \
 *     --data-dir "/path/to/data" \
 *     --client-id ironfx \
 *     --output-dir ./profiles \
 *     --language es
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readdir } from "fs/promises";

import { discoverDocumentPairs, readDocument } from "./docx-reader.js";
import { extractProfile } from "../agents/profile-extraction-agent.js";
import type { TextSample } from "../agents/profile-extraction-agent.js";
import {
  DEFAULT_METRIC_THRESHOLDS,
  DEFAULT_AGGREGATE_THRESHOLD,
  DEFAULT_MAX_REVISION_ATTEMPTS,
} from "../profiles/types.js";

// --- Types ---

interface ExtractConfig {
  dataDir: string;
  clientId: string;
  outputDir: string;
  brandOnly: boolean;
  language: string | undefined;
  clientName: string;
}

interface BrandOutput {
  clientId: string;
  clientName: string;
  sourceLanguage: string;
  tone: Record<string, unknown>;
  brandRules: string[];
  forbiddenTerms: string[];
  compliancePatterns: string[];
}

interface GlossaryOutput {
  language: string;
  regionalVariant: string;
  glossary: Record<string, string>;
  scoring: {
    metricThresholds: Record<string, number>;
    aggregateThreshold: number;
    metricWeights: Record<string, number>;
    maxRevisionAttempts: number;
  };
}

// --- Arg Parsing ---

function parseArgs(): ExtractConfig {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};
  const flags: Set<string> = new Set();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        config[key] = next;
        i++;
      } else {
        flags.add(key);
      }
    }
  }

  const dataDir = config["data-dir"];
  const clientId = config["client-id"];
  const outputDir = config["output-dir"] ?? "./profiles";
  const brandOnly = flags.has("brand-only");
  const language = config["language"];
  const clientName = config["client-name"] ?? clientId ?? "";

  if (!dataDir || !clientId) {
    printUsage();
    process.exit(1);
  }

  if (!brandOnly && !language) {
    console.error(
      "Error: Provide --brand-only for brand extraction or --language <lang> for glossary extraction.",
    );
    printUsage();
    process.exit(1);
  }

  return { dataDir, clientId, outputDir, brandOnly, language, clientName };
}

function printUsage(): void {
  console.error(
    "\nUsage:\n" +
      "  Brand:    bun run src/benchmark/extract.ts --data-dir <path> --client-id <id> --output-dir <dir> --brand-only\n" +
      "  Glossary: bun run src/benchmark/extract.ts --data-dir <path> --client-id <id> --output-dir <dir> --language <lang>\n" +
      "\nRequired:\n" +
      "  --data-dir      Path to test data directory\n" +
      "  --client-id     Client identifier (e.g. ironfx)\n" +
      "\nMode (one required):\n" +
      "  --brand-only    Extract brand profile from source docs only\n" +
      "  --language      Target language code for glossary extraction (e.g. es, de)\n" +
      "\nOptional:\n" +
      "  --output-dir    Output directory (default: ./profiles)\n" +
      "  --client-name   Human-readable client name (defaults to client-id)",
  );
}

// --- Source File Discovery (brand-only mode) ---

/**
 * Discover ALL source .docx files across report subdirectories.
 * Unlike discoverDocumentPairs, this does not require a language — it only
 * looks in the Original/ subfolder of each report directory.
 */
async function discoverSourceFiles(dataDir: string): Promise<string[]> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const reportDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const sourceFiles: string[] = [];

  for (const reportId of reportDirs) {
    const originalDir = join(dataDir, reportId, "Original");
    let files: string[];
    try {
      files = await readdir(originalDir);
    } catch {
      continue;
    }

    const docFile = files.find((f) => {
      const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
      return ext === ".docx" || ext === ".doc";
    });

    if (docFile) {
      sourceFiles.push(join(originalDir, docFile));
    }
  }

  sourceFiles.sort();
  return sourceFiles;
}

// --- Brand Extraction (Phase 1 only) ---

async function runBrandExtraction(config: ExtractConfig): Promise<void> {
  console.log("=== Brand Profile Extraction (Phase 1) ===");
  console.log(`  Data:     ${config.dataDir}`);
  console.log(`  Client:   ${config.clientId}`);
  console.log(`  Output:   ${config.outputDir}`);
  console.log("");

  // Discover all source files
  console.log("Discovering source documents...");
  const sourceFiles = await discoverSourceFiles(config.dataDir);

  if (sourceFiles.length === 0) {
    console.error(
      "No source documents found. Check that --data-dir contains report subdirectories with Original/ folders.",
    );
    process.exit(1);
  }

  console.log(`  Found ${sourceFiles.length} source document(s)`);
  console.log("");

  // Read all source documents
  console.log("Reading source documents...");
  const samples: TextSample[] = [];
  for (const filePath of sourceFiles) {
    const text = await readDocument(filePath);
    samples.push({ source: text });
  }

  // Run extraction (phase 1 only — no translations provided)
  console.log(
    `Running phase 1 extraction on ${samples.length} document(s)...`,
  );

  // Use a dummy language since brand extraction is language-agnostic.
  // Phase 2 will be skipped because no samples have translations.
  const result = await extractProfile(
    {
      clientId: config.clientId,
      clientName: config.clientName,
      targetLanguage: "en",
      samples,
    },
    (event) => console.log(`  [${String(event.status)}] ${event.message}`),
  );

  // Build brand output
  const brandOutput: BrandOutput = {
    clientId: config.clientId,
    clientName: config.clientName,
    sourceLanguage: "en",
    tone: result.extractedProfile.tone as unknown as Record<string, unknown>,
    brandRules: result.extractedProfile.brandRules,
    forbiddenTerms: result.extractedProfile.forbiddenTerms,
    compliancePatterns: result.extractedProfile.compliancePatterns,
  };

  // Ensure output directory exists
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  const outputPath = join(config.outputDir, `${config.clientId}-brand.json`);
  await Bun.write(outputPath, JSON.stringify(brandOutput, null, 2) + "\n");

  console.log("");
  console.log(`  Brand rules:       ${brandOutput.brandRules.length}`);
  console.log(`  Forbidden terms:   ${brandOutput.forbiddenTerms.length}`);
  console.log(`  Compliance:        ${brandOutput.compliancePatterns.length}`);
  console.log(`  Confidence:        ${result.confidence}`);
  console.log(`  Samples analyzed:  ${result.sampleCount}`);

  if (result.warnings.length > 0) {
    console.log("");
    console.log("  Warnings:");
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }

  console.log("");
  console.log(`Written: ${outputPath}`);
}

// --- Glossary Extraction (Phase 1 + Phase 2) ---

async function runGlossaryExtraction(config: ExtractConfig): Promise<void> {
  const language = config.language!;

  console.log("=== Glossary Extraction (Phase 1 + Phase 2) ===");
  console.log(`  Data:     ${config.dataDir}`);
  console.log(`  Client:   ${config.clientId}`);
  console.log(`  Language:  ${language}`);
  console.log(`  Output:   ${config.outputDir}`);
  console.log("");

  // Discover document pairs for this language
  console.log(`Discovering document pairs for ${language}...`);
  const pairs = await discoverDocumentPairs(config.dataDir, language);

  if (pairs.length === 0) {
    console.error(
      `No document pairs found for language '${language}'. Check --data-dir and --language.`,
    );
    process.exit(1);
  }

  console.log(`  Found ${pairs.length} document pair(s)`);
  console.log("");

  // Read source + translation pairs.
  // All sources for phase 1 (tone/brand), first 10 translations for phase 2 (glossary).
  console.log("Reading documents...");
  const samples: TextSample[] = [];
  for (const [i, pair] of pairs.entries()) {
    const source = await readDocument(pair.sourceFile);
    const translation = i < 10 ? await readDocument(pair.humanFile) : undefined;
    samples.push({ source, translation });
  }

  const pairsWithTranslation = samples.filter((s) => s.translation).length;
  console.log(
    `  Phase 1: ${samples.length} source doc(s) for tone/brand extraction`,
  );
  console.log(
    `  Phase 2: ${pairsWithTranslation} pair(s) for glossary extraction`,
  );
  console.log("");

  // Run full extraction (both phases)
  console.log("Running extraction agent...");
  const result = await extractProfile(
    {
      clientId: config.clientId,
      clientName: config.clientName,
      targetLanguage: language,
      samples,
    },
    (event) => console.log(`  [${String(event.status)}] ${event.message}`),
  );

  const profile = result.extractedProfile;

  // Build glossary output with default scoring thresholds
  const glossaryOutput: GlossaryOutput = {
    language,
    regionalVariant: profile.regionalVariant || language,
    glossary: profile.glossary,
    scoring: {
      metricThresholds: { ...DEFAULT_METRIC_THRESHOLDS },
      aggregateThreshold: DEFAULT_AGGREGATE_THRESHOLD,
      metricWeights: {},
      maxRevisionAttempts: DEFAULT_MAX_REVISION_ATTEMPTS,
    },
  };

  // Ensure output directory exists
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  const outputPath = join(
    config.outputDir,
    `${config.clientId}-glossary-${language}.json`,
  );
  await Bun.write(outputPath, JSON.stringify(glossaryOutput, null, 2) + "\n");

  console.log("");
  console.log(`  Glossary terms:    ${Object.keys(profile.glossary).length}`);
  console.log(`  Regional variant:  ${glossaryOutput.regionalVariant}`);
  console.log(`  Confidence:        ${result.confidence}`);
  console.log(`  Samples analyzed:  ${result.sampleCount}`);

  if (result.warnings.length > 0) {
    console.log("");
    console.log("  Warnings:");
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }

  console.log("");
  console.log(`Written: ${outputPath}`);
}

// --- Main ---

async function main(): Promise<void> {
  const config = parseArgs();

  if (config.brandOnly) {
    await runBrandExtraction(config);
  } else {
    await runGlossaryExtraction(config);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Fatal error:", msg);
  process.exit(1);
});
