/**
 * Orchestration for the uniqueness PoC.
 *
 * Stages:
 *   1. Core analysis      — one Opus call producing the FA piece
 *   2. Identity adaptation — N Sonnet calls in parallel
 *   3. Embeddings         — one OpenAI embedding call per output
 *   4. Pairwise similarity matrix
 *   5. Stage-3 LLM judge for borderline pairs
 *   6. Optional reproducibility test (same identity twice)
 *   7. Optional persona-overlay differentiation test
 */

import Anthropic from "@anthropic-ai/sdk";

import { callClaudeCli, isClaudeCliEnabled } from "../../lib/claude-cli.js";
import type {
  NewsEvent,
  CoreAnalysis,
  IdentityOutput,
  ContentPersona,
  SimilarityResult,
  ReproducibilityResult,
  PersonaDifferentiationResult,
  CrossTenantMatrixResult,
  NarrativeStateTestResult,
  TenantTopicNarrativeState,
  RunResult,
  SimilarityStatus,
  JudgeFailureRecord,
} from "./types.js";
import {
  buildNarrativeStateFromPriorOutput,
  extractNarrativeState,
} from "./narrative-state.js";
import {
  lookupPersonaState,
  type NarrativeStateStore,
} from "./narrative-state-store.js";
import { UNIQUENESS_THRESHOLDS } from "./types.js";
import { FA_AGENT_SYSTEM_PROMPT, buildFAAgentUserMessage } from "./prompts/fa-agent.js";
import { IDENTITY_REGISTRY, getIdentityById } from "./prompts/identities/index.js";
import { computeCostUsd, modelForTier } from "./pricing.js";
import { embedText, scorePair, cosineSimilarity, rougeLF1 } from "./similarity.js";
import { judgePairUniqueness, type JudgeVerdict } from "./llm-judge.js";

/**
 * Copy a two-axis judge verdict onto a SimilarityResult. Used at every
 * judge call site in this file so the field-population logic stays in one
 * place.
 */
function applyJudgeVerdict(sim: SimilarityResult, verdict: JudgeVerdict): void {
  sim.judgeFactualFidelity = verdict.factualFidelity;
  sim.judgeFactualFidelityReasoning = verdict.factualFidelityReasoning;
  sim.judgeFactualDivergences = verdict.factualDivergences;
  sim.judgePresentationSimilarity = verdict.presentationSimilarity;
  sim.judgePresentationSimilarityReasoning = verdict.presentationSimilarityReasoning;
  sim.judgeTrinaryVerdict = verdict.verdict;
  sim.judgeCostUsd = verdict.costUsd;
}

/**
 * Build a structured failure record for a judge call that gave up after
 * all retries. Used at every judge call site so persistent failures land
 * in `CrossTenantMatrixResult.judgeFailures` / `RunResult.judgeFailures`
 * rather than only stdout.
 */
function recordJudgeFailure(
  pairId: string,
  stage: JudgeFailureRecord["stage"],
  err: unknown,
): JudgeFailureRecord {
  const errorName =
    err instanceof Error ? err.constructor.name : typeof err;
  const errorMessage =
    err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
  return {
    pairId,
    stage,
    errorName,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

// ───────────────────────────────────────────────────────────────────
// Stage 1 — core analysis
// ───────────────────────────────────────────────────────────────────

export async function runCoreAnalysis(event: NewsEvent): Promise<CoreAnalysis> {
  const model = modelForTier("opus");
  const start = Date.now();
  const userMessage = buildFAAgentUserMessage(event);

  if (isClaudeCliEnabled()) {
    const cli = await callClaudeCli({
      model,
      systemPrompt: FA_AGENT_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 4096,
    });
    return {
      body: cli.text,
      model,
      inputTokens: cli.inputTokens,
      outputTokens: cli.outputTokens,
      durationMs: cli.durationMs,
      costUsd: computeCostUsd(model, cli.inputTokens, cli.outputTokens),
    };
  }

  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: FA_AGENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("FA agent did not return a text block");
  }

  return {
    body: textBlock.text,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - start,
    costUsd: computeCostUsd(model, response.usage.input_tokens, response.usage.output_tokens),
  };
}

// ───────────────────────────────────────────────────────────────────
// Stage 2 — identity adaptation
// ───────────────────────────────────────────────────────────────────

export async function runIdentity(
  identityId: string,
  coreAnalysisBody: string,
  persona?: ContentPersona,
  options?: {
    narrativeState?: TenantTopicNarrativeState;
    topicName?: string;
    /**
     * Optional hard word-count override (playground only). When provided,
     * a directive is appended to the user message instructing the writer
     * to hit this exact target instead of the identity's baked-in range.
     */
    targetWordCount?: number;
  },
): Promise<IdentityOutput> {
  const registered = getIdentityById(identityId);
  if (!registered) {
    throw new Error(`Unknown identity: ${identityId}`);
  }

  const model = modelForTier(registered.definition.modelTier);
  const start = Date.now();

  // The journalist builder accepts optional narrativeState/topicName via options.
  // Other identity builders ignore the third arg silently — call with options anyway.
  const userMessageBuilder = registered.buildUserMessage as (
    coreAnalysis: string,
    persona?: ContentPersona,
    options?: { narrativeState?: TenantTopicNarrativeState; topicName?: string },
  ) => string;

  let userMessage = userMessageBuilder(coreAnalysisBody, persona, options);
  if (options?.targetWordCount && options.targetWordCount > 0) {
    userMessage += `\n\n# WORD-COUNT OVERRIDE — HARD CONSTRAINT\n\nTarget word count: ${options.targetWordCount} words. This is a hard limit, not a guideline. It overrides any word count range specified in your system prompt. Allowed band: ±10%.`;
  }

  // Inject company background facts so the writer can reference them
  // naturally during generation (two shots: here at generation time,
  // and again in the conformance pass if enabled).
  if (persona?.companyBackground && persona.companyBackground.length > 0) {
    userMessage += `\n\n# COMPANY CONTEXT\n\nYou are writing for ${persona.name}. Weave these facts in naturally where they add credibility or context — do not force every fact into the piece:\n${persona.companyBackground.map((f) => `- ${f}`).join("\n")}`;
  }

  if (isClaudeCliEnabled()) {
    const cli = await callClaudeCli({
      model,
      systemPrompt: registered.definition.systemPrompt,
      userMessage,
      maxTokens: 4096,
    });
    return {
      identityId,
      identityName: registered.definition.name,
      body: cli.text,
      wordCount: wordCount(cli.text),
      model,
      inputTokens: cli.inputTokens,
      outputTokens: cli.outputTokens,
      durationMs: cli.durationMs,
      costUsd: computeCostUsd(model, cli.inputTokens, cli.outputTokens),
      personaId: persona?.id,
    };
  }

  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: registered.definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Identity ${identityId} did not return a text block`);
  }

  return {
    identityId,
    identityName: registered.definition.name,
    body: textBlock.text,
    wordCount: wordCount(textBlock.text),
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - start,
    costUsd: computeCostUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    personaId: persona?.id,
  };
}

async function runAllIdentities(coreAnalysisBody: string): Promise<IdentityOutput[]> {
  // Run all identities in parallel — they're independent and reading the same cached core.
  return Promise.all(
    IDENTITY_REGISTRY.map((reg) => runIdentity(reg.definition.id, coreAnalysisBody)),
  );
}

// ───────────────────────────────────────────────────────────────────
// Stage 3 — embedding similarity matrix + ROUGE-L
// ───────────────────────────────────────────────────────────────────

interface OutputWithEmbedding {
  output: IdentityOutput;
  embedding: number[];
  embeddingCostUsd: number;
}

async function embedOutputs(outputs: IdentityOutput[]): Promise<OutputWithEmbedding[]> {
  return Promise.all(
    outputs.map(async (output) => {
      const result = await embedText(output.body);
      return {
        output,
        embedding: result.vector,
        embeddingCostUsd: result.costUsd,
      };
    }),
  );
}

function classifyStatus(cosineSim: number, rougeL: number): SimilarityStatus {
  const { cosine, cosineBorderlineMargin, rougeL: rougeThreshold } =
    UNIQUENESS_THRESHOLDS.crossTenant;

  if (cosineSim >= cosine || rougeL >= rougeThreshold) {
    return "fail-cross-tenant";
  }

  const inBorderlineCosine = cosineSim >= cosine - cosineBorderlineMargin;
  const inBorderlineRouge = rougeL >= rougeThreshold - 0.05;

  if (inBorderlineCosine || inBorderlineRouge) {
    return "borderline-cross-tenant";
  }

  return "pass";
}

function buildPairwiseMatrix(embedded: OutputWithEmbedding[]): SimilarityResult[] {
  const results: SimilarityResult[] = [];

  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const a = embedded[i]!;
      const b = embedded[j]!;
      const score = scorePair(a.embedding, b.embedding, a.output.body, b.output.body);
      results.push({
        pairId: `${a.output.identityId}__${b.output.identityId}`,
        identityA: a.output.identityId,
        identityB: b.output.identityId,
        cosineSimilarity: score.cosineSimilarity,
        rougeL: score.rougeL,
        status: classifyStatus(score.cosineSimilarity, score.rougeL),
      });
    }
  }

  return results;
}

async function judgeBorderlinePairs(
  similarities: SimilarityResult[],
  outputs: IdentityOutput[],
): Promise<JudgeFailureRecord[]> {
  const failures: JudgeFailureRecord[] = [];
  // Intra-tenant cross-identity matrix: keep the borderline gate since it's
  // not load-bearing for production (cross-tenant is the load-bearing test
  // and fires on every pair below in `runCrossTenantMatrix`).
  const borderline = similarities.filter(
    (s) => s.status === "borderline-cross-tenant" || s.status === "fail-cross-tenant",
  );

  for (const sim of borderline) {
    const outA = outputs.find((o) => o.identityId === sim.identityA)!;
    const outB = outputs.find((o) => o.identityId === sim.identityB)!;

    // The judge retries internally on recoverable errors (ZodError + empty
    // tool_use). Non-recoverable errors (auth, rate limit, etc.) propagate
    // immediately. Either way, if we land in the catch here it's a hard
    // failure — we record it in the failures array AND log it to stdout,
    // then skip the pair. The failures list gets plumbed into
    // `RunResult.judgeFailures` so skipped pairs are visible in
    // `raw-data.json`, not only in the console.
    try {
      const verdict = await judgePairUniqueness({
        identityA: outA.identityName,
        identityB: outB.identityName,
        contentA: outA.body,
        contentB: outB.body,
        cosineSimilarity: sim.cosineSimilarity,
        rougeL: sim.rougeL,
      });
      applyJudgeVerdict(sim, verdict);
    } catch (err) {
      failures.push(recordJudgeFailure(sim.pairId, "intra-tenant", err));
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[runner]   ⚠ skipping intra-tenant pair ${sim.pairId} (judge failure): ${message.slice(0, 300)}`,
      );
    }
  }
  return failures;
}

