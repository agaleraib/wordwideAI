# FinFlow Content Uniqueness Gate

**Date:** 2026-04-07
**Status:** Draft (decision spec — no code yet)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (decisions), Claude (drafting)
**Companion specs:**
- `2026-04-07-content-pipeline.md` — the dispatcher and producer pipeline that this gate sits inside (stage 9 of §5)
- `2026-04-07-deployment-stack.md` — pgvector dependency, embedding storage
- `2026-04-07-data-sources.md` — upstream document fetcher

---

## 1. Goal

Guarantee that **every piece of content FinFlow generates is meaningfully different from every other piece of content FinFlow has generated for any other client (and to a looser standard, from the same client's other pipelines)** when the underlying news event is the same.

This is the **load-bearing differentiator of the entire business case**. If two clients can compare their dashboards and see the same article with different brand wrappers, the product fails — first commercially (they can buy that from FXStreet for less), then technically (Google's duplicate-content detection penalizes both sites and tanks their organic traffic).

The gate must clear **two independent bars**:

| Bar | Standard | Why |
|---|---|---|
| **Product perception** | A discerning client reading both pieces should perceive them as distinct work, not a reskin | The premium pricing only justifies if the work feels bespoke |
| **SEO survival** | Google's duplicate-content detector should not flag them | Duplicate-content penalties degrade organic traffic for *all* affected clients simultaneously |

The two bars have different shapes. Product perception is fuzzy and forgives shared facts if the framing/voice/structure differ. SEO is unforgiving on prose-level n-gram overlap regardless of how different the framing is. We have to clear both.

---

## 2. Non-goals

| Out of scope | Lives where |
|---|---|
| Document fetching, event clustering, impact classification, fan-out mechanics | `2026-04-07-content-pipeline.md` |
| Content generation itself (FA/TA/hybrid agents) | Content pipeline spec §5.7, agent code |
| Compliance review | FinFlow compliance agent |
| Translation engine internals | `packages/api/src/pipeline/translation-engine.ts` |
| Enforcing uniqueness against **external** sources (FXStreet, Investing.com, Reuters analysis) | Hard problem, deferred — we cannot crawl the internet for similarity. We rely on deliberate diversification to make collisions with external sources unlikely. |
| Plagiarism detection against **the source document itself** (don't paraphrase Reuters into our analysis) | Out of scope here; should be handled by the content agents at generation time, not the uniqueness gate |

---

## 3. Two-layer strategy: pre-allocate, then verify

Uniqueness is enforced at two stages of the content pipeline, not one.

**Layer 1 — Pre-allocation at brief time (the bulk of the work).** When the dispatcher creates a `ContentBrief`, it deterministically assigns an angle, persona, format, length, and CTA from the pipeline's `ContentPersona`. Two pipelines with different personas naturally produce different content **by construction**; the pre-allocation does ~90% of the diversification work.

**Layer 2 — Verification gate at content-output time (the safety net).** After the content agent produces a draft, before compliance and translation, the uniqueness gate runs a three-stage similarity check against all prior content for the same event and topic. On collision, one regeneration attempt with a diversification hint, then HITL escalation.

This split matters because:
- Generation is **expensive** (Opus, multi-hundred-token outputs); we want to get it right first try most of the time.
- Verification is **cheap** (embeddings + n-grams); we can afford to run it on every output.
- The verification gate exists to catch the rare cases where two pipelines genuinely collide despite different personas — not as the primary diversification mechanism.

If we relied on verification alone, generation would loop until it stumbled into a different output, wasting tokens and time. If we relied on pre-allocation alone, we'd ship occasional collisions when two clients have unusually similar profiles. Both layers earn their keep.

**Layer 1.5 — Brand voice conformance pass (added 2026-04-10, validated in PoC).** After the identity agent generates content and before the uniqueness gate, an optional brand voice enforcement pass rewrites each output to strictly match the tenant's persona profile — formality level, sentence length, hedging frequency, person preference, and company background facts. This is a post-generation style rewrite, not a full 13-metric conformance loop. It targets the structural-convergence problem: two outputs from the same identity sharing the same core analysis tend to follow the same narrative blueprint despite different persona overlays. The conformance pass pushes them apart by enforcing voice differences more aggressively than the identity agent does on its own.

PoC validation (2026-04-10, `worktree-poc-conformance-layer` branch): same fixture, same identity (Beginner Blogger), two personas (Premium Capital Markets formality 5/5 vs FastTrade Pro formality 1/5). Without conformance: cosine 0.90, presentation 0.52. With conformance: cosine 0.79, presentation 0.32. Fidelity preserved at 0.95. The pass uses the translation engine's `callAgentWithUsage` infrastructure but a dedicated brand-voice prompt — not the translation-specific `correctStyle` specialist.

Only the **Style & Voice** category of the translation engine's specialist taxonomy is brought into the content pipeline. Terminology (glossary) is per-language and not the divergence driver at this stage. Structural and Linguistic specialists are translation-specific and do not apply. See the content-pipeline spec §5.9 for the full architectural rationale.

---

## 4. `ContentPersona` shape

Lives on `ContentPipeline` (see `2026-04-07-content-pipeline.md` §4.1). One persona per pipeline; a tenant with N pipelines has N personas.

```ts
type ContentPersona = {
  // ─────────── Identity ───────────
  authorPersona: string;             // "in-house journalist", "senior FX strategist", "trader's desk"
  voiceDescription: string;          // 1-3 sentence voice guide, fed to the writer LLM
  voiceExamples?: string[];          // optional 2-5 sample paragraphs in this voice for few-shot

  // ─────────── Audience ───────────
  audienceProfile: string;           // "retail traders, intermediate sophistication"
  audienceSophistication: 'beginner' | 'intermediate' | 'professional';

  // ─────────── Angle preferences (the primary diversification lever) ───────────
  preferredAngles: AngleTag[];       // ranked; first = primary preference
  forbiddenAngles: AngleTag[];       // never use these for this persona
  preferredFraming: 'analytical' | 'narrative' | 'urgency' | 'educational' | 'contrarian';

  // ─────────── Calls to action ───────────
  ctaLibrary: CTAEntry[];
  ctaPolicy: 'always' | 'when-relevant' | 'never';

  // ─────────── Compliance / positioning ───────────
  forbiddenClaims: string[];         // "guaranteed returns", "risk-free", etc.
  jurisdictions: string[];           // ISO codes — passed to the compliance gate
  brandPositioning: string;          // 1-2 sentence brand voice statement

  // ─────────── Company background (added 2026-04-10) ───────────
  companyBackground?: string[];      // factual company claims the writer can weave in:
                                     // founding year, team size, sponsorships, proprietary tools,
                                     // community stats, awards, track record. Drives uniqueness by
                                     // construction — two companies' facts can never converge.
                                     // Populated during onboarding (scrape + questionnaire).
};

type CTAEntry = {
  id: string;
  text: string;                      // "Open an account now to trade EUR/USD"
  conditions?: string;               // "only on bullish/bearish, not mixed/unclear"
  priority: number;                  // for ranking when multiple CTAs match
};

type AngleTag =
  | 'macro-flow'           // risk-on/off, capital flows
  | 'technical-reaction'   // chart levels, momentum
  | 'trade-idea'           // specific entry/exit suggestion
  | 'risk-warning'         // volatility, hedge, defensive positioning
  | 'educational'          // explainer / "what does this mean for you"
  | 'macro-narrative'      // broader story arc, context
  | 'correlation-play'     // cross-asset arbitrage angle
  | 'positioning'          // institutional flow, sentiment
  | 'safe-haven'           // flight-to-quality framing
  | string;                // open string for custom angles
```

The `AngleTag` union is deliberately a closed core taxonomy with an open-string escape hatch. The closed core lets the pre-allocator reason structurally. The open hatch lets clients add custom angles when their pipeline doesn't fit ("commodity-supply-disruption", "central-bank-watch", "earnings-cycle"). Custom angles are treated as opaque tags by the pre-allocator — they only affect uniqueness via differentness, not via structural reasoning.

**Note on what's NOT in `ContentPersona`:** format, length, native shape, and the actual writing voice are owned by the **identity agent** the pipeline picks (see content-pipeline §4.0 and §5.7b). A `BeginnerBlogger` identity natively produces ~600-word beginner blog posts; a `TradingDesk` identity natively produces ~150-word terse alerts. The identity *is* the format, length, and structural voice. `ContentPersona` is the **client-specific overlay** on top of that — brand positioning, audience hint, angle preferences, CTA library, jurisdictions, forbidden claims. The identity agent reads the persona as context to bias its in-voice writing toward the client's brand; the conformance engine then applies the deterministic glossary + regional variant + brand-voice corrections afterwards.

In short: **identity = native shape and editorial voice; persona = client overlay applied on top.** Two clients picking the same identity (e.g. both pick `InHouseJournalist`) get the same base shape and voice, with their respective personas applied as context to the identity agent and as deterministic corrections in the conformance engine. The uniqueness gate catches any residual collision.

---

## 5. Pre-allocation algorithm

The dispatcher runs this when creating a `ContentBrief`. Inputs and outputs:

```ts
type AllocationInput = {
  pipeline: ContentPipeline;          // includes contentPersona
  event: EventCluster;                // includes fingerprint, lead entities
  topic: { id: string; impactScore: number; direction: ImpactDirection };
  priorBriefsForEvent: ContentBrief[]; // briefs already created for THIS event,
                                       // ANY tenant, ANY pipeline, in last 90 days
};

type AllocationOutput = {
  preferredAngle: AngleTag;
  ctaSelection: CTAEntry | null;
  expectedLength: { min: number; target: number; max: number };
  diversificationNote: string;        // human-readable, surfaced in HITL
};
```

Algorithm:

```
1. CANDIDATE_ANGLES = pipeline.contentPersona.preferredAngles
                      MINUS pipeline.contentPersona.forbiddenAngles
                      INTERSECTED WITH angles_compatible_with_topic_and_event(topic, event)

   Compatibility rules (heuristic, instrument-catalog-grounded):
   - "trade-idea" requires impact direction != 'unclear' AND confidence >= 0.6
   - "safe-haven" requires event tagged as risk-off
   - "correlation-play" requires the topic to have non-empty correlatedWith
   - "technical-reaction" requires recent price-action context (else suppress for this brief)
   - others: always compatible

2. SCORE each candidate angle:
   score(angle) =
       persona_priority_weight(angle, persona.preferredAngles)   # higher = more preferred
     - diversity_penalty(angle, priorBriefsForEvent)             # decay per prior use of same angle
     + framing_match_bonus(angle, persona.preferredFraming)      # small alignment boost

3. PICK the highest-scoring angle.
   Tiebreak: persona's first preference wins.

4. SELECT CTA from persona.ctaLibrary:
   - If ctaPolicy == 'never' → null
   - If ctaPolicy == 'always' → highest-priority CTA whose conditions match
   - If ctaPolicy == 'when-relevant' → highest-priority CTA whose conditions match the
     impact direction and confidence; null if no match

5. EXPECTED LENGTH = pipeline.defaultLengthWords (already on the pipeline, copied for the brief)

6. DIVERSIFICATION NOTE = human-readable summary:
   "Angle: {chosen}. Persona prefers {top 3}. {N} prior brief(s) on this event used
    {other angles}. CTA: {chosen or 'none'}."
```

**Key properties:**

- **Deterministic.** Same inputs → same output. Re-running on the same event produces the same allocation, which is essential for re-runs and audit reproducibility.
- **Diversity-aware across the entire fan-out.** The `priorBriefsForEvent` parameter includes briefs from *other tenants and other pipelines for the same event*. This is what spreads the angles across the fan-out: if Tenant A's retail pipeline has already claimed `macro-flow`, Tenant B's similar pipeline will be pushed toward `risk-warning` even though both prefer `macro-flow` first.
- **Persona-bounded.** A pipeline never gets allocated an angle outside its `preferredAngles ∖ forbiddenAngles` set, even under diversity pressure. If the persona's preferred angles are all already taken by prior briefs and only forbidden ones remain, the brief is marked `pending-collision` and surfaced to HITL — no silent override of persona constraints.
- **Order-sensitive.** Briefs are allocated in the order they enter the dispatcher. First-come pipelines get their first preference; later pipelines get pushed to lower preferences. This matters for auditability ("why did Pipeline X get angle Y?") and is documented in the brief's `diversificationNote`.

The allocation is **persisted on the brief**. The identity agent (content-pipeline §5.7b) reads `preferredAngle` from the brief and bakes it into its transformation prompt as a constraint, not a suggestion: *"Transform the cached core analysis from the {angle} angle. Do not adopt the {forbidden_angles} framing."* The angle is fed to the **identity layer**, not to the FA/TA core analytical layer (content-pipeline §5.7a) — the core analysis stays angle-agnostic so the cache remains valid across all 9 angles. This is a deliberate decision: we pay one core call per (event × topic × method) and reuse it for every angle the identity layer wants to emphasize.

---

## 6. The verification gate

Runs after the content agent produces a draft, before the compliance gate. Three stages, cheapest first; later stages only fire if earlier ones are inconclusive.

### 6.1 Stage 1 — Embedding similarity

```
1. Compute embedding(generated_content.body) using the canonical embedding model.
2. Query generated_content WHERE event_id = X AND topic_id = Y
                            AND created_at > now() - INTERVAL '90 days'
                            AND tenant_id != current_tenant   -- cross-tenant check
   ORDER BY embedding <=> new_embedding ASC LIMIT 5;
3. If max(1 - cosine_distance) >= CROSS_TENANT_COSINE_THRESHOLD → FAIL_CROSS_TENANT
4. Repeat the query WHERE tenant_id = current_tenant AND pipeline_id != current_pipeline
                    (intra-tenant cross-pipeline check).
5. If max(1 - cosine_distance) >= INTRA_TENANT_COSINE_THRESHOLD → FAIL_INTRA_TENANT
6. If both checks pass clearly (max similarity below thresholds with margin), → PASS.
7. If max similarity is within MARGIN of either threshold → BORDERLINE → fall through to stage 2.
```

**Default thresholds (tuned during v1, see §10):**

| Comparison | Cosine threshold | Borderline margin |
|---|---|---|
| Cross-tenant | 0.85 | ±0.05 |
| Intra-tenant cross-pipeline | 0.92 | ±0.03 |

Cross-tenant is strict because Google does not care about your editorial intent. Intra-tenant is looser because a single client's two pipelines analyzing the same event will share underlying perspective and conclusions — they need to differ in voice/format/CTA, not necessarily in fundamental claims.

**Embedding model: `text-embedding-3-small` (OpenAI), 1536 dimensions.** Cheap, fast, well-known, dimension fits the schema. Selected as the canonical embedding model for the entire system; *all stored embeddings use this model*. Swapping later requires re-embedding the entire corpus and re-validating the thresholds — meaningful migration cost. Picking it carefully now matters more than picking the absolute-best model.

**Threshold notes:** these are first-pass values. We will tune them against the live consistency-test harness during v1 rollout. The schema stores both `max_cross_tenant_similarity` and `max_intra_tenant_similarity` so we can analyze the actual distribution before locking in production thresholds.

### 6.2 Stage 2 — N-gram overlap

Embedding similarity catches *semantic* duplication but is somewhat forgiving on prose-level paraphrase ("synonym swap" attacks that fool embeddings but not Google). Stage 2 catches the SEO bar specifically.

```
1. For each candidate from stage 1's top-5 list (regardless of cosine score),
   compute ROUGE-L F1 between new_body and candidate_body.
2. If max(rouge_l) >= CROSS_TENANT_ROUGE_THRESHOLD vs cross-tenant candidates → FAIL_CROSS_TENANT_NGRAM
3. If max(rouge_l) >= INTRA_TENANT_ROUGE_THRESHOLD vs intra-tenant candidates → FAIL_INTRA_TENANT_NGRAM
4. Else → PASS (or fall through to stage 3 if stage 1 was borderline).
```

**Default thresholds:**

| Comparison | ROUGE-L F1 threshold |
|---|---|
| Cross-tenant | 0.40 |
| Intra-tenant | 0.50 |

ROUGE-L (longest common subsequence-based) is chosen over n-gram BLEU because it handles reorderings better — a paraphrase that shuffles paragraph order but reuses phrases will still trigger ROUGE-L. We're not trying to be perfect, we're trying to catch the things that would catch Google's eye.

**Computation:** ROUGE-L is fast, deterministic, no LLM. Computed locally in the gate, no API call. ~milliseconds per candidate, ~tens of milliseconds for the top-5 list.

### 6.3 Stage 3 — LLM judge (only if stages 1 or 2 were borderline)

Stages 1 and 2 produce numbers. Numbers in the gray zone (within margin) need a qualitative call. Stage 3 makes that call once, with structured output.

```
input = {
  newContent: { body, angle, persona },
  candidates: [{ body, angle, persona, similarity, rouge }, …],  // top borderline matches
};

prompt (Haiku, tool_use):
  "You are auditing two pieces of financial analysis content for uniqueness.
   They were both produced from the same news event, for the same market topic.
   Decide whether they would be perceived as MEANINGFULLY DIFFERENT perspectives,
   or as essentially the SAME analysis with surface variation.

   Specifically consider:
   1. Angle / framing — do they take the same perspective on the event?
   2. Structural shape — are the headings, narrative arc, examples the same?
   3. Conclusions and recommendations — do they reach the same takeaways?
   4. Voice and prose — could a human reader tell two different writers wrote them?
   5. Search-engine duplication risk — would Google's duplicate-content detector
      flag these as substantially similar?

   Return: { verdict: 'unique' | 'duplicate', reasoning: string,
             dimensions_too_similar: string[] }"
```

Stage 3 fires only when:
- Stage 1 returned BORDERLINE (within margin of either threshold), OR
- Stage 1 was clean but stage 2 returned a high ROUGE that doesn't quite cross the threshold

Stage 3 fires **at most once per generated content piece**. It is the most expensive stage (one Haiku call) but the cheapest of the false-positive elimination steps. Hard cap: stage 3 cannot run more than 100 times per tenant per day — beyond that, default to FAIL and force HITL, because we'd be hemorrhaging money on borderline calls.

### 6.4 Verdict resolution

| Stage 1 | Stage 2 | Stage 3 | Verdict |
|---|---|---|---|
| Clean pass | Clean pass | (skipped) | **PASS** |
| Borderline | Clean | Pass | **PASS** with note |
| Borderline | Borderline | Pass | **PASS** with warning |
| Borderline | Borderline | Fail | **FAIL** |
| Fail | (skipped) | (skipped) | **FAIL** |
| Clean | Fail | (skipped) | **FAIL** (Google bar) |
| Clean | Borderline | Pass | **PASS** |
| Clean | Borderline | Fail | **FAIL** |

Any FAIL verdict triggers the failure path (§7).

---

## 7. Failure path: regenerate once, then HITL

On a verification FAIL:

1. **Record the verdict** on the in-flight `generated_content` row (or its draft predecessor) with the failure stage, similarity numbers, and the colliding content's `content_id`.
2. **Build a diversification hint** from the colliding content:
   ```
   "The previous attempt was too similar to existing content in the {dimensions}.
    Specifically: the colliding piece used the {angle} angle, structured around {structure},
    and emphasized {key_points}. You must take a meaningfully different approach by:
    - using the {alternate_angle} angle (already pre-allocated for this brief)
    - structuring the analysis as {alternate_structure}
    - emphasizing {alternate_emphasis}
    - using different specific examples and data points where possible"
   ```
3. **Re-invoke the content agent** with the original brief PLUS the diversification hint as an additional system prompt.
4. **Re-run the verification gate** on the new output.
5. If **PASS** → continue down the pipeline (compliance → translation → publish).
6. If **FAIL again** → escalate to HITL. **No third regeneration.** We do not infinite-loop.

The "regenerate once" rule exists because:
- Two regenerations triple the LLM cost for what may be a fundamentally hard collision
- If the agent can't diversify enough on the second try, it likely won't on the third
- Forcing HITL after one retry surfaces real product feedback ("two of my pipelines keep colliding — should I rethink them?")

### 7.1 HITL escalation surface

The HITL queue (content-pipeline §8.4) gains a new state for uniqueness escalations. The view shows:

- The new draft content
- All colliding prior content (cross-tenant first, intra-tenant after)
- Cosine similarity, ROUGE-L F1, and the LLM judge's reasoning per collision
- The pre-allocated angle and the diversification hint that was used
- Three actions:
  1. **Edit and republish** — the operator edits the draft inline. On save, the gate re-runs against the edited body. Multiple edit cycles allowed; each is logged.
  2. **Suppress this brief** — mark the brief `rejected` with reason `uniqueness-collision-manual-suppression`. The brief is removed from the active queue. The dashboard shows the suppression on the activity timeline.
  3. **Override and publish** — publish the colliding content anyway, with a permanent audit note. Override is rate-limited per tenant (default: max 3 per month) to discourage normalization. Repeated overrides trigger an internal alert: the affected pipelines need persona reconfiguration.

### 7.2 What happens on HITL inaction

Briefs in uniqueness-escalation state have a TTL (default: 24 hours). If no operator action is taken within the TTL:

- **HITL-mode pipelines:** brief is auto-suppressed with reason `uniqueness-escalation-timeout`. No content is published. Dashboard records the timeout.
- **Autopilot-mode pipelines:** same — auto-suppressed. Autopilot does not auto-override on uniqueness collisions. The cost ceiling and uniqueness gate are the two safeguards autopilot cannot bypass.

This means: in the worst case of a chaotic news day where many briefs collide and HITL is overwhelmed, content silently stops shipping rather than degrading the brand's content uniqueness. Failure mode: silent, recoverable, audit-visible.

---

## 8. Canonical schema

This is the **canonical** definition of `generated_content`. The content-pipeline spec §7.6 references this section.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE generated_content (
  -- Identity
  content_id           TEXT PRIMARY KEY,
  brief_id             TEXT NOT NULL REFERENCES content_briefs(brief_id),
  pipeline_id          TEXT NOT NULL,
  tenant_id            TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  topic_id             TEXT NOT NULL,

  -- Shape
  format               TEXT NOT NULL,
  angle                TEXT NOT NULL,                  -- the pre-allocated angle
  language             TEXT NOT NULL,
  body                 TEXT NOT NULL,
  body_hash            TEXT NOT NULL,                  -- sha256, defensive exact-dup check

  -- Uniqueness gate results
  embedding            vector(1536) NOT NULL,          -- text-embedding-3-small
  uniqueness_passed    BOOLEAN NOT NULL,
  uniqueness_attempts  INTEGER NOT NULL DEFAULT 1,     -- 1 = passed first try; 2 = needed regen
  uniqueness_verdict   JSONB NOT NULL,                 -- {stage1, stage2, stage3, dimensions_too_similar}
  max_xt_similarity    REAL,                           -- max cross-tenant cosine similarity
  max_it_similarity    REAL,                           -- max intra-tenant cosine similarity
  max_xt_rouge         REAL,                           -- max cross-tenant ROUGE-L F1
  max_it_rouge         REAL,                           -- max intra-tenant ROUGE-L F1

  -- Bookkeeping
  generated_by_model   TEXT NOT NULL,                  -- e.g. "claude-opus-4-6"
  generation_tokens    JSONB,                          -- {input, output} token counts
  embedding_model      TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at           TIMESTAMPTZ NOT NULL,

  -- Publishing
  published_at         TIMESTAMPTZ,                    -- nullable until publishers run
  hitl_override        BOOLEAN NOT NULL DEFAULT false, -- true if HITL overrode a uniqueness FAIL

  CONSTRAINT generated_content_unique_body
    UNIQUE (tenant_id, body_hash)
);

-- Cosine-similarity ANN index. lists=100 is fine for ~100k+ rows;
-- tune via `SET ivfflat.probes` and re-index when corpus grows.
CREATE INDEX idx_gc_embedding
  ON generated_content
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Lookup by event/topic for the gate's similarity query
CREATE INDEX idx_gc_event_topic_recent
  ON generated_content (event_id, topic_id, created_at DESC);

-- Per-tenant browsing
CREATE INDEX idx_gc_tenant_created
  ON generated_content (tenant_id, created_at DESC);

-- Per-pipeline browsing
CREATE INDEX idx_gc_pipeline_created
  ON generated_content (pipeline_id, created_at DESC);
```

**Schema notes:**

- `uniqueness_verdict` is a JSONB blob so we can evolve the verdict shape (add new stages, new dimensions) without ALTER TABLE migrations during the tuning period.
- `max_xt_similarity` / `max_it_similarity` columns enable analytics: *"what's the actual similarity floor of our shipped content?"* This is what we use to tune the thresholds in §6.1.
- `embedding_model` is on the row (not a global constant) so a future migration to a different model is safer — we can have multiple model embeddings during a transition.
- `body_hash` + the unique constraint is a defensive layer. If a regeneration somehow produces byte-identical output, the unique constraint prevents two rows. Should never fire in practice but cheap insurance.
- `hitl_override` defaults false; the rate-limit logic (§7.1) reads this column to count monthly overrides per tenant.

---

## 9. Metrics — how we know the gate is working

The gate is invisible when it works. We need observability to know it's actually catching duplicates and not just rubber-stamping or over-blocking.

Tracked per day per tenant (and rolled up globally):

| Metric | What it tells us | Healthy range |
|---|---|---|
| `pass_rate_first_attempt` | % of generated content that passes uniqueness on first try | ≥ 90% |
| `pass_rate_after_regen` | % that pass on the single regeneration retry | ≥ 70% of those that needed it |
| `hitl_escalation_rate` | % of generated content that ends up in HITL escalation | ≤ 5% |
| `hitl_override_rate` | % of escalations resolved by override (vs edit/suppress) | ≤ 10% (high = thresholds too strict OR personas badly configured) |
| `stage3_invocation_rate` | % of generations that needed the LLM judge | ≤ 15% (high = stage 1+2 thresholds need tuning) |
| `mean_max_xt_similarity` | average max cross-tenant cosine on shipped content | gives baseline for threshold tuning |
| `mean_max_it_similarity` | same, intra-tenant cross-pipeline | as above |
| `regeneration_token_overhead` | extra tokens spent on regenerations as % of total generation tokens | ≤ 5% |
| `escalation_timeout_rate` | % of HITL escalations that timed out without action | ≤ 2% (high = HITL queue overloaded, need more reviewers) |

External signals (manual, low-frequency):

- **Google Search Console duplicate-content warnings** for any tenant we publish to. Any non-zero count is a gate failure that escaped detection. Triggers a post-mortem.
- **Cross-client comparison** — quarterly internal review where we sample 20 pieces of content from different tenants on the same recent events and check by hand whether they feel like distinct work. If we can't tell them apart, the gate failed regardless of what the metrics say.
- **Client-reported collisions** — clients comparing notes at industry events. The dashboard's "see what was published for this event" view should make this self-correcting (a client sees their content alongside the source doc and the audit reasoning, and trusts the editorial integrity).

All metrics surface in an internal dashboard (not client-facing). Per-tenant rollups surface in the client-facing dashboard's "uniqueness health" widget so clients can see we're enforcing it on their behalf.

---

## 10. Threshold calibration plan

The thresholds in §6 are first-pass educated guesses. They will be wrong. The plan to tune them:

**Phase 0 — Synthetic calibration (before launch):**
1. Build a small fixture set: 30 hand-curated event clusters with 3–5 manually-written analyses per cluster, deliberately covering "obviously same" / "obviously different" / "borderline" cases.
2. Run the gate against the fixture set. Tune thresholds until: obvious-same is always FAIL, obvious-different is always PASS, borderline triggers stage 3.
3. Lock initial production thresholds.

**Phase 1 — Live calibration (first 30 days of production):**
1. Run the gate in **shadow mode for the first week**: compute verdict, store all similarity numbers, but always PASS regardless. This gathers real data on the actual similarity distribution without blocking shipping.
2. Analyze `max_xt_similarity` and `max_it_similarity` distributions across all shipped content. Look for natural bimodality — the gap between "this is fine" and "this is a collision."
3. Set production thresholds at the high end of the "fine" mode.
4. Switch the gate from shadow to enforcing.
5. Monitor `hitl_escalation_rate` for 2 weeks. If > 10%, thresholds are too strict — relax. If 0%, thresholds are too loose — tighten.

**Phase 2 — Continuous tuning (ongoing):**
- Quarterly review of metrics and threshold settings.
- Threshold changes are logged in the decision log of this spec, not silently in config.
- Embedding model upgrades (if we ever switch from `text-embedding-3-small`) trigger a full re-calibration cycle — see the embedding-model warning in §6.1.

This plan assumes we have a real enough corpus to calibrate against. For the first week of production, the gate can only compare against the synthetic fixtures + whatever has shipped so far. That's fine — there are few opportunities for collision when the corpus is empty.

---

## 11. Open questions

| Question | Resolution path |
|---|---|
| Should we **also** check uniqueness against the source document itself (don't paraphrase Reuters)? | Probably yes, but as a separate gate at the agent layer, not here. Tracked as a content-pipeline open question. |
| Should the embedding model be swappable per tenant (e.g. a regulated client wants on-prem embeddings)? | Defer. v1 is one canonical model. Per-tenant embedding models would force multiple ANN indexes — meaningful complexity for hypothetical demand. |
| What about **near-duplicate news events**? Two distinct events that produce thematically identical analyses. | Out of scope for this gate. The event clustering layer (content-pipeline §5.1) is responsible for collapsing duplicate events. The uniqueness gate trusts the event_id is correct. |
| Should clients be able to **export their full content history** including embeddings for portability/audit? | Yes, but as a data-export feature, not a uniqueness concern. Out of scope here. |
| How do we handle **regenerated content for content that has already been published**? (e.g. an editor wants to update an article after publication) | Out of scope for v1. Update-in-place is a separate workflow that bypasses the gate by definition. |
| **Bilingual / multilingual collision** — same event, two languages, are they "the same" or "different"? | The gate compares within `language`. Two language versions of the same article are not collisions. The translation engine produces them deliberately. |

---

## 12. Decision log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-07 | Two-layer strategy: pre-allocate first, verify after | Pre-allocation does the bulk of diversification cheaply; verification is the safety net |
| 2026-04-07 | `ContentPersona` lives on `ContentPipeline`, not `ClientProfile` | A tenant can run multiple pipelines with different personas drawing from the same source pool |
| 2026-04-07 | Closed core `AngleTag` taxonomy + open string escape hatch | Closed core lets the pre-allocator reason structurally; escape hatch handles edge cases without core changes |
| 2026-04-07 | Three-stage gate: embedding → ROUGE-L → LLM judge | Cheapest first; LLM only fires on borderline cases; clears both product and SEO bars |
| 2026-04-07 | Cross-tenant cosine threshold = 0.85 (strict), intra-tenant = 0.92 (looser) | Cross-tenant is Google's bar; intra-tenant is product perception, looser by design |
| 2026-04-07 | Cross-tenant ROUGE-L = 0.40, intra-tenant = 0.50 | First-pass values; will tune in production via the calibration plan in §10 |
| 2026-04-07 | One regeneration attempt, then HITL escalation. Never two. | Triples cost for hard collisions; HITL surfaces real product feedback faster |
| 2026-04-07 | Embedding model = `text-embedding-3-small`, locked system-wide | Cheap, fast, dimension fits, OpenAI is already a configured provider; swapping later is expensive |
| 2026-04-07 | HITL override is rate-limited (default 3/month per tenant) | Discourages normalizing the safety net into a rubber stamp |
| 2026-04-07 | HITL escalation TTL = 24h, then auto-suppress (never auto-override) | Worst-case failure mode is silent, recoverable, audit-visible — never published-anyway |
| 2026-04-07 | Stage 1 runs in shadow mode for the first week of production | Gather real similarity distribution before locking production thresholds |
| 2026-04-07 | All similarity numbers persisted on `generated_content` rows | Enables threshold tuning, analytics, and post-hoc audit of close calls |
| 2026-04-07 | Pre-allocated angle is fed to the IDENTITY agent (content-pipeline §5.7b), not the core analytical agent | Keeps the core analysis cache valid across all angles; the angle is an editorial framing concern, not a reasoning concern. One core Opus call serves all 9 angles. |
| 2026-04-07 | `ContentPersona` is a **client overlay**, not the editorial identity itself; the identity agent owns native format, length, and voice | Clarification after the two-layer split in content-pipeline.md. Persona is what differentiates two clients picking the same identity. |
| 2026-04-07 | Uniqueness gate runs on the **conformed** content (post-conformance engine), not on raw generated content | The conformance overlay (glossary, brand voice, regional variant) is part of what differentiates one client's output from another's, so the gate must see the final form. |
