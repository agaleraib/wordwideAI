/**
 * Benchmark CLI — run calibration comparison pipeline.
 *
 * Usage:
 *   bun run src/benchmark/run.ts \
 *     --data-dir "/path/to/IronFX/05-May-2015" \
 *     --client-id ironfx \
 *     --language es \
 *     --output-dir ./benchmark-results \
 *     [--extract-profile]              \
 *     [--profile-json ./profile.json]  \
 *     [--skip-ai]                      \
 *     [--report-ids AM050115,AM050415]
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { InMemoryProfileStore } from "../lib/store.js";
import type { ClientProfile } from "../profiles/types.js";
import { ClientProfileSchema } from "../profiles/types.js";
import { extractProfile } from "../agents/profile-extraction-agent.js";
import { discoverDocumentPairs, readDocument } from "./docx-reader.js";
import { runComparison } from "./runner.js";
import { aggregateResults, formatAggregateReport } from "./aggregation.js";
import type { BenchmarkConfig, ComparisonResult } from "./types.js";

// --- Arg Parsing ---

function parseArgs(): BenchmarkConfig {
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
  const language = config["language"];
  const outputDir = config["output-dir"] ?? "./benchmark-results";

  if (!dataDir || !clientId || !language) {
    console.error(
      "Usage: bun run src/benchmark/run.ts --data-dir <path> --client-id <id> --language <lang> [options]",
    );
    console.error("\nRequired:");
    console.error("  --data-dir      Path to test data directory");
    console.error("  --client-id     Client identifier (e.g. ironfx)");
    console.error("  --language      Target language code (e.g. es, de)");
    console.error("\nOptional:");
    console.error("  --output-dir    Output directory (default: ./benchmark-results)");
    console.error("  --profile-json  Path to client profile JSON file");
    console.error("  --report-ids    Comma-separated report IDs to filter");
    console.error("  --extract-profile  Extract profile from first 10 pairs");
    console.error("  --skip-ai       Skip AI translation, only score human");
    process.exit(1);
  }

  return {
    dataDir,
    clientId,
    language,
    outputDir,
    profileJson: config["profile-json"],
    reportIds: config["report-ids"]?.split(","),
    extractProfile: flags.has("extract-profile"),
    skipAiTranslation: flags.has("skip-ai"),
  };
}

// --- Profile Loading ---

async function loadProfile(
  config: BenchmarkConfig,
  profileStore: InMemoryProfileStore,
): Promise<ClientProfile> {
  // Option 1: Load from JSON file
  if (config.profileJson) {
    console.log(`Loading profile from ${config.profileJson}...`);
    const raw = await Bun.file(config.profileJson).json();
    const profile = ClientProfileSchema.parse(raw);
    profileStore.seed([profile]);
    return profile;
  }

  // Option 2: Extract from test data
  if (config.extractProfile) {
    console.log("Extracting profile from test data...");
    const pairs = await discoverDocumentPairs(config.dataDir, config.language);
    const samplePairs = pairs.slice(0, 10);

    console.log(
      `  Reading ${samplePairs.length} document pairs for extraction...`,
    );
    const samples = [];
    for (const pair of samplePairs) {
      const source = await readDocument(pair.sourceFile);
      const translation = await readDocument(pair.humanFile);
      samples.push({ source, translation });
    }

    console.log("  Running extraction agent...");
    const result = await extractProfile({
      clientId: config.clientId,
      clientName: config.clientId,
      targetLanguage: config.language,
      samples,
    });

    const profile = ClientProfileSchema.parse({
      clientId: config.clientId,
      clientName: config.clientId,
      sourceLanguage: "en",
      languages: {
        [config.language]: result.extractedProfile,
      },
    });

    console.log(
      `  Extracted: ${Object.keys(result.extractedProfile.glossary).length} glossary terms, ` +
        `formality ${result.extractedProfile.tone.formalityLevel}/5, ` +
        `confidence: ${result.confidence}`,
    );

    profileStore.seed([profile]);
    return profile;
  }

  console.error(
    "Error: No profile source. Use --profile-json <path> or --extract-profile.",
  );
  process.exit(1);
}

// --- Main ---

async function main() {
  const config = parseArgs();

  console.log("=== FinFlow Calibration Benchmark ===");
  console.log(`  Data:     ${config.dataDir}`);
  console.log(`  Client:   ${config.clientId}`);
  console.log(`  Language:  ${config.language}`);
  console.log(`  Output:   ${config.outputDir}`);
  console.log(`  Skip AI:  ${config.skipAiTranslation ? "yes" : "no"}`);
  console.log("");

  // Setup
  const profileStore = new InMemoryProfileStore();
  const profile = await loadProfile(config, profileStore);

  // Discover pairs
  console.log("Discovering document pairs...");
  let pairs = await discoverDocumentPairs(config.dataDir, config.language);

  if (config.reportIds) {
    const filter = new Set(config.reportIds);
    pairs = pairs.filter((p) => filter.has(p.reportId));
  }

  console.log(`  Found ${pairs.length} document pairs for ${config.language}`);
  console.log("");

  if (pairs.length === 0) {
    console.error("No document pairs found. Check --data-dir and --language.");
    process.exit(1);
  }

  // Ensure output dirs
  const comparisonsDir = join(config.outputDir, "comparisons");
  if (!existsSync(comparisonsDir)) {
    mkdirSync(comparisonsDir, { recursive: true });
  }

  // Run comparisons
  const results: ComparisonResult[] = [];
  const startTime = Date.now();

  for (const [i, pair] of pairs.entries()) {
    console.log(
      `[${i + 1}/${pairs.length}] ${pair.reportId} (${config.language})`,
    );

    try {
      const result = await runComparison(pair, profile, profileStore, {
        skipAiTranslation: config.skipAiTranslation,
        onProgress: (msg) => console.log(msg),
      });

      results.push(result);

      // Summary line
      const aiAgg = result.aiScorecard.aggregateScore.toFixed(1);
      const humanAgg = result.humanScorecard.aggregateScore.toFixed(1);
      const delta = (
        result.aiScorecard.aggregateScore -
        result.humanScorecard.aggregateScore
      ).toFixed(1);
      const deltaSign = Number(delta) >= 0 ? "+" : "";
      console.log(
        `  Result: AI ${aiAgg} | Human ${humanAgg} | Delta: ${deltaSign}${delta}`,
      );

      // Write individual result JSON (metrics + analysis, no full texts)
      const compactResult = {
        reportId: result.reportId,
        language: result.language,
        metricDeltas: result.metricDeltas,
        qualitativeAnalysis: result.qualitativeAnalysis,
        timing: result.timing,
        aiAggregate: result.aiScorecard.aggregateScore,
        aiPassed: result.aiScorecard.passed,
        humanAggregate: result.humanScorecard.aggregateScore,
        humanPassed: result.humanScorecard.passed,
      };
      writeFileSync(
        join(comparisonsDir, `${pair.reportId}-${config.language}.json`),
        JSON.stringify(compactResult, null, 2),
      );

      // Write translated texts as separate files for review
      const textsDir = join(config.outputDir, "translations");
      if (!existsSync(textsDir)) mkdirSync(textsDir, { recursive: true });
      if (result.aiTranslation) {
        writeFileSync(
          join(textsDir, `${pair.reportId}-${config.language}-ai.txt`),
          result.aiTranslation,
        );
      }
      writeFileSync(
        join(textsDir, `${pair.reportId}-${config.language}-human.txt`),
        result.humanTranslation,
      );
      writeFileSync(
        join(textsDir, `${pair.reportId}-${config.language}-source.txt`),
        result.sourceText,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
    }

    console.log("");
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(
    `Completed ${results.length}/${pairs.length} comparisons in ${elapsed} minutes.`,
  );
  console.log("");

  if (results.length === 0) {
    console.error("No successful comparisons to aggregate.");
    process.exit(1);
  }

  // Aggregate
  console.log("Aggregating results...");
  const report = aggregateResults(results, config.language, profile);
  const markdown = formatAggregateReport(report);

  // Write reports
  const reportPath = join(
    config.outputDir,
    `calibration-report-${config.language}.md`,
  );
  const dataPath = join(
    config.outputDir,
    `calibration-data-${config.language}.json`,
  );

  writeFileSync(reportPath, markdown);

  // Write aggregate data without rawResults (too large)
  const { rawResults: _, ...compactReport } = report;
  writeFileSync(dataPath, JSON.stringify(compactReport, null, 2));

  console.log(`  Report:  ${reportPath}`);
  console.log(`  Data:    ${dataPath}`);
  console.log("");

  // Print summary table
  console.log("=== Summary ===");
  console.log(
    `  AI overall pass rate:    ${Math.round(report.overallAiPassRate * 100)}%`,
  );
  console.log(
    `  Human overall pass rate: ${Math.round(report.overallHumanPassRate * 100)}%`,
  );
  console.log(
    `  Recommendations:         ${report.calibrationRecommendations.length}`,
  );

  if (report.calibrationRecommendations.length > 0) {
    console.log("");
    for (const rec of report.calibrationRecommendations.slice(0, 5)) {
      const arrow =
        rec.suggestedValue !== undefined
          ? ` → suggested ${rec.suggestedValue}`
          : "";
      console.log(
        `  [${rec.confidence.toUpperCase()}] ${rec.metric}: ${rec.description.slice(0, 80)}...${arrow}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
