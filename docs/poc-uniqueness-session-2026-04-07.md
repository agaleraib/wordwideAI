# Uniqueness PoC — Session Journal (2026-04-07)

> ### ⚠️ REVISION 2026-04-08 — read this before §4, §5, §6, §9
>
> A follow-up session on 2026-04-08 re-scored the Stage 6 and Stage 8 outputs of the 2026-04-07 and 2026-04-08 runs under a **two-axis judge rubric** (factual fidelity × presentation similarity) that replaces the original single-axis "unique vs duplicate" judge. Under the new rubric, **the "0.87 cosine wall" that this journal describes as the most important finding is substantially a measurement artifact**, not an architectural ceiling. The original single-axis judge was rewarding fact fabrication (low overlap on levels/probabilities/direction) and punishing faithfulness (high overlap on the same shared facts), which is exactly backwards for a broker that must preserve the FA/TA substance. Headline revised findings:
>
> - **Stage 6 (baseline) under the new rubric scores 5/6 `distinct_products`** on the 2026-04-08 run and 4/6 on the 2026-04-07 run. The architecture was already essentially working; the old metric hid it.
> - **Stage 8 (persona-tilt) is net-negative and is being killed.** Under the new rubric it tripled the `fabrication_risk` count (1→3) and bought ~zero presentation improvement. The tilt agent was mutating facts (levels, probabilities, direction) to score better on a metric that wasn't measuring the right thing. The §6 / §9 recommendation to make Stage 1B / Stage 8 a first-class production layer is **retracted**.
> - **Helix Markets is the one persona that fails factual fidelity** independently of Stage 8. All six of its tag prompts (`tail-risk`, `crowded-trade`, `sentiment-extreme`, `contrarian`, `skeptical`, `provocative`) semantically encode "disagree with something" — and in a shared-FA architecture the only thing for Helix to disagree with is the source itself. This is a persona-design problem, not an architecture problem. See §13 below and `tags.ts`.
> - **The real uniqueness metric is presentation similarity, and it is already in the target zone** (0.28–0.48 across Stage 6 pairs on the 2026-04-08 run, against a < 0.5 target) without the tilt layer and without masking facts.
>
> The section-level addenda are inline: §4.1, §6.1, §9.1, §13 (new), and §14 (post-retraction housekeeping — two-axis judge wired into production in `040d019`, Stage 6/7 outputs now persisted as individual files in `72c9a82`, `analyze-uniqueness-run` skill added in `d8f6f2e`, plus a list of residual gaps flagged by code review that are not yet fixed). The rescoring artifacts are at:
> - `uniqueness-poc-runs/2026-04-07T21-04-37-536Z_iran-strike-2026-04-07/report-rescored.md`
> - `uniqueness-poc-runs/2026-04-08T11-40-20-923Z_iran-strike-2026-04-07/report-rescored.md`
>
> The rescoring script lives at `packages/api/src/benchmark/uniqueness-poc/rescore.ts`. The new two-axis judge prompt is defined inside that script and will be wired into `llm-judge.ts` + `runner.ts` in a follow-up commit.
>
> The original 2026-04-07 narrative below is preserved as-is for historical context — the confused interpretation is itself part of the record of how this PoC was understood before the measurement bug was found. Do not delete it. Just read this revision banner and the §4.1/§6.1/§9.1/§13 addenda first.

---

**Session date:** 2026-04-07 (+ 2026-04-08 revision)
**Branch:** `workstream-b-sources-spec`
**Owner:** Albert Galera
**Working with:** Claude (Opus 4.6)
**Status at end of session:** Phase 1 PoC complete, four runs analyzed, next experiment identified, all artifacts committed. **2026-04-08 revision: measurement rubric was wrong; §4 table is an artifact; Stage 8 killed; Helix persona being rewritten.**

This is a non-spec session journal — a high-fidelity record of the proof-of-concept work done on the FinFlow content uniqueness architecture. It exists so that future readers (the team, partners, future Claude sessions, and Albert himself when he comes back tomorrow) can pick up the experimental thread without having to re-derive what was learned.

For the production specs that this PoC tests, see:
- `docs/specs/2026-04-07-content-pipeline.md` — the content pipeline architecture
- `docs/specs/2026-04-07-content-uniqueness.md` — the uniqueness gate
- `docs/specs/2026-04-07-deployment-stack.md` — runtime/deploy
- `packages/api/src/benchmark/uniqueness-poc/` — the harness code

---

## 1. Why this PoC existed

The FinFlow architecture's load-bearing claim is that **the same news event can produce genuinely unique content per broker** without losing the cost-sharing benefits of a shared analytical layer. If this claim doesn't hold empirically, the entire commercial pitch ("your own analyst, not syndication, won't be penalized by Google duplicate-content detection") collapses.

The PoC was designed to falsify or validate this claim **before** investing in the full production build. The hypothesis: a layered system of (shared FA core analysis) + (identity adaptation per pipeline) + (persona overlay) + (tag-driven angles + personality) + (temporal narrative continuity) would produce content that is:

1. **Below the SEO duplicate-content threshold** (ROUGE-L F1 < 0.40 — the bar Google's duplicate detector cares about)
2. **Below the product-perception threshold** (cosine similarity < 0.85 cross-tenant — the bar for "feels like distinct products")

We tested this empirically with real LLM calls, real prompts, real similarity measurements, and a real LLM judge across **four iterations** in a single session.

## 2. The harness in one paragraph

A standalone TypeScript script at `packages/api/src/benchmark/uniqueness-poc/` that orchestrates the architectural pattern end-to-end without building production infrastructure. It runs FA agent (Opus) → identity agents (Sonnet) → embedding similarity (OpenAI text-embedding-3-small) → ROUGE-L overlap → LLM judge for borderline cases → markdown report. Single fixture (Iran strike → EUR/USD) was used as the running example throughout. Cost per `--full` run: ~$0.60-$1.40 depending on which stages are enabled. See `packages/api/src/benchmark/uniqueness-poc/README.md` for run instructions.

## 3. The four runs in chronological order

### Run 1 — Basic mode (no `--full`)

**What was tested:** the original 6-identity stable (BeginnerBlogger, InHouseJournalist, TradingDesk, NewsletterEditor, Educator, SeniorStrategist) all consuming the same FA core analysis on the Iran event. Persona overlay was the only differentiation tool. No tags. No narrative state. Pairwise matrix of 15 cross-identity pairs evaluated against the cross-tenant thresholds (incorrectly — see below).

**Headline numbers:**
- Cosine: 6 of 15 pairs flagged duplicate by the LLM judge
- ROUGE-L: well below threshold throughout
- Verdict: FAIL (judge flagged duplicates)

**Critical methodological issue discovered after the run:** the harness was applying the strict **cross-tenant** thresholds (cosine 0.85, ROUGE-L 0.40) to what is structurally an **intra-tenant cross-identity** comparison. The spec actually allows looser thresholds (cosine 0.92) for the intra-tenant case because two pipelines from the same brand naturally share perspective. So the FAIL verdict was over-strict — re-classified at the correct threshold, only 1 borderline pair remained. This bug was never fixed (deferred so we could focus on the cross-tenant case in subsequent runs).

**Key qualitative finding:** the LLM judge's reasoning on the duplicate pairs was sharp and specific: *"Both pieces share the same three-factor analysis. Same examples (Syria strikes, 4% oil, gold spike, 2022 parity). Same technical levels (1.0820, 1.0780). Same historical analog (2020 Soleimani). Same conclusion about Iran's response. This is surface-level identity variation on a single analytical take, not meaningfully different perspectives."*

**This judge verdict was the most important finding of the entire PoC.** It told us, in plain English, exactly what was wrong: the identity agents were producing **surface-format diversity** (different lengths, different structures, different voices) but **content convergence** (same chains, same examples, same conclusions). The four downstream runs would all be variations on trying to fix this.

### Run 2 — Cross-tenant matrix added (Stage 6) with current prompts

**What changed from Run 1:** added two new personas (Helix Markets en-AU contrarian boutique, Northbridge Wealth en-CA conservative wealth manager) bringing the total to 4. Added Stage 6: cross-tenant matrix that runs the same identity (`InHouseJournalist`) with all 4 personas and builds 6 pairwise comparisons against the **strict** cross-tenant thresholds. This was the first run that produced statistically meaningful cross-tenant data instead of a single anecdotal pair.

**Stage 6 baseline numbers:**
- Cosine mean: **0.9344** (range 0.9121 – 0.9514)
- ROUGE-L mean: **0.3044** (range 0.2577 – 0.3410)
- Verdict: **FAIL** — 6 of 6 pairs flagged duplicate by the LLM judge

**Reproducibility floor (Stage 4) — same identity, no persona, 3 runs:**
- Pairwise cosine mean: 0.9554
- This established the **noise floor** — anything below 0.9554 was real persona signal, not just sampling noise.

**Differential from persona overlay alone:**
- Noise floor: 0.9554
- Cross-tenant mean (with persona overlay): 0.9344
- **Persona overlay alone produced 0.021 cosine of differentiation.** Real signal, but tiny.

**Key insight from Run 2:** the persona-overlay layer (brand voice, audience description, jurisdictions) is doing real work but its dynamic range is small. The most-different persona pair (FastTrade vs Northbridge — energetic retail vs conservative wealth) produced cosine 0.9121, the most-similar pair (Premium vs Helix — both sophisticated voices) produced 0.9514. Total dynamic range across the persona space: ~0.04. This is the maximum the brand-overlay layer can deliver no matter how aggressive we make the prompts.

**Architectural implication:** prompt-time brand-overlay differentiation is inherently bounded. To clear the cross-tenant bar (need to drop another ~0.07-0.10), we need a different mechanism that operates on a different dimension.

### Run 3 — Tag-driven angles + personality directives

**What changed from Run 2:**
- Created `tags.ts` with two onboarding tag taxonomies:
  - **AngleTag** (~25 tags in 7 categories: macro framing, technical framing, action-oriented, risk framing, educational, cross-asset, positioning)
  - **PersonalityTag** (~30 tags in 6 categories: editorial stance, risk temperament, communication style, information density, confidence posture, tone qualities)
- Each tag has a sharp prompt-ready description that gets injected into the system prompt verbatim.
- Added `preferredAngles` and `personalityTags` to `ContentPersona` (max-different picks per broker)
- Updated `in-house-journalist.ts` user-message builder to inject both tag directive blocks as **hard constraints** before the brand-overlay context
- No other changes (single architectural variable: tag-driven directives)

**Tag picks for the four brokers (deliberately maximally different):**

| Broker | Angles | Personality |
|---|---|---|
| Premium Capital Markets | positioning + macro-narrative + risk-warning | calibrated + comprehensive + formal + observer + measured |
| FastTrade Pro | trade-idea + momentum-driven + signal-extract | aggressive + prescriptive + high-conviction + urgent + energetic |
| Helix Markets | sentiment-extreme + crowded-trade + tail-risk | contrarian + skeptical + provocative + independent + authoritative |
| Northbridge Wealth | educational + historical-parallel + mechanism-explainer | conservative + consultative + narrative-driven + warm + hedged |

**Stage 6 results (Run 3):**

| Metric | Run 2 (no tags) | Run 3 (tags) | Δ |
|---|---:|---:|---:|
| Cosine mean | 0.9344 | **0.8672** | **−0.067** |
| Cosine min | 0.9121 | **0.8185** | **−0.094** |
| Cosine max | 0.9514 | **0.9082** | **−0.043** |
| ROUGE-L mean | 0.3044 | **0.1992** | **−0.105** |
| ROUGE-L max | 0.3410 | **0.2246** | **−0.116** |

**Headline finding:** the tag mechanism produced a **7-point cosine drop and a 10-point ROUGE-L drop in a single intervention**. To put this in perspective, the persona overlay alone in Run 2 gave us 0.02 cosine of differentiation; tag-driven angles + personality gave us **0.07 — over 3× the persona-overlay budget.**

**The most important pair:** FastTrade Pro vs Northbridge Wealth (the most-different persona pair on both axes — aggressive trade-idea vs conservative educational) hit **cosine 0.8185, BELOW the 0.85 cross-tenant threshold**. This was the first time in the entire experiment that any pair mathematically cleared the strict bar.

**ROUGE-L was decisively cleared:** every pair was now at most 0.22 against a 0.40 threshold — a 45% margin. The Google duplicate-content concern was decisively addressed at this layer.

**But the LLM judge still said duplicate on all 6 pairs.** Even the FastTrade ↔ Northbridge pair, which cleared by raw cosine, was judged duplicate by the LLM. Reading the actual prose explained why: the writers shared *the same three transmission mechanisms in the same order* (safe-haven dollar, oil terms-of-trade, monetary divergence), *the same factual anchors* (Brent at $92, gold at $2,365), *the same conclusions*. The tag system changed HOW they wrote but did not change WHAT they chose to talk about. *"Same article structurally, just dressed differently."*

This was the **first measurement of the empirical wall** — the floor below which prompt-time framing layers cannot push, because all writers are reading from the same source analysis.

### Run 4 — Temporal narrative state (Stage 7)

**Hypothesis going in:** maybe the missing layer is **per-tenant accumulated history**. Each broker has its own "narrative thread" of prior coverage on each topic. Inject that history into the prompt as memory, and the writer feels like a continuing voice rather than a fresh take. Two clients with different prior takes would then diverge on follow-up coverage because their narrative states differ.

**What was built:**
- New `NarrativeStateEntry` and `TenantTopicNarrativeState` types
- New `narrative-state.ts` module:
  - `extractNarrativeState()` — Haiku call with `tool_use` that takes a published piece and extracts structured state (one-sentence summary, directional view + confidence, key thesis statements, levels mentioned, CTAs used)
  - `renderNarrativeStateDirective()` — formats the state into a hard-constraint context block for the next piece's user message
- New fixture `iran-retaliation.json` — a continuation event 2 days later (Houthi/Iraqi militia strike on Saudi Aramco Yanbu, Brent +6%, EUR/USD breaks 1.0820)
- New Stage 7 in the runner: takes Stage 6's outputs as "prior coverage", extracts narrative state from each, runs a fresh core analysis on the second event, then runs the journalist on the second event TWICE per persona — once WITHOUT state (control), once WITH state (treatment). Builds cross-tenant matrices for both groups and reports the differential.

**Stage 7 results:**

| Group | Cosine mean | ROUGE-L mean |
|---|---:|---:|
| Control (no narrative state) | 0.8664 | 0.1994 |
| Treatment (with narrative state) | **0.8736** | 0.1994 |
| **Differential** (control − treatment) | **−0.0073** | 0.0000 |

**The differential is essentially zero — within noise, slightly negative.** Narrative state injection did not produce additional cross-tenant differentiation. **In fact, treatment was very slightly MORE similar than control.** ROUGE-L was identical between groups.

**But the prose tells a different story than the numbers.** I read the FastTrade and Northbridge treatment outputs in full. Both writers ARE using the narrative state — and using it well:

- FastTrade's treatment piece opens with: *"The bearish EUR/USD thesis laid out in Tuesday's note just got a powerful confirmation, and the window to act is open right now."*
- Later: *"When the U.S. launched strikes on IRGC positions in Syria on April 7, the analysis here flagged 1.0820 as the decisive pivot — hold it and the bearish thesis stays controlled, break it and the pair opens up for a run toward 1.0720..."*
- Northbridge's treatment piece opens with: *"For readers who have been following this space, that 1.0820 level will be familiar — it was the floor that had held since February, and in Tuesday's note we flagged it as the line in the sand."*

**The continuity feature works — empirically.** Both writers reference "Tuesday's note", confirm prior calls, build on the previously-established framing. A real reader subscribed to either broker's content would absolutely feel "this is the same writer continuing the story they started two days ago." The product story — "feels like a human is writing" — is genuinely validated.

But the cosine didn't move because of a deeper mechanism issue:

**Narrative state propagates similarity forward — it doesn't create divergence.** If the prior pieces converged at 0.87 cosine, the extracted narrative states converge too (because the extractor is faithful to what each writer said), and the continuations converge too (because each writer is told to maintain consistency with their prior view). The mechanism is *additive in continuity but neutral in cross-tenant divergence*.

For narrative state to *add* cross-tenant divergence, the priors would need to be already structurally divergent — and they weren't, because they all consumed the same source FA analysis at the previous step. The convergence was baked in upstream.

**Lesson learned:** narrative state is the right tool for the temporal continuity product feature (which has independent value — see §8.7 of the content-pipeline spec for the future "running thesis" dashboard view this enables) but it is NOT a cross-tenant differentiation mechanism.

## 4. The empirical differentiation budget (the most important table in this document)

After the four runs, we have statistically meaningful data on what each architectural layer contributes to cross-tenant cosine differentiation. Each row shows the layer added on top of the previous and the resulting mean cosine on the same Stage 6 cross-tenant test (4 personas × InHouseJournalist × Iran event):

| Layer added | Cosine mean | Marginal contribution |
|---|---:|---:|
| Reproducibility floor (same identity, same core, no persona) | 0.9554 | (noise floor) |
| + brand-voice persona overlay (Run 2) | 0.9344 | **−0.021** |
| + persona-driven angle + personality tags (Run 3) | 0.8672 | **−0.067** |
| + temporal narrative state (Run 4) | 0.8736 | **+0.006** (no contribution, slight regression) |
| **Strict cross-tenant threshold** | **0.85** | (the bar to cross) |

**Headline finding (original, retracted 2026-04-08): there is a hard empirical floor at ~0.85-0.87 cosine when all writers consume the same shared core analysis.** Three additive prompt-time layers got close but cannot push past it. **The wall is the source analysis itself.**

### 4.1 REVISION 2026-04-08 — the wall was substantially a measurement artifact

The single-axis "unique vs duplicate" rubric used by the original judge (see `llm-judge.ts` as of 2026-04-07) conflated two things that should have been scored independently:

1. **Factual fidelity** — do both documents agree on the facts that must be shared (price levels, probabilities, directional call, historical anchors, set of transmission chains, conclusion)? This SHOULD be high; a broker whose tilt agent contradicts the source FA is fabricating, not differentiating.
2. **Presentation similarity** — how alike do the two documents read as prose (voice, structure, lead, emphasis, framing)? This SHOULD be low; the goal is two different writers producing different prose from the same facts.

The original judge collapsed these into one number, so documents that were doing the right thing (same facts, different prose) got flagged `duplicate` for the *wrong reason* — the judge was counting the shared facts as evidence of copying, when in fact the shared facts were the required state. Conversely, any document that mutated facts (invented a level, reassigned a probability) could score as `unique` even though it was contradicting the source — also the wrong direction.

Re-scoring the existing Stage 6 outputs with a two-axis rubric shows:

| Run | Distinct products | Reskinned | Fabrication risk | Fidelity mean | Presentation mean |
|---|---:|---:|---:|---:|---:|
| 2026-04-07 Stage 6 (Run 4 / iran-strike) | **4/6** | 0 | 2/6 | 0.885 | 0.488 |
| 2026-04-08 Stage 6 (latest / iran-strike) | **5/6** | 0 | 1/6 | 0.925 | 0.378 |

Compare these rows with §5's table below which reports "6/6 flagged duplicate by the LLM judge — FAIL." **Every pair the old judge flagged on the 2026-04-08 Stage 6 run — except the one involving Helix — is actually a `distinct_products` success under the two-axis rubric.** The 0.87 mean cosine was not the hard floor the journal believed; it was a floor on a metric that had the wrong sign on its shared-facts term.

The one pair that legitimately fails is `Helix Markets ↔ Northbridge Wealth`, which has factual fidelity 0.88 with two level/probability divergences. This is a persona-design problem (see §13), not an architecture problem.

**Corrected §4 table (measured under the two-axis rubric):**

| Layer | Presentation similarity mean | What it means |
|---|---:|---|
| 2026-04-08 Stage 6 baseline (universal core + tags + persona overlay) | **0.38** | Already in the target zone (< 0.5) without the tilt layer |
| Cross-tenant target | **< 0.5** | The real bar |
| Stage 8 treatment (persona-tilt on top of Stage 6) | **0.39** (essentially unchanged) | Tilt bought nothing on the axis it was designed to improve, AND dragged fidelity from 0.925 → 0.835 |

The "0.07 cosine of differentiation" that §4 attributed to the tag layer was real, but it was measured against the wrong target. Under the right target, the tag layer already gets the architecture across the line.

## 5. The product-bar vs SEO-bar distinction — both bars matter, only one is cleared

The spec defines two thresholds, one for each commercial concern:

| Concern | What it asks | Threshold | Run 4 result |
|---|---|---|---|
| **SEO uniqueness** (Google duplicate-content detection penalizes brokers' organic traffic) | Are pieces n-gram-distinct enough that Google won't flag them? | ROUGE-L F1 < 0.40 | **0.20** mean (max 0.22) — **PASS by 50% margin on every pair, every run** |
| **Product perception** (a sophisticated reader recognizing "this is the same article reskinned") | Are pieces analytically distinct enough that a discerning reader perceives different work? | Cosine < 0.85 (cross-tenant), judge says different | **0.87** mean — **FAIL**, judge flags all 6 pairs as duplicate |

**The PoC can defend the SEO bar today.** Every run cleared it decisively. The Google duplicate-content concern is solved with the existing prompt-engineering layers.

**The product-perception bar requires more architecture.** The 0.87 wall is not crossable by any combination of prompt-time layers we tested (4 attempts, 3 distinct mechanisms). To cross it, we need to attack the source-analysis convergence directly. See §6.

## 6. The Stage 1B insight — what to test next

The four runs all share the same upstream constraint: every persona's identity-adaptation step reads from the same shared FA core analysis. Different prompts at the identity layer can't change the fact that the source content is the same. The convergence is born upstream.

**Albert's question at the end of session 4 surfaced the obvious fix:** *"What if each client's FA/TA analysis itself was personalized?"* The answer is: yes, that would create the divergence — but pure per-client FA breaks the cost-sharing economics.

**The smart middle ground is a new architectural stage between the universal core analysis and the identity adaptation:**

```
Stage 5.7a — Universal core analysis (FA / TA / FA+TA agents)
   • One Opus call per (event × topic × method), shared across all tenants
   • Comprehensive: covers ALL transmission chains, ALL conclusions, ALL levels
   • Cached in domain_analyses, 24h TTL
   • UNCHANGED from existing architecture

Stage 5.7b — NEW: Persona-tilted analytical view
   • One Sonnet call per (event × topic × persona)
   • Takes Stage 5.7a's comprehensive analysis + the persona's tags + prior coverage
   • Produces a persona-specific analytical view: same facts, different emphasis,
     different conclusions, different anchors
   • Cached in tenant_event_analytical_view (NEW table)
   • This is where the cross-tenant divergence is BORN
   • ~$0.05-0.08 per tenant per event

Stage 5.7c — Identity adaptation (existing)
   • Now consumes Stage 5.7b instead of Stage 5.7a
   • Same identity agents, same prompts, same persona overlay
   • Per pipeline, ~$0.10
```

**Cost economics under the new architecture (50 tenants, per event):**

| Model | Per-event cost (50 tenants) | Per-month at 100 events/day |
|---|---:|---:|
| Current (shared FA) | $5.30 | ~$16,000 |
| **Two-stage (Stage 5.7a shared + Stage 5.7b per-tenant)** | **$7.80-9.30** | **~$24,000-28,000** |
| Naive per-tenant FA (no sharing) | $20.00 | ~$60,000 |

The two-stage architecture costs ~50% more than full sharing but ~60% less than naive per-tenant FA. The marginal cost is small enough to absorb into the per-pipeline pricing.

**Hypothesis to test:** with Stage 5.7b in place, the cross-tenant cosine should drop from 0.87 to 0.70-0.78, well below the 0.85 bar. The mechanism: each persona-tilted analytical view contains different facts, different emphasis, different conclusions, so the identity adaptation that follows is starting from a divergent foundation rather than a convergent one.

**This is the experiment to run tomorrow.** The harness change is small (one new stage in `runner.ts`, one new prompt module for the persona-tilt agent, one new test stage that compares "current Stage 6" vs "Stage 6 with 5.7b enabled"). Cost: ~$1.50-$2.00 per run. Expected outcome: PASS or BORDERLINE on cross-tenant verdict for the first time.

### 6.1 REVISION 2026-04-08 — Stage 1B / Stage 8 was a mistake, retracted

The Stage 1B insight was premised on the wall at 0.87 being a real architectural ceiling. §4.1 shows it wasn't. Worse, when the 2026-04-08 run actually built and executed Stage 8, it produced exactly the failure mode last session's Albert asked about: *"any of those will produce misleading information by turning or changing FA and TA output into something completely different, particularly in terms of levels or prices?"* — yes, they did.

**Stage 8 measured outcome on the 2026-04-08 run, under the two-axis rubric:**

| Metric | Stage 6 baseline (control) | Stage 8 treatment | Delta |
|---|---:|---:|---:|
| `distinct_products` count | 5/6 | 3/6 | **−2** |
| `fabrication_risk` count | 1/6 | 3/6 | **+2** |
| Factual fidelity mean | 0.925 | 0.835 | **−0.09** (catastrophic) |
| Presentation similarity mean | 0.378 | 0.388 | +0.01 (null) |

The tilt agent pushed Helix's fidelity from 0.88 → 0.72 and dragged `Premium ↔ Helix` from 0.95 → 0.72. It bought near-zero presentation improvement. **The treatment strictly damaged the output quality on the axis that matters for broker integrity, while failing to improve the axis it was built to improve.**

**Decision 2026-04-08:** Stage 8 is killed. The `PersonaTiltTestResult` type, the `runPersonaTiltTest` runner stage, the `prompts/persona-tilt-agent.ts` module, and the Stage 8 rendering in `report.ts` are all to be removed in a follow-up commit. Do NOT wire any form of "persona-tilted analytical view" into the production architecture without the new two-axis rubric catching fabrication first.

**What a faithful "contrarian broker" looks like instead:** if a future workstream genuinely needs an analytically divergent view (e.g. a contrarian independent-research house), it should be built as a *house-view-conditioned FA agent* — an extra input to the FA stage itself that gives it contrarian priors before it generates the analysis, so the divergence is born at the FA layer with proper reasoning and all downstream stages consume it faithfully. This is a separate workstream, not a tilt layer.

## 7. Ancillary findings

A few smaller findings that don't fit into the main narrative but are worth recording:

### 7.1 The narrative continuity layer is independently valuable as a product feature

Even though narrative state didn't add cross-tenant differentiation, the prose it produces (the treatment outputs in Stage 7) genuinely feels like continuation pieces. Both FastTrade and Northbridge treatment outputs reference "Tuesday's note", confirm prior calls, and build on prior framing. **A real subscriber would feel like the same writer is covering the story over time.** This is the "feels like a human is writing" pitch validated.

The implication for the spec: narrative state stays in scope as a *product* feature regardless of its (lack of) contribution to cross-tenant uniqueness. It enables the "running thesis" dashboard view (see content-pipeline spec §8.7) which is a sellable feature on its own and creates user lock-in.

### 7.2 The intra-tenant matrix's FAIL verdict is misleading

Throughout all four runs, the original 6-identity intra-tenant matrix (the matrix of all 15 cross-identity pairs for one notional broker) reported FAIL because the harness was applying cross-tenant thresholds (cosine 0.85) to what is structurally an intra-tenant case (cosine 0.92 in the spec). At the correct intra-tenant threshold, only 1-2 pairs would be borderline and most would pass. **This is a known bug in `classifyStatus` that we deliberately did not fix during the session, but should be fixed in a follow-up.** The fix is one function: split it into `classifyCrossTenantStatus` (already exists) and `classifyIntraTenantStatus` (TODO), and route the correct one to each matrix.

### 7.3 The LLM judge is the most valuable measurement tool in the harness

Across every run, the LLM judge (Haiku via tool_use) produced sharp, specific, actionable verdicts on borderline pairs. Examples:

> *"Both pieces share the same three-factor analysis. Same examples (Syria strikes, 4% oil, gold spike, 2022 parity). Same technical levels (1.0820, 1.0780). Same historical analog (2020 Soleimani). Same conclusion about Iran's response. This is surface-level identity variation on a single analytical take, not meaningfully different perspectives."*

The judge caught content convergence that raw embedding similarity could only suggest. It also distinguished "looks similar by metric" from "actually similar by content" — for example, the BeginnerBlogger ↔ Educator pair was borderline by cosine in Run 1 but the judge correctly said unique because they had genuinely different pedagogical approaches. **The judge belongs in the production gate exactly as the spec says (Stage 3 of the verification gate, fires only on borderline pairs).**

### 7.4 Cost economics are very forgiving

| Run | Total cost |
|---|---:|
| Run 1 (basic mode) | ~$0.70 |
| Run 2 (--full with cross-tenant matrix) | ~$0.62 |
| Run 3 (--full with tags) | ~$0.62 |
| Run 4 (--full with narrative state) | ~$1.24 |
| **Session total** | **~$3.20** |

Four full iterations of the architecture for $3.20. The PoC harness is cheap enough to iterate on freely. Albert can run dozens more experiments at this cost level without thinking about it.

### 7.5 Word counts behave reasonably under tag directives

Across all runs, word counts stayed close to target:

| Identity | Target | Run 4 actual |
|---|---:|---:|
| BeginnerBlogger | 500-750 | 743 ✓ |
| InHouseJournalist | 700-950 | 928 ✓ |
| TradingDesk | 120-220 | 156 ✓ |
| NewsletterEditor | 350-480 | 456 ✓ |
| Educator | 600-850 | **1358 ✗** (60% over) |
| SeniorStrategist | 1000-1400 | 1493 ✗ (slightly over) |

**Educator is the consistent length offender.** Both basic mode and `--full` mode produced ~1300+ words against an 850 cap. The fix is to add a "if you exceed 850 words you have failed" instruction to the Educator system prompt. Not done in this session because length was not the primary experimental variable.

## 8. What's committed at the end of session

**In the repo (workstream-b-sources-spec branch):**

- The PoC harness scaffold and the basic-mode pipeline (`packages/api/src/benchmark/uniqueness-poc/`)
- The two new personas (Helix Markets, Northbridge Wealth)
- The Stage 6 cross-tenant matrix code
- The tag taxonomies (`tags.ts` with 25 angle tags + 30 personality tags) and persona tag picks
- The journalist user-message builder updated to inject tag directives
- The narrative state module (`narrative-state.ts`) with the extractor + injection helper
- The Stage 7 narrative state test in the runner
- The continuation fixture (`iran-retaliation.json`)
- The report renderer with all new section types
- This session journal
- The new "running thesis" dashboard view spec'd in `2026-04-07-content-pipeline.md` §8.7

**In memory (`~/.claude/projects/.../memory/`):**

- New: `project_uniqueness_poc_2026-04-07.md` — empirical findings + next experiment
- Updated: `feedback_two_layer_generation.md` — extended with the narrative state lesson
- Updated: `project_content_uniqueness.md` — empirical wall finding

## 9. What to do tomorrow morning (Albert's pickup point)

When you sit down to work on this tomorrow, the **single highest-value experiment is Stage 1B (the persona-tilt analytical layer)**. The reason: it's the only layer the data hasn't tested, and the data is pointing directly at it as the missing piece.

The build steps for Stage 1B:

1. Add a new module `prompts/persona-tilt-agent.ts`:
   - System prompt for a persona-tilt agent
   - User-message builder that takes (universal core analysis + persona tags + prior narrative state) and instructs the agent to produce a persona-tilted analytical view
2. Add `runPersonaTiltedAnalysis()` to `runner.ts`
3. Add a new Stage 8 to the runner: variant of Stage 6 where each persona's identity adaptation reads from its persona-tilted view instead of the universal core analysis
4. Wire Stage 8 into `--full` mode in `index.ts`
5. Update `report.ts` to render Stage 8
6. Run `bun run poc:uniqueness:full` and compare Stage 6 (current) vs Stage 8 (with tilt)

**Hypothesis to falsify or validate:** Stage 8 cosine mean should drop from 0.87 to 0.70-0.78. If it does, the architecture is empirically validated end-to-end. If it doesn't, we have a deeper finding that needs investigation.

**Cost of the experiment:** ~$1.50-$2.00 (one extra core analysis call at Sonnet pricing per persona, plus another set of identity adaptation calls). **Time:** ~30 min build, ~5 min run.

**Decision criteria for what to do after Stage 1B:**

| Stage 8 cosine mean | What it means | Next action |
|---|---|---|
| < 0.80 | Strong validation, the architecture works | Update spec to add Stage 1B as a first-class layer; declare PoC done; start production build |
| 0.80-0.85 | Validation but tight | Update spec; add the conformance engine layer to the production roadmap as the closer; declare PoC done |
| 0.85-0.88 | No improvement | Reframe the conversation: maybe 0.87 cosine is acceptable for content that obviously reads as different products; tune thresholds; consider conformance engine as the primary cross-tenant tool |
| > 0.88 | Hurt | Real architectural finding — the persona tilt is being ignored or backfiring; needs deeper investigation |

### 9.1 REVISION 2026-04-08 — the Stage 8 table above is obsolete

Stage 8 was built and executed. It fell into a decision class that the above table did not anticipate: **the cosine number went nowhere (0.87 → 0.87) but a rescoring under the two-axis rubric revealed it had corrupted factual fidelity (0.925 → 0.835) as the price of that null result.** The old decision table could not distinguish "null + safe" from "null + unsafe" because it did not separate fidelity from presentation.

**The actual next experiments, as of 2026-04-08 (superseding §9):**

1. **Rework the Helix persona** (§13). Rewrite the six Helix-owned tag prompts in `tags.ts` so they license emphasis/ordering rather than counter-claims. Re-run Stage 6 and verify Helix clears factual fidelity ≥ 0.9 across all pairs. Cost: ~$0.60 + $0.05 rescore.
2. **Wire the two-axis judge into `llm-judge.ts` + `runner.ts` + `report.ts`** as the default judge, replacing the single-axis `unique/duplicate` rubric. Adjust `aggregateVerdict` to HALT on `fabrication_risk`, fail on `reskinned_same_article`, pass on `distinct_products`. Consider firing the judge on every cross-tenant pair (not just borderline) since the new rubric is the authoritative metric and the mechanical metrics become diagnostics.
3. **Delete Stage 8** from the runner, the report, and the type definitions. The `persona-tilt-agent.ts` prompt module can be kept as a reference for the "don't do this" pattern, or deleted outright.
4. **Add the same-persona variance probe** ("Bloomberg two-analysts" test). Generate N drafts from the same persona on the same source with varied temperature and a writer-instance nonce. Measure presentation similarity. This tests whether natural sampling variation produces writerly divergence, and if not, what explicit writer-instance state would.
5. **Masking as a diagnostic (not a gate).** Once the two-axis judge is in production, add an optional preprocessing step that strips numeric levels/probabilities/directional words before cosine/ROUGE scoring. Use it as a sanity check alongside the judge, not as a replacement. The judge is now the authoritative metric.
6. **Integrate the conformance engine** (`packages/api/src/pipeline/translation-engine.ts`) as the downstream deterministic layer that enforces glossary, regional variant, and brand voice on top of the identity layer's output. Expected to push presentation similarity further without any fidelity cost.

## 10. Open questions parked for later

These came up during the session and were not resolved:

1. **Threshold tuning.** The 0.85 cross-tenant cosine threshold was a first-pass guess from the spec. We now have ~25 cross-tenant data points across runs — enough to start thinking about whether 0.85 is the right number, or whether 0.87 is a more realistic bar given the architecture's natural operating range. The spec's calibration plan (`content-uniqueness.md` §10) anticipated this tuning.
2. **`classifyStatus` bug fix.** The harness applies cross-tenant thresholds to the intra-tenant matrix. Trivial fix, deferred for focus.
3. **Educator length cap.** Educator consistently produces 1300+ words against an 850 target. Fix: add a hard length instruction.
4. **Conformance engine integration.** The existing translation engine in `packages/api/src/pipeline/translation-engine.ts` is the architecture's intended primary cross-tenant differentiator (per spec). It was deliberately not tested in the PoC. Hypothesis: it would add another 0.05-0.10 cosine drop via deterministic glossary substitution + regional variant rewrites + brand voice corrections. This is a bigger lift to wire into the harness (~1-2 hours of integration) but is the next natural experiment after Stage 1B.
5. **Multi-event temporal validation.** The narrative state test only used 2 events (Iran strike + Iran retaliation). If we accumulate 5-10 events on the same topic per persona, the narrative state becomes much richer and may produce more divergence than the single-event test showed. Worth retesting after Stage 1B is in place.
6. **Are we measuring the right thing?** Cosine 0.87 between a 200-word terse trade alert and a 1500-word educational essay might be acceptable to a human reader even though the embedding model groups them together. The judge is currently the strictest measurement tool; the question is whether the judge's "duplicate" verdict matches what a real client reader would perceive. Consider doing a small human-judgment pass. **[RESOLVED 2026-04-08 — the answer was no; see §4.1 and §13. A two-axis rubric replaces the single-axis judge.]**
7. **FA prompt should name one explicit invalidation level.** (Added 2026-04-08 after the Helix rewrite verification.) When the new Helix tags were tested on the iran-strike fixture, one `fabrication_risk` flag remained on `FastTrade ↔ Helix` — both writers had to *infer* the invalidation level because the source FA mentions multiple technical levels (1.0820 support, 1.0920 resistance, 1.0980 pre-event equilibrium) without designating one as *the* invalidation. FastTrade inferred 1.0980; Helix inferred 1.0820 with slightly sloppy language ("the level that must hold to maintain the bearish case" — backwards for a support level in a bearish scenario). Neither writer fabricated, but the judge's hard rule fires on any stop-level divergence. The clean fix is upstream: instruct the FA agent to always emit an explicit `invalidation_level` field in its analysis, so all downstream personas cite the same level verbatim. This is a separate workstream from the tag rewrite and benefits *all* personas, not just Helix. Consider it when touching the FA agent prompt next. Tracked as a future consideration; not urgent, the current behavior is accepted per 2026-04-08 session decision ("A + C later").

## 11. Methodology notes for future sessions

A few things that would have made this session faster:

- **Run 1's threshold bug** cost us a confused FAIL verdict that we had to mentally re-classify in every analysis. Fix the bug before re-running.
- **The Stage 6 four-persona cross-tenant matrix** was the right primary test, but it took until Run 2 to introduce it. In hindsight, the basic-mode 15-pair intra-tenant matrix wasn't load-bearing for the architectural question — we should have started with Stage 6 directly.
- **Reading the prose** is much higher signal than reading the cosine numbers. After every run, take 5 minutes to read 2-3 of the actual output pairs. The judge's verdict will make sense in context, and you'll catch issues the metrics don't.
- **The differential metric** (control vs treatment cosine) was the cleanest measurement for Stage 7. Use the same A/B pattern for Stage 8 (with tilt vs without tilt).

## 12. Thank-you note to future-Claude

If you're reading this in a future session and trying to pick up the thread: the single most important paragraph in this entire document is the **empirical differentiation budget table in §4**. That table tells you what each layer contributes and why the wall is at 0.87. Everything else flows from understanding that wall and what it implies.

The second most important thing is the **Stage 1B insight in §6** — the architectural fix that the data is pointing at and that hasn't been tested yet. If Albert hasn't run the Stage 1B experiment yet when you join, that's the highest-value next step.

And the third most important thing is to **read the actual prose**, not just the numbers. The metrics suggest one story; the prose often tells a more useful one.

## 13. REVISION 2026-04-08 — the Helix persona problem and the governing rule for tags

Under the two-axis rubric, Helix Markets is the one persona that consistently fails factual fidelity — independently of whether Stage 8 is enabled. Reading the six tag prompts Helix carries (`tail-risk`, `crowded-trade`, `sentiment-extreme`, `contrarian`, `skeptical`, `provocative`) alongside the prompts of the other three personas reveals a structural difference:

**The other three personas' tags are all about emphasis and selection.** They say "frame", "lead with", "foreground", "anchor in". They tell the writer which slice of the source to emphasize. They do not license the writer to contradict anything.

**All six of Helix's tags semantically encode "disagree with something".** `tail-risk` says *"the consensus is underpricing"*. `crowded-trade` says *"what would unwind it"*. `contrarian` says *"challenge the consensus, be willing to be wrong loudly"*. `skeptical` says *"what if the data is misleading?"*. `provocative` says *"do not soften the implications"*. `sentiment-extreme` says *"the piece is about positioning extremes, not fundamentals"*.

In a shared-FA architecture where every persona reads the same source analysis, there is no consensus for Helix to disagree with **except the source itself**. The writer has no other reference point. So when `contrarian` says "challenge the consensus" and `tail-risk` says "the consensus is underpricing", the model reads the FA's probabilities as "the consensus" and obediently writes "that probability is underpriced, the real number is higher" — fabricating a counter-claim the source does not support. This is exactly the output pattern the 2026-04-08 fidelity score picked up.

**Governing rule for tags in a shared-FA architecture (add this to `tags.ts` as a top-of-file comment):**

> Tags must license **emphasis and ordering**, not **counter-claims**. A tag may tell the writer WHICH fact to lead with, WHICH scenario to foreground, WHICH level to quote first, HOW MUCH SPACE to give each transmission chain, and in WHAT VOICE to render it. A tag must NOT tell the writer to change a level, reassign a probability, reverse a directional call, add a scenario the source did not cover, or invent a counter-thesis. The writer's job is to present the source's analysis, not to argue with it. A genuinely divergent analytical view requires its own FA pass with conditioning priors, not a downstream tilt — see the "house-view-conditioned FA" workstream for that path.

**The immediate fix is a rewrite of Helix's six tag prompts.** Each rewrite keeps the voice (skeptical, provocative, contrarian-in-register) but redirects the counter-claim license to an emphasis license. Before/after pairs are in the follow-up commit; the pattern is "don't renumber, re-order" — the skeptical voice is free to foreground the source's tail scenario, to quote the invalidation level prominently, to write "the base case hangs on a thin assumption," but not to write "the real probability is 40% not 25%." After the rewrite, the expectation is that Helix clears factual fidelity ≥ 0.9 across all pairs while maintaining its distinct presentation voice.

**What this means for tag authoring generally:** a contributor adding a new tag to `tags.ts` should read the governing rule and ask: "does my tag require the writer to disagree with something?" If yes, the tag is unsafe for the shared-FA architecture and either needs rewriting or needs to be parked for the house-view-conditioned FA workstream.

---

## 14. REVISION 2026-04-08 (late) — post-retraction housekeeping + residual gaps

After the two-axis judge wire-up (`040d019`), three follow-up commits cleaned up the harness and captured the analytical workflow as a reusable skill:

- **`91cab2e` — docs + rescore tool + Helix tag rewrite.** Covered in §6.1 / §13. Introduces `packages/api/src/benchmark/uniqueness-poc/rescore.ts` as a standalone migration tool for re-judging pre-2026-04-08 `raw-data.json` files under the new rubric.
- **`040d019` — two-axis judge wired into production.** Replaces the single-axis judge at all four call sites in `runner.ts`. Stage 6 cross-tenant now judges **every** pair (the cosine-based borderline gate is no longer load-bearing for cross-tenant); Stage 3.5 intra-tenant keeps borderline gating because it is not load-bearing. `SimilarityResult` gains seven optional fields (`judgeFactualFidelity`, `judgeFactualFidelityReasoning`, `judgeFactualDivergences`, `judgePresentationSimilarity`, `judgePresentationSimilarityReasoning`, `judgeTrinaryVerdict`, `judgeCostUsd`); legacy `judgeVerdict`/`judgeReasoning` kept as optional back-compat for `rescore.ts` consumers.
- **`72c9a82` — Stage 6/7 outputs persisted as individual files.** `persistRun` was silently dropping 12 of 18 generated pieces from `outputs/` on a `--full` run (all Stage 6 cross-tenant outputs shared `identityId === "in-house-journalist"` and would have clobbered each other onto one file even if the loop had covered them). New layout:
  ```
  outputs/
    <identity>.md                               (Stage 2, 6 files)
    stage6_<identity>__<persona>.md             (Stage 6, 4 files)
    stage7_control_<identity>__<persona>.md     (Stage 7, 4 files)
    stage7_treatment_<identity>__<persona>.md   (Stage 7, 4 files)
  ```
  Each Stage 6/7 file now carries a header with persona name, regional variant, brand voice, and (for narrative-state) event title and group label so a file read in isolation is self-contextualizing.
- **`d8f6f2e` — `analyze-uniqueness-run` skill.** Project-scoped skill at `.claude/skills/analyze-uniqueness-run/SKILL.md` that captures the deep-analysis workflow for a PoC run as a reusable procedure: run metadata → sorted per-pair table → per-pair fabrication triage → cross-pair pattern detection → judge-vs-arithmetic consistency → Stage 7 A/B → Stage 3.5 → cost → prioritized next steps. Hard rules from the 2026-04-08 session are baked in: read the prose not just the numbers, trinary verdict is load-bearing (cosine is diagnostic only), distinguish invention from omission from framing-disagreement, findings not transcripts, cross-rubric comparisons must be caveated when `--compare` spans the pre/post 2026-04-08 measurement revision.

### 14.1 Residual gaps flagged by code review (not yet fixed)

A post-hoc adversarial review of the above commits surfaced four issues that are **not blocking** but that future-Claude should fix before trusting the §6.1 retraction end-to-end:

1. **HARD RULE is prompt-only, not code-enforced** (`llm-judge.ts:160-168, :293-300`). The "any level/probability/direction/stop/historical-anchor divergence ⇒ `fabrication_risk`" rule lives only in the system prompt and tool-schema description. `judgePairUniqueness` spreads the model response with no post-hoc check. Haiku can — and reportedly does — return `factualDivergences: [{kind: "level", …}]` alongside `verdict: "distinct_products"`. Four-line fix: after parsing, if `factualDivergences.some(d => HARD_KINDS.has(d.kind))`, force `verdict = "fabrication_risk"`. The entire retraction rests on this rule being reliable; leaving it as a prompt hint is the single biggest gap in the two-axis wiring.
2. **Tool-use response is cast, not Zod-parsed** (`llm-judge.ts:293-300`). `toolUse.input as {…}` trusts the model to return well-formed numbers. If a numeric field comes back as a string, `report.ts .toFixed()` throws at render time, after the run's API spend is sunk. Project convention (`CLAUDE.md`) is Zod on structured output.
3. **`rescore.ts` duplicates the judge implementation** (`rescore.ts:104-340` ≈ `llm-judge.ts:13-320`). System prompt, schema, types, and `judge()` function are near-line-for-line copies. Any rubric tweak drifts silently between production and the tool used to *validate* production. Should `import` from `llm-judge.ts`.
4. **`rescore.ts` lives under `src/` and runs `main()` at import time** (`rescore.ts:631`). A top-level `main().catch(...)` fires `loadDotEnvFromRepoRoot()` and the Anthropic client as a side effect on any barrel/bundle import. Move to `scripts/` or guard with `if (import.meta.main)`.

Minor:

- **Stage 3.5 `aggregateVerdict` can never return PASS** (`runner.ts:699-706`) even when the judge clears every borderline/fail pair as `distinct_products`; it falls through to `BORDERLINE` unconditionally. Pre-existing behavior, but the two-axis wiring makes the fix trivial (`if (judgedDistinct === fails.length + borderline.length) return PASS`). Leaving it unfixed means a clean intra-tenant run with any mechanically-borderline pair is permanently mislabeled.
- **Cost-summary label is now wrong** (`report.ts:492`) — still reads `"LLM judge (Haiku, borderline pairs)"`, but Stage 6 now judges every pair.
- **Filename interpolation in `persistRun` is unsanitized** (`index.ts:142/162/180`). `identityId` / `personaId` are config-derived (safe in practice), but a persona id containing `/` or `..` would escape `runDir/outputs/`. Cheap defensive fix alongside the commit that just hardened filename collisions.
- **Stage 7 `personaId ?? \`unknown-${i}\`` fallback** (`index.ts:170`) silently masks a contract violation — should throw, not invent a filename.
- **Helix `contrarian` tag rewrite is the closest remaining edge** (`tags.ts:217`: *"question the implicit confidence of the base case in voice and framing"*). Passes the governing rule as written, but is the tag most likely to regress under aggressive voice. Worth an explicit post-Helix-run audit on the next full run.

These are tracked for the next session, not hotfixed — the PoC harness is not production, and the playground spec (`docs/specs/2026-04-08-uniqueness-poc-playground.md`) will exercise the same judge path and surface any regression immediately.

---

**End of session journal.**

*Generated 2026-04-07 by Claude (Opus 4.6) at the end of a multi-hour PoC session. Session covered: architectural design, harness implementation, four iterative runs, qualitative prose analysis, empirical characterization of the differentiation budget, identification of the persona-tilt fix as the next experiment, and capture of the running-thesis dashboard view as a future product feature. Revised 2026-04-08 after the measurement-rubric retraction (§4.1 / §6.1 / §9.1 / §13) and again later the same day with post-retraction housekeeping (§14). All artifacts committed to branch `workstream-b-sources-spec`.*
