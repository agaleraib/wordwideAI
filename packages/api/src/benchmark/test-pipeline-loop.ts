/**
 * Pipeline Loop PoC — live A/B comparison.
 *
 * Runs the same translation through:
 *   A) Current specialist pipeline (FINFLOW_PIPELINE_LOOP=0)
 *   B) Advisor loop pipeline (FINFLOW_PIPELINE_LOOP=1)
 *
 * Compares: final scores, cost, latency, output text.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... bun run src/benchmark/test-pipeline-loop.ts
 */

import { InMemoryProfileStore, InMemoryTranslationStore } from "../lib/store.js";
import { runTranslationEngine } from "../pipeline/translation-engine.js";
import type { ClientProfileData } from "../lib/types.js";

// --- Test profile ---

const TEST_PROFILE: ClientProfileData = {
  clientId: "test-broker",
  clientName: "Test Broker",
  sourceLanguage: "en",
  languages: {
    es: {
      regionalVariant: "es-ES",
      glossary: {
        "interest rates": "tipos de interés",
        "Federal Reserve": "Reserva Federal",
        inflation: "inflación",
        "monetary policy": "política monetaria",
        "central bank": "banco central",
        "borrowing costs": "costes de endeudamiento",
        policymakers: "responsables políticos",
        "rate cut": "recorte de tipos",
      },
      forbiddenTerms: ["tasa de interés", "fed"],
      tone: {
        formalityLevel: 4,
        description: "Professional financial reporting, formal but accessible",
        avgSentenceLength: 22,
        sentenceLengthStddev: 5,
        personPreference: "third",
        hedgingFrequency: "moderate",
      },
      brandRules: [
        "Use 'tipos de interés' not 'tasas de interés'",
        "Refer to Fed chair by surname only after first mention",
      ],
      compliancePatterns: [],
      scoring: {
        metricThresholds: {
          glossary_compliance: 90,
          term_consistency: 85,
          untranslated_terms: 90,
          formality: 80,
          sentence_length: 75,
          brand_voice: 80,
          numerical_accuracy: 95,
          formatting_preservation: 90,
          paragraph_alignment: 85,
          fluency: 80,
          meaning_preservation: 85,
          regional_variant: 85,
          overall_readability: 80,
        },
        aggregateThreshold: 82,
        metricWeights: {},
        maxRevisionAttempts: 2,
      },
    },
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SOURCE_TEXT = `The Federal Reserve held interest rates steady at 5.25-5.50% on Wednesday,
signaling that policymakers need more evidence inflation is cooling before they cut borrowing costs.
Chair Jerome Powell said the central bank is "not yet at a point" where it can begin easing monetary policy,
though he acknowledged recent data has been encouraging. Markets had priced in a June cut,
but Powell's remarks pushed expectations to September. The decision was unanimous among the 12 voting members.
Treasury yields rose sharply after the announcement, with the 10-year note climbing to 4.68%,
its highest level since November. The dollar index gained 0.4% against a basket of major currencies.`;

// --- Runner ---

interface PipelineRun {
  label: string;
  passed: boolean;
  aggregateScore: number;
  revisionRounds: number;
  hitl: boolean;
  durationMs: number;
  translatedText: string;
  auditSummary: string;
}

async function runPipeline(label: string, useLoop: boolean): Promise<PipelineRun> {
  const profileStore = new InMemoryProfileStore();
  const translationStore = new InMemoryTranslationStore();
  await profileStore.save(TEST_PROFILE);

  process.env.FINFLOW_PIPELINE_LOOP = useLoop ? "1" : "0";

  console.log(`\nRunning: ${label}...`);
  const start = Date.now();

  const result = await runTranslationEngine(
    SOURCE_TEXT,
    "test-broker",
    "es",
    { profileStore, translationStore },
  );

  const durationMs = Date.now() - start;

  // Summarize audit trail
  const auditLines = result.auditTrail.map(
    (a: { stage: string; agent: string; durationMs?: number; tokens?: { input: number; output: number } }) => `  [${a.stage}] ${a.agent} — ${a.durationMs ?? 0}ms${a.tokens ? ` (${a.tokens.input}in/${a.tokens.output}out)` : ""}`,
  );

  return {
    label,
    passed: result.passed,
    aggregateScore: result.scorecard.aggregateScore,
    revisionRounds: result.revisionCount,
    hitl: result.escalatedToHitl,
    durationMs,
    translatedText: result.translatedText,
    auditSummary: auditLines.join("\n"),
  };
}

// --- Main ---

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Pipeline Loop PoC — Live A/B Comparison");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`API key: ${process.env.ANTHROPIC_API_KEY ? "set" : "MISSING"}`);

  // A) Current specialist pipeline
  const currentResult = await runPipeline("Current (specialists)", false);

  // B) Advisor loop pipeline
  const loopResult = await runPipeline("Advisor Loop (Sonnet)", true);

  // Print results
  for (const r of [currentResult, loopResult]) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${r.label}`);
    console.log("─".repeat(60));
    console.log(`  Passed:     ${r.passed}`);
    console.log(`  Score:      ${r.aggregateScore.toFixed(1)}`);
    console.log(`  Rounds:     ${r.revisionRounds}`);
    console.log(`  HITL:       ${r.hitl}`);
    console.log(`  Duration:   ${r.durationMs}ms`);
    console.log(`  Output:     ${r.translatedText.slice(0, 200)}...`);
    console.log(`  Audit:`);
    console.log(r.auditSummary);
  }

  // Comparison
  console.log(`\n${"═".repeat(60)}`);
  console.log("  COMPARISON");
  console.log("═".repeat(60));
  console.log(`  Score:    ${currentResult.aggregateScore.toFixed(1)} → ${loopResult.aggregateScore.toFixed(1)} (${loopResult.aggregateScore >= currentResult.aggregateScore ? "✓ same or better" : "⚠ regressed"})`);
  console.log(`  Duration: ${currentResult.durationMs}ms → ${loopResult.durationMs}ms (${Math.round(((currentResult.durationMs - loopResult.durationMs) / currentResult.durationMs) * 100)}% change)`);
  console.log(`  Rounds:   ${currentResult.revisionRounds} → ${loopResult.revisionRounds}`);
}

main().catch(console.error);