// ───────────────────────────────────────────────────────────────────
// Stage 4 — reproducibility test (optional)
// ───────────────────────────────────────────────────────────────────

async function runReproducibilityTest(
  identityId: string,
  coreAnalysisBody: string,
  runs: number,
): Promise<ReproducibilityResult> {
  const outputs = await Promise.all(
    Array.from({ length: runs }, () => runIdentity(identityId, coreAnalysisBody)),
  );

  const embeddings = await Promise.all(outputs.map((o) => embedText(o.body)));

  const cosines: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      cosines.push(cosineSimilarity(embeddings[i]!.vector, embeddings[j]!.vector));
    }
  }

  const mean = cosines.reduce((a, b) => a + b, 0) / cosines.length;

  return {
    identityId,
    runs: outputs.map((o) => ({ body: o.body, wordCount: o.wordCount })),
    pairwiseCosineMean: mean,
    pairwiseCosineMin: Math.min(...cosines),
    pairwiseCosineMax: Math.max(...cosines),
  };
}

// ───────────────────────────────────────────────────────────────────
// Stage 5 — persona-overlay differentiation test (optional)
// ───────────────────────────────────────────────────────────────────

async function runPersonaDifferentiation(
  identityId: string,
  coreAnalysisBody: string,
  personaA: ContentPersona,
  personaB: ContentPersona,
): Promise<PersonaDifferentiationResult> {
  const [outputA, outputB] = await Promise.all([
    runIdentity(identityId, coreAnalysisBody, personaA),
    runIdentity(identityId, coreAnalysisBody, personaB),
  ]);

  const [embA, embB] = await Promise.all([embedText(outputA.body), embedText(outputB.body)]);

  const cosine = cosineSimilarity(embA.vector, embB.vector);
  const rougeL = rougeLF1(outputA.body, outputB.body);

  return {
    identityId,
    personaA,
    personaB,
    outputA,
    outputB,
    cosineSimilarity: cosine,
    rougeL,
    differentiated:
      cosine < UNIQUENESS_THRESHOLDS.intraTenant.cosine &&
      rougeL < UNIQUENESS_THRESHOLDS.intraTenant.rougeL,
  };
}

// ───────────────────────────────────────────────────────────────────
// Stage 6 — cross-tenant matrix (the load-bearing test)
// ───────────────────────────────────────────────────────────────────

/**
 * Apply STRICT cross-tenant thresholds (cosine 0.85, ROUGE-L 0.40) to a pair.
 * This is the bar from content-uniqueness §6.1 for the cross-tenant case.
 */
function classifyCrossTenantStatus(cosineSim: number, rougeL: number): SimilarityStatus {
  const { cosine, cosineBorderlineMargin, rougeL: rougeThreshold } =
    UNIQUENESS_THRESHOLDS.crossTenant;

  if (cosineSim >= cosine || rougeL >= rougeThreshold) {
    return "fail-cross-tenant";
  }

  const inBorderlineCosine = cosineSim >= cosine - cosineBorderlineMargin;
  const inBorderlineRouge = rougeL >= rougeThreshold - 0.05;

  if (inBorderlineCosine || inBorderlineRouge) {
    return "borderline-cross-tenant";
  }

  return "pass";
}

