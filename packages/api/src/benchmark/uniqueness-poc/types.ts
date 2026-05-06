/**
 * Shared types for the uniqueness proof-of-concept harness.
 *
 * This is NOT production code — it is a deliberately minimal implementation
 * of the architectural pattern described in:
 *   - docs/specs/2026-04-07-content-pipeline.md (two-layer generation)
 *   - docs/specs/2026-04-07-content-uniqueness.md (uniqueness gate)
 *
 * Goal: prove that one shared core analysis + N identity adapters produces
 * genuinely different content across identities, with measurable similarity
 * scores below the uniqueness gate's cross-tenant thresholds.
 */

import { z } from "zod";

// ─── Run Manifest ──────────────────────────────────────────────────
// Captures the exact setup/configuration of every PoC run so results
// can be compared, reproduced, and grouped by the cross-run comparator.
// Spec: docs/specs/2026-04-13-run-manifest.md

export const RunManifestSchema = z.object({
  version: z.literal(1),
  timestamp: z.string(),
  gitCommitHash: z.string().nullable(),
  source: z.enum(["cli", "dashboard"]),
  runtime: z.object({
    name: z.string(),
    version: z.string(),
  }),
  memoryBackend: z.enum([
    "editorial-memory-postgres",
    "editorial-memory-inmemory",
    "narrative-state",
    "none",
  ]),
  editorialMemoryState: z
    .object({ articleCountByTenant: z.record(z.string(), z.number()) })
    .nullable(),
  stagesEnabled: z.object({
    stage1: z.literal(true),
    stage2: z.literal(true),
    stage3: z.literal(true),
    stage4: z.boolean(),
    stage5: z.boolean(),
    stage6: z.boolean(),
    stage7: z.boolean(),
  }),
  cliFlags: z.array(z.string()),
  fixtureId: z.string(),
  eventIds: z.array(z.string()),
  personaIds: z.array(z.string()),
  identityIds: z.array(z.string()),
  sequenceId: z.string().nullable(),
  sequenceStep: z.number().nullable(),
  sequenceStepCount: z.number().nullable(),
  /** Short hash (first 8 chars of SHA-256) of each identity's system prompt at run time. */
  promptHashes: z.record(z.string(), z.string()).nullable(),
  /**
   * Reproducibility receipt — Wave M (audit §5.1, §4.1.4 Tier 1).
   *
   * Captures the full set of inputs that determine a run's output so future
   * waves can detect drift between the historical baseline and a fresh
   * re-execution under the current run's configuration.
   *
   * Optional for backward compatibility: existing `raw-data.json` files written
   * before Wave M ship without this block; consumers should treat absence as
   * "pre-Wave-M" (no receipt available) rather than as a hard error.
   *
   * - `models`: pinned model identifiers per call site (resolved at call time)
   * - `promptVersions`: judge prompt has a hand-bumped semver; FA / identities /
   *   conformance carry full SHA-256 hashes of their system prompts; the legacy
   *   8-char `promptHashes` field above continues to render for backward compat
   * - `fixtureHash`: SHA-256 of the JSON-stringified, key-sorted fixture object
   *   (canonical-form digest — robust to whitespace / formatting differences)
   * - `packageHash`: SHA-256 of the lockfile bytes (`bun.lockb` / `bun.lock` /
   *   `package-lock.json` / `pnpm-lock.yaml`); `null` if no lockfile resolves
   * - `temperatureOverrides`: any non-default temperature applied at call sites
   *   keyed by call-site label (e.g. `{ judge: 0.0 }`); empty object when none
   */
  reproducibility: z
    .object({
      models: z.object({
        fa: z.string(),
        identity: z.string(),
        judge: z.string(),
        embedding: z.string(),
        conformance: z.string(),
      }),
      promptVersions: z.object({
        judge: z.string(),
        judgeHash: z.string(),
        fa: z.string(),
        identities: z.record(z.string(), z.string()),
        conformance: z.string().nullable(),
      }),
      fixtureHash: z.string(),
      packageHash: z.string().nullable(),
      temperatureOverrides: z.record(z.string(), z.number()),
    })
    .optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

export interface NewsEvent {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  body: string;
  /** The market/topic the analysis should focus on. */
  topicId: string;
  topicName: string;
  /** Optional grounding for the FA agent (would come from instrument catalog in prod). */
  topicContext: string;
}

/**
 * An ordered list of related events sharing the same topic. Consumed by the
 * `poc:uniqueness:sequence` CLI mode, which walks the steps in order,
 * persisting narrative state between them, so Stage 7 on the final step can
 * be driven against accumulated multi-event history rather than a single
 * in-memory prior piece.
 *
 * Spec: docs/specs/2026-04-08-narrative-state-persistence.md §8.
 */
export interface EventSequence {
  /** Stable id, also used as the fixtureId in the store path. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** The topic key persisted into the store for every step. Required. */
  topicId: string;
  /** Ordered list of events. Length must be ≥ 2. */
  steps: NewsEvent[];
}

import type { AngleTag, PersonalityTag } from "./tags.js";

export interface ContentPersona {
  id: string;
  name: string;
  brandVoice: string;
  audienceProfile: string;
  ctaPolicy: "always" | "when-relevant" | "never";
  ctaLibrary: Array<{ id: string; text: string }>;
  forbiddenClaims: string[];
  regionalVariant: string;
  brandPositioning: string;
  jurisdictions: string[];

  /**
   * Company background facts the writer can weave into content for
   * authentic differentiation. These are NOT style rules — they're
   * material: founding story, team size, market presence, sponsorships,
   * proprietary tools, community stats, track record claims.
   *
   * Examples:
   *   - "Founded in 1994, 300+ employees across London, Zurich, and Singapore"
   *   - "Official analytics partner of Arsenal FC since 2021"
   *   - "Proprietary RiskGuard™ engine processes 2M+ data points daily"
   *
   * The identity agent and Style & Voice specialist receive these as
   * available context — they're encouraged to reference them naturally
   * where relevant, but not forced to use every one in every piece.
   * This drives divergence by construction: two companies' facts can
   * never converge the way two tone adjustments can.
   */
  companyBackground?: string[];

  /**
   * Onboarding-time analytical-angle preferences, ranked.
   * The first tag is the primary lens; later tags are fallbacks if the
   * first does not fit a specific event. See tags.ts for the full taxonomy.
   */
  preferredAngles: AngleTag[];

  /**
   * Onboarding-time personality / temperament tags, ranked.
   * These tell the writer HOW to write — editorial stance, tone, density,
   * confidence posture. Orthogonal to angles. See tags.ts for the taxonomy.
   */
  personalityTags: PersonalityTag[];

  /**
   * Structural variant resolution order:
   * `customStructuralTemplate` (if set) > pre-built variant lookup by
   * `structuralVariant` > default (variant 1, the legacy template).
   * Both fields are optional; when both are undefined the identity uses
   * variant 1 unchanged, preserving existing behavior.
   */
  structuralVariant?: StructuralVariantId;
  customStructuralTemplate?: string;
}

export type StructuralVariantId = 1 | 2 | 3;

export interface IdentityDefinition {
  id: string;
  name: string;
  shortDescription: string;
  systemPrompt: string;
  /** Default model tier. PoC uses Sonnet for identity calls. */
  modelTier: "opus" | "sonnet" | "haiku";
  /** Target word count for self-validation in the report. */
  targetWordCount: { min: number; target: number; max: number };
}

export interface CoreAnalysis {
  body: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
}

export interface IdentityOutput {
  identityId: string;
  identityName: string;
  body: string;
  wordCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
  /** Set when this output was produced under a specific persona overlay (stage 5). */
  personaId?: string;
  /**
   * Structural variant used to render this output. Populated on Stage 5
   * and Stage 6 calls (anywhere a persona is threaded) from
   * `persona?.structuralVariant ?? 1`. Omitted when no persona is
   * present (Stage 2 `runAllIdentities`) — documented behavior, not
   * silent: downstream readers treat omission as "variant 1 / baseline".
   * See `docs/specs/2026-04-16-structural-variants.md` §6.10-6.11.
   */
  structuralVariant?: StructuralVariantId;
}

export type SimilarityStatus = "pass" | "borderline-cross-tenant" | "fail-cross-tenant";

/**
 * Two-axis judge verdict, populated on cross-tenant pairs by `llm-judge.ts`.
 *
 * - Factual fidelity: agreement on shared facts (levels, probabilities, direction,
 *   anchors). Target ≥ 0.9. Low = fabrication risk, not uniqueness win.
 * - Presentation similarity: how alike the prose reads (voice, structure, lead).
 *   Target < 0.5. Shared facts explicitly excluded from this axis.
 * - Trinary verdict gates the pipeline (distinct → pass, reskinned → fail,
 *   fabrication_risk → halt).
 *
 * See `llm-judge.ts` top-of-file comment for the full rubric rationale.
 */
export interface FactualDivergenceRecord {
  kind:
    | "level"
    | "probability"
    | "direction"
    | "stop"
    | "confidence"
    | "historical_anchor"
    | "transmission_chain_set"
    | "conclusion"
    | "other";
  docA: string;
  docB: string;
}

export type TrinaryUniquenessVerdict =
  | "distinct_products"
  | "reskinned_same_article"
  | "fabrication_risk";

export interface SimilarityResult {
  pairId: string;
  identityA: string;
  identityB: string;
  /** Cosine similarity in [0, 1]. Higher = more similar. */
  cosineSimilarity: number;
  /** ROUGE-L F1 in [0, 1]. Higher = more n-gram overlap. */
  rougeL: number;
  status: SimilarityStatus;

  /**
   * Two-axis judge fields. Populated on every cross-tenant pair by
   * `judgePairUniqueness` in `llm-judge.ts`.
   */
  judgeFactualFidelity?: number;
  judgeFactualFidelityReasoning?: string;
  judgeFactualDivergences?: FactualDivergenceRecord[];
  judgePresentationSimilarity?: number;
  judgePresentationSimilarityReasoning?: string;
  judgeTrinaryVerdict?: TrinaryUniquenessVerdict;
  /**
   * The judge model's own returned verdict BEFORE the `HARD_RULE_KINDS`
   * override (see llm-judge.ts). Persisted on the SimilarityResult so the
   * Wave M two-column verdict surface (judge raw vs post-override) on
   * report.md can render without re-calling the judge. Optional for
   * backward compatibility with raw-data.json files written before WM5.
   */
  judgeRawVerdict?: TrinaryUniquenessVerdict;
  /**
   * True when the hard-rule override fired and flipped the verdict to
   * `fabrication_risk`. Surfaced on the two-column report row so readers
   * see at a glance how often the override mattered. Optional; WM5 onward.
   */
  judgeHardRuleFired?: boolean;
  judgeCostUsd?: number;

  /**
   * Legacy single-axis fields — present only in historical raw-data.json
   * files from runs before 2026-04-08. The production judge no longer
   * populates them. Kept on the type so `rescore.ts` can read old runs.
   */
  judgeVerdict?: "unique" | "duplicate";
  judgeReasoning?: string;
}

export interface ReproducibilityResult {
  identityId: string;
  runs: Array<{ body: string; wordCount: number }>;
  pairwiseCosineMean: number;
  pairwiseCosineMin: number;
  pairwiseCosineMax: number;
}

export interface PersonaDifferentiationResult {
  identityId: string;
  personaA: ContentPersona;
  personaB: ContentPersona;
  outputA: IdentityOutput;
  outputB: IdentityOutput;
  cosineSimilarity: number;
  rougeL: number;
  /** True = personas produced meaningfully different outputs. */
  differentiated: boolean;
}

/**
 * Structured narrative state extracted from a previously-published piece.
 * Used as "writer memory" for the same persona's future coverage of the same topic.
 */
export interface NarrativeStateEntry {
  pieceId: string;
  publishedAt: string;
  oneSentenceSummary: string;
  directionalView: "bullish" | "bearish" | "neutral" | "mixed";
  directionalViewConfidence: "low" | "moderate" | "high";
  keyThesisStatements: string[];
  keyLevelsMentioned: string[];
  callsToActionUsed: string[];
  /** Token usage for the extraction call. */
  extractionInputTokens: number;
  extractionOutputTokens: number;
  extractionCostUsd: number;
}

/**
 * The accumulated narrative state for one (tenant, topic) pair. In production
 * this would persist across runs and grow over time. In the PoC we build a
 * fresh one from a single prior piece.
 */
export interface TenantTopicNarrativeState {
  tenantId: string;
  topicId: string;
  recentEntries: NarrativeStateEntry[];
  currentHouseView: "bullish" | "bearish" | "neutral" | "mixed";
  currentHouseViewConfidence: "low" | "moderate" | "high";
  lastUpdatedAt: string;
}

/**
 * Stage 7 — the temporal narrative continuity test.
 *
 * Tests whether per-client narrative memory produces additional cross-tenant
 * differentiation on top of the static persona+tag layers. Mechanism:
 *
 *   1. Take Stage 6's outputs (one journalist piece per persona on event A).
 *   2. Extract structured NarrativeStateEntry from each via a Haiku call.
 *   3. Run a SECOND core analysis on event B (a continuation of event A).
 *   4. For each persona, generate a journalist piece on event B TWICE:
 *        - CONTROL:   no narrative state injected
 *        - TREATMENT: persona's narrative state from event A injected
 *   5. Build pairwise cross-tenant matrices for both groups.
 *   6. Compare the cosine distributions: does the narrative-state group
 *      show meaningfully lower cross-tenant similarity than the control?
 *
 * If yes → temporal continuity is a real differentiation layer that compounds
 * over time as each client's narrative thread accumulates.
 */
export interface NarrativeStateTestResult {
  identityId: string;
  identityName: string;
  /** The second event used for the test. */
  secondEvent: NewsEvent;
  /** The second core analysis run on the second event. */
  secondCoreAnalysis: CoreAnalysis;
  /** Per-persona narrative state extracted from Stage 6 outputs. */
  narrativeStates: Array<{
    personaId: string;
    personaName: string;
    state: TenantTopicNarrativeState;
  }>;
  /** Control group: 4 outputs without narrative state, on the second event. */
  controlOutputs: IdentityOutput[];
  controlSimilarities: SimilarityResult[];
  controlMeanCosine: number;
  controlMeanRougeL: number;
  /** Treatment group: 4 outputs WITH narrative state, on the second event. */
  treatmentOutputs: IdentityOutput[];
  treatmentSimilarities: SimilarityResult[];
  treatmentMeanCosine: number;
  treatmentMeanRougeL: number;
  /** The differential — what narrative state buys us. */
  cosineImprovement: number;     // control - treatment (positive = treatment is more unique)
  rougeLImprovement: number;
  /** Verdict against cross-tenant thresholds for the treatment group. */
  treatmentVerdict: "PASS" | "BORDERLINE" | "FAIL";
  treatmentVerdictReasoning: string;
}

/**
 * Stage 6 — the **load-bearing cross-tenant test**.
 *
 * Pick ONE identity. Run it with N personas (different brokers) on the SAME
 * core analysis. Build the pairwise matrix. Apply STRICT cross-tenant
 * thresholds (cosine 0.80, ROUGE-L 0.40 — the SEO + product-perception bar).
 *
 * This is the test that directly validates the architecture's load-bearing
 * claim: that the persona overlay layer produces meaningful differentiation
 * between two brokers picking the same identity on the same event.
 *
 * Stage 5 (PersonaDifferentiationResult) tests this with N=2 (one pair).
 * Stage 6 expands it to N≥3 personas (≥3 pairs) so we can characterize the
 * actual *distribution* of cross-tenant similarity, not just one anecdotal
 * pair.
 */
/**
 * Record of a judge pair that failed all retry attempts and was skipped.
 *
 * Surfaced on `CrossTenantMatrixResult.judgeFailures` and `RunResult.
 * judgeFailures` so the raw-data.json + analyze-uniqueness-run skill can
 * see skipped pairs at a glance — previously these were logged only to
 * stdout, producing run artifacts that "looked complete" when a
 * persistent auth error or rate limit was silently dropping verdicts.
 */
export interface JudgeFailureRecord {
  /** Pair id the judge was called on (`${i}_${idA}__${j}_${idB}` format). */
  pairId: string;
  /** Stage the failure happened in. `intra-tenant` = Stage 3.5, `cross-tenant` = Stage 6, `narrative-state` = Stage 7. */
  stage: "intra-tenant" | "cross-tenant" | "narrative-state";
  /** Error class name (e.g. `ZodError`, `APIError`, `Error`). */
  errorName: string;
  /** Error message, truncated to 300 chars. */
  errorMessage: string;
  /** ISO timestamp when the failure was recorded. */
  timestamp: string;
}

export interface CrossTenantMatrixResult {
  identityId: string;
  identityName: string;
  personas: ContentPersona[];
  outputs: IdentityOutput[];
  similarities: SimilarityResult[];
  /** Distribution stats over the pairwise cosine values. */
  meanCosine: number;
  minCosine: number;
  maxCosine: number;
  /** Distribution stats over the pairwise ROUGE-L values. */
  meanRougeL: number;
  minRougeL: number;
  maxRougeL: number;
  /** Cross-tenant verdict (PASS/BORDERLINE/FAIL) for this matrix. */
  verdict: "PASS" | "BORDERLINE" | "FAIL";
  verdictReasoning: string;
  /**
   * Pairs where `judgePairUniqueness` threw after all retries and the
   * runner had to skip the pair. Empty array means the judge ran cleanly
   * on every pair. Non-empty means the aggregate stats and verdict were
   * computed over a subset — consumers should surface a warning.
   */
  judgeFailures: JudgeFailureRecord[];
  /** Cost of the optional conformance pass (0 when not enabled). */
  conformanceCostUsd?: number;
  /**
   * Per-output conformance pass details — reasoning, changed flag, token
   * usage. Present only when the conformance pass ran successfully.
   * Indexed in the same order as `outputs` and `personas`.
   */
  conformanceDetails?: ConformanceDetail[];
}

/**
 * Per-output conformance pass result, persisted alongside the cross-tenant
 * matrix so the pipeline inspector can show what changed and why.
 */
export interface ConformanceDetail {
  personaId: string;
  personaName: string;
  /** Whether the conformance specialist actually modified the text. */
  changed: boolean;
  /** The specialist's reasoning for what it changed (or why it didn't). */
  reasoning: string;
  /** Token usage from the specialist call. */
  inputTokens: number;
  outputTokens: number;
  /** Cost of this individual conformance call. */
  costUsd: number;
  /** The body BEFORE the conformance pass (only when changed=true, to enable diffing). */
  preConformanceBody?: string;
}

/**
 * One sampled pair's Tier 2 inter-rater record (WM6, audit §4.3.4 Tier 2 /
 * §5.5). Both verdicts are pre-override / post-override pairs; agreement is
 * computed on the post-override gate verdict because that's what the
 * pipeline actually consumes.
 */
export interface Tier2PairRecord {
  pairId: string;
  /** Original-order verdict (post-override, the pipeline-consumed one). */
  rawVerdict: TrinaryUniquenessVerdict;
  /** Swapped-order verdict (post-override). */
  swappedVerdict: TrinaryUniquenessVerdict;
  /** True iff the two verdicts match — feeds the agreement rate. */
  agree: boolean;
  /** Cost of the swapped re-judge call (the original was paid by Stage 6). */
  swapCostUsd: number;
}

/**
 * Tier 2 (WM6) — judge-reliability sampling. Per audit §4.3.4 Tier 2 / §5.5,
 * 20% of cross-tenant pairs (≥3 whichever larger) are re-judged with A/B
 * order swapped. If disagreement on the gate metric exceeds 15%, the wave
 * is flagged as judge-unreliable. The flag is informational — it does NOT
 * short-circuit the run or change the cross-tenant verdict.
 */
export interface Tier2InterRaterResult {
  /** Per-pair records. */
  pairs: Tier2PairRecord[];
  /** Number of pairs sampled (= pairs.length, surfaced for ergonomics). */
  sampledPairCount: number;
  /** Total cross-tenant pair count from which the sample was drawn. */
  totalCrossTenantPairs: number;
  /** Fraction of sampled pairs whose raw and swapped verdicts agree. */
  agreementRate: number;
  /** True when (1 − agreementRate) > 0.15. */
  judgeUnreliableFlag: boolean;
  /** Total cost of the Tier 2 swapped re-judge calls. */
  totalCostUsd: number;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Run configuration snapshot — see docs/specs/2026-04-13-run-manifest.md. */
  manifest: RunManifest;
  event: NewsEvent;
  coreAnalysis: CoreAnalysis;
  identityOutputs: IdentityOutput[];
  similarities: SimilarityResult[];
  reproducibility?: ReproducibilityResult;
  personaDifferentiation?: PersonaDifferentiationResult;
  /** Stage 6 — the load-bearing cross-tenant matrix test. */
  crossTenantMatrix?: CrossTenantMatrixResult;
  /** Stage 7 — temporal narrative continuity test. */
  narrativeStateTest?: NarrativeStateTestResult;
  totalCostUsd: number;
  totalDurationMs: number;
  /** Intra-tenant cross-identity verdict (the original matrix). */
  verdict: "PASS" | "BORDERLINE" | "FAIL";
  verdictReasoning: string;
  /**
   * Run-level rollup of every judge pair that was skipped due to persistent
   * failures (after all retries). Aggregated from Stage 3.5 (intra-tenant),
   * Stage 6 (cross-tenant), and Stage 7 (narrative-state) judge passes.
   * Empty array means every judge call succeeded. Non-empty means the
   * aggregate metrics in the result are computed over a subset — treat
   * with caution.
   */
  judgeFailures: JudgeFailureRecord[];
  /**
   * Tier 2 inter-rater check (WM6, audit §4.3.4 Tier 2 / §5.5). Optional —
   * present only when the cross-tenant matrix ran AND the runner sampled
   * 20% of pairs for position-swap re-judging. Renders into the inter-rater
   * section of report.md and the writeup template's `{{TIER2_INTER_RATER_BLOCK}}`.
   */
  tier2?: Tier2InterRaterResult;
}

/**
 * Thresholds copied from docs/specs/2026-04-07-content-uniqueness.md §6.
 * These are the v1 first-pass values that the spec says will be tuned in
 * production via shadow-mode rollout.
 */
export const UNIQUENESS_THRESHOLDS = {
  crossTenant: {
    cosine: 0.80,
    cosineBorderlineMargin: 0.05,
    rougeL: 0.4,
  },
  intraTenant: {
    cosine: 0.92,
    cosineBorderlineMargin: 0.03,
    rougeL: 0.5,
  },
} as const;
