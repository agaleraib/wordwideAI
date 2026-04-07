# FinFlow Content Pipeline (Workstream C)

**Date:** 2026-04-07
**Status:** Draft (decision spec — no code yet)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (decisions), Claude (drafting)
**Companion specs:**
- `2026-04-07-data-sources.md` — `@wfx/ingest`, the upstream document fetcher
- `2026-04-07-content-uniqueness.md` — the uniqueness gate that runs at the end of this pipeline (separate spec for focus)
- `2026-04-07-deployment-stack.md` — runtime, DB, deploy modes

---

## 1. Goal

Define the FinFlow content production pipeline that turns a stream of incoming news documents (from `@wfx/ingest`) into client-branded, market-impacting analysis content delivered through `@wfx/publishers`.

The pipeline is **causal-impact driven, not topic-match driven**: it does not look for news that *mentions* a client's instruments, it looks for news that *moves* them. A geopolitical event with no forex keywords in it can still trigger a EUR/USD analysis if the impact classifier scores it highly.

The pipeline is **multi-pipeline per tenant**: a single client can run several content pipelines in parallel (e.g. a retail-journalist pipeline producing blog posts and a pro-quant pipeline producing premium newsletters), each with its own persona, audience, format, threshold, and publishing channels.

---

## 2. Non-goals

| Out of scope | Lives where |
|---|---|
| Document fetching, normalization, deduplication | `@wfx/ingest` (`docs/specs/2026-04-07-data-sources.md`) |
| Translation engine internals (13-metric scoring, specialists, glossary patcher) | `packages/api/src/pipeline/translation-engine.ts` (already built) |
| Cross-tenant content uniqueness enforcement | `docs/specs/2026-04-07-content-uniqueness.md` (separate spec) |
| Output channel adapters (Telegram, IG, WordPress, email) | Future `@wfx/publishers` package (Workstream D) |
| Compliance review of generated content | FinFlow compliance agent (workstream C, separate component) |
| Auth, billing, tenant onboarding | FinFlow app code |
| Instrument catalog | `finflow/instruments.py` → TS port (Workstream C, separate task) |

---

## 3. End-to-end picture

```
@wfx/ingest                                                            │  upstream
   │ produces shared-pool + tenant-private documents                   │  package
   ▼
┌──────────────────────────────────────────────────────────────────┐
│  FinFlow content pipeline (this spec)                            │
│                                                                  │
│  1.  event clustering       — group docs by underlying event     │
│  2.  impact classification  — per-tenant Haiku call              │
│  3.  trigger evaluation     — per-pipeline thresholds            │
│  4.  cost-ceiling check     — per-pipeline daily/monthly cap     │
│  5.  content-brief assembly — angle pre-allocated by dispatcher  │
│  6.  HITL gate (or auto)    — per-pipeline mode                  │
│                                                                  │
│  7a. CORE analytical layer  — FA / TA / FA+TA, cached & shared   │
│                               across tenants by (event,topic,    │
│                               method). The ONLY layer that       │
│                               reasons about markets.             │
│  7b. IDENTITY adaptation    — transformer agents (BeginnerBlogger│
│                               InHouseJournalist, TradingDesk,    │
│                               NewsletterEditor, raw-fa/ta, …)    │
│                               apply persona/angle/audience       │
│                                                                  │
│  8.  compliance gate        — jurisdiction-aware                 │
│  9.  conformance engine     — 13 metrics + glossary + brand      │
│                               voice + regional variant + opt.    │
│                               translation if lang differs        │
│  10. uniqueness gate        — see content-uniqueness spec;       │
│                               runs on the conformed final text   │
│  11. publish dispatch       — hand off to @wfx/publishers        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                                                                       │
                                                                       ▼
                                                          @wfx/publishers (D)
```

Stages 1–6 are the **dispatcher**. Stages 7a–11 are the **per-pipeline producer**. The dispatcher fans out one event into N producer jobs; each producer job runs independently and can fail without taking down the others. The core analytical layer (7a) runs at most three times per (event, topic) regardless of N; the identity layer (7b) runs once per producer job but consumes a shared cached core analysis.

---

## 4. Core entities

### 4.0 `IdentityAgentId` and the identity registry

```ts
type IdentityAgentId =
  // Pass-through identities — ship the core analysis with no transformation,
  // only the conformance overlay is applied downstream
  | 'raw-fa'
  | 'raw-ta'
  | 'raw-fa+ta'
  // Transformer identities — adapt the core analysis into a specific product
  | 'beginner-blogger'
  | 'in-house-journalist'
  | 'trading-desk'
  | 'newsletter-editor'
  | 'educator'
  | 'strategist'
  // Open string for custom client-bespoke identities (rare)
  | string;
```

Identity agents are registered the same way source adapters and content formats are: a small registry maps the id to an agent implementation. v1 ships the built-ins above. New identities can be added without touching the dispatcher, the brief shape, or the conformance engine — write the agent, register it, expose it as an option in the pipeline editor.

**Each identity has a native output format.** `BeginnerBlogger` always produces a beginner-friendly blog post. `TradingDesk` always produces a terse signal-extract alert. `InHouseJournalist` always produces a journalism-style market column. There is no separate `format` field on `ContentPipeline` — format is the identity's native shape. To offer a new format, add a new identity. This is a deliberate decision (see §10) — it sidesteps the cartesian-explosion problem of `(method × format × audience × voice)` agents.

### 4.1 `ContentPipeline` (NEW first-class entity)

A `ContentPipeline` is the **unit of content production**. A tenant owns N pipelines. Each pipeline has its own:

