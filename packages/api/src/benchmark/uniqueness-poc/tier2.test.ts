/**
 * Unit tests for the WM6 Tier 2 inter-rater verdict logic.
 *
 * Run with: `bun test src/benchmark/uniqueness-poc/tier2.test.ts` from
 * packages/api/.
 *
 * Covers:
 *   - `computeTier2Verdict` flips `judgeUnreliableFlag` correctly around
 *     the audit §4.3.4 Tier 2 disagreement threshold (1 − agreementRate
 *     > 0.15 ⇒ flag = true).
 *   - The report.md rendering surfaces the banner when the flag is set
 *     and the success banner when agreement ≥ 85%.
 */

import { describe, expect, test } from "bun:test";

import { computeTier2Verdict } from "./runner.js";
import { renderReport } from "./report.js";
import type { RunResult, Tier2PairRecord } from "./types.js";

// ───────────────────────────────────────────────────────────────────
// computeTier2Verdict
// ───────────────────────────────────────────────────────────────────

describe("computeTier2Verdict", () => {
  test("agreementRate >= 0.85 → judgeUnreliableFlag is false", () => {
    const result = computeTier2Verdict({
      pairs: [],
      sampledPairCount: 5,
      totalCrossTenantPairs: 24,
      agreementRate: 0.85,
      totalCostUsd: 0.04,
    });
    expect(result.judgeUnreliableFlag).toBe(false);
    expect(result.agreementRate).toBe(0.85);
    expect(result.totalCostUsd).toBe(0.04);
  });

  test("agreementRate < 0.85 → judgeUnreliableFlag is true (the audit's >15% disagreement gate)", () => {
    const result = computeTier2Verdict({
      pairs: [],
      sampledPairCount: 5,
      totalCrossTenantPairs: 24,
      agreementRate: 0.7,
      totalCostUsd: 0.04,
    });
    expect(result.judgeUnreliableFlag).toBe(true);
  });

  test("agreementRate exactly at 0.85 boundary is acceptable (not flagged)", () => {
    // Disagreement = 0.15 EXACTLY; the audit says "> 15%" so equal-to is fine.
    const result = computeTier2Verdict({
      pairs: [],
      sampledPairCount: 4,
      totalCrossTenantPairs: 20,
      agreementRate: 0.85,
      totalCostUsd: 0.03,
    });
    expect(result.judgeUnreliableFlag).toBe(false);
  });

  test("perfect agreement is not flagged", () => {
    const result = computeTier2Verdict({
      pairs: [],
      sampledPairCount: 6,
      totalCrossTenantPairs: 30,
      agreementRate: 1.0,
      totalCostUsd: 0.05,
    });
    expect(result.judgeUnreliableFlag).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// report.md rendering — banners
// ───────────────────────────────────────────────────────────────────

/** Shape just enough of a RunResult for renderReport to walk through it. */
function makeMinimalRunResult(args: {
  agreementRate: number;
  judgeUnreliableFlag: boolean;
}): RunResult {
  const samplePair: Tier2PairRecord = {
    pairId: "0_a__1_b",
    rawVerdict: "distinct_products",
    swappedVerdict: args.agreementRate >= 1 ? "distinct_products" : "reskinned_same_article",
    agree: args.agreementRate >= 1,
    swapCostUsd: 0.005,
  };

  return {
    runId: "test-run",
    startedAt: "2026-05-06T00:00:00.000Z",
    finishedAt: "2026-05-06T00:01:00.000Z",
    manifest: {
      version: 1,
      timestamp: "2026-05-06T00:00:00.000Z",
      gitCommitHash: null,
      source: "cli",
      runtime: { name: "bun", version: "1.0.0" },
      memoryBackend: "none",
      editorialMemoryState: null,
      stagesEnabled: { stage1: true, stage2: true, stage3: true, stage4: false, stage5: false, stage6: true, stage7: false },
      cliFlags: [],
      fixtureId: "test",
      eventIds: ["test-event"],
      personaIds: ["broker-a", "broker-b"],
      identityIds: ["in-house-journalist"],
      sequenceId: null,
      sequenceStep: null,
      sequenceStepCount: null,
      promptHashes: null,
    },
    event: {
      id: "test-event",
      title: "Test Event",
      source: "test",
      publishedAt: "2026-05-06T00:00:00.000Z",
      body: "Test body",
      topicId: "test-topic",
      topicName: "Test Topic",
      topicContext: "test context",
    },
    coreAnalysis: {
      body: "core",
      model: "claude-opus-4-6",
      inputTokens: 100,
      outputTokens: 100,
      durationMs: 1000,
      costUsd: 0.01,
    },
    identityOutputs: [
      {
        identityId: "in-house-journalist",
        identityName: "In-House Journalist",
        body: "alpha",
        wordCount: 1,
        model: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 100,
        durationMs: 1000,
        costUsd: 0.005,
      },
      {
        identityId: "in-house-journalist",
        identityName: "In-House Journalist",
        body: "beta",
        wordCount: 1,
        model: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 100,
        durationMs: 1000,
        costUsd: 0.005,
      },
    ],
    similarities: [],
    crossTenantMatrix: {
      identityId: "in-house-journalist",
      identityName: "In-House Journalist",
      personas: [
        { id: "broker-a", name: "Broker A", brandVoice: "v", audienceProfile: "a", ctaPolicy: "never", ctaLibrary: [], forbiddenClaims: [], regionalVariant: "uk", brandPositioning: "p", jurisdictions: [], preferredAngles: [], personalityTags: [] },
        { id: "broker-b", name: "Broker B", brandVoice: "v", audienceProfile: "a", ctaPolicy: "never", ctaLibrary: [], forbiddenClaims: [], regionalVariant: "uk", brandPositioning: "p", jurisdictions: [], preferredAngles: [], personalityTags: [] },
      ],
      outputs: [
        { identityId: "in-house-journalist", identityName: "In-House Journalist", personaId: "broker-a", body: "alpha", wordCount: 1, model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 100, durationMs: 1000, costUsd: 0.005 },
        { identityId: "in-house-journalist", identityName: "In-House Journalist", personaId: "broker-b", body: "beta", wordCount: 1, model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 100, durationMs: 1000, costUsd: 0.005 },
      ],
      similarities: [
        {
          pairId: "0_broker-a__1_broker-b",
          identityA: "broker-a",
          identityB: "broker-b",
          cosineSimilarity: 0.5,
          rougeL: 0.3,
          status: "pass",
          judgeFactualFidelity: 0.95,
          judgePresentationSimilarity: 0.3,
          judgeTrinaryVerdict: "distinct_products",
        },
      ],
      meanCosine: 0.5,
      minCosine: 0.5,
      maxCosine: 0.5,
      meanRougeL: 0.3,
      minRougeL: 0.3,
      maxRougeL: 0.3,
      verdict: "PASS",
      verdictReasoning: "test pass",
      judgeFailures: [],
    },
    totalCostUsd: 0.025,
    totalDurationMs: 60000,
    verdict: "PASS",
    verdictReasoning: "test pass",
    judgeFailures: [],
    tier2: {
      pairs: [samplePair],
      sampledPairCount: 1,
      totalCrossTenantPairs: 1,
      agreementRate: args.agreementRate,
      judgeUnreliableFlag: args.judgeUnreliableFlag,
      totalCostUsd: 0.005,
    },
  };
}

describe("renderReport — Tier 2 banners", () => {
  test("agreementRate=1.0 (no unreliable flag) renders the success banner", () => {
    const r = makeMinimalRunResult({ agreementRate: 1.0, judgeUnreliableFlag: false });
    const md = renderReport(r);
    expect(md).toContain("Inter-rater check (Tier 2");
    expect(md).toContain("Judge agreement above 85%");
    expect(md).not.toContain("Wave flagged as judge-unreliable");
  });

  test("agreementRate=0.7 (unreliable flag) renders the alarm banner", () => {
    const r = makeMinimalRunResult({ agreementRate: 0.7, judgeUnreliableFlag: true });
    const md = renderReport(r);
    expect(md).toContain("Inter-rater check (Tier 2");
    expect(md).toContain("Wave flagged as judge-unreliable");
    expect(md).not.toContain("Judge agreement above 85%");
  });
});
