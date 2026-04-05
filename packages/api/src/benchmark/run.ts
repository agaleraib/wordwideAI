/**
 * Benchmark CLI — run calibration comparison pipeline.
 *
 * Usage:
 *   bun run src/benchmark/run.ts \
 *     --data-dir "/path/to/IronFX/05-May-2015" \
 *     --client-id ironfx \
 *     --language es \
 *     --output-dir ./benchmark-results \
 *     [--extract-profile]                        \
 *     [--profile-json ./profile.json]            \
 *     [--brand-json ./brand.json --glossary-json ./glossary-es.json] \
 *     [--skip-ai]                                \
 *     [--report-ids AM050115,AM050415]
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { InMemoryProfileStore } from "../lib/store.js";
import type { ClientProfile } from "../profiles/types.js";
import { ClientProfileSchema } from "../profiles/types.js";
import { extractProfile } from "../agents/profile-extraction-agent.js";
import { mergeProfile } from "./profile-merge.js";
import { discoverDocumentPairs, readDocument } from "./docx-reader.js";
import { runComparison, type GenericTranslator } from "./runner.js";
import { aggregateResults, formatAggregateReport } from "./aggregation.js";
import { formatDocumentReport } from "./report.js";
import { exportMetricsCSV, exportSummaryCSV } from "./csv-export.js";
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
    console.error("  --output-dir      Output directory (default: ./benchmark-results)");
    console.error("  --profile-json    Path to full client profile JSON file");
    console.error("  --brand-json      Path to brand profile (shared across languages)");
    console.error("  --glossary-json   Path to language glossary file (use with --brand-json)");
    console.error("  --report-ids      Comma-separated report IDs to filter");
    console.error("  --extract-profile Extract profile from test data");
    console.error("  --skip-ai         Skip AI translation, only score human");
    console.error("  --export-csv      Export metrics and summary as CSV files");
    console.error("  --compare-generic Run unconstrained generic LLM translation for comparison");
    console.error("  --generic-ratio N Compare generic on 1 out of every N docs (default: 5)");
    console.error("  --generic-provider opus|openai  Provider for generic translation (default: opus)");
    process.exit(1);
  }

  return {
    dataDir,
    clientId,
    language,
    outputDir,
    profileJson: config["profile-json"],
    brandJson: config["brand-json"],
    glossaryJson: config["glossary-json"],
    reportIds: config["report-ids"]?.split(","),
    extractProfile: flags.has("extract-profile"),
    skipAiTranslation: flags.has("skip-ai"),
    exportCsv: flags.has("export-csv"),
    compareGeneric: flags.has("compare-generic"),
    compareGenericRatio: config["generic-ratio"] ? parseInt(config["generic-ratio"], 10) : 5,
    compareGenericProvider: (config["generic-provider"] as "opus" | "openai") ?? "opus",
  };
}

// --- Profile Loading ---

async function loadProfile(
  config: BenchmarkConfig,
  profileStore: InMemoryProfileStore,
): Promise<ClientProfile> {
  // Option 1: Merge brand + glossary files
  if (config.brandJson && config.glossaryJson) {
    console.log(`Loading brand from ${config.brandJson}`);
    console.log(`Loading glossary from ${config.glossaryJson}`);
    const profile = await mergeProfile(config.brandJson, config.glossaryJson);
    profileStore.seed([profile]);
    return profile;
  }

  // Option 2: Load from full profile JSON file
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
    // Read ALL source docs for phase 1 (brand/tone), first 10 pairs for phase 2 (glossary)
    console.log(
      `  Reading ${pairs.length} source documents + up to 10 translation pairs...`,
    );
    const samples = [];
    for (const [i, pair] of pairs.entries()) {
      const source = await readDocument(pair.sourceFile);
      // Only include translation for first 10 pairs (glossary extraction)
      const translation =
        i < 10 ? await readDocument(pair.humanFile) : undefined;
      samples.push({ source, translation });
    }

    console.log(
      `  Phase 1: ${samples.length} source docs for tone/brand extraction`,
    );
    console.log(
      `  Phase 2: ${samples.filter((s) => s.translation).length} pairs for glossary extraction`,
    );
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
  console.log(`  Generic:  ${config.compareGeneric ? `yes (1 in ${config.compareGenericRatio ?? 5}, ${config.compareGenericProvider ?? "opus"})` : "no"}`);
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

  // Build generic translator if needed
  let genericTranslator: GenericTranslator | undefined;
  if (config.compareGeneric && config.compareGenericProvider === "openai") {
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (!openaiKey) {
      console.error("Error: --generic-provider openai requires OPENAI_API_KEY in environment");
      process.exit(1);
    }
    genericTranslator = async (sourceText: string, language: string) => {
      const langNames: Record<string, string> = { es: "Spanish", de: "German", fr: "French", pt: "Portuguese", ar: "Arabic", zh: "Chinese", it: "Italian", ko: "Korean", ja: "Japanese" };
      const langName = langNames[language] ?? language;
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0,
          messages: [
            { role: "system", content: `You are a professional financial translator. Translate to ${langName} (${language}-ES).` },
            { role: "user", content: `Translate the following financial document:\n${sourceText}` },
          ],
        }),
      });
      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content ?? "";
    };
    console.log("  Generic provider: OpenAI (gpt-4o)");
  }

  // Randomly select which docs get generic comparison (1 in N)
  const genericRatio = config.compareGenericRatio ?? 5;
  const genericIndices = new Set<number>();
  if (config.compareGeneric && pairs.length > 0) {
    // Pick random indices, at least 1
    const count = Math.max(1, Math.ceil(pairs.length / genericRatio));
    const shuffled = [...Array(pairs.length).keys()].sort(() => Math.random() - 0.5);
    for (let j = 0; j < count; j++) {
      genericIndices.add(shuffled[j]!);
    }
    console.log(`  Generic comparison on ${genericIndices.size}/${pairs.length} docs (ratio 1:${genericRatio})`);
  }
  console.log("");

  // Run comparisons
  const results: ComparisonResult[] = [];
  const startTime = Date.now();

  for (const [i, pair] of pairs.entries()) {
    const runGenericForThis = genericIndices.has(i);
    console.log(
      `[${i + 1}/${pairs.length}] ${pair.reportId} (${config.language})${runGenericForThis ? " [+generic]" : ""}`,
    );

    try {
      const result = await runComparison(pair, profile, profileStore, {
        skipAiTranslation: config.skipAiTranslation,
        compareGeneric: runGenericForThis,
        genericTranslator,
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
      const compactResult: Record<string, unknown> = {
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
      if (result.genericScorecard) {
        compactResult["genericAggregate"] = result.genericScorecard.aggregateScore;
        compactResult["genericPassed"] = result.genericScorecard.passed;
      }
      writeFileSync(
        join(comparisonsDir, `${pair.reportId}-${config.language}.json`),
        JSON.stringify(compactResult, null, 2),
      );

      // Write per-document Markdown report
      const reportsDir = join(config.outputDir, "reports");
      if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
      const markdownReport = formatDocumentReport(result);
      writeFileSync(
        join(reportsDir, `${pair.reportId}-${config.language}.md`),
        markdownReport,
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
      if (result.genericTranslation) {
        writeFileSync(
          join(textsDir, `${pair.reportId}-${config.language}-generic.txt`),
          result.genericTranslation,
        );
      }
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

  // CSV export
  if (config.exportCsv) {
    const metricsCSVPath = join(
      config.outputDir,
      `metrics-${config.language}.csv`,
    );
    const summaryCSVPath = join(
      config.outputDir,
      `summary-${config.language}.csv`,
    );

    writeFileSync(metricsCSVPath, exportMetricsCSV(results, config.language));
    writeFileSync(summaryCSVPath, exportSummaryCSV(results, config.language));

    console.log(`  Metrics CSV: ${metricsCSVPath}`);
    console.log(`  Summary CSV: ${summaryCSVPath}`);
  }

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