```ts
type ContentPipeline = {
  id: string;
  tenantId: string;
  name: string;                        // human label, shown in UI
  enabled: boolean;

  // What it produces — TWO-LAYER GENERATION (see §5.7)
  // Layer 1: which core analytical method runs (the only layer that reasons about markets)
  analyticalMethod: 'fa' | 'ta' | 'fa+ta';

  // Layer 2: which identity agent transforms the core analysis into the final product.
  // "raw-fa" / "raw-ta" / "raw-fa+ta" mean pass-through (no identity transform — ship the
  // core analysis as-is). Other identities transform the analysis: BeginnerBlogger,
  // InHouseJournalist, TradingDesk, NewsletterEditor, Educator, Strategist, etc.
  // Each identity has a NATIVE OUTPUT FORMAT — there is no separate `format` field.
  // Add a new identity to add a new product type. (Registry pattern.)
  identityAgent: IdentityAgentId;

  // Client-specific overlay applied at the conformance stage and used as context
  // by the identity agent. See content-uniqueness spec §4.
  contentPersona: ContentPersona;

  language: string;                    // ISO-639-1, e.g. "es", "en-GB"

  // What it cares about
  interests: InterestProfile;          // see §4.2

  // When it fires
  triggerMode: 'hitl' | 'autopilot';   // default 'hitl' at v1
  triggerThresholds: {
    global: number;                    // 0-100, default 70
    perTopic?: Record<string, number>; // topic-id → override
  };

  // What it costs
  costCeiling: {
    maxJobsPerDay: number;
    maxJobsPerMonth: number;
    priorityOnTie: 'highest-impact' | 'fifo';
  };

  // Where it goes
  publishTargets: PublishTargetId[];   // resolved by @wfx/publishers

  createdAt: Date;
  updatedAt: Date;
};
```

**Why a separate entity:** a tenant needs to be able to run "retail journalist for blog" and "quant analyst for pro newsletter" simultaneously, with different personas, different thresholds, different formats, and different channels — but **drawing from the same source pool and the same impact-classification call**. Pipelines are also the natural unit of pricing, quotas, and uniqueness scoping.

### 4.2 `InterestProfile`

```ts
type InterestProfile = {
  // Canonical topics from FinFlow's global taxonomy
  // (built from the instrument catalog port)
  canonicalTopics: string[];           // e.g. ["eurusd", "oil-brent", "gold", "sp500"]

  // Free-form custom topics for niche client asks
  customTopics: {
    id: string;
    name: string;
    description: string;               // fed to the impact classifier
    relatedInstruments?: string[];     // optional grounding
  }[];

  // Optional macro / sector / theme tags for cross-topic context
  themes?: string[];                   // e.g. ["geopolitics", "central-banks"]
};
```

**Topic taxonomy decision:** canonical core (~50 instruments and topics) sourced from the instrument catalog port, plus per-pipeline free-form custom topics for unusual asks. Canonical topics are what unlock the cross-pipeline classification cache (§5.2 optimization, deferred).

### 4.3 `EventCluster`

Multiple incoming documents can describe the same underlying real-world event. The clustering layer groups them so the fan-out fires **once per event, not once per document**.

```ts
type EventCluster = {
  eventId: string;                     // hash-based at v1
  documentIds: string[];               // (sourceId, externalId) pairs
  representativeDocId: string;         // the doc used for impact classification
  firstSeenAt: Date;
  lastSeenAt: Date;

  // Cheap fingerprint at v1, real entity extraction at v2
  fingerprint: {
    leadEntities: string[];            // e.g. ["Iran", "USA", "missile-strike"]
    canonicalTopics: string[];         // pre-tagged topics if obvious
    timeBucket: string;                // e.g. "2026-04-07T14"
  };
};
```

**v1 event clustering** is cheap and good-enough:

```
eventId = sha256(
  sorted(leadEntities) + sorted(canonicalTopics) + timeBucket
)
```

Where `leadEntities` and `canonicalTopics` come from a single Haiku entity-extraction pass on the document title + first paragraph. `timeBucket` is the document's `publishedAt` truncated to the hour.

Two documents that produce the same `eventId` are clustered. The first document in a cluster becomes the `representativeDocId`; later documents are appended to the cluster but do not retrigger the impact classifier or the fan-out.

**v2 event clustering** (deferred): real entity extraction + clustering against active event clusters via embedding similarity. Out of scope here.

### 4.4 `ContentBrief`

The dispatcher's output and the producer's input. One `ContentBrief` per (pipeline × event × topic) that triggered.

```ts
type ContentBrief = {
  briefId: string;
  pipelineId: string;
  tenantId: string;
  eventId: string;
  topicId: string;                     // the topic that triggered

  // What we know
  representativeDoc: Document;         // from @wfx/ingest
  relatedDocIds: string[];             // other docs in the cluster
  impactScore: number;                 // 0-100
  impactReasoning: string;             // from the classifier

  // What to write — copied from the pipeline at brief time, frozen for audit
  analyticalMethod: 'fa' | 'ta' | 'fa+ta';
  identityAgent: IdentityAgentId;
  coreAnalysisId?: string;             // set after the core analysis lands (§5.7a),
                                       // either a fresh run or a cache hit
  contentPersona: ContentPersona;      // copied from the pipeline
  preferredAngle: string;              // pre-allocated by the dispatcher; fed to the
                                       // identity agent at transformation time, not to
                                       // the core analytical agent (the cache stays valid)
  ctaPolicy: 'always' | 'when-relevant' | 'never';

  // Bookkeeping
  createdAt: Date;
  hitlState: 'pending' | 'approved' | 'rejected' | 'auto';
};
```

**Pre-allocation of `preferredAngle` happens at brief time, not at generation time.** This is the architectural call from the uniqueness conversation: deterministic angle assignment from profile + event topology, then generate, then verify uniqueness as a safety net. See `2026-04-07-content-uniqueness.md` §4 for the allocation algorithm.

---

## 5. Stage-by-stage

### 5.1 Event clustering

Runs as documents stream in from `@wfx/ingest`. For each new document:

1. Extract `leadEntities` + `canonicalTopics` via a Haiku call (cached per document).
2. Compute `eventId` per §4.3.
3. If `eventId` already exists in `event_clusters`, append `documentId`, update `lastSeenAt`, **return without firing classification**.
4. Otherwise, insert a new cluster with this document as the representative, then proceed to §5.2.

**Cost note:** the entity-extraction call is one Haiku invocation per document, regardless of how many tenants subscribe to the source. For 1,000 documents/day across all shared sources, this is ~$1–2/day at current Haiku pricing. Cheap.

### 5.2 Impact classification

For each new event cluster, for each active tenant with at least one enabled pipeline:

1. Resolve the tenant's union of interest topics across all their enabled pipelines (one set of topics per tenant, not per pipeline — the classification is per-tenant, the trigger evaluation is per-pipeline).
2. Call the **impact classifier** (Haiku, structured output via `tool_use`):

```ts
type ImpactClassifierInput = {
  document: { title: string; body: string; publishedAt: Date };
  topics: { id: string; name: string; description: string }[];
  instrumentCatalog: InstrumentCatalogSlice;  // grounding from §6
};

type ImpactClassifierOutput = {
  scores: Array<{
    topicId: string;
    impactScore: number;          // 0-100
    direction: 'bullish' | 'bearish' | 'mixed' | 'unclear';
    reasoning: string;            // 1-2 sentences
    confidence: number;           // 0-1
  }>;
};
```

3. Persist results into `tenant_event_impact` (§7.1).

**Why Haiku, not Opus:** the task is structured + bounded + benefits from speed. Haiku is fast and cheap; we're calling it N tenants × M events per day. We can promote to Sonnet if quality is insufficient — but only after measuring on real fixtures.

**Future cross-tenant cache (deferred to Phase 2):** if 50 tenants subscribe to canonical topic `eurusd`, the Iran event's impact on `eurusd` is the same answer for all 50. We could classify once per (event × canonical-topic) globally, then fan out to per-tenant scores by looking up subscriptions. This requires the canonical topic taxonomy to be stable, which is why we're sourcing it from the instrument catalog. Day one: per-tenant classification (simpler, fine for ≤10 tenants). Day N: shared classification with per-tenant lookup.

### 5.3 Trigger evaluation

For each (tenant × event) row in `tenant_event_impact`, for each enabled pipeline owned by that tenant:

1. Filter the topic scores down to topics the pipeline subscribes to (`pipeline.interests.canonicalTopics ∪ pipeline.interests.customTopics`).
2. For each topic, compare `impactScore` against `pipeline.triggerThresholds.perTopic[topicId] ?? pipeline.triggerThresholds.global`.
3. Topics that meet or exceed the threshold are **candidates**.
4. Apply per-pipeline cost-ceiling and event-dedup window (see §5.4 and §5.5).
5. Survivors become `ContentBrief` rows.

### 5.4 Cost-ceiling check

Each pipeline has `costCeiling.maxJobsPerDay` and `maxJobsPerMonth`. Before creating a `ContentBrief`:

1. Count `briefs` (or `content_jobs`) created for this pipeline in the current day and month.
2. If under both ceilings, create the brief.
3. If at or above either ceiling, **queue the candidate** in a `deferred_briefs` table with the event impact score. At the next ceiling reset, the highest-impact deferred candidates are dequeued first if the pipeline's `priorityOnTie` is `highest-impact`.
4. Optionally surface "ceiling reached" to the dashboard so the client sees we suppressed N items (and can adjust thresholds or upgrade their plan).

This stops a chaotic news day from blowing up the LLM bill or flooding a client's audience.

### 5.5 Event-dedup window

Even after event clustering, we may get **two distinct events** triggering the same topic in quick succession (e.g. two unrelated geopolitical stories both hitting EUR/USD within an hour). We do not want to publish two near-identical EUR/USD analyses back-to-back.

At v1 we apply a **per-(pipeline × topic) suppression window**: if this pipeline has already produced content on this topic in the last `eventDedupWindowHours` (default: 2, configurable per pipeline), the new candidate is suppressed unless its impact score is materially higher than the recent one (`newScore - recentScore >= 20`).

This is the "dumb but fine" version of event-dedup. The smarter version (event-similarity check, not just topic+window) waits for v2.

### 5.6 HITL gate

Each pipeline has `triggerMode: 'hitl' | 'autopilot'`. **Default at v1 is `'hitl'`**.

- **HITL mode**: each surviving `ContentBrief` is queued for human approval. The dashboard shows: the source document, the impact reasoning, the affected topics, the assigned angle, the projected fan-out ("this will produce 3 articles for 3 of your topics"). The client approves, modifies, or rejects each brief.
- **Autopilot mode**: briefs proceed directly to §5.7. The cost ceiling and event-dedup window are still enforced.

A pipeline can switch modes at any time via the dashboard. Pipelines new to a tenant default to HITL until the client explicitly opts in.

The HITL approval action emits an audit event (`brief.approved` / `brief.rejected`) with the user, timestamp, and any notes.

### 5.7 Content generation (two-layer)

Generation is split into two layers, deliberately. The **core analytical layer** (§5.7a) is the only place markets are reasoned about; its output is cached and shared across tenants. The **identity adaptation layer** (§5.7b) is a family of transformer agents that take the cached core analysis and produce a specific editorial product (beginner blog, journalist column, trader alert, etc.) per pipeline.

This split exists because **method (FA/TA) and identity (journalist/blogger/trader) are orthogonal**, and trying to fuse them into a single agent either causes prompt overloading or forces a cartesian explosion of `(method × format × audience × voice)` agents. By making FA/TA the privileged source of truth and putting identities below them as transformers, we get: cheap shared reasoning, factual consistency across all tenants on the same event, and a clean stable-of-writers commercial story.

#### 5.7a Core analytical layer

For each approved brief, the dispatcher checks the `domain_analyses` cache for `(event_id, topic_id, analyticalMethod)`:

- **Cache hit** → reuse the cached `DomainAnalysis` row. No LLM call. Set `coreAnalysisId` on the brief.
- **Cache miss** → invoke the appropriate core agent, persist the result, set `coreAnalysisId` on the brief.

Three core agents:

| Agent | `analyticalMethod` | Produces | Notes |
|---|---|---|---|
| `FundamentalAnalystAgent` | `'fa'` | Authoritative fundamental analysis prose — drivers, transmission mechanisms, scenarios, outlook, catalysts | Opus, `tool_use`, grounded by instrument catalog |
| `TechnicalAnalystAgent` | `'ta'` | Authoritative technical analysis prose — levels, patterns, indicators, momentum, entry/exit zones | Opus, `tool_use`, grounded by market data snapshot + instrument catalog |
| `IntegratedAnalystAgent` | `'fa+ta'` | A **third independent run** that weaves fundamental and technical perspectives into a single integrated analysis ("fundamentally bearish because X; technically, price approaching support at Y; the confluence suggests…"). Not a concatenation of FA + TA outputs. | Opus, `tool_use`, both groundings |

**Important: `'fa+ta'` is not derived from `'fa'` and `'ta'`.** It is a separate Opus call with its own prompt. A pipeline that wants `'fa+ta'` does not benefit from cached `'fa'` and `'ta'` entries from other pipelines on the same event — and vice versa. Cache key is the full `(event_id, topic_id, method)` triple. At most three core calls per (event, topic) regardless of how many tenants/pipelines are interested.

**Cost model:** for a busy news day with 100 events × 10 triggered pipelines/event, if methods are roughly evenly split, expect ~150–250 core calls/day across the entire system, regardless of tenant count. Cost scales sub-linearly with tenant count — adding a 50th tenant is essentially free at the core layer because they share existing cache entries.

**Cache TTL:** 24 hours by default. After 24h, the analysis is considered stale (markets and context may have moved) and a fresh run is required for any new brief. Cached entries older than 24h are still kept for audit but no longer served as a cache hit.

**Pre-allocated angle is NOT passed to the core agent.** The core analysis is angle-agnostic — it captures the full analytical picture. The angle is applied at the identity-adaptation step (§5.7b) so the cache stays valid across all 9 angles. This is deliberate (see §10).

**Audit:** every core call emits a `core_analysis.computed` event with model, tokens, duration, instrument-catalog snapshot, market-data snapshot if applicable, and persists a `DomainAnalysis` row (§7.7).

#### 5.7b Identity adaptation layer

Once `coreAnalysisId` is set on the brief, the dispatcher invokes the identity agent named on the brief. The identity agent is a **transformer**, not a reasoner — it does not call the instrument catalog, does not look at market data, does not invent new facts. It takes the core analysis prose plus the brief's persona/angle/CTA inputs and produces the final content in the identity's native format.

```ts
type IdentityAgentInput = {
  coreAnalysis: DomainAnalysis;       // from cache or fresh run
  brief: ContentBrief;                // includes preferredAngle, persona, CTA policy
  contentPersona: ContentPersona;     // brand positioning, audience hint, jurisdictions
};

type IdentityAgentOutput = {
  body: string;                       // final prose in the identity's native shape
  format: ContentFormatId;            // declared by the identity, not chosen
  angleApplied: AngleTag;             // confirms which angle was actually emphasized
  ctaUsed: CTAEntry | null;
  reasoning: string;                  // 1-2 sentences for audit (NOT market reasoning,
                                      //  shaping reasoning: "emphasized macro-flow per
                                      //  angle, used journalism opening hook")
  generatedBy: { model: string; tokens: { input: number; output: number } };
};
```

**Identity agents declare their own native format.** `BeginnerBlogger` always produces blog-post-shaped output ~600 words with beginner framing and a soft CTA. `TradingDesk` always produces alert-shaped output ~150 words with terse signal extraction and an urgent CTA. `InHouseJournalist` always produces journalism-shaped output ~800 words with hook + narrative arc + closing. The identity *is* the format; there is no separate format selection.

**Pass-through identities.** The `'raw-fa'`, `'raw-ta'`, and `'raw-fa+ta'` identities are special: they perform **no transformation** and pass the core analysis prose straight through to the conformance engine. The brief's `preferredAngle` is recorded but not used (the raw analysis covers all angles). This is the cheapest path: zero identity-layer cost, full analytical fidelity. Used when a client wants institutional-grade FA/TA pieces with no editorial dressing.

**Model selection at the identity layer.** Default to **Sonnet** for transformer identities — they need real writing craft but no Opus-level reasoning (the reasoning is already in the core analysis). Pass-through identities incur zero LLM cost. Per-pipeline override allowed: a premium client can opt their pipeline into Opus-on-identity for an extra fee, configurable in the pipeline editor.

**Audit:** every identity-agent call emits a `content.composed` event with input core analysis id, model, tokens, duration, applied angle, CTA used, and persists a `GeneratedContent` row (§7.6, canonical definition in the uniqueness spec).

#### Why this split is the right one

| Dimension | Why two layers wins |
|---|---|
| **Cost at scale** | Expensive reasoning runs 1× per (event × topic × method). 50 tenants on the same event = 1 Opus + 50 Sonnet, not 50 Opus. ~3.5× cheaper at meaningful scale. |
| **Factual consistency** | All tenants on the same event share the same core analysis. No risk of two clients getting contradictory directional views from independently-reasoning agents. |
| **Specialization depth** | FA, TA, and FA+TA agents do one thing — analyze markets. Identity agents do one thing — shape prose for an audience. No prompt overloading. |
| **Extensibility** | Adding `NewsletterEditor` or `Educator` is one new identity-layer agent. No core-layer changes, no schema changes, no dispatcher changes. |
| **Commercial story** | "Our stable of writers" is a clean pitch. Clients pick which writer they want; the underlying analysis is shared and authoritative. |
| **Pass-through is natural** | A client who wants institutional FA/TA pieces uses a `raw-fa` identity. Zero identity-layer cost. The same architecture serves both "raw analysis" and "fully-shaped product" clients. |

