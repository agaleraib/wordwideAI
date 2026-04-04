/**
 * Test glossary guard on a cached translation.
 *
 * Simulates what happens when a specialist rewrites text and the guard
 * re-applies glossary terms. No translation, no API calls for translation.
 *
 * Usage:
 *   bun run src/benchmark/test-guard.ts \
 *     --source "/path/to/Original/AM050415.docx" \
 *     --cached-translation ./path/to/cached-ai.txt \
 *     --brand-json ./profiles/ironfx-brand.json \
 *     --glossary-json ./profiles/ironfx-glossary-es.json \
 *     --language es \
 *     [--alternatives-json ./alternatives.json]
 */

import { readDocument } from "./docx-reader.js";
import { mergeProfile } from "./profile-merge.js";
import { scoreTranslation } from "../agents/scoring-agent.js";
import { scorecardSummary } from "../scoring/scorecard.js";
import { getLanguageProfile } from "../profiles/types.js";
import {
  enforceGlossary,
  checkCompliance,
} from "../pipeline/glossary-patcher.js";

// --- Arg Parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        config[key] = next;
        i++;
      }
    }
  }

  const source = config["source"];
  const cached = config["cached-translation"];
  const brandJson = config["brand-json"];
  const glossaryJson = config["glossary-json"];
  const language = config["language"];

  if (!source || !cached || !brandJson || !glossaryJson || !language) {
    console.error("Usage: bun run src/benchmark/test-guard.ts --source <.docx> --cached-translation <.txt> --brand-json <path> --glossary-json <path> --language <lang>");
    process.exit(1);
  }

  return { source, cached, brandJson, glossaryJson, language, alternativesJson: config["alternatives-json"] };
}

async function main() {
  const config = parseArgs();

  const profile = await mergeProfile(config.brandJson, config.glossaryJson);
  const langProfile = getLanguageProfile(profile, config.language);
  const sourceText = await readDocument(config.source);
  const cachedText = await Bun.file(config.cached).text();

  let alternativesMap: Record<string, string[]> | undefined;
  if (config.alternativesJson) {
    alternativesMap = await Bun.file(config.alternativesJson).json() as Record<string, string[]>;
  }

  // Step 1: Check baseline compliance
  const baseline = checkCompliance(sourceText, cachedText, langProfile.glossary);
  console.log(`Baseline compliance: ${baseline.pct.toFixed(1)}% (${baseline.matched.length}/${baseline.total})`);
  console.log(`Missed: ${baseline.missed.length} terms`);
  console.log("");

  // Step 2: Run patcher
  console.log("Running patcher...");
  const patchResult = await enforceGlossary(
    sourceText,
    cachedText,
    langProfile.glossary,
    config.language,
    { skipGrammarFix: true, alternativesMap },
  );
  console.log(`After patcher: ${patchResult.complianceBefore.toFixed(1)}% → ${patchResult.complianceAfter.toFixed(1)}%`);
  console.log(`Replacements: ${patchResult.replacements.length}`);
  console.log(`HITL: ${patchResult.hitlTerms.length}`);
  console.log("");

  // Step 3: Simulate specialist undoing some terms
  // Find 5 glossary terms in the patched text and revert them to alternatives
  console.log("Simulating specialist undoing glossary terms...");
  let damagedText = patchResult.correctedText;
  const undone: Array<{ term: string; original: string; reverted: string }> = [];

  for (const rep of patchResult.replacements.slice(0, 5)) {
    // Revert the replacement to simulate specialist damage
    if (damagedText.includes(rep.replace)) {
      damagedText = damagedText.replace(rep.replace, rep.find);
      undone.push({ term: rep.termEn, original: rep.replace, reverted: rep.find });
    }
  }
  console.log(`Simulated ${undone.length} terms undone by specialist:`);
  for (const u of undone) {
    console.log(`  "${u.original}" → "${u.reverted}" (reverted ${u.term})`);
  }

  const damagedCompliance = checkCompliance(sourceText, damagedText, langProfile.glossary);
  console.log(`Compliance after damage: ${damagedCompliance.pct.toFixed(1)}%`);
  console.log("");

  // Step 4: Run glossary guard
  console.log("Running glossary guard...");
  let guardedText = damagedText;
  let recovered = 0;

  for (const rep of patchResult.replacements) {
    if (!guardedText.toLowerCase().includes(rep.replace.toLowerCase())) {
      const escaped = rep.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const before = guardedText;
      guardedText = guardedText.replace(regex, rep.replace);
      if (guardedText !== before) recovered++;
    }
  }

  const guardedCompliance = checkCompliance(sourceText, guardedText, langProfile.glossary);
  console.log(`Guard recovered: ${recovered} terms`);
  console.log(`Compliance after guard: ${guardedCompliance.pct.toFixed(1)}%`);
  console.log("");

  // Step 5: Score all three versions
  console.log("Scoring all versions...");

  console.log("\n--- Baseline (cached translation) ---");
  const sc1 = await scoreTranslation(sourceText, cachedText, profile, config.language);
  console.log(scorecardSummary(sc1));

  console.log("\n--- After patcher ---");
  const sc2 = await scoreTranslation(sourceText, patchResult.correctedText, profile, config.language);
  console.log(scorecardSummary(sc2));

  console.log("\n--- After damage + guard ---");
  const sc3 = await scoreTranslation(sourceText, guardedText, profile, config.language);
  console.log(scorecardSummary(sc3));

  console.log("\n=== SUMMARY ===");
  console.log(`Baseline:      ${sc1.aggregateScore.toFixed(1)} (${13 - sc1.failedMetrics.length}/13 pass)`);
  console.log(`After patcher: ${sc2.aggregateScore.toFixed(1)} (${13 - sc2.failedMetrics.length}/13 pass)`);
  console.log(`Damage+guard:  ${sc3.aggregateScore.toFixed(1)} (${13 - sc3.failedMetrics.length}/13 pass)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
