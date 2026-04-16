# Archetype Validation PoC — Do 4 Frameworks Produce Sufficiently Different Content?

**Status:** Ready for implementation
**Date:** 2026-04-16
**Author:** Albert Galera + Claude
**Related:**
- `docs/specs/2026-04-16-content-uniqueness-v2.md` — parent spec (Framework Archetype Model)
- `docs/specs/2026-04-12-editorial-memory.md` — editorial memory system (not modified by this PoC)
- `docs/specs/2026-04-07-content-uniqueness.md` — v1 uniqueness gate (thresholds referenced)

---

## Prior Work

Builds on: [Content Uniqueness v2 — Framework Archetype Model](2026-04-16-content-uniqueness-v2.md)
Assumes:
- The 4 archetype definitions from v2 spec section 2.2-2.3 (Conservative Advisor, Active Trader Desk, Retail Educator, Contrarian Strategist)
- The `FrameworkArchetype` TypeScript type from v2 spec section 2.3
- Cross-framework thresholds from v2 spec section 7.2 (cosine < 0.80, ROUGE-L < 0.35)
- Same-framework overlay thresholds from v2 spec section 7.3 (cosine 0.75-0.93, ROUGE-L < 0.55)
- Decision criteria from v2 spec section 11

Changes: Nothing in the parent spec. This is a validation-only PoC that tests the hypothesis before any production code is written.

---

## 1. Goal

Validate the central hypothesis of the Framework Archetype Model: **4 pre-built analytical frameworks, processing the same FA core analysis, produce content that is structurally and semantically distinct enough to serve as the primary cross-tenant differentiation layer.**

This is a go/no-go gate. If the validation passes, the full archetype production system (v2 spec sections 2-6) is worth building. If it fails, the archetype model needs redesign or abandonment before any production investment.

**What this PoC produces:**
- 24 content outputs (3 events x 4 frameworks x 2 overlays)
- A similarity matrix with cosine, ROUGE-L, and two-axis LLM judge scores
- A clear PASS/FAIL verdict against the v2 spec's thresholds
- A cost estimate for the validation run itself

**What this PoC does NOT produce:**
- No production code, no pipeline changes, no editorial memory modifications
- No Postgres schema, no TA agent dependency, no deployment changes

---

## 2. What Exists That Can Be Reused

The existing PoC harness at `packages/api/src/benchmark/uniqueness-poc/` provides most of the measurement infrastructure. The archetype validation reuses it directly.

| Existing Component | File | Reuse Strategy |
|---|---|---|
| Core analysis runner (Stage 1) | `runner.ts` → `runCoreAnalysis()` | Call directly. The FA agent produces the shared facts-only analysis that all frameworks consume. |
| Identity adaptation (Stage 2) | `runner.ts` → `runIdentity()` | **Needs a new code path.** The existing `runIdentity` resolves system prompts from the identity registry via `getIdentityById()` and does not accept custom system prompts. The archetype validation runner must either register temporary identities in the registry or bypass `runIdentity` with a direct Anthropic SDK call using the archetype-composed system prompt. The latter is simpler — reuse `runIdentity`'s Anthropic client setup but compose the messages directly. |
| Embedding + cosine similarity | `similarity.ts` → `embedText()`, `cosineSimilarity()`, `rougeLF1()` | Call directly. Same embedding model (`text-embedding-3-small`), same scoring functions. |
| Two-axis LLM judge | `llm-judge.ts` → `judgePairUniqueness()` | Call directly. The judge rubric (factual fidelity + presentation similarity) applies unchanged to cross-framework pairs. |
| Fixture events | `fixtures/*.json` | Reuse `fed-rate-decision.json` for FOMC event. Need 2 new fixtures (EUR/USD breakout, geopolitical). |
| Persona overlays | `personas/broker-*.json` | Reuse as same-framework overlay pairs. |
| Pricing | `pricing.ts` | Call directly for cost tracking. |
| Types | `types.ts` | Extend with archetype-specific result types. |