### 5.8 Compliance gate

Existing FinFlow compliance agent (port from Python prototype, Workstream C). Runs on the composed content from §5.7b, scoped to the client's `jurisdictions` from `ContentPersona`. On fail, escalates to HITL with the compliance reasoning. On pass, proceeds to the conformance engine.

### 5.9 Conformance engine

The "translation engine" in `packages/api/src/pipeline/translation-engine.ts` is misnamed — it is **conceptually a client-conformance engine that optionally translates**. Of the 13 metrics it enforces (`docs/metrics-reference.md`), 12 apply to any content regardless of language — glossary compliance, brand voice adherence, formality level, sentence length, passive voice, regional variant, fluency, meaning preservation, numerical accuracy, formatting preservation, paragraph alignment, term consistency. Only `untranslated_terms` is translation-specific, and it trivially returns 100 when source and target language match.

**The engine runs unconditionally for every piece of content**, regardless of whether translation is needed:

- If `sourceLanguage === targetLanguage` (e.g. content was composed in English for an English-only client), the `TranslationAgent` step is a **pass-through no-op** that incurs zero LLM cost. The rest of the pipeline (`ScoringAgent` → `GlossaryPatcher` → gate → specialists → re-score → gate) runs normally and enforces the client's editorial standard against the English content. This is where glossary substitution, brand voice enforcement, regional variant (en-GB vs en-US vs en-AU), and the 13-metric quality loop earn their keep on same-language content.
- If `sourceLanguage !== targetLanguage`, the engine translates first, then runs the same downstream conformance loop on the translated text.

Either way, downstream stages — scoring, glossary patcher, gate, specialists — are unchanged. The only change is the `TranslationAgent` learns a same-language pass-through mode and `untranslated_terms` short-circuits to 100. **This is a small code change with a large conceptual reframe.** See the updated `docs/architecture.md` for the framing.

**Naming:** the function name (`runTranslationEngine`) and file name (`pipeline/translation-engine.ts`) stay as-is for now to minimize churn — renaming cascades through code, docs, and memory. The reframe is conceptual; a future refactor can rename to `runConformanceEngine` if it becomes confusing in practice.