async function runCrossTenantMatrix(
  identityId: string,
  coreAnalysisBody: string,
  personas: ContentPersona[],
  callbacks?: RunCallbacks,
  /**
   * Optional: inject accumulated narrative state into each persona's identity
   * call. Only populated by the sequence runner (`poc:uniqueness:sequence`);
   * single-event `--full` runs pass `undefined` and behave exactly as before.
   * Each entry is the state for the persona at the same index, or null if
   * the store had nothing for that persona.
   */
  narrativeStates?: Array<TenantTopicNarrativeState | null>,
  /**
   * Topic display name for the injected directive (see
   * `renderNarrativeStateDirective`). Only consulted when `narrativeStates`
   * is provided.
   */
  narrativeTopicName?: string,
  /**
   * Playground-only: per-tenant identity override. When `tenantIdentityIds[i]`
   * is a non-empty string, that persona uses that identity instead of the
   * default `identityId`. The CLI never sets this and the matrix's reported
   * `identityId` / `identityName` are still the default.
   */
  tenantIdentityIds?: Array<string | null>,
  /**
   * Playground-only: per-tenant hard word-count override. When `tenantWordCountOverrides[i]`
   * is a positive number, the directive appended to that persona's user
   * message forces this exact target. The CLI never sets this.
   */
  tenantWordCountOverrides?: Array<number | null>,
  /**
   * When true, run the Style & Voice specialist on each output after
   * generation but before embedding/similarity scoring. This enforces
   * persona-specific brand voice and drives structural divergence between
   * outputs that share the same identity agent.
   */
  withConformancePass?: boolean,
): Promise<CrossTenantMatrixResult> {
  if (personas.length < 2) {
    throw new Error(
      `runCrossTenantMatrix requires at least 2 personas to form a meaningful matrix; got ${personas.length}`,
    );
  }

  const registered = getIdentityById(identityId);
  if (!registered) {
    throw new Error(`Unknown identity: ${identityId}`);
  }

  // Run the same identity once per persona, in parallel.
  // Emit per-tenant lifecycle callbacks so the playground UI can populate
  // each card progressively as its identity call resolves.
  const outputs = await Promise.all(
    personas.map(async (persona, index) => {
      callbacks?.onTenantStarted?.(index, persona.id);
      const narrativeState = narrativeStates?.[index] ?? undefined;
      const wordCountOverride = tenantWordCountOverrides?.[index] ?? undefined;
      const identityOptions =
        narrativeState || wordCountOverride
          ? {
              ...(narrativeState ? { narrativeState, topicName: narrativeTopicName } : {}),
              ...(wordCountOverride ? { targetWordCount: wordCountOverride } : {}),
            }
          : undefined;
      const perTenantIdentity = tenantIdentityIds?.[index];
      const effectiveIdentityId =
        perTenantIdentity && perTenantIdentity.length > 0
          ? perTenantIdentity
          : identityId;
      const out = await runIdentity(
        effectiveIdentityId,
        coreAnalysisBody,
        persona,
        identityOptions,
      );
      callbacks?.onTenantCompleted?.(index, out);
      return out;
    }),
  );

  // ── Conformance pass (optional) ──────────────────────────────────
  // When enabled, run the Style & Voice specialist on each output to
  // enforce persona-specific brand voice. This is the content pipeline's
  // equivalent of the translation engine's conformance loop, scoped to
  // the two specialists that drive divergence (Style & Voice) without
  // pulling in the full 13-metric loop.
  let conformedOutputs = outputs;
  let conformanceCostUsd = 0;
  let conformanceDetails: import("./types.js").ConformanceDetail[] | undefined;
  if (withConformancePass) {
    try {
      const { runConformancePassAll } = await import("./conformance-pass.js");
      console.log(`[runner] Stage 6 — conformance pass: enforcing brand voice on ${outputs.length} outputs...`);
      const conformanceResult = await runConformancePassAll(
        outputs,
        personas,
        (index, changed) => {
          const p = personas[index]!;
          console.log(`[runner]   ${changed ? "✓" : "○"} ${p.name}: ${changed ? "rewritten for brand voice" : "no changes needed"}`);
        },
      );
      conformedOutputs = conformanceResult.outputs;
      conformanceCostUsd = conformanceResult.totalCostUsd;
      // Capture per-output conformance details for the pipeline inspector
      conformanceDetails = conformanceResult.conformanceResults.map((r, i) => ({
        personaId: personas[i]!.id,
        personaName: personas[i]!.name,
        changed: r.changed,
        reasoning: r.reasoning,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costUsd: r.costUsd,
        // Only save the pre-conformance body when something actually changed
        // (avoids doubling the JSON size when nothing was rewritten)
        preConformanceBody: r.changed ? outputs[i]!.body : undefined,
      }));
      const changedCount = conformanceDetails.filter((r) => r.changed).length;
      console.log(`[runner]   Conformance pass complete: ${changedCount}/${outputs.length} outputs rewritten, cost $${conformanceCostUsd.toFixed(4)}`);
    } catch (err) {
      console.error(`[runner]   ⚠ Conformance pass failed, using raw outputs:`, err instanceof Error ? err.message : err);
      // Fall through with original outputs — don't lose the generation work
    }
  }

  // Embed all outputs
  const embedded = await embedOutputs(conformedOutputs);

  // Build pairwise matrix using STRICT cross-tenant thresholds.
  //
  // Pair IDs are prefixed with the tenant (pipeline) index so duplicate
  // personas across tenants never collide, e.g. two tenants both using
  // `premium-capital-markets` produce a distinct pairId per (i, j). The
  // underlying persona ids are still in the suffix so existing tooling that
  // greps for them keeps working.
  // Also track the tenant indices on each SimilarityResult so the judge loop
  // below can look up the right outputs by index rather than by persona name
  // (name-based lookup also collides on duplicates).
  interface IndexedSimilarity {
    indexA: number;
    indexB: number;
    sim: SimilarityResult;
  }
  const indexedSimilarities: IndexedSimilarity[] = [];
  const similarities: SimilarityResult[] = [];
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const a = embedded[i]!;
      const b = embedded[j]!;
      const score = scorePair(a.embedding, b.embedding, a.output.body, b.output.body);
      const sim: SimilarityResult = {
        pairId: `${i}_${personas[i]!.id}__${j}_${personas[j]!.id}`,
        identityA: personas[i]!.name,
        identityB: personas[j]!.name,
        cosineSimilarity: score.cosineSimilarity,
        rougeL: score.rougeL,
        status: classifyCrossTenantStatus(score.cosineSimilarity, score.rougeL),
      };
      similarities.push(sim);
      indexedSimilarities.push({ indexA: i, indexB: j, sim });
    }
  }

  // Two-axis LLM judge on EVERY cross-tenant pair (not just borderline).
  // The cosine-based borderline gate is unreliable — the new judge is the
  // authoritative cross-tenant metric and the mechanical metrics are
  // diagnostics. See docs/poc-uniqueness-session-2026-04-07.md §4.1.
  // The judge retries internally on recoverable errors (ZodError + empty
  // tool_use). Non-recoverable errors (auth, rate limit) propagate
  // immediately. Hard failures are recorded in `judgeFailures` so they
  // surface in raw-data.json.
  const crossTenantJudgeFailures: JudgeFailureRecord[] = [];
  for (const { indexA, indexB, sim } of indexedSimilarities) {
    const outA = outputs[indexA]!;
    const outB = outputs[indexB]!;

    try {
      const verdict = await judgePairUniqueness({
        identityA: `${registered.definition.name} for ${sim.identityA}`,
        identityB: `${registered.definition.name} for ${sim.identityB}`,
        contentA: outA.body,
        contentB: outB.body,
        cosineSimilarity: sim.cosineSimilarity,
        rougeL: sim.rougeL,
      });
      applyJudgeVerdict(sim, verdict);
      callbacks?.onJudgeCompleted?.(sim.pairId, sim);
    } catch (err) {
      crossTenantJudgeFailures.push(
        recordJudgeFailure(sim.pairId, "cross-tenant", err),
      );
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[runner]   ⚠ skipping cross-tenant pair ${sim.pairId} (judge failure): ${message.slice(0, 300)}`,
      );
    }
  }

  // Distribution stats
  const cosines = similarities.map((s) => s.cosineSimilarity);
  const rouges = similarities.map((s) => s.rougeL);
  const meanCosine = cosines.reduce((a, b) => a + b, 0) / cosines.length;
  const meanRougeL = rouges.reduce((a, b) => a + b, 0) / rouges.length;

  // Cross-tenant verdict — trinary judge logic.
  // - ANY fabrication_risk    → FAIL (alarm — the pipeline should halt in prod)
  // - ANY reskinned           → FAIL (regenerate with diversity hint)
  // - ALL distinct_products   → PASS
  const fabricationRiskPairs = similarities.filter(
    (s) => s.judgeTrinaryVerdict === "fabrication_risk",
  );
  const reskinnedPairs = similarities.filter(
    (s) => s.judgeTrinaryVerdict === "reskinned_same_article",
  );

  let verdict: CrossTenantMatrixResult["verdict"];
  let verdictReasoning: string;

  if (fabricationRiskPairs.length > 0) {
    verdict = "FAIL";
    verdictReasoning = `🚨 ${fabricationRiskPairs.length} of ${similarities.length} cross-tenant pair(s) flagged as FABRICATION_RISK by the two-axis judge: ${fabricationRiskPairs.map((s) => s.pairId).join(", ")}. In production this would HALT the pipeline — at least one writer invented or contradicted facts from the source analysis.`;
  } else if (reskinnedPairs.length > 0) {
    verdict = "FAIL";
    verdictReasoning = `${reskinnedPairs.length} of ${similarities.length} cross-tenant pair(s) flagged as RESKINNED_SAME_ARTICLE — faithful to facts but prose too similar: ${reskinnedPairs.map((s) => s.pairId).join(", ")}. In production this would trigger one regeneration with a diversity hint.`;
  } else {
    verdict = "PASS";
    verdictReasoning = `All ${similarities.length} cross-tenant pairs are DISTINCT_PRODUCTS under the two-axis judge (fidelity ≥ 0.9 AND presentation < 0.5). Mean factual fidelity: ${(similarities.reduce((a, b) => a + (b.judgeFactualFidelity ?? 0), 0) / similarities.length).toFixed(3)}. Mean presentation similarity: ${(similarities.reduce((a, b) => a + (b.judgePresentationSimilarity ?? 0), 0) / similarities.length).toFixed(3)}.`;
  }

  return {
    identityId,
    identityName: registered.definition.name,
    personas,
    outputs,
    similarities,
    meanCosine,
    minCosine: Math.min(...cosines),
    maxCosine: Math.max(...cosines),
    meanRougeL,
    minRougeL: Math.min(...rouges),
    maxRougeL: Math.max(...rouges),
    verdict,
    verdictReasoning,
    judgeFailures: crossTenantJudgeFailures,
    conformanceCostUsd: conformanceCostUsd > 0 ? conformanceCostUsd : undefined,
    conformanceDetails,
  };
}

// ───────────────────────────────────────────────────────────────────
// Stage 7 — Temporal narrative continuity test
// ───────────────────────────────────────────────────────────────────

/**
 * Build a cross-tenant matrix from a set of outputs (one per persona),
 * applying the strict cross-tenant thresholds. Used for both the control
 * and treatment groups in Stage 7.
 */
async function buildCrossTenantMatrixFromOutputs(
  identityName: string,
  personas: ContentPersona[],
  outputs: IdentityOutput[],
): Promise<{
  similarities: SimilarityResult[];
  meanCosine: number;
  meanRougeL: number;
  judgeFailures: JudgeFailureRecord[];
}> {
  const embedded = await embedOutputs(outputs);

  const similarities: SimilarityResult[] = [];
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const a = embedded[i]!;
      const b = embedded[j]!;
      const score = scorePair(a.embedding, b.embedding, a.output.body, b.output.body);
      similarities.push({
        pairId: `${personas[i]!.id}__${personas[j]!.id}`,
        identityA: personas[i]!.name,
        identityB: personas[j]!.name,
        cosineSimilarity: score.cosineSimilarity,
        rougeL: score.rougeL,
        status: classifyCrossTenantStatus(score.cosineSimilarity, score.rougeL),
      });
    }
  }

  // Two-axis judge on EVERY pair (not just borderline) — Stage 7 control
  // and treatment both need full judge coverage so the A/B comparison is
  // measured on the same metric. Resilient: retries 3x internally, skips
  // the pair with a warning if it still fails. Skipped pairs are collected
  // in `judgeFailures` and surfaced on the returned result so consumers
  // can see that the aggregate stats were computed over a subset.
  const judgeFailures: JudgeFailureRecord[] = [];
  for (const sim of similarities) {
    const indexA = personas.findIndex((p) => p.name === sim.identityA);
    const indexB = personas.findIndex((p) => p.name === sim.identityB);
    const outA = outputs[indexA]!;
    const outB = outputs[indexB]!;

    try {
      const verdict = await judgePairUniqueness({
        identityA: `${identityName} for ${sim.identityA}`,
        identityB: `${identityName} for ${sim.identityB}`,
        contentA: outA.body,
        contentB: outB.body,
        cosineSimilarity: sim.cosineSimilarity,
        rougeL: sim.rougeL,
      });
      applyJudgeVerdict(sim, verdict);
    } catch (err) {
      judgeFailures.push(recordJudgeFailure(sim.pairId, "narrative-state", err));
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[runner]   ⚠ skipping Stage 7 pair ${sim.pairId} after 3 judge attempts: ${message.slice(0, 300)}`,
      );
    }
  }

  const cosines = similarities.map((s) => s.cosineSimilarity);
  const rouges = similarities.map((s) => s.rougeL);
  return {
    similarities,
    meanCosine: cosines.reduce((a, b) => a + b, 0) / cosines.length,
    meanRougeL: rouges.reduce((a, b) => a + b, 0) / rouges.length,
    judgeFailures,
  };
}

