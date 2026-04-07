/**
 * A/B Test Harness — fast iteration for testing translation pipeline configs.
 *
 * Runs: translate + patch + score on a single document.
 * Does NOT run: comparison agent, aggregation, generic LLM.
 * ~2 min per config instead of ~10 min.
 *
 * Usage:
 *   bun run src/benchmark/ab-test.ts \
 *     --source "/path/to/Original/AM050115.docx" \
 *     --brand-json ./profiles/ironfx-brand.json \
 *     --glossary-json ./profiles/ironfx-glossary-es.json \
 *     --language es \
 *     --phase1-model opus \
 *     --patcher-model haiku \
 *     [--glossary-in-prompt]          # Branch A: include glossary as reference
 *     [--alternatives-json ./alt.json] # Branch B: alternatives map file
 *     --output-dir ./ab-results
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";

import { callAgentWithUsage, runAgent } from "../lib/anthropic.js";
import type { AgentConfig, ModelTier } from "../lib/types.js";
import { mergeProfile } from "./profile-merge.js";
import { readDocument } from "./docx-reader.js";
import { scoreTranslation } from "../agents/scoring-agent.js";
import { scorecardToDict } from "../scoring/scorecard.js";
import {
  enforceGlossary,
  checkCompliance,
} from "../pipeline/glossary-patcher.js";
import type { ClientProfile } from "../profiles/types.js";
import { getLanguageProfile } from "../profiles/types.js";

// --- Language Names ---

const LANG_NAMES: Record<string, string> = {
  es: "Spanish", de: "German", fr: "French", pt: "Portuguese",
  ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean",
  it: "Italian", ru: "Russian", pl: "Polish", vi: "Vietnamese",
  hu: "Hungarian", tr: "Turkish",
};

// --- Arg Parsing ---

interface ABConfig {
  sourceFile: string;
  brandJson: string;
  glossaryJson: string;
  language: string;
  phase1Model: ModelTier;
  patcherModel: ModelTier;
  glossaryInPrompt: boolean;
  alternativesJson?: string;
  outputDir: string;
}

function parseArgs(): ABConfig {
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

  const sourceFile = config["source"];
  const brandJson = config["brand-json"];
  const glossaryJson = config["glossary-json"];
  const language = config["language"];

  if (!sourceFile || !brandJson || !glossaryJson || !language) {
    console.error("Usage: bun run src/benchmark/ab-test.ts --source <.docx> --brand-json <path> --glossary-json <path> --language <lang> [options]");
    console.error("\nOptions:");
    console.error("  --phase1-model opus|sonnet   (default: opus)");
    console.error("  --patcher-model haiku|sonnet (default: haiku)");
    console.error("  --glossary-in-prompt         Branch A: include glossary in Phase 1");
    console.error("  --alternatives-json <path>   Branch B: alternatives map file");
    console.error("  --output-dir <path>          (default: ./ab-results)");
    process.exit(1);
  }

  return {
    sourceFile,
    brandJson,
    glossaryJson,
    language,
    phase1Model: (config["phase1-model"] as ModelTier) ?? "opus",
    patcherModel: (config["patcher-model"] as ModelTier) ?? "haiku",
    glossaryInPrompt: flags.has("glossary-in-prompt"),
    alternativesJson: config["alternatives-json"],
    outputDir: config["output-dir"] ?? "./ab-results",
  };
}

// --- Phase 1 Translation ---

async function translatePhase1(
  sourceText: string,
  profile: ClientProfile,
  language: string,
  model: ModelTier,
  glossaryInPrompt: boolean,
): Promise<{ text: string; tokens: { input: number; output: number }; durationMs: number }> {
  const langProfile = getLanguageProfile(profile, language);
  const tone = langProfile.tone;
  const langName = LANG_NAMES[language] ?? language;

  let glossarySection = "";
  if (glossaryInPrompt) {
    const sourceLower = sourceText.toLowerCase();
    const relevant: Record<string, string> = {};
    for (const [en, es] of Object.entries(langProfile.glossary)) {
      if (!en.startsWith("_") && sourceLower.includes(en.toLowerCase())) {
        relevant[en] = es;
      }
    }
    const glossaryLines = Object.entries(relevant)
      .sort(([a], [b]) => b.length - a.length)
      .map(([en, es]) => `  "${en}" → "${es}"`)
      .join("\n");

    glossarySection = `\nGLOSSARY REFERENCE (prefer these translations where they fit naturally):\n${glossaryLines}\n\nWhen a glossary term appears in the source, prefer the glossary translation if it reads naturally. Do not force awkward phrasing to match the glossary.\n`;
  }

  const systemPrompt = `You are a senior financial translator specializing in forex, CFD, and commodity market analysis. Translate into natural, fluent ${langName} (${langProfile.regionalVariant || language} variant).

CLIENT: ${profile.clientName}

STYLE GUIDANCE:
- Formality: ${tone.formalityLevel}/5 — ${tone.description}
- Person preference: ${tone.personPreference}
- Hedging frequency: ${tone.hedgingFrequency}
${glossarySection}
RULES:
1. Produce natural, idiomatic ${langName}. Fluency is the top priority.
2. Preserve all numerical values, percentages, and price levels exactly.
3. Maintain the document structure (paragraphs, headers, bullet points).
4. Do NOT translate proper nouns, currency pairs (EUR/USD), or technical indicator abbreviations (RSI, MACD) unless you know the standard ${langName} equivalent.
5. Preserve all hedging language (may, could, might, likely) — do not convert possibilities into certainties.
6. Use the ${langProfile.regionalVariant || language} regional variant consistently.

Respond with ONLY the translated text. No commentary.`;

  const start = Date.now();

  const agentConfig: AgentConfig = {
    name: "TranslationAgent",
    systemPrompt,
    model,
    maxTokens: 8192,
  };

  const response = await runAgent(
    agentConfig,
    `Translate this financial analysis report:\n\n---\n${sourceText}\n---`,
  );

  return {
    text: response.content,
    tokens: {
      input: response.usage?.inputTokens ?? 0,
      output: response.usage?.outputTokens ?? 0,
    },
    durationMs: Date.now() - start,
  };
}

// --- Main ---

async function main() {
  const config = parseArgs();

  const reportId = basename(config.sourceFile, ".docx");
  const configName = `${config.glossaryInPrompt ? "A" : "B"}_${config.phase1Model}_${config.patcherModel}`;

  console.log(`=== A/B Test: ${configName} ===`);
  console.log(`  Source:    ${reportId}`);
  console.log(`  Language:  ${config.language}`);
  console.log(`  Phase 1:   ${config.phase1Model}${config.glossaryInPrompt ? " + glossary ref" : ""}`);
  console.log(`  Patcher:   ${config.patcherModel}`);
  console.log("");

  // Load
  const profile = await mergeProfile(config.brandJson, config.glossaryJson);
  const langProfile = getLanguageProfile(profile, config.language);
  const sourceText = await readDocument(config.sourceFile);

  let alternativesMap: Record<string, string[]> | undefined;
  if (config.alternativesJson) {
    alternativesMap = await Bun.file(config.alternativesJson).json() as Record<string, string[]>;
    console.log(`  Alternatives: ${Object.keys(alternativesMap).length} terms loaded`);
  }

  console.log(`  Source words: ${sourceText.split(/\s+/).length}`);
  console.log("");

  // Phase 1: Translate
  console.log("Phase 1: Translating...");
  const phase1 = await translatePhase1(
    sourceText,
    profile,
    config.language,
    config.phase1Model,
    config.glossaryInPrompt,
  );
  console.log(`  Done in ${(phase1.durationMs / 1000).toFixed(1)}s (${phase1.tokens.input} in / ${phase1.tokens.output} out)`);

  // Check compliance after Phase 1
  const phase1Compliance = checkCompliance(sourceText, phase1.text, langProfile.glossary);
  console.log(`  Glossary: ${phase1Compliance.pct.toFixed(1)}% (${phase1Compliance.matched.length}/${phase1Compliance.total})`);
  console.log(`  Missed: ${phase1Compliance.missed.length} terms`);
  console.log("");

  // Patcher
  console.log("Patcher: Enforcing glossary...");
  const patchStart = Date.now();
  const patchResult = await enforceGlossary(
    sourceText,
    phase1.text,
    langProfile.glossary,
    config.language,
    {
      alternativesMap,
      locatorModel: config.patcherModel,
      grammarModel: config.patcherModel,
    },
  );
  const patchMs = Date.now() - patchStart;
  console.log(`  Done in ${(patchMs / 1000).toFixed(1)}s`);
  console.log(`  Compliance: ${patchResult.complianceBefore.toFixed(1)}% → ${patchResult.complianceAfter.toFixed(1)}%`);
  console.log(`  Replacements: ${patchResult.replacements.length} (${patchResult.replacements.map((r) => r.layer).join(", ")})`);
  console.log(`  HITL terms: ${patchResult.hitlTerms.length}`);
  console.log(`  Tokens: ${patchResult.usage.inputTokens} in / ${patchResult.usage.outputTokens} out`);
  console.log("");

  // Score
  console.log("Scoring...");
  const scoreStart = Date.now();
  const scorecard = await scoreTranslation(sourceText, patchResult.correctedText, profile, config.language);
  const scoreMs = Date.now() - scoreStart;
  console.log(`  Done in ${(scoreMs / 1000).toFixed(1)}s`);
  console.log(`  Aggregate: ${scorecard.aggregateScore.toFixed(1)} / ${scorecard.aggregateThreshold} ${scorecard.passed ? "PASS" : "FAIL"}`);
  console.log(`  Failed: ${scorecard.failedMetrics.join(", ") || "none"}`);
  console.log("");

  // Cost calculation
  const opusInRate = 15 / 1_000_000;
  const opusOutRate = 75 / 1_000_000;
  const sonnetInRate = 3 / 1_000_000;
  const sonnetOutRate = 15 / 1_000_000;
  const haikuInRate = 0.25 / 1_000_000;
  const haikuOutRate = 1.25 / 1_000_000;

  function tokenCost(tokens: { input: number; output: number }, model: ModelTier): number {
    const rates = model === "opus" ? [opusInRate, opusOutRate] : model === "sonnet" ? [sonnetInRate, sonnetOutRate] : [haikuInRate, haikuOutRate];
    return tokens.input * rates[0]! + tokens.output * rates[1]!;
  }

  const phase1Cost = tokenCost(phase1.tokens, config.phase1Model);
  const patcherCost = tokenCost({ input: patchResult.usage.inputTokens, output: patchResult.usage.outputTokens }, config.patcherModel);
  const totalCost = phase1Cost + patcherCost;

  // Summary
  console.log("=== RESULTS ===");
  console.log(`  Config:       ${configName}`);
  console.log(`  Glossary:     ${patchResult.complianceAfter.toFixed(1)}%`);
  console.log(`  Aggregate:    ${scorecard.aggregateScore.toFixed(1)}`);
  console.log(`  Passed:       ${13 - scorecard.failedMetrics.length}/13`);
  console.log(`  Cost:         $${totalCost.toFixed(4)} (Phase1: $${phase1Cost.toFixed(4)}, Patcher: $${patcherCost.toFixed(4)})`);
  console.log(`  Time:         ${((phase1.durationMs + patchMs + scoreMs) / 1000).toFixed(1)}s`);
  console.log(`  HITL:         ${patchResult.hitlTerms.length} terms`);

  // Write results
  if (!existsSync(config.outputDir)) mkdirSync(config.outputDir, { recursive: true });

  const resultData = {
    config: configName,
    reportId,
    language: config.language,
    phase1Model: config.phase1Model,
    patcherModel: config.patcherModel,
    glossaryInPrompt: config.glossaryInPrompt,
    glossaryBefore: patchResult.complianceBefore,
    glossaryAfter: patchResult.complianceAfter,
    scores: scorecardToDict(scorecard),
    aggregate: scorecard.aggregateScore,
    passed: scorecard.passed,
    failedMetrics: scorecard.failedMetrics,
    replacements: patchResult.replacements,
    hitlTerms: patchResult.hitlTerms,
    cost: { phase1: phase1Cost, patcher: patcherCost, total: totalCost },
    tokens: {
      phase1: phase1.tokens,
      patcher: patchResult.usage,
      total: {
        input: phase1.tokens.input + patchResult.usage.inputTokens,
        output: phase1.tokens.output + patchResult.usage.outputTokens,
      },
    },
    timing: { phase1Ms: phase1.durationMs, patcherMs: patchMs, scoringMs: scoreMs },
  };

  const outFile = join(config.outputDir, `${reportId}-${config.language}-${configName}.json`);
  writeFileSync(outFile, JSON.stringify(resultData, null, 2));
  console.log(`\n  Results: ${outFile}`);

  // Save translation
  const transFile = join(config.outputDir, `${reportId}-${config.language}-${configName}.txt`);
  writeFileSync(transFile, patchResult.correctedText);
  console.log(`  Translation: ${transFile}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