**Order rationale:** the conformance engine runs **after** content composition (§5.7b) and **before** the uniqueness gate (§5.10). Brand-voice, glossary, and regional-variant enforcement push the content *away* from cross-tenant similarity (because each client's overlay is unique to them), so running uniqueness on the conformed text catches the bar that actually ships rather than blocking content that would have been unique once the client overlay was applied.

### 5.10 Uniqueness gate

See `2026-04-07-content-uniqueness.md`. Runs against `generated_content` filtered by `(eventId, topicId, last 90 days)`, with stricter thresholds for cross-tenant comparisons and looser for intra-tenant intra-pipeline. Critically, it runs **on the conformed content** (post-§5.9), because that's what actually gets published — the conformance overlay (glossary, brand voice, regional variant) is part of what differentiates one client's output from another's, so the uniqueness check needs to see the final form. On fail, one regeneration attempt with a diversification hint passed back to the identity agent (§5.7b), then HITL escalation.

### 5.11 Publish dispatch

Hand off to `@wfx/publishers` (Workstream D, separate spec). The brief's `publishTargets` resolve to publisher adapters; each adapter handles its own channel-specific formatting and delivery confirmation.

---

## 6. Instrument catalog dependency

The impact classifier (§5.2) is only as good as its grounding. It needs to know that "EUR/USD" is a major FX pair, that USD strength is a typical risk-off response, that Brent crude responds to Middle East geopolitics, and so on. This grounding comes from the **instrument catalog** being ported from `finflow/instruments.py` (Workstream C, separate task).

The catalog provides per-instrument:

```ts
type InstrumentCatalogEntry = {
  id: string;                          // canonical topic id, e.g. "eurusd"
  name: string;                        // "EUR/USD"
  type: 'fx' | 'commodity' | 'index' | 'crypto' | 'rate' | 'equity';
  description: string;                 // human-readable context
  drivers: string[];                   // free-form macro drivers
  correlatedWith: string[];            // other instrument ids
  riskOnRiskOff: 'risk-on' | 'risk-off' | 'mixed';
  // …other fields from the Python original
};
```

The classifier receives a **slice** of the catalog filtered to the topics the tenant cares about, not the whole catalog. This keeps the prompt small and the reasoning focused.

**Dependency note:** the catalog port is a hard prerequisite for §5.2. Without it, the impact classifier is hand-waving. The catalog port is tracked as a Workstream C task (`C1: Port instrument catalog (finflow/instruments.py) to TS`) in Second Brain.

---

## 7. Schema additions

These tables live in `packages/db/` (the new Drizzle package from the deployment-stack spec). They join against `documents` (from `@wfx/ingest`'s Postgres backend) by `(source_id, external_id)`.

### 7.1 `tenant_event_impact`

```sql
CREATE TABLE tenant_event_impact (
  tenant_id      TEXT NOT NULL,
  event_id       TEXT NOT NULL,
  topic_id       TEXT NOT NULL,
  impact_score   INTEGER NOT NULL,        -- 0-100
  direction      TEXT NOT NULL,           -- 'bullish'|'bearish'|'mixed'|'unclear'
  confidence     REAL NOT NULL,           -- 0-1
  reasoning      TEXT NOT NULL,
  scored_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id, topic_id)
);

CREATE INDEX idx_tei_tenant_event ON tenant_event_impact(tenant_id, event_id);
CREATE INDEX idx_tei_score ON tenant_event_impact(tenant_id, impact_score DESC);
```

One row per (tenant × event × topic). Powers the trigger evaluation (§5.3) and the dashboard view.

### 7.2 `event_clusters`

```sql
CREATE TABLE event_clusters (
  event_id              TEXT PRIMARY KEY,
  representative_doc    JSONB NOT NULL,   -- (source_id, external_id)
  document_ids          JSONB NOT NULL,   -- array of (source_id, external_id)
  fingerprint           JSONB NOT NULL,   -- leadEntities, canonicalTopics, timeBucket
  first_seen_at         TIMESTAMPTZ NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_ec_last_seen ON event_clusters(last_seen_at);
```

### 7.3 `content_briefs`

```sql
CREATE TABLE content_briefs (
  brief_id            TEXT PRIMARY KEY,
  pipeline_id         TEXT NOT NULL,
  tenant_id           TEXT NOT NULL,
  event_id            TEXT NOT NULL,
  topic_id            TEXT NOT NULL,
  impact_score        INTEGER NOT NULL,
  -- Two-layer generation contract (copied from pipeline at brief time, frozen)
  analytical_method   TEXT NOT NULL,        -- 'fa'|'ta'|'fa+ta'
  identity_agent      TEXT NOT NULL,        -- IdentityAgentId
  core_analysis_id    TEXT,                 -- nullable until §5.7a runs (cache hit or fresh)
  preferred_angle     TEXT NOT NULL,        -- pre-allocated, fed to identity agent (§5.7b)
  -- HITL state
  hitl_state          TEXT NOT NULL,        -- 'pending'|'approved'|'rejected'|'auto'
  hitl_user           TEXT,
  hitl_decided_at     TIMESTAMPTZ,
  generated_content_id TEXT,                -- nullable until §5.7b completes
  created_at          TIMESTAMPTZ NOT NULL,
  UNIQUE (pipeline_id, event_id, topic_id)  -- one brief per (pipeline × event × topic)
);

CREATE INDEX idx_cb_pipeline_state ON content_briefs(pipeline_id, hitl_state);
CREATE INDEX idx_cb_tenant_created ON content_briefs(tenant_id, created_at DESC);
CREATE INDEX idx_cb_core_analysis ON content_briefs(core_analysis_id);
```

### 7.4 `content_pipelines`

```sql
CREATE TABLE content_pipelines (
  pipeline_id        TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  name               TEXT NOT NULL,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  config             JSONB NOT NULL,       -- the full ContentPipeline shape
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cp_tenant ON content_pipelines(tenant_id, enabled);
```

The `config` blob is the full `ContentPipeline` type from §4.1 stored as JSONB. We can promote fields to columns later if we need to index them.

### 7.5 `deferred_briefs`

```sql
CREATE TABLE deferred_briefs (
  brief_id          TEXT PRIMARY KEY,
  pipeline_id       TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  event_id          TEXT NOT NULL,
  topic_id          TEXT NOT NULL,
  impact_score      INTEGER NOT NULL,
  deferred_reason   TEXT NOT NULL,         -- 'cost-ceiling-day'|'cost-ceiling-month'|'event-dedup-window'
  deferred_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_db_pipeline_score ON deferred_briefs(pipeline_id, impact_score DESC);
```

### 7.6 `generated_content`

Sketched here for completeness; the canonical definition lives in `2026-04-07-content-uniqueness.md` because the embedding column and uniqueness logic are that spec's concern.

```sql
CREATE TABLE generated_content (
  content_id     TEXT PRIMARY KEY,
  brief_id       TEXT NOT NULL,
  pipeline_id    TEXT NOT NULL,
  tenant_id      TEXT NOT NULL,
  event_id       TEXT NOT NULL,
  topic_id       TEXT NOT NULL,
  identity_agent TEXT NOT NULL,            -- which identity produced it
  angle          TEXT NOT NULL,
  body           TEXT NOT NULL,
  embedding      vector(1536),             -- pgvector, see content-uniqueness spec
  created_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_gc_event_topic ON generated_content(event_id, topic_id);
CREATE INDEX idx_gc_pipeline_created ON generated_content(pipeline_id, created_at DESC);
CREATE INDEX idx_gc_embedding ON generated_content USING ivfflat (embedding vector_cosine_ops);
```

### 7.7 `domain_analyses` (NEW — the core analytical layer cache)

The shared cache for `§5.7a`. One row per `(event_id, topic_id, analytical_method)` combination — at most three rows per (event, topic) regardless of how many tenants/pipelines consume it. This is the table that powers the cost optimization of the two-layer split: 50 tenants subscribing to FA on the same EUR/USD event share one row here.

```sql
CREATE TABLE domain_analyses (
  analysis_id          TEXT PRIMARY KEY,
  event_id             TEXT NOT NULL,
  topic_id             TEXT NOT NULL,
  analytical_method    TEXT NOT NULL,       -- 'fa'|'ta'|'fa+ta'
  body                 TEXT NOT NULL,       -- the authoritative analysis prose
  -- Grounding snapshots (frozen at compute time for audit + reproducibility)
  instrument_catalog_snapshot JSONB NOT NULL,
  market_data_snapshot         JSONB,       -- nullable for FA-only methods
  -- Compute metadata
  generated_by_model   TEXT NOT NULL,       -- e.g. "claude-opus-4-6"
  generation_tokens    JSONB NOT NULL,      -- {input, output}
  generation_duration_ms INTEGER NOT NULL,
  -- Cache lifecycle
  computed_at          TIMESTAMPTZ NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL, -- computed_at + 24h by default
  cache_hits           INTEGER NOT NULL DEFAULT 0,  -- analytics: how many briefs reused this
  -- Tenancy (NULL for canonical-topic shared analyses; set for tenant-private custom topics)
  tenant_id            TEXT,
  UNIQUE (event_id, topic_id, analytical_method, COALESCE(tenant_id, ''))
);

CREATE INDEX idx_da_lookup
  ON domain_analyses (event_id, topic_id, analytical_method)
  WHERE expires_at > now();   -- only fresh entries are cache hits

CREATE INDEX idx_da_expires ON domain_analyses(expires_at);
CREATE INDEX idx_da_method ON domain_analyses(analytical_method);
```

**Cache lifecycle:**
- **TTL: 24 hours by default.** After 24h the row is considered stale (markets and context may have moved); a new brief on the same `(event, topic, method)` triggers a fresh core call. The expired row is kept for audit but not served from the cache.
- **Sharing scope:** canonical-topic analyses (`tenant_id IS NULL`) are shared across all tenants. Tenant-private custom-topic analyses (`tenant_id = X`) are scoped to that tenant only — same shared/private split as `@wfx/ingest` sources and the documents table.
- **`cache_hits`** counter is incremented every time a brief reuses this row. Powers a "cost savings from sharing" metric on the internal dashboard ("FA analysis on Iran event reused by 47 briefs across 12 tenants").

**Brief → analysis linkage:** the `content_briefs.core_analysis_id` foreign key (§7.3) points here. When a brief is created, the dispatcher checks the cache (`SELECT analysis_id FROM domain_analyses WHERE event_id = X AND topic_id = Y AND analytical_method = Z AND (tenant_id IS NULL OR tenant_id = current_tenant) AND expires_at > now()`); on hit, set `core_analysis_id` and skip §5.7a; on miss, run §5.7a, insert the row, then set `core_analysis_id`.

---

## 8. Dashboard surface (FinFlow web UI)

Mandatory for launch (Mode A and Mode B). The web UI surfaces this pipeline through these views:

### 8.1 Sources view

- List of sources connected for the tenant: shared (read-only, with health metrics) and tenant-private (full CRUD).
- Per-source: enabled/paused, recent fetch count, dedup count, blocked count, last error.
- "Add source" wizard for tenant-private sources (RSS or HTML to start, more later).
- Sources view is fed by `SourceConfigStore` + the runner's metric events from `@wfx/ingest`.

### 8.2 Pipelines view

- List of `ContentPipeline`s owned by the tenant.
- Create / edit / pause / delete a pipeline.
- For each pipeline: persona, audience, format, language, interests, thresholds, cost ceiling, publish targets, trigger mode.

### 8.3 Activity / event timeline

- Stream of recent events (`event_clusters`) with their per-tenant impact scores.
- For each event: which documents seeded it, which topics scored above which pipeline's threshold, which briefs were created, which were approved/rejected/auto, which produced content, where that content was published.
- This is the "show me what happened today" view that proves we're earning our money.

### 8.4 HITL queue

- Pending briefs awaiting approval, grouped by pipeline.
- For each brief: source doc, impact reasoning, assigned angle, projected fan-out. Approve / reject / approve-with-edits.

### 8.5 Generated content library

- All content produced for this tenant, filterable by pipeline, event, topic, date.
- Per item: full body, brief link, source doc link, publish status per channel, uniqueness verdict.

### 8.6 Cost / quota view

- Current day/month usage vs ceilings, per pipeline.
- Deferred briefs and why they were deferred.
- Estimated bill for the period.

### 8.7 Running thesis view (FUTURE — depends on narrative-state layer being shipped)

A first-class view that surfaces each tenant's accumulated **narrative state per (topic × pipeline)** as a coherent "house view" the client can read, audit, and edit. Conceptually:

> *"Here is your firm's running thesis on EUR/USD. You've been bearish since April 7 (the U.S.-Iran strike event). Your last 5 pieces argued: [summary]. Your current thesis is: [thesis]. The next time an EUR/USD event triggers, your content will pick up from this thread."*

This view exists because once the narrative-state layer is in production (see content-uniqueness spec and PoC findings in `docs/poc-uniqueness-session-2026-04-07.md`), each tenant accumulates a **persistent per-topic narrative state** that conditions their future content. The state is invisible-by-default (it lives behind the scenes and gets injected into prompts) — but it's also **the most valuable artifact the client owns inside FinFlow**, because it's the literal track record of what their writer has said over time. Surfacing it as a UI view turns a hidden internal data structure into a sellable product feature.

**What the view shows per (topic × pipeline):**

- **Current house view** — bullish / bearish / neutral / mixed, with confidence (low / moderate / high)
- **Active since** — date the current view was first established
- **Recent thesis statements** — the last 3-5 explicit thesis claims the writer has made on this topic
- **Recent levels mentioned** — the price levels the writer has been tracking (e.g., "1.0820 support, 1.0780 next downside target")
- **Recent calls to action** — the last few CTAs the writer has used (or "no CTAs — wealth-management framing")
- **Last 5 pieces in chronological order** — title, date, one-sentence summary, link to the full piece in the generated content library
- **Continuity timeline** — a visual showing when the thesis was reinforced, when it shifted, when it was tested by contrary evidence
- **Next-event preview** — *"When the next EUR/USD-impacting event triggers your pipeline, your content will pick up from this thread. Want to override the current view? Edit the thesis manually below."*

**Mutations the client can perform on this view:**

- **Edit the current thesis text** — overrides what the narrative state injects on the next piece
- **Flip the directional view** — manual override (useful when the firm changes its mind ahead of an event)
- **Mark a prior piece as "no longer reflects our view"** — demotes that piece from the active narrative state without deleting the published content
- **Pause narrative continuity for this topic** — the next piece on this topic is generated without prior context (useful for major regime shifts)
- **Reset the thread** — clears the narrative state and starts fresh (the next piece is treated as a fresh take with no prior context)

**Why this is a first-class view, not just a debug panel:**

- **It's the brand asset.** A broker's "running thesis" on EUR/USD over time IS the brand. Clients reading consistent, evolving coverage trust the source. Surfacing the thesis explicitly lets the broker SEE that brand asset accumulating in real time.
- **It's the lock-in.** A client who's been running on FinFlow for 6 months has a rich narrative state per topic. Switching brokers means losing that history. The longer the history, the higher the switching cost.
- **It's the editorial control surface.** Real editorial teams have a "house view" meeting where they decide what the firm thinks about a market this week. This view IS that meeting, surfaced as software. The broker's editor can sit in front of FinFlow and see/adjust the running view across all topics in one place.
- **It's the transparency proof.** "AI-generated content" feels untrustworthy to many buyers. Showing them the writer's accumulated reasoning trail makes the system feel like a real editor with a track record, not a black box.

**Implementation note:** this view is gated on shipping the narrative-state layer first (which the PoC empirically tested but did not validate as a *cross-tenant* differentiation mechanism — see `docs/poc-uniqueness-session-2026-04-07.md`). The narrative state layer remains in scope as a temporal-continuity product feature regardless of whether it contributes to cross-tenant uniqueness, so this view is on the "ship in v1.5" list, not the "wait for v2" list.

---

These views are read-mostly. The mutations are: pipeline CRUD, source CRUD (tenant-private only), HITL approval, mode toggling (HITL ↔ autopilot), threshold tuning, ceiling adjustments, **and the narrative-state edits in §8.7**.

---

## 9. Open questions

| Question | Resolution path |
|---|---|
| Should the impact classifier also consider **cross-event context** (e.g. "this is the third Iran-related story today, escalation pattern")? | v1 = no. Each event scored independently. v2 if quality demands it. |
| How much **market data** does the FA/TA agent need at generation time? Live prices? Snapshot at brief approval time? | Snapshot at brief approval (or auto-fire) time. Fed by a small market-data fetcher (port from Python prototype). |
| Should pipelines be able to **chain** (output of one feeds another)? | v2. v1 pipelines are independent. |
| What happens to a brief if its source document is **retracted** by the source between fetch and generation? | v1 = generate anyway; provenance trail records the original. v2 = configurable suppression. |
| **Per-tenant LLM provider binding** at the agent level — can different pipelines for the same tenant use different providers? | v1 = no, providers are per-tenant (deployment-stack §5.3). Per-pipeline overrides if a real client asks. |

---

## 10. Decision log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-07 | Pipelines, not personas, are the unit of fan-out | A tenant can run multiple pipelines (retail journalist + pro quant) drawing from the same source pool with different personas/formats/thresholds |
| 2026-04-07 | Impact classification per-tenant, trigger evaluation per-pipeline | One Haiku call serves all pipelines for a tenant; cheaper than per-pipeline classification |
| 2026-04-07 | Default trigger threshold = 70 (per-tenant override, then per-topic override) | Sensible default; clients tune from there |
| 2026-04-07 | Default trigger mode = HITL; autopilot is per-pipeline opt-in | Compliance and trust at launch; clients earn autopilot |
| 2026-04-07 | Cost ceiling per pipeline (per day + per month), highest-impact priority on ties | Stops chaotic news days from blowing up LLM bills |
| 2026-04-07 | Event clustering at v1 = hash of (entities + topics + time bucket); v2 = real entity extraction + embedding clustering | Cheap, good-enough start; evolve when measured pain |
| 2026-04-07 | Canonical topic taxonomy from instrument catalog port + per-pipeline custom topics | Enables future cross-tenant classification cache |
| 2026-04-07 | Topic threshold defaults inherit pipeline → tenant → global; per-topic overrides allowed | Flexibility without forcing N config knobs at onboarding |
| 2026-04-07 | Content briefs are immutable once generation starts; new context creates a new brief | Audit clarity |
| 2026-04-07 | Two-layer generation: core analytical layer (FA/TA/FA+TA) + identity adaptation layer | Decouples market reasoning from editorial shaping; avoids prompt overloading; enables shared cache; matches "stable of writers" commercial story |
| 2026-04-07 | FA, TA, and FA+TA are three distinct core agents — FA+TA is NOT a concatenation of FA and TA | A combined FA+TA piece weaves both perspectives into one integrated read; that's a different thinking task from running FA and TA separately and concatenating |
| 2026-04-07 | Core analytical cache key = (event_id, topic_id, analytical_method); 24h TTL | Powers the cost optimization (one Opus call serves N tenants); 24h matches the half-life of "this analysis is still broadly correct" |
| 2026-04-07 | Identity agents are transformers, not reasoners; each has a NATIVE output format | No `(method × format × audience × voice)` cartesian explosion; format is the identity's shape; add a new identity to add a new product |
| 2026-04-07 | Pre-allocated angle is fed to the IDENTITY agent, not the core agent | Keeps the core analysis cache valid across all 9 angles; angles are an editorial framing concern, not a reasoning concern |
| 2026-04-07 | Default identity-layer model = Sonnet (Opus per-pipeline override available) | The reasoning is already in the cached core analysis; identity transformation needs writing craft, not Opus-level reasoning. ~5x cheaper. |
| 2026-04-07 | Pass-through identities (`raw-fa` / `raw-ta` / `raw-fa+ta`) skip the identity layer entirely | Zero identity-layer cost; serves clients who want institutional FA/TA pieces with no editorial dressing |
| 2026-04-07 | Translation engine reframed as **conformance engine** that runs unconditionally for every piece | 12 of 13 metrics apply to any content regardless of language; same-language content gets a pass-through TranslationAgent and the rest of the pipeline runs as before |
| 2026-04-07 | Pipeline order corrected: composition → compliance → conformance → uniqueness → publish | Conformance overlay (glossary, brand voice) pushes content AWAY from cross-tenant similarity, so uniqueness must run on the conformed final form |
| 2026-04-07 | Events that don't match FA or TA are filtered at the trigger layer, not handled by a special agent | The impact classifier can't ground them against an instrument, so they don't reach the content pipeline. v2 may add a `CommentaryAgent` if a real client demands it. |