/**
 * Resolve the narrative state to inject into a persona's treatment call.
 *
 * Store-first, synthesis-fallback. If a store is provided and has a non-empty
 * entry for the (fixture, persona, topic) triple, use it directly. Otherwise
 * fall back to today's in-memory single-prior synthesis from the prior
 * Stage 6 output.
 */
async function resolveNarrativeStateForPersona(args: {
  persona: ContentPersona;
  topicId: string;
  priorOutput: IdentityOutput;
  priorPublishedAt: string;
  store: NarrativeStateStore | undefined;
  fixtureId: string | undefined;
}): Promise<TenantTopicNarrativeState> {
  const existing = await lookupPersonaState({
    store: args.store,
    fixtureId: args.fixtureId,
    persona: args.persona,
    topicId: args.topicId,
  });
  if (existing) return existing;

  return buildNarrativeStateFromPriorOutput(
    args.persona,
    args.topicId,
    args.priorOutput,
    args.priorPublishedAt,
  );
}

async function runNarrativeStateTest(args: {
  identityId: string;
  personas: ContentPersona[];
  /** Stage 6 outputs to use as the "prior coverage" for each persona. */
  priorOutputs: IdentityOutput[];
  /** Date string for when the prior pieces were "published". */
  priorPublishedAt: string;
  /** The second event to write about — the continuation. */
  secondEvent: NewsEvent;
  /** Optional store; when provided, Stage 7 reads accumulated history from it. */
  store?: NarrativeStateStore;
  /** Fixture namespace for store lookups; required if `store` is set. */
  fixtureId?: string;
}): Promise<{ result: NarrativeStateTestResult; judgeFailures: JudgeFailureRecord[] }> {
  const registered = getIdentityById(args.identityId);
  if (!registered) {
    throw new Error(`Unknown identity: ${args.identityId}`);
  }

  if (args.priorOutputs.length !== args.personas.length) {
    throw new Error(
      `Mismatched arrays: ${args.priorOutputs.length} prior outputs vs ${args.personas.length} personas`,
    );
  }

  // STEP 1 — Run a fresh core analysis on the second event
  console.log(`[runner]   Stage 7.1 — running core analysis on second event (${args.secondEvent.id})...`);
  const secondCoreAnalysis = await runCoreAnalysis(args.secondEvent);
  console.log(`[runner]     ✓ ${secondCoreAnalysis.outputTokens} output tokens, $${secondCoreAnalysis.costUsd.toFixed(4)}`);

  // STEP 2 — Resolve narrative state for each persona: store-first if the
  // store has an accumulated history, otherwise fall back to the in-memory
  // single-prior synthesis path.
  console.log(`[runner]   Stage 7.2 — resolving narrative state for ${args.personas.length} personas (store-first, synthesis fallback)...`);
  const narrativeStates = await Promise.all(
    args.personas.map(async (persona, i) => {
      const state = await resolveNarrativeStateForPersona({
        persona,
        topicId: args.secondEvent.topicId,
        priorOutput: args.priorOutputs[i]!,
        priorPublishedAt: args.priorPublishedAt,
        store: args.store,
        fixtureId: args.fixtureId,
      });
      return { personaId: persona.id, personaName: persona.name, state };
    }),
  );
  for (const { personaName, state } of narrativeStates) {
    const e = state.recentEntries[0]!;
    console.log(`[runner]     ✓ ${personaName}: ${e.directionalView} (${e.directionalViewConfidence}), thesis="${e.keyThesisStatements[0]?.slice(0, 60)}..."`);
  }

  // STEP 3 — Generate CONTROL group (no narrative state) on second event
  console.log(`[runner]   Stage 7.3 — control group: 4 journalist runs on second event WITHOUT narrative state (parallel)...`);
  const controlOutputs = await Promise.all(
    args.personas.map((persona) =>
      runIdentity(args.identityId, secondCoreAnalysis.body, persona),
    ),
  );
  for (const out of controlOutputs) {
    console.log(`[runner]     ✓ control[${out.identityId}]: ${out.wordCount} words, $${out.costUsd.toFixed(4)}`);
  }

  // STEP 4 — Generate TREATMENT group (WITH narrative state) on second event
  console.log(`[runner]   Stage 7.4 — treatment group: 4 journalist runs on second event WITH narrative state (parallel)...`);
  const treatmentOutputs = await Promise.all(
    args.personas.map((persona, i) =>
      runIdentity(args.identityId, secondCoreAnalysis.body, persona, {
        narrativeState: narrativeStates[i]!.state,
        topicName: args.secondEvent.topicName,
      }),
    ),
  );
  for (const out of treatmentOutputs) {
    console.log(`[runner]     ✓ treatment[${out.identityId}]: ${out.wordCount} words, $${out.costUsd.toFixed(4)}`);
  }

  // STEP 5 — Build cross-tenant matrices for both groups
  console.log(`[runner]   Stage 7.5 — building cross-tenant matrices for control and treatment...`);
  const controlMatrix = await buildCrossTenantMatrixFromOutputs(
    registered.definition.name,
    args.personas,
    controlOutputs,
  );
  const treatmentMatrix = await buildCrossTenantMatrixFromOutputs(
    registered.definition.name,
    args.personas,
    treatmentOutputs,
  );

  console.log(`[runner]     ✓ CONTROL  : cosine mean=${controlMatrix.meanCosine.toFixed(4)}, rougeL mean=${controlMatrix.meanRougeL.toFixed(4)}`);
  console.log(`[runner]     ✓ TREATMENT: cosine mean=${treatmentMatrix.meanCosine.toFixed(4)}, rougeL mean=${treatmentMatrix.meanRougeL.toFixed(4)}`);
  console.log(`[runner]     ✓ DIFFERENTIAL: cosine ${(controlMatrix.meanCosine - treatmentMatrix.meanCosine).toFixed(4)} (positive = treatment more unique)`);

  // STEP 6 — Aggregate verdict for the treatment group (two-axis trinary)
  const treatmentFabricationRisk = treatmentMatrix.similarities.filter(
    (s) => s.judgeTrinaryVerdict === "fabrication_risk",
  );
  const treatmentReskinned = treatmentMatrix.similarities.filter(
    (s) => s.judgeTrinaryVerdict === "reskinned_same_article",
  );

  let treatmentVerdict: NarrativeStateTestResult["treatmentVerdict"];
  let treatmentVerdictReasoning: string;
  if (treatmentFabricationRisk.length > 0) {
    treatmentVerdict = "FAIL";
    treatmentVerdictReasoning = `🚨 ${treatmentFabricationRisk.length} of ${treatmentMatrix.similarities.length} treatment pair(s) flagged as FABRICATION_RISK by the two-axis judge.`;
  } else if (treatmentReskinned.length > 0) {
    treatmentVerdict = "FAIL";
    treatmentVerdictReasoning = `${treatmentReskinned.length} of ${treatmentMatrix.similarities.length} treatment pair(s) flagged as RESKINNED_SAME_ARTICLE by the two-axis judge.`;
  } else {
    treatmentVerdict = "PASS";
    treatmentVerdictReasoning = `All ${treatmentMatrix.similarities.length} treatment pairs are DISTINCT_PRODUCTS under the two-axis judge.`;
  }

  return {
    result: {
      identityId: args.identityId,
      identityName: registered.definition.name,
      secondEvent: args.secondEvent,
      secondCoreAnalysis,
      narrativeStates,
      controlOutputs,
      controlSimilarities: controlMatrix.similarities,
      controlMeanCosine: controlMatrix.meanCosine,
      controlMeanRougeL: controlMatrix.meanRougeL,
      treatmentOutputs,
      treatmentSimilarities: treatmentMatrix.similarities,
      treatmentMeanCosine: treatmentMatrix.meanCosine,
      treatmentMeanRougeL: treatmentMatrix.meanRougeL,
      cosineImprovement: controlMatrix.meanCosine - treatmentMatrix.meanCosine,
      rougeLImprovement: controlMatrix.meanRougeL - treatmentMatrix.meanRougeL,
      treatmentVerdict,
      treatmentVerdictReasoning,
    },
    judgeFailures: [...controlMatrix.judgeFailures, ...treatmentMatrix.judgeFailures],
  };
}