**What does NOT exist and must be built:**
1. The 4 `FrameworkArchetype` instances (TypeScript data objects)
2. Archetype-aware identity prompt composition (system prompt + user message builder that takes archetype config + optional tenant overlay)
3. 2 new fixture events (EUR/USD technical breakout, geopolitical escalation)
4. 2 overlay configs per framework (maximally different personas for same-framework testing)
5. A validation runner that orchestrates the 3 x 4 x 2 matrix and produces the comparison report
6. Archetype-specific thresholds and verdict logic

---

## 3. Archetype Definitions

Each archetype is an instance of the `FrameworkArchetype` type from v2 spec section 2.3. The validation PoC defines all 4 as static TypeScript objects.

### 3.1 Conservative Advisor

- **Analytical stance:** Hedged, macro-focused, balanced scenarios. "Risks tilted toward..." not "Go long at..."
- **Horizon:** Weeks to months
- **Structure:** Context → macro drivers → scenario tree (base/upside/downside with rough probabilities) → levels to watch → risk caveats
- **Voice:** Formality 5, hedging high, jargon 4, person "we", avg sentence 22 words
- **Headline style:** Narrative ("Fed Policy Divergence Reshapes the EUR/USD Outlook")

### 3.2 Active Trader Desk

- **Analytical stance:** Momentum-driven, level-focused, explicit directional calls with entry/stop/target
- **Horizon:** Intraday to 5 days
- **Structure:** Signal first (direction + levels in sentence 1) → setup description → key levels table → risk/reward → invalidation
- **Voice:** Formality 2, hedging low, jargon 3, person "impersonal", avg sentence 12 words
- **Headline style:** Signal-first ("EUR/USD: Short Below 1.0850, Target 1.0750")

### 3.3 Retail Educator