// ───────────────────────────────────────────────────────────────────
// Verdict — aggregate the run against the spec's thresholds
// ───────────────────────────────────────────────────────────────────

/**
 * Aggregate verdict for the legacy intra-tenant cross-identity matrix.
 *
 * This function runs against the 15-pair matrix of all identities (stage 3.5,
 * not the load-bearing cross-tenant test). It still uses the
 * borderline-gated judge approach because intra-tenant is not load-bearing
 * for the architecture. The load-bearing cross-tenant verdict is computed
 * inline in `runCrossTenantMatrix` with the full two-axis trinary logic.
 *
 * For the intra-tenant case, we interpret the new trinary verdict values as
 * best we can: fabrication_risk → FAIL, reskinned_same_article → FAIL,
 * distinct_products → PASS. Pairs that weren't judged (below the borderline
 * gate) count as PASS.
 */
function aggregateVerdict(similarities: SimilarityResult[]): { verdict: RunResult["verdict"]; reasoning: string } {
  const fails = similarities.filter((s) => s.status === "fail-cross-tenant");
  const borderline = similarities.filter((s) => s.status === "borderline-cross-tenant");

  const fabricationRisk = similarities.filter(
    (s) => s.judgeTrinaryVerdict === "fabrication_risk",
  );
  const reskinned = similarities.filter(
    (s) => s.judgeTrinaryVerdict === "reskinned_same_article",
  );

  if (fabricationRisk.length > 0) {
    return {
      verdict: "FAIL",
      reasoning: `🚨 ${fabricationRisk.length} pair(s) flagged as FABRICATION_RISK by the two-axis judge: ${fabricationRisk.map((s) => s.pairId).join(", ")}`,
    };
  }

  if (reskinned.length > 0) {
    return {
      verdict: "FAIL",
      reasoning: `${reskinned.length} pair(s) flagged as RESKINNED_SAME_ARTICLE by the two-axis judge: ${reskinned.map((s) => s.pairId).join(", ")}`,
    };
  }

  if (fails.length > 0 || borderline.length > 0) {
    // Count how many of the borderline/fail pairs the judge cleared as
    // distinct_products (vs how many were left unjudged or returned a
    // non-distinct verdict). If EVERY borderline/fail pair was cleared,
    // the mechanical threshold was over-strict and the run is effectively
    // PASS under the two-axis judge — previously this fell through to
    // BORDERLINE unconditionally, which meant a clean judge verdict could
    // never produce a PASS for the intra-tenant matrix.
    const nonPassPairs = [...fails, ...borderline];
    const clearedByJudge = nonPassPairs.filter(
      (s) => s.judgeTrinaryVerdict === "distinct_products",
    ).length;

    if (clearedByJudge === nonPassPairs.length) {
      return {
        verdict: "PASS",
        reasoning: `All ${similarities.length} pair(s) either cleared cross-tenant thresholds or were adjudicated DISTINCT_PRODUCTS by the two-axis judge (${clearedByJudge} borderline pair${clearedByJudge === 1 ? "" : "s"} cleared).`,
      };
    }

    return {
      verdict: "BORDERLINE",
      reasoning: `${nonPassPairs.length} pair(s) crossed the cross-tenant threshold band by raw similarity; ${clearedByJudge} of ${nonPassPairs.length} were cleared as DISTINCT_PRODUCTS by the two-axis judge.`,
    };
  }

  return {
    verdict: "PASS",
    reasoning: `All ${similarities.length} pairs passed cross-tenant uniqueness thresholds (cosine < ${UNIQUENESS_THRESHOLDS.crossTenant.cosine}, ROUGE-L < ${UNIQUENESS_THRESHOLDS.crossTenant.rougeL}).`,
  };
}