- **Analytical stance:** Neutral explainer, no directional commitment. "Here's what to watch" not "Here's what to do"
- **Horizon:** Context-dependent (explains the timeframe, doesn't commit to one)
- **Structure:** What happened (accessible) → Why it matters (cause-and-effect for beginners) → What to watch next → Key terms explained inline
- **Voice:** Formality 2, hedging moderate, jargon 1, person "we" (inclusive), avg sentence 16 words
- **Headline style:** Question-hook ("What Does the Fed Decision Mean for Your EUR/USD Position?")

### 3.4 Contrarian Strategist

- **Analytical stance:** Counter-consensus. Opens with what the market is getting wrong. Directional but against the prevailing read.
- **Horizon:** Strategic (quarters+)
- **Structure:** Consensus view stated and challenged → the overlooked evidence → contrarian thesis → asymmetric risk setup → what would confirm/invalidate
- **Voice:** Formality 4, hedging low, jargon 5, person "we" (institutional), avg sentence 20 words
- **Headline style:** Provocative ("The Market Has the Fed Story Backwards")

---

## 4. Fixture Events

### 4.1 Existing fixture (reuse)

**FOMC Rate Decision** — `fixtures/fed-rate-decision.json` (already exists). Macro-dominant, high-impact event on EUR/USD. This is the strongest test case because all 4 frameworks must interpret the same central bank action differently.

### 4.2 New fixture: EUR/USD Technical Breakout

A TA-dominant event. EUR/USD breaks above a key resistance level on high volume with no fundamental catalyst. Tests whether the Conservative Advisor and Retail Educator (macro/educational) produce content structurally different from the Active Trader Desk (level-focused) and Contrarian Strategist (counter-consensus) on a pure technicals story.

**File:** `fixtures/archetype-validation/eurusd-breakout.json`

### 4.3 New fixture: Geopolitical Escalation

A mixed FA+TA event. A geopolitical escalation (e.g., sanctions, military action) drives safe-haven flows, impacting EUR/USD, gold, and oil simultaneously. Tests cross-asset reasoning differences across frameworks.

**File:** `fixtures/archetype-validation/geopolitical-escalation.json`

---

## 5. Overlay Configs (Same-Framework Testing)

For each framework, define 2 maximally different `ContentPersona` overlays to test whether the deterministic overlay layer produces measurable divergence within a shared framework base article.

| Framework | Overlay A | Overlay B | Key differences |
|---|---|---|---|
| Conservative Advisor | Institutional UK broker (formal, en-GB, no CTAs, 30yr history) | Boutique Swiss wealth advisor (warm-formal, en-US, soft CTAs, 5yr startup) |  Regional variant, CTA policy, company age/positioning, glossary |
| Active Trader Desk | Asian prop trading desk (terse, en-SG, aggressive CTAs, quant-oriented) | EU retail broker's signal service (accessible, en-GB, educational CTAs, retail) | Audience level, CTA style, regional variant, jargon density |
| Retail Educator | US fintech blog (casual, en-US, app-download CTAs, Gen Z audience) | UK bank's learning center (warm-formal, en-GB, webinar CTAs, mid-career) | Formality, audience age, CTA type, regional language |
| Contrarian Strategist | Hedge fund research note (dense, en-US, no CTAs, institutional) | Independent newsletter (provocative, en-GB, subscription CTAs, sophisticated retail) | CTA policy, distribution channel, audience sophistication |

**Files:** `fixtures/archetype-validation/overlays/*.json` (8 persona files, 2 per framework)

---

## 6. Test Runner Design

### 6.1 Execution flow

```
For each of 3 events:
  1. Run FA core analysis (Opus) → 1 shared analysis per event
  2. For each of 4 frameworks:
     a. Compose archetype-aware identity prompt (framework config → system prompt + user message)
     b. Run identity call (Sonnet) with overlay A → output A
     c. Run identity call (Sonnet) with overlay B → output B
  → 8 outputs per event (4 frameworks x 2 overlays)

Total: 3 events x 8 outputs = 24 outputs

Then measure:
  3. Embed all 24 outputs
  4. Cross-framework comparisons: for each event, 6 framework pairs x 2 overlay combos = up to 24 pair comparisons
     (simplified: compare overlay-A outputs across frameworks = 6 pairs per event = 18 cross-framework pairs)
  5. Same-framework comparisons: for each event, 4 frameworks x 1 intra-framework pair = 4 pairs per event = 12 same-framework pairs
  6. Two-axis LLM judge on all 30 pairs
  7. Aggregate and report
```

### 6.2 Prompt composition

The archetype-aware identity prompt is built by composing:

1. **System prompt** — derived from the archetype's `voiceDirectives`, `structuralTemplate`, and `analyticalStance`. This replaces the existing identity-specific system prompts (in-house-journalist, trading-desk, etc.). Each archetype gets ONE system prompt that encodes its entire editorial personality.

2. **User message** — the FA core analysis + persona overlay directives (brand voice, glossary, CTAs, company background, regional variant). Same structure as the existing `buildInHouseJournalistUserMessage` but with archetype-level framing directives prepended.

The key insight: the system prompt changes per framework (4 variants), while the user message overlay changes per tenant (N variants). The PoC validates that the system prompt differences (framework) dominate the user message differences (overlay).

### 6.3 Output structure

```ts
interface ArchetypeValidationResult {
  runId: string;
  startedAt: string;
  finishedAt: string;

  events: Array<{
    eventId: string;
    coreAnalysis: CoreAnalysis;
    outputs: Array<{
      frameworkId: FrameworkArchetypeId;
      overlayId: string;      // "overlay-a" | "overlay-b"
      personaId: string;
      output: IdentityOutput;
    }>;
  }>;

  crossFrameworkPairs: SimilarityResult[];
  sameFrameworkPairs: SimilarityResult[];

  crossFrameworkStats: {
    meanCosine: number;
    maxCosine: number;
    meanRougeL: number;
    maxRougeL: number;
    allPairsBelow080: boolean;
    allRougeLBelow035: boolean;
    allJudgeDistinct: boolean;
  };

  sameFrameworkStats: {
    meanCosine: number;
    minCosine: number;
    maxCosine: number;
    meanRougeL: number;
    maxRougeL: number;
    allRougeLBelow055: boolean;
    judgeDistinctRate: number;   // fraction of pairs judged "distinct_products"
  };

  verdict: "PASS" | "FAIL" | "PARTIAL";
  verdictReasoning: string;
  totalCostUsd: number;
  totalDurationMs: number;
}
```

---

## 7. Pass/Fail Criteria

Pulled directly from v2 spec sections 7.2, 7.3, and 11. **Vocabulary note:** the v2 spec uses prose labels ("DISTINCT", "RESKINNED", "HALT"); the PoC codebase uses `distinct_products`, `reskinned_same_article`, `fabrication_risk` (defined in `types.ts`). This spec uses the code-level labels since it targets the PoC harness.

### 7.1 Cross-framework (the load-bearing gate)

All criteria must pass for the validation to succeed.

| Criterion | Threshold | Source |
|---|---|---|
| Mean cosine similarity across all 6 framework pairs, averaged over 3 events | < 0.80 | v2 spec section 7.2 |
| No single cross-framework pair on any event exceeds cosine | < 0.80 | v2 spec section 7.2 |
| Mean ROUGE-L F1 across all cross-framework pairs | < 0.35 | v2 spec section 7.2 |
| Two-axis LLM judge scores all cross-framework pairs | `distinct_products` (maps to v2 spec's "DISTINCT") | v2 spec section 7.2 |
| No cross-framework pair flagged as | `fabrication_risk` (maps to v2 spec's "HALT") | v2 spec section 7.2 |

### 7.2 Same-framework overlay (informational, not blocking)

These inform whether the overlay layer is viable but do not block the archetype decision itself.

| Criterion | Threshold | Source |
|---|---|---|
| Mean cosine of same-framework pairs with max-different overlays | 0.75 - 0.93 | v2 spec section 7.3 |
| ROUGE-L F1 of same-framework pairs | < 0.55 | v2 spec section 7.3 |
| Two-axis LLM judge "distinct_products" rate for same-framework pairs | >= 50% | v2 spec section 7.3 |

### 7.3 Aggregate verdict

| Condition | Verdict |
|---|---|
| All cross-framework criteria pass | **PASS** — proceed to build the archetype production system |
| Cross-framework criteria pass, same-framework overlay results are weak | **PARTIAL** — archetype model is valid, but overlay strategy needs work before multi-tenant same-framework publishing |
| Any cross-framework criterion fails | **FAIL** — archetypes do not produce sufficient differentiation; do not build |

---

## 8. Decision Gate

### If PASS

1. Commit to the archetype model as the primary cross-tenant differentiation mechanism
2. Proceed to implement v2 spec sections 2-6 (production archetype system)
3. Record the validation metrics as the baseline for production threshold tuning
4. Archive this PoC's outputs as the reference dataset

### If PARTIAL

1. The archetype model is sound for cross-framework differentiation
2. Same-framework overlay strategy needs strengthening before multi-tenant same-framework publishing
3. Options: sub-archetype customization (v2 spec Q2), editorial memory as differentiator (v2 spec section 3.3), or accept the overlay limitation as a product reality (v2 spec section 3.3 "Accept it as a product reality")
4. Build the archetype production system but defer same-framework multi-tenant publishing

### If FAIL

1. Do not build the archetype production system
2. Analyze which framework pairs failed and why:
   - If 2 frameworks are too similar, consider merging them (reduce K from 4 to 3)
   - If all frameworks converge, the problem is in prompt composition, not archetype design — iterate on prompts before re-running
   - If the LLM judge flags fabrication risk, the framework prompts are too aggressive in pushing divergence at the cost of factual fidelity
3. Revisit the House Position brief's per-tenant approach or design a hybrid

---

## 9. Cost Estimate

### 9.1 Per-run LLM costs

| Component | Model | Count | Est. cost/call | Total |
|---|---|---|---|---|
| FA core analysis | Opus | 3 events | $0.21 | $0.63 |
| Framework identity calls | Sonnet | 24 (3 events x 4 frameworks x 2 overlays) | $0.03 | $0.72 |
| Embeddings | text-embedding-3-small | 24 | ~$0.00002 | ~$0.0005 |
| Cross-framework judge | Haiku | 18 (6 pairs x 3 events) | $0.008 | $0.14 |
| Same-framework judge | Haiku | 12 (4 pairs x 3 events) | $0.008 | $0.10 |
| **Total per run** | | | | **~$1.60** |

### 9.2 Expected runs

- 1 initial run to establish baseline: $1.60
- 1-2 iteration runs after prompt tuning: $1.60-3.20
- **Total validation budget: ~$5-8**

This is negligible relative to the production system it gates.

---

## 10. Requirements

### Phase 1: Foundation — Types, Fixtures, Archetype Definitions

Build the data layer: archetype TypeScript definitions, fixture events, and overlay personas.

#### Archetype Type and Instances

**Acceptance criteria:**
- [ ] `FrameworkArchetype` type defined at `packages/api/src/benchmark/uniqueness-poc/archetypes/types.ts` matching v2 spec section 2.3 exactly (all fields, correct union types, no `any`)
- [ ] `FrameworkArchetypeId` union type: `'conservative-advisor' | 'active-trader-desk' | 'retail-educator' | 'contrarian-strategist'`
- [ ] 4 archetype instances exported from `packages/api/src/benchmark/uniqueness-poc/archetypes/definitions.ts`, one per archetype ID
- [ ] Each instance has all required fields populated with values matching sections 3.1-3.4 of this spec
- [ ] `getArchetypeById(id: FrameworkArchetypeId)` lookup function exported
- [ ] `bun run typecheck` passes with zero errors

#### Fixture Events

**Acceptance criteria:**
- [ ] `fixtures/archetype-validation/eurusd-breakout.json` — a TA-dominant EUR/USD breakout event with `topicId: "eurusd"`, `topicName: "EUR/USD"`, and a body of at least 300 words describing a technical breakout with key levels, volume data, and pattern context
- [ ] `fixtures/archetype-validation/geopolitical-escalation.json` — a geopolitical event with `topicId: "eurusd"`, `topicName: "EUR/USD"`, and a body of at least 300 words describing a mixed FA+TA scenario with safe-haven flows and cross-asset impacts
- [ ] Both fixtures conform to the existing `NewsEvent` interface in `types.ts`
- [ ] Both fixtures are valid JSON and can be imported by the runner

#### Overlay Personas

**Acceptance criteria:**
- [ ] 8 persona JSON files at `fixtures/archetype-validation/overlays/` — 2 per framework, named `{framework-id}-overlay-a.json` and `{framework-id}-overlay-b.json`
- [ ] Each persona conforms to the `ContentPersona` interface
- [ ] Overlay A and B for each framework are maximally different per section 5 of this spec (different `regionalVariant`, `ctaPolicy`, `brandVoice`, `companyBackground`, `audienceProfile`)
- [ ] Each persona has non-empty `companyBackground` (at least 3 facts) and non-empty `ctaLibrary` (at least 1 CTA)

### Phase 2: Prompt Composition — Archetype-Aware Identity Calls

Build the prompt layer that converts archetype config into identity agent system prompts and user messages.

#### Archetype Identity Prompt Builder

**Acceptance criteria:**
- [ ] `buildArchetypeSystemPrompt(archetype: FrameworkArchetype): string` exported from `packages/api/src/benchmark/uniqueness-poc/archetypes/prompt-builder.ts`
- [ ] The system prompt encodes the archetype's `analyticalStance`, `voiceDirectives`, and `structuralTemplate` as concrete writing directives (not abstract descriptions)
- [ ] The system prompt includes the factual fidelity hard constraint from the existing identity prompts ("The source analysis is your factual ground truth...")
- [ ] `buildArchetypeUserMessage(coreAnalysis: string, archetype: FrameworkArchetype, persona?: ContentPersona): string` exported from the same file
- [ ] When `persona` is provided, the user message includes brand voice, glossary, CTA, companyBackground, and regional variant directives (same injection pattern as the existing `buildInHouseJournalistUserMessage`)
- [ ] When `persona` is not provided, the user message contains only the core analysis and archetype framing
- [ ] The 4 generated system prompts are materially different: no two share more than 20% of their directive text (excluding the factual fidelity boilerplate)
- [ ] `bun run typecheck` passes with zero errors

### Phase 3: Runner and Measurement

Build the validation runner that produces the 24 outputs and measures them.

#### Archetype Validation Runner

**Acceptance criteria:**
- [ ] `runArchetypeValidation(opts: { events: NewsEvent[]; archetypes: FrameworkArchetype[]; overlays: Map<FrameworkArchetypeId, [ContentPersona, ContentPersona]> }): Promise<ArchetypeValidationResult>` exported from `packages/api/src/benchmark/uniqueness-poc/archetypes/validation-runner.ts`
- [ ] For each event: runs `runCoreAnalysis` once, then runs `runIdentity` with each archetype x overlay combination (8 calls per event, 24 total)
- [ ] Identity calls use the archetype-aware system prompt from `buildArchetypeSystemPrompt` (registered as a temporary identity or called via a custom code path that reuses the Anthropic client)
- [ ] All 24 outputs are embedded via `embedText`
- [ ] Cross-framework pairs: for each event, compares overlay-A outputs across all 6 framework pairs (18 total cross-framework comparisons)
- [ ] Same-framework pairs: for each event, compares overlay-A vs overlay-B within each framework (12 total same-framework comparisons)
- [ ] All 30 pairs are scored with cosine similarity, ROUGE-L F1, and the two-axis LLM judge
- [ ] The result object includes `crossFrameworkStats` and `sameFrameworkStats` with the fields defined in section 6.3
- [ ] The verdict is computed according to section 7.3 of this spec
- [ ] Total cost is tracked and reported
- [ ] `bun run typecheck` passes with zero errors

#### CLI Entry Point

**Acceptance criteria:**
- [ ] `packages/api/src/benchmark/uniqueness-poc/archetypes/index.ts` — a CLI script runnable as `bun run packages/api/src/benchmark/uniqueness-poc/archetypes/index.ts`
- [ ] Loads the 3 fixture events, 4 archetype definitions, and 8 overlay personas
- [ ] Calls `runArchetypeValidation` and prints a structured report to stdout
- [ ] Saves the full `ArchetypeValidationResult` as JSON to `uniqueness-poc-runs/{runId}/archetype-validation.json`
- [ ] The report includes: per-event breakdown, cross-framework matrix, same-framework matrix, aggregate verdict, total cost
- [ ] Error case: missing `ANTHROPIC_API_KEY` → exits with descriptive error message before making any calls
- [ ] Error case: missing `OPENAI_API_KEY` → exits with descriptive error message before making any calls

---

## 11. Implementation Plan (Sprint Contracts)

### Phase 1

- [ ] **Task 1:** Define `FrameworkArchetype` type and `FrameworkArchetypeId` union
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/types.ts`
  - **Depends on:** Nothing
  - **Verify:** `bun run typecheck` passes. Type is importable from other modules. All fields from v2 spec section 2.3 are present with correct types.

- [ ] **Task 2:** Instantiate 4 archetype definitions
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/definitions.ts`
  - **Depends on:** Task 1
  - **Verify:** `bun run typecheck` passes. `getArchetypeById('conservative-advisor')` returns a non-null object with all required fields populated. All 4 IDs resolve.

- [ ] **Task 3:** Create 2 new fixture events + 8 overlay persona files
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/fixtures/archetype-validation/eurusd-breakout.json`, `packages/api/src/benchmark/uniqueness-poc/fixtures/archetype-validation/geopolitical-escalation.json`, `packages/api/src/benchmark/uniqueness-poc/fixtures/archetype-validation/overlays/*.json` (8 files)
  - **Depends on:** Nothing (can run in parallel with Tasks 1-2)
  - **Verify:** All JSON files parse without error. Each event file has all `NewsEvent` fields. Each persona file has all `ContentPersona` fields. The 2 overlays per framework have different `regionalVariant`, `ctaPolicy`, and `companyBackground` values.

### Phase 2

- [ ] **Task 4:** Build archetype-aware prompt builder
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/prompt-builder.ts`
  - **Depends on:** Task 1, Task 2
  - **Verify:** `buildArchetypeSystemPrompt(conservativeAdvisor)` returns a string > 500 chars. The 4 system prompts differ materially (manual inspection of first 200 chars of each). `buildArchetypeUserMessage` includes the core analysis text and, when a persona is provided, the persona's brand voice and companyBackground. `bun run typecheck` passes.

- [ ] **Task 5:** Define `ArchetypeValidationResult` type and verdict logic
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/types.ts` (append)
  - **Depends on:** Task 1
  - **Verify:** `bun run typecheck` passes. The type includes all fields from section 6.3. A helper function `computeArchetypeVerdict(crossFramework, sameFramework)` returns `PASS`, `PARTIAL`, or `FAIL` according to section 7.3.

### Phase 3

- [ ] **Task 6:** Build the validation runner
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/validation-runner.ts`
  - **Depends on:** Tasks 1-5
  - **Verify:** With `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set, running a single-event validation (1 event, 4 frameworks, 2 overlays) completes without error, produces 8 outputs, 6 cross-framework pairs, 4 same-framework pairs, and a verdict. Cost is tracked and reported. `bun run typecheck` passes.

- [ ] **Task 7:** Build CLI entry point and report
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/archetypes/index.ts`
  - **Depends on:** Task 6
  - **Verify:** `bun run packages/api/src/benchmark/uniqueness-poc/archetypes/index.ts` loads fixtures, runs the full 3-event validation, prints a report, and saves JSON to `uniqueness-poc-runs/`. Total cost is within $1-3 of the estimate in section 9. `bun run typecheck` passes.

- [ ] **Task 8:** Run full validation, analyze results, record verdict
  - **Files:** None (execution + analysis)
  - **Depends on:** Task 7
  - **Verify:** The validation run completes. The verdict (PASS/PARTIAL/FAIL) is recorded in the v2 spec's decision log (section 12). If PASS, the archetype model is approved for production implementation. If FAIL, the failure analysis is documented in the run output with specific pair-level diagnostics.

---

## 12. Constraints

- **No Postgres.** All data is in-memory or JSON files. No database dependency.
- **No pipeline wiring.** The validation runner is standalone, not integrated into the production pipeline.
- **No editorial memory changes.** The editorial memory system is not involved in this validation.
- **No TA agent dependency.** The FA agent produces the core analysis; TA is out of scope for this validation. Archetypes reference TA in their `taTimeframes` and `taEmphasis` fields, but those are defined (not exercised) in this PoC.
- **Strict TypeScript, no `any`.** All types fully defined. `bun run typecheck` passes at every task.
- **All structured LLM output via Anthropic `tool_use`.** The validation runner uses the existing Anthropic SDK and `tool_use` patterns (for the LLM judge). Identity calls use plain text output (same as existing identities).
- **Reuse existing PoC infrastructure.** The validation runner calls `runCoreAnalysis`, `runIdentity`, `embedText`, `cosineSimilarity`, `rougeLF1`, and `judgePairUniqueness` from the existing harness. No reimplementation.

---

## 13. Out of Scope

| Item | Why not now |
|---|---|
| Production archetype system (v2 spec sections 2-6) | This PoC gates that investment. Build only if validation passes. |
| TA integration in archetype identity calls | TA agent not yet shipped. `taTimeframes` and `taEmphasis` fields are defined in the archetype type but not exercised. |
| Editorial memory under archetypes (v2 spec section 5) | Requires production archetype system first. |
| Per-tenant archetype customization / sub-archetypes (v2 spec Q2) | Premature. Validate the 4 base archetypes first. |
| Shadow mode / production rollout (v2 spec section 7.4) | Requires production pipeline. |
| Playground UI for archetype validation | CLI-only is sufficient for the go/no-go gate. |
| Conformance pass on archetype outputs | The conformance pass is a post-generation step that operates on the overlay layer. Validating it is useful but not blocking for the archetype hypothesis. |

---

## 14. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Should the archetype identity call use Sonnet (current default for identity calls) or Opus (stronger adherence to complex system prompts)? Sonnet is 5x cheaper but may collapse archetype voice differences. | Could affect whether frameworks produce different enough content. Run first with Sonnet; if cross-framework cosine is borderline (0.75-0.80), re-run with Opus to see if it helps. | Before interpreting results |
| 2 | Should the 2 overlay personas per framework share the same `preferredAngles` and `personalityTags`, or should those differ too? If they differ, it confounds the measurement (divergence could be from tags, not overlays). | Cleaner measurement if tags are identical and only brand/glossary/CTA/companyBackground differ. | Task 3 (fixture creation) |
| 3 | The existing LLM judge rubric was designed for cross-tenant pairs with the same identity. Does the rubric need adaptation for cross-framework pairs where the analytical stance is deliberately different? Specifically: a Conservative Advisor hedging and a Trader giving explicit levels are factually compatible but analytically different. | May need to relax the factual fidelity axis for cross-framework pairs (different frameworks may legitimately emphasize different facts). | Task 6 (runner implementation) |