// ───────────────────────────────────────────────────────────────────
// The main entry point
// ───────────────────────────────────────────────────────────────────

export interface RunOptions {
  event: NewsEvent;
  /** Run the reproducibility test (Stage 4)? Adds ~$0.30 in calls. */
  withReproducibility?: { identityId: string; runs: number };
  /** Run the persona-overlay differentiation test (Stage 5)? Adds ~$0.20. */
  withPersonaDifferentiation?: {
    identityId: string;
    personaA: ContentPersona;
    personaB: ContentPersona;
  };
  /**
   * Run the cross-tenant matrix test (Stage 6)?
   * Pick one identity, run it with N personas, build pairwise matrix.
   * This is the load-bearing cross-tenant uniqueness test.
   * Requires at least 3 personas for a meaningful matrix. ~$0.20-0.40.
   */
  withCrossTenantMatrix?: {
    identityId: string;
    personas: ContentPersona[];
    /**
     * Playground-only: per-tenant identity override. Length must equal
     * `personas.length` when provided. The CLI never sets this.
     */
    tenantIdentityIds?: Array<string | null>;
    /**
     * Playground-only: per-tenant hard word-count override. Length must equal
     * `personas.length` when provided. The CLI never sets this.
     */
    tenantWordCountOverrides?: Array<number | null>;
    /**
     * When true, run the Style & Voice specialist on each output after
     * generation to enforce persona-specific brand voice, before
     * embedding and similarity scoring. Adds ~$0.10-0.20 per output.
     */
    withConformancePass?: boolean;
  };
  /**
   * Run the temporal narrative continuity test (Stage 7)?
   * Uses Stage 6's outputs as "prior coverage", runs a SECOND event with
   * narrative state injected (treatment) and without (control), compares.
   * Requires withCrossTenantMatrix to also be set so we can reuse its outputs.
   * ~$0.50-0.80.
   */
  withNarrativeStateTest?: {
    secondEvent: NewsEvent;
    /** Date string to attribute to the prior pieces (the "publishedAt" field). */
    priorPublishedAt: string;
  };
  /**
   * Between-runs narrative-state persistence. See
   * `docs/specs/2026-04-08-narrative-state-persistence.md`.
   *
   * When both `store` and `fixtureId` are provided:
   *   - Stage 7 reads accumulated state from the store instead of synthesising
   *     a single-entry prior in memory (falls back to synthesis if empty).
   *   - If `persistNarrativeState === true`, Stage 6 outputs are extracted
   *     and appended to the store after Stage 6 completes.
   *   - If `readNarrativeStateInCrossTenant === true`, Stage 6 **reads** from
   *     the store before each identity call and injects the accumulated
   *     history into the identity prompt. This is only used by the sequence
   *     runner; single-event `--full` runs leave it false so back-compat is
   *     byte-identical.
   *
   * All three flags are opt-in and default to `undefined`/`false`. Existing
   * call sites that don't pass any of them behave exactly as before.
   */
  store?: NarrativeStateStore;
  fixtureId?: string;
  persistNarrativeState?: boolean;
  readNarrativeStateInCrossTenant?: boolean;
}

/**
 * Optional lifecycle callbacks the runner emits at each major stage transition.
 *
 * Used by the uniqueness PoC playground to stream stage events over SSE so the
 * UI populates progressively as the run proceeds. The CLI does not pass any
 * callbacks; every field is optional and the runner treats missing handlers as
 * no-ops, so existing callers are unaffected.
 */
export interface RunCallbacks {
  onRunStarted?: (runId: string, estimatedCostUsd: number) => void;
  onStageStarted?: (stage: "core" | "identity" | "cross-tenant" | "judge") => void;
  onCoreAnalysisCompleted?: (body: string, costUsd: number, tokens: number) => void;
  onTenantStarted?: (tenantIndex: number, personaId: string) => void;
  onTenantCompleted?: (tenantIndex: number, output: IdentityOutput) => void;
  onJudgeCompleted?: (pairId: string, similarity: SimilarityResult) => void;
  onCostUpdated?: (totalCostUsd: number) => void;
  onRunCompleted?: (result: RunResult) => void;
  onRunErrored?: (error: Error) => void;
}

export async function runUniquenessPoc(
  opts: RunOptions,
  callbacks?: RunCallbacks,
): Promise<RunResult> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${opts.event.id}`;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  console.log(`\n[runner] Starting run ${runId}`);
  console.log(`[runner] Event: ${opts.event.title}`);
  console.log(`[runner] Topic: ${opts.event.topicName}`);

  callbacks?.onRunStarted?.(runId, 0);

  // Stage 1
  console.log(`[runner] Stage 1 — running core FA analysis (Opus)...`);
  callbacks?.onStageStarted?.("core");
  const coreAnalysis = await runCoreAnalysis(opts.event);
  console.log(`[runner]   ✓ ${coreAnalysis.outputTokens} output tokens, ${(coreAnalysis.durationMs / 1000).toFixed(1)}s, $${coreAnalysis.costUsd.toFixed(4)}`);
  callbacks?.onCoreAnalysisCompleted?.(
    coreAnalysis.body,
    coreAnalysis.costUsd,
    coreAnalysis.outputTokens,
  );
  callbacks?.onCostUpdated?.(coreAnalysis.costUsd);

  // Stage 2
  console.log(`[runner] Stage 2 — adapting via ${IDENTITY_REGISTRY.length} identity agents (Sonnet, parallel)...`);
  const identityOutputs = await runAllIdentities(coreAnalysis.body);
  for (const out of identityOutputs) {
    console.log(`[runner]   ✓ ${out.identityName}: ${out.wordCount} words, ${(out.durationMs / 1000).toFixed(1)}s, $${out.costUsd.toFixed(4)}`);
  }

  // Stage 3
  console.log(`[runner] Stage 3 — computing embeddings + similarity matrix...`);
  const embedded = await embedOutputs(identityOutputs);
  const totalEmbeddingCost = embedded.reduce((sum, e) => sum + e.embeddingCostUsd, 0);
  console.log(`[runner]   ✓ ${embedded.length} embeddings, $${totalEmbeddingCost.toFixed(6)}`);

  const similarities = buildPairwiseMatrix(embedded);
  console.log(`[runner]   ✓ ${similarities.length} pairwise comparisons`);

  // Stage 3.5 — LLM judge for borderline pairs
  let intraTenantJudgeFailures: JudgeFailureRecord[] = [];
  const borderlineCount = similarities.filter(
    (s) => s.status !== "pass",
  ).length;
  if (borderlineCount > 0) {
    console.log(`[runner] Stage 3.5 — running LLM judge on ${borderlineCount} borderline/fail pair(s) (Haiku)...`);
    intraTenantJudgeFailures = await judgeBorderlinePairs(similarities, identityOutputs);
    for (const s of similarities.filter((s) => s.judgeTrinaryVerdict)) {
      const fidelity = (s.judgeFactualFidelity ?? 0).toFixed(2);
      const presentation = (s.judgePresentationSimilarity ?? 0).toFixed(2);
      console.log(
        `[runner]   ✓ ${s.pairId}: ${s.judgeTrinaryVerdict} (fidelity=${fidelity}, presentation=${presentation}) — ${s.judgePresentationSimilarityReasoning?.slice(0, 100)}...`,
      );
    }
  } else {
    console.log(`[runner]   ✓ All pairs cleared cleanly — no LLM judge needed`);
  }

  // Stage 4 (optional)
  let reproducibility: ReproducibilityResult | undefined;
  if (opts.withReproducibility) {
    console.log(`[runner] Stage 4 — reproducibility test: ${opts.withReproducibility.runs} runs of ${opts.withReproducibility.identityId}...`);
    reproducibility = await runReproducibilityTest(
      opts.withReproducibility.identityId,
      coreAnalysis.body,
      opts.withReproducibility.runs,
    );
    console.log(`[runner]   ✓ pairwise cosine: mean=${reproducibility.pairwiseCosineMean.toFixed(4)}, min=${reproducibility.pairwiseCosineMin.toFixed(4)}, max=${reproducibility.pairwiseCosineMax.toFixed(4)}`);
  }

  // Stage 5 (optional)
  let personaDifferentiation: PersonaDifferentiationResult | undefined;
  if (opts.withPersonaDifferentiation) {
    console.log(`[runner] Stage 5 — persona-overlay differentiation test: ${opts.withPersonaDifferentiation.personaA.name} vs ${opts.withPersonaDifferentiation.personaB.name}...`);
    personaDifferentiation = await runPersonaDifferentiation(
      opts.withPersonaDifferentiation.identityId,
      coreAnalysis.body,
      opts.withPersonaDifferentiation.personaA,
      opts.withPersonaDifferentiation.personaB,
    );
    console.log(`[runner]   ✓ cosine=${personaDifferentiation.cosineSimilarity.toFixed(4)}, rouge-L=${personaDifferentiation.rougeL.toFixed(4)}, differentiated=${personaDifferentiation.differentiated}`);
  }

  // Stage 6 + Stage 7 share Stage 6's outputs (Stage 7 uses them as priors)
  let crossTenantMatrix: CrossTenantMatrixResult | undefined;
  let narrativeStateTest: NarrativeStateTestResult | undefined;
  let narrativeStateJudgeFailures: JudgeFailureRecord[] = [];
  let stage6PersistCost = 0;
  if (opts.withCrossTenantMatrix) {
    console.log(`[runner] Stage 6 — CROSS-TENANT MATRIX (the load-bearing test): ${opts.withCrossTenantMatrix.identityId} × ${opts.withCrossTenantMatrix.personas.length} personas...`);
    callbacks?.onStageStarted?.("cross-tenant");

    // Sequence-mode: pre-fetch accumulated narrative state from the store
    // so each persona's identity call in Stage 6 gets injected with its own
    // history. Single-event `--full` runs skip this entirely and remain
    // byte-identical to today.
    let stage6NarrativeStates: Array<TenantTopicNarrativeState | null> | undefined;
    if (
      opts.readNarrativeStateInCrossTenant &&
      opts.store &&
      opts.fixtureId
    ) {
      stage6NarrativeStates = await Promise.all(
        opts.withCrossTenantMatrix.personas.map((persona) =>
          lookupPersonaState({
            store: opts.store,
            fixtureId: opts.fixtureId,
            persona,
            topicId: opts.event.topicId,
          }),
        ),
      );
      const hits = stage6NarrativeStates.filter((s) => s !== null).length;
      console.log(
        `[runner]   ✓ injected accumulated narrative state from store for ${hits}/${stage6NarrativeStates.length} personas`,
      );
    }

    crossTenantMatrix = await runCrossTenantMatrix(
      opts.withCrossTenantMatrix.identityId,
      coreAnalysis.body,
      opts.withCrossTenantMatrix.personas,
      callbacks,
      stage6NarrativeStates,
      opts.event.topicName,
      opts.withCrossTenantMatrix.tenantIdentityIds,
      opts.withCrossTenantMatrix.tenantWordCountOverrides,
      opts.withCrossTenantMatrix.withConformancePass,
    );
    console.log(`[runner]   ✓ ${crossTenantMatrix.similarities.length} pairs`);
    console.log(`[runner]   ✓ cosine: mean=${crossTenantMatrix.meanCosine.toFixed(4)}, min=${crossTenantMatrix.minCosine.toFixed(4)}, max=${crossTenantMatrix.maxCosine.toFixed(4)}`);
    console.log(`[runner]   ✓ rougeL: mean=${crossTenantMatrix.meanRougeL.toFixed(4)}, min=${crossTenantMatrix.minRougeL.toFixed(4)}, max=${crossTenantMatrix.maxRougeL.toFixed(4)}`);
    console.log(`[runner]   ✓ CROSS-TENANT VERDICT: ${crossTenantMatrix.verdict}`);
    console.log(`[runner]     ${crossTenantMatrix.verdictReasoning}`);

    // Stage 6 write-back: append each output to the store as a new entry.
    // Guarded by `opts.persistNarrativeState` so existing runs don't silently
    // mutate state on disk.
    if (opts.persistNarrativeState && opts.store && opts.fixtureId) {
      console.log(
        `[runner]   ✓ persisting ${crossTenantMatrix.outputs.length} Stage 6 output(s) to narrative-state store...`,
      );
      for (const output of crossTenantMatrix.outputs) {
        if (!output.personaId) {
          throw new Error(
            `runUniquenessPoc: Stage 6 output is missing personaId, cannot persist narrative state`,
          );
        }
        const entry = await extractNarrativeState({
          pieceId: `${output.personaId}-${runId}`,
          publishedAt: opts.event.publishedAt,
          body: output.body,
        });
        await opts.store.append(
          opts.fixtureId,
          output.personaId,
          opts.event.topicId,
          entry,
        );
        stage6PersistCost += entry.extractionCostUsd;
      }
    }

    // Stage 7 — narrative state test (uses Stage 6 outputs as priors)
    if (opts.withNarrativeStateTest) {
      console.log(`[runner] Stage 7 — TEMPORAL NARRATIVE CONTINUITY TEST...`);
      const nstResult = await runNarrativeStateTest({
        identityId: opts.withCrossTenantMatrix.identityId,
        personas: opts.withCrossTenantMatrix.personas,
        priorOutputs: crossTenantMatrix.outputs,
        priorPublishedAt: opts.withNarrativeStateTest.priorPublishedAt,
        secondEvent: opts.withNarrativeStateTest.secondEvent,
        store: opts.store,
        fixtureId: opts.fixtureId,
      });
      narrativeStateTest = nstResult.result;
      narrativeStateJudgeFailures = nstResult.judgeFailures;
      console.log(`[runner]   ✓ TREATMENT VERDICT: ${narrativeStateTest.treatmentVerdict}`);
      console.log(`[runner]     ${narrativeStateTest.treatmentVerdictReasoning}`);
    }

  }

  // Aggregate verdict (intra-tenant cross-identity matrix; cross-tenant has its own verdict in the matrix result)
  const { verdict, reasoning } = aggregateVerdict(similarities);
  console.log(`[runner] Verdict: ${verdict}`);
  console.log(`[runner]   ${reasoning}`);

  // Cost rollup
  const judgeCost = similarities.reduce((sum, s) => sum + (s.judgeCostUsd ?? 0), 0);
  const reproCost = reproducibility
    ? reproducibility.runs.reduce((sum) => sum + 0, 0)
    : 0;
  const crossTenantCost = crossTenantMatrix
    ? crossTenantMatrix.outputs.reduce((sum, o) => sum + o.costUsd, 0) +
      crossTenantMatrix.similarities.reduce((sum, s) => sum + (s.judgeCostUsd ?? 0), 0)
    : 0;
  const narrativeStateCost = narrativeStateTest
    ? narrativeStateTest.secondCoreAnalysis.costUsd +
      narrativeStateTest.narrativeStates.reduce(
        (sum, ns) => sum + (ns.state.recentEntries[0]?.extractionCostUsd ?? 0),
        0,
      ) +
      narrativeStateTest.controlOutputs.reduce((sum, o) => sum + o.costUsd, 0) +
      narrativeStateTest.treatmentOutputs.reduce((sum, o) => sum + o.costUsd, 0) +
      narrativeStateTest.controlSimilarities.reduce((sum, s) => sum + (s.judgeCostUsd ?? 0), 0) +
      narrativeStateTest.treatmentSimilarities.reduce((sum, s) => sum + (s.judgeCostUsd ?? 0), 0)
    : 0;
  // Note: reproducibility identity outputs aren't tracked in the result type for cost
  // (kept simple — the figures we report are the headline calls)
  const totalCostUsd =
    coreAnalysis.costUsd +
    identityOutputs.reduce((sum, o) => sum + o.costUsd, 0) +
    totalEmbeddingCost +
    judgeCost +
    reproCost +
    crossTenantCost +
    narrativeStateCost +
    stage6PersistCost +
    (personaDifferentiation
      ? personaDifferentiation.outputA.costUsd + personaDifferentiation.outputB.costUsd
      : 0);

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startTime;

  callbacks?.onCostUpdated?.(totalCostUsd);

  const judgeFailures: JudgeFailureRecord[] = [
    ...intraTenantJudgeFailures,
    ...(crossTenantMatrix?.judgeFailures ?? []),
    ...narrativeStateJudgeFailures,
  ];

  const result: RunResult = {
    runId,
    startedAt,
    finishedAt,
    event: opts.event,
    coreAnalysis,
    identityOutputs,
    similarities,
    reproducibility,
    personaDifferentiation,
    crossTenantMatrix,
    narrativeStateTest,
    totalCostUsd,
    totalDurationMs,
    verdict,
    verdictReasoning: reasoning,
    judgeFailures,
  };

  callbacks?.onRunCompleted?.(result);

  return result;
}
