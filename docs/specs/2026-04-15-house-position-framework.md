# House Position Framework — Decision Brief

**Status:** Proposal — decision pending.
**Date:** 2026-04-15
**Author:** Alex + Claude
**Related:**
- `docs/pipeline-reference.md` (single source of truth for both pipelines)
- `docs/specs/2026-04-12-editorial-memory.md`
- `docs/specs/2026-04-13-demo-mvp.md`
- Memory: `project_editorial_memory_convergence.md` (the finding that triggered this brief)

---

## 1. Problem

The 2026-04-15 3-event sequence run (`eur-usd-q2-2026`) showed editorial memory driving cross-tenant cosine **up** across steps — 0.8710 → 0.8998 → 0.9119 — the opposite of the thesis. Tenants converge under accumulated memory, not diverge.

Five root causes are documented in `project_editorial_memory_convergence.md`. The load-bearing ones for this brief:

1. **All tenants adapt from the same Stage 1 core analysis.** The shared upstream anchors every downstream output to the same facts, directional view, and transmission-channel skeleton. No downstream layer can compensate for this.
2. **Opus is the implicit analyst.** Prompting Opus to "adopt a contrarian lens" produces rhetorical contrarianism (the headline disagrees) but the analytical conclusion regresses toward Opus's own base-model priors on the evidence. Lens-based divergence has a ceiling that is probably not much below where the pipeline currently sits.
3. **The fact-extractor schema has no differentiating dimensions.** Memory records world-facts (levels, data points, positions) which converge across tenants by construction; it does not record voice, register, stance, or audience posture.

Two reframes fell out of the discussion:

- **Re-baseline before rebuilding.** The current FAIL threshold (cosine > 0.85 cross-tenant) may be stricter than real-world analyst-vs-analyst divergence. Four Goldman/JPM/MS/Deutsche morning FX notes on the same Fed decision plausibly cluster at 0.85–0.92. If true, our "convergence problem" is partly a measurement artifact.
- **Stop asking the LLM to take positions.** If Opus cannot reliably take divergent analytical positions on clear evidence, shift the architecture so position is an **input** to the pipeline (authored by the tenant) rather than an **output** of the LLM. The pipeline's job becomes "execute this position faithfully in house voice at wire speed", not "decide what the market should think".

This brief specifies the second reframe: the **House Position Framework**. It does not assume the first reframe (re-baseline study) has happened; the two are complementary and independent.

---

## 2. The proposal — position as input

Replace the current model:

```
Event → LLM (analysis + writing) → Article
```

with:

```
Event + House Position (structured input per tenant per event) → LLM (writing only) → Article
```

The tenant's standing analytical framework and per-event call are captured as structured data and become the authoritative upstream. The LLM writes *from* the position; it does not generate the position.

Two layers of capture:

- **Layer 1 — Standing Framework.** One-time onboarding. ~20 questions. Scrape-bootstrapped, tenant-confirmed. Versioned.
- **Layer 2 — Per-event Position.** 6–8 fields. Minutes per event. Three operating modes (full analyst, rules engine, or LLM-drafted + tenant-approved "coach mode").

### 2.1 Layer 1 — Standing framework questionnaire

Scope: permanent per-tenant profile. Bootstrap via website scrape + published-content extraction; tenant validates and corrects.

**A. Audience & mandate**
1. Who reads your research? (retail <$50k / retail >$50k / active traders / HNW / institutional / advisors / corporate treasury)
2. What decision do you want readers to make after reading? (educate only / consider a trade / take a position / stay allocated / reallocate)
3. Are you licensed to give investment advice in the reader's jurisdiction?
4. What asset classes do you publish on in priority order?

**B. Analytical stance**
5. When consensus is strongly one direction, how often do you take the other side? (almost never / when we see a specific reason / as a core differentiator)
6. Rank decision inputs: macro fundamentals, positioning/flow, technicals, policy/central banks, geopolitics, sentiment.
7. Default time horizon? (intraday / 1–7 days / weeks–months / quarters+)
8. When fundamentals and technicals disagree, which wins?
9. Weight given to central bank guidance vs. market-implied paths?

**C. House emphases & taboos**
10. What do you *always* mention when covering your primary asset class?
11. What do you *never* do? (name competitors / numeric targets / specific politicians / leverage recommendations / crypto mentions)
12. What breaks your usual horizon? (central bank day / month-end / quarterly FA / geopolitical shock)
13. Recurring analogies or brand-defining frames? (2–3 examples)

**D. Voice & register**
14. Closest voice: Bloomberg wire / Economist editorial / Goldman desk note / newsletter warm / educator / tactical trader. (or one-sentence description)
15. Formality 1–5. Use of "we" / "I" / neither?
16. Jargon level 1–5; specific terms always vs. never used.
17. Headline style + 3 examples.
18. Typical piece length per event.

**E. Structural conventions**
19. Preferred structure: event→analysis→implication / TL;DR-first / scenario-tree / Q&A / narrative arc. Show an example.
20. Bullets? Sub-headers? Pull quotes? Charts? Price tables?
21. How do you reference prior calls? ("As we noted…" / "Our view, unchanged since…" / never reference)

**F. Risk & disclaimers**
22. Required legal/compliance boilerplate (paste verbatim).
23. What constitutes a "recommendation" you cannot make without review?

### 2.2 Layer 2 — Per-event position (6–8 fields)

Captured once per news event the tenant is publishing on.

1. **Direction:** bullish / bearish / neutral / mixed / not covering.
2. **Conviction:** low / moderate / high.
3. **Horizon for this call:** intraday / 1–5 days / weeks / strategic.
4. **Key levels or triggers:** free text, 1–3 items (e.g., "1.0820 breaks → accelerates; 1.0920 reclaim → invalidated").
5. **Thesis in ≤30 words:** the one-sentence reason this call exists.
6. **Emphasis:** 1–3 bullets — what to foreground.
7. **Avoid/downplay:** 1–2 bullets.
8. **Optional recommendation:** structured (instrument, bias, invalidation) *or* "no recommendation".

Fields 1–5 mandatory; 6–8 optional. If tenant skips, pipeline falls back to neutral description in house voice without committing to a call.

### 2.3 Operating modes for Layer 2

Tenant picks per subscription tier or per pipeline.

- **Full analyst seat.** Human at tenant fills Layer 2 per event. Highest quality, slowest, highest tenant labour cost.
- **Rules engine.** Tenant defines standing rules ("if FOMC surprise direction matches our bias → conviction high; if conflict → skip"). Engine emits Layer 2 automatically.
- **Coach mode.** Pipeline drafts a Layer 2 from event + standing framework; tenant one-click approves or edits in <30s. Expected sweet spot for most B2B clients.

---

## 3. Architectural implications

### 3.1 Where the layers inject in the Content Generation Pipeline

Reference the mermaid in `docs/pipeline-reference.md` §2. The pipeline today is:

```
Event → FA Agent (shared) → Identity Agent (+ Persona + companyBackground) → Conformance Pass → Output
       → Embed + Similarity → Two-Axis Judge → Gate
```

Proposed:

```
Event → FA Agent (shared, facts-only)
       ↓
       (Per tenant, in parallel)
       Position Resolver (Layer 2 source: human / rules / coach draft)
       ↓
       Identity Agent  ← injects: Layer 1 (voice, structure, mandate) + Layer 2 (direction, thesis, levels, emphasis)
                         + companyBackground
                         + editorial memory (voice/stance facts only — NOT world-facts)
       ↓
       Conformance Pass  ← Layer 1 voice enforcement
       ↓
       Fidelity Judge    ← article conclusion matches Layer 2 position (new, cheap)
       ↓
       Embed + Similarity → Two-Axis Judge → Gate
```

**Injection map:**

| Layer | Content field | Where it injects | Which pipeline stage |
|---|---|---|---|
| L1.A Audience & mandate | System prompt — "Your readers are X; your job is Y" | Identity Agent | Content |
| L1.B Analytical stance | *Not injected into LLM.* Used by Rules engine / Coach draft to generate Layer 2. | Position Resolver | Content |
| L1.C House emphases & taboos | System prompt — "Always mention X; never do Y" | Identity Agent + Conformance Pass | Content |
| L1.D Voice & register | System prompt + Conformance Pass rewrite prompt | Identity Agent, Conformance Pass | Content |
| L1.E Structural conventions | User prompt — section order directive | Identity Agent | Content |
| L1.F Risk & disclaimers | Post-generation template append; compliance gate | After Conformance Pass | Content |
| L2 Direction + conviction | User prompt — "The house has taken a [direction] call with [conviction] conviction" | Identity Agent | Content |
| L2 Levels + thesis | User prompt — mandatory content | Identity Agent | Content |
| L2 Emphasis + avoid | User prompt — foreground/downplay guidance | Identity Agent | Content |
| L2 Recommendation | User prompt + compliance gate (if tenant unlicensed) | Identity Agent + Compliance | Content |

The FA Agent is **demoted** from "analyst producing a view" to "facts collector": normalized event payload (what happened, numeric impacts, cited data) with no directional stance. The directional stance comes from Layer 2 per tenant.

### 3.2 Where the layers inject in the Translation Quality Pipeline

Translation pipeline (`pipeline-reference.md` §1) is for *existing content* passing through conformance + language-level enforcement. It is **unchanged by this framework** at the pipeline-flow level. The only impact:

- **Layer 1.D (voice) and L1.F (compliance boilerplate)** feed into `LanguageProfile` / `ToneProfile` — which the translation pipeline already consumes.
- **Layer 1.C (taboos)** becomes a new pre-translation gate: reject source content that violates a tenant's "never" list instead of letting it pass through silently.
- **Layer 2 is not used** in the translation pipeline — translation does not take positions, it preserves them.

The `pipeline-reference.md` §6 planned change — *"Remove Style & Voice from translation pipeline"* — remains correct and is complementary to this framework. Brand voice lives on the content pipeline's Conformance Pass, fed by Layer 1.D.

### 3.3 Where the layers come from in the Onboarding flow

Reference `pipeline-reference.md` §5. The unified onboarding already ingests sample docs + website scrape + questionnaire and produces `ContentPersona` + `LanguageProfile`. Proposed additions:

- **`ProfileExtractionAgent`** extends to propose answers for Layer 1.C/D/E from sample documents.
- **Company scrape agent** extends to propose answers for Layer 1.A (audience segment) from pricing pages, about pages, disclaimers.
- **New: Standing Framework Questionnaire** — the 23-question form above — human-confirms all bootstrapped proposals and fills gaps.
- **New: Rules Engine config** — optional, for tenants using Layer 2 "Rules" operating mode. Per-pipeline, not per-tenant.

### 3.4 New types and components

- `HousePosition` type: Layer 2 structured payload. Validated by Zod. Stored per (tenant, event) tuple.
- `StandingFramework` type: Layer 1 answers. Extends `ContentPersona`. Versioned.
- `PositionResolver` interface: `resolve(tenantId, event): Promise<HousePosition>` with three implementations — `HumanInputResolver`, `RulesEngineResolver`, `CoachDraftResolver`.
- `FidelityJudge`: single Haiku call comparing article conclusion against `HousePosition.direction` + `HousePosition.thesis`. Binary pass/fail. Cheap (~$0.001).

---

## 4. Conflict analysis vs. `pipeline-reference.md`

The framework reshapes the content pipeline but does not break the translation pipeline. Specific conflicts and compatibilities:

### 4.1 Compatible — extends existing design

| Existing artifact | Status under this framework |
|---|---|
| Brand Voice Conformance Pass (§2) | **Kept and strengthened.** Layer 1.D feeds its prompt. |
| `ContentPersona` + `companyBackground` (§2, §4) | **Kept and extended** — Layer 1 fields become new properties on `ContentPersona`. |
| Two-Axis LLM Judge (§2) | **Kept.** Still the uniqueness gate after the new Fidelity Judge. |
| Unified onboarding flow (§5) | **Extended** with standing-framework questionnaire + optional rules-engine config. Mermaid remains structurally valid. |
| `ProfileExtractionAgent` + Company Scrape Agent (§5) | **Extended** to propose Layer 1 answers, not redesigned. |
| Planned: `preferredStructure` (§6) | **Absorbed into Layer 1.E.** The planned change becomes one question in the standing framework rather than a standalone field. |
| Planned: Glossary patcher in content pipeline (§6) | **Still planned.** Layer 1.D lists "terms always vs. never used" — which becomes the per-tenant glossary input. |
| Planned: Section labels + termMap (§6) | **Absorbed into Layer 1.E.** |
| Planned: Remove Style & Voice from translation pipeline (§6) | **Unchanged, still needed.** |

### 4.2 Conflicting — requires decision

| Existing artifact | Conflict | Resolution options |
|---|---|---|
| **FA Agent as "shared core analysis" (§2)** | Current FA Agent emits directional analysis ("bearish EUR/USD because…"). Under this framework, direction comes from Layer 2 per tenant, not from a shared FA. | (a) **Demote FA Agent to facts-only** — it emits normalized event payload with no direction. Layer 2 supplies direction per tenant. (b) **Keep shared FA for tenants in "no Layer 2" mode**, let Layer-2 tenants override. |
| **Per-tenant FA angle "Option 3, parked" (§4 divergence-layers table)** | That parked option (separate FA per tenant) attacks the same root cause. This framework supersedes it — position-as-input is stronger because it doesn't rely on Opus adopting different analytical stances. | **Close Option 3 as superseded.** |
| **Editorial memory fact-extractor schema (§2.2 of editorial-memory spec)** | Current extractor pulls world-facts (position, level, thesis, data_point) — the source of convergence. | **Split extractor into two tracks:** (a) *voice-memory extractor* keeps register, structural pattern, house idiom, audience posture — per-tenant, genuinely differentiating; (b) *world-facts extractor* keeps levels/data_points but these are injected as a *cross-tenant shared* context (so memory does not double-count facts that came from the shared FA). |
| **Uniqueness gate thresholds (§4)** | If position is now explicit and divergent upstream, thresholds may need recalibration. Real analyst-vs-analyst may still cluster at 0.85+; our gate may be too strict for the new architecture as well as the old. | **Run the re-baseline study** (collect real published analyst notes, measure their cosine floor) before re-calibrating. Pending regardless of this framework. |
| **Stage 7 narrative-state A/B (§editorial-memory spec)** | Validated that editorial memory beats narrative state on a single event. Under this framework, the memory being validated is not the same thing — it's voice-memory, not fact-memory. The prior result does not transfer. | **Re-run Stage 7 A/B after the extractor split.** Old A/B remains historically valid for what it tested. |
| **Fabrication gate "fidelity < 0.9 blocks publication" (memory `project_fabrication_fix_plan.md`)** | Current gate runs on the two-axis judge output. Under this framework, a *new* upstream Fidelity Judge (article-vs-position) is introduced. | **Two fidelity gates:** (a) new upstream Fidelity Judge (article matches Layer 2 position) — cheap, fail-fast; (b) existing two-axis judge's fidelity axis — catches cross-tenant fabrications the upstream gate missed. |
| **"All identities share memory within a tenant" (`feedback_editorial_memory_tenant_not_persona.md`)** | Still correct — within a tenant, all identities share the voice-memory and the Layer 1/2 framework. | **Unchanged.** |

### 4.3 Pipeline-reference.md document updates required if we adopt

- §2 content pipeline mermaid: add **Position Resolver** and **Fidelity Judge** nodes; demote **FA Agent** to "facts-only" box.
- §4 divergence layers table: add **"House Position (Layer 2)"** as the new top-impact layer, reclassify **"Per-tenant FA angle"** as *superseded*.
- §5 onboarding flow: add **Standing Framework Questionnaire** and **Rules Engine config** branches.
- §6 planned changes: absorb `preferredStructure` and Section labels/termMap into Layer 1.E. Add new rows: *Implement Position Resolver* (3 backends), *Implement Fidelity Judge*, *Split fact-extractor into voice-memory + world-facts*.

---

## 5. Pros

**P1. Root-cause fix.** Divergence comes from actual tenant business decisions (their analysts' calls, their standing framework) rather than from coaxing Opus to disagree with itself. The Opus-as-implicit-analyst ceiling is sidestepped entirely.

**P2. Fabrication risk collapses.** The LLM no longer decides what to say — the position is given. Fidelity becomes a simple "does the article match the structured position" check. No more inventing price targets or positions to differentiate.

**P3. Product claim becomes honest and defensible.** "Your analysts' calls, written at wire speed in your house voice, consistent with your prior coverage" is a real, narrow, valuable claim. "Our AI makes market calls for you" is a claim every AI shop makes and none can defend.

**P4. Regulatory posture improves.** If the AI does not generate positions, then non-advisor-licensed tenants can safely publish without the AI inadvertently crossing into investment advice. Layer 2 field 8 (recommendation) has a compliance gate per tenant licensing.

**P5. Multi-tenant scaling is natural.** Two tenants with genuinely different calls on the same event produce genuinely different articles. No prompt engineering required to force it.

**P6. Editorial memory becomes useful for the right reason.** Memory of the tenant's past *positions* (not past prose) + tenant's voice patterns creates genuine analytical continuity. "Northbridge has been bearish EUR/USD for 3 events; today they're pivoting" is a real, meaningful article frame that only their memory enables.

**P7. Tenant-facing tier differentiation becomes clean.** "Coach mode" is the default product; "Rules engine" is an upsell (automation); "Full analyst seat" is the premium tier (tenant's own analysts author Layer 2). This maps to subscription tiers already in `project_subscription_quota_layers.md`.

**P8. De-risks the demo MVP.** `project_demo_mvp_2026_04_13.md` currently depends on AI-generated cross-tenant divergence that the 2026-04-15 sequence showed fails under editorial memory. Position-as-input removes that failure mode.

**P9. Low disruption to the translation pipeline.** Zero flow changes. Only `LanguageProfile` becomes a subset of the new standing framework.

## 6. Cons

**C1. Requires tenant labour.** Layer 2 capture, even in coach mode, is a touchpoint per event. If the tenant doesn't want to engage, the product degrades to "neutral house-voice event descriptions" — which may not be what they bought. Some tenants *want* the AI to be the analyst.

**C2. Narrower product claim.** "We execute your positions" is a smaller promise than "we analyze the market for you". This closes off a potential customer segment that wants the AI to do the analysis — and that segment is arguably larger in SMB/retail-broker markets.

**C3. Rules engine complexity.** The "rules" operating mode is deceptively hard. Rules that produce robust Layer 2 outputs across diverse event types require significant config and ongoing maintenance. Tenant may under-configure and get wrong calls, which is worse than no call.

**C4. Coach mode risks becoming a rubber stamp.** If the pipeline drafts Layer 2 and the tenant one-clicks approve without reading, the AI-implicit-analyst problem returns in a new costume. Needs UX friction (forced reading of thesis field, or randomized red-team edits that the tenant must correct) to stay honest.

**C5. Onboarding becomes heavier.** 23 questions + validated scrape outputs is more than the current onboarding. Slows time-to-first-publish.

**C6. Versioning and audit burden grows.** Standing framework versions, per-event positions, rules engine rule versions, compliance state at time of publication — all need to be captured in the audit trail per published article.

**C7. Potentially over-engineers for small tenants.** A 2-person broker who just wants "write us a morning note" doesn't need Layer 2 capture. The fallback-to-neutral mode helps, but the full product's value depends on tenant engagement.

**C8. Cost of Fidelity Judge, albeit small.** Adds one Haiku call per generated article per tenant. At scale, ~$0.001 × articles/day × tenants. Negligible vs. existing pipeline cost but worth tracking.

**C9. Doesn't fully resolve the "lean in" chorus.** Even with divergent positions, if two tenants both take bearish-high calls, the "Lean in" guideline from `context-assembler.ts` still fires for both. Still needs a pipeline-level fix (anti-anchor: when 3+ tenants share a guideline trigger, suppress the guideline). That is in-scope for this framework but not automatically solved by it.

**C10. Re-baseline study may make this framework unnecessary.** If the re-baseline study shows real analyst-vs-analyst cosine is 0.85–0.92, the current convergence is already at real-world parity — and the framework's main justification weakens to P2 (fabrication) and P3 (honest product claim) rather than P1 (divergence fix). Both are still valid, but the urgency drops.

---

## 7. Cost implications

**Per event at steady state (4 tenants, demo configuration):**

| Component | Today | Under this framework | Delta |
|---|---|---|---|
| FA Agent (Stage 1) | ~$0.21 Opus | ~$0.15 Opus (facts-only, shorter output) | **−$0.06** |
| Position Resolver — coach draft | — | ~$0.01 Haiku per tenant = $0.04 | **+$0.04** |
| Position Resolver — rules / human | — | $0 LLM cost | **0** |
| Identity Agent (Stage 2) | ~$0.14 (6 identities × $0.023) | ~$0.14 (same, more input tokens, negligible delta) | **~0** |
| Fidelity Judge (new) | — | ~$0.001 × articles | **+$0.004 for 4 tenants** |
| Conformance Pass | existing | existing | 0 |
| Embed + Similarity + Two-axis Judge | existing | existing | 0 |

Net delta at 4-tenant demo scale: roughly **−$0.02 per event** if most tenants are in coach mode. Non-material.

**Onboarding cost per tenant (one-time):**

- ProfileExtractionAgent + Company Scrape: ~$0.10 (existing).
- Standing-framework bootstrap extraction: new Haiku call, ~$0.05.
- Human validation time: ~30 min (existing was ~15 min).

Non-material at expected tenant volumes (hundreds, not thousands).

---

## 8. Decision criteria

Adopt if any two of the following hold:

1. The re-baseline study (planned regardless) confirms real analyst-vs-analyst cosine < 0.90 — i.e. we have a genuine divergence gap to close.
2. The demo MVP commits contractually depend on *visible* cross-tenant divergence on the same event; and
3. We want to position FinFlow as a "tenant-voice execution engine" rather than an "AI analyst", for product + regulatory + marketing reasons.

Do **not** adopt if:

1. Re-baseline study shows we're already at real-world parity and fabrication is the only residual issue — in that case, solve fabrication with the simpler `contradiction-detector` schema fix + fidelity-guardrail hardening + anti-anchor guideline, which are cheaper than the Framework.
2. Core tenant segment wants "AI does the analysis" and cannot be persuaded to Layer 2 capture — check with 3–5 design-partner calls before committing.

---

## 9. Prerequisites and open questions

**Prerequisites before committing:**
- [ ] Re-baseline study: collect 12+ real analyst notes across 3 events, measure cosine/rougeL distribution. Compare to PoC thresholds. (~$5, ~2 days.)
- [ ] Design-partner validation: 3 calls with prospective tenants on willingness to engage with Layer 2 capture (coach mode UX in mockup).
- [ ] Regulatory read: confirm whether "structured tenant-authored position → LLM-generated article" changes the licensing posture favourably in EU/UK/US.

**Open questions:**
- Q1. Does the standing framework extend `ContentPersona` or replace it? Proposal: extend (add new fields), with a deprecation path for fields absorbed into Layer 1.
- Q2. Where does the rules engine live — per pipeline (per topic feed) or per tenant? Proposal: per pipeline, composable (tenant has N pipelines, each with own rules).
- Q3. Is Layer 2 cached per (tenant, canonical event)? If two tenants publish on the same FOMC decision 2 hours apart, do we re-compute the event payload or reuse it? Proposal: event payload cached for 15 min, Layer 2 per-tenant always fresh.
- Q4. What's the fallback when Layer 2 is missing/skipped? Proposal: "neutral description in house voice, no directional call, no recommendation" — still uses Layer 1 voice/structure but no Layer 2 fields.
- Q5. Can the Coach-mode draft be generated using Opus or does Haiku suffice? Proposal: Haiku — Coach draft is pattern-match against standing framework, not deep reasoning.
- Q6. How does editorial memory split work in practice — two postgres tables, or a `factType` discriminator on the existing one? Proposal: discriminator — minimal migration.
- Q7. Does the Fidelity Judge run before or after the Two-Axis Judge? Proposal: before — fail-fast on upstream fidelity before spending on cross-tenant similarity.

---

## 10. Next steps if adopted

1. **Week 1** — re-baseline study + 3 design-partner calls in parallel. Decision gate at end of week.
2. **Week 2** — draft `HousePosition` + `StandingFramework` schemas. Build standing-framework questionnaire bootstrap extraction. Wire into onboarding flow.
3. **Week 3** — implement Position Resolver (Coach backend first; Human + Rules deferred).
4. **Week 4** — wire Identity Agent + Conformance Pass to Layer 1/2 injections. Implement Fidelity Judge.
5. **Week 5** — split fact-extractor (voice-memory vs. world-facts). Re-run 3-event sequence on `eur-usd-q2-2026`. Measure Stage 6 cross-tenant cosine vs. 0.871/0.900/0.912 baseline.
6. **Week 6** — adjust thresholds based on re-baseline; update `pipeline-reference.md`; promote to spec from brief.

---

## 11. What this brief is not

- **Not a commitment.** No code changes implied. Decision requires sign-off after re-baseline + design-partner calls.
- **Not a replacement for the `contradiction-detector` schema fix.** That bug is in the parking lot and should be fixed regardless — it affects both the current architecture and any future one.
- **Not a rejection of editorial memory.** Memory remains load-bearing; its fact-extractor schema needs to change, and this brief specifies how.
- **Not a claim that Opus cannot do analysis.** It is a claim that Opus cannot reliably take *divergent* analytical positions on clear evidence, when we need it to. Opus-as-analyst remains the right model for single-tenant content; position-as-input is a multi-tenant-divergence fix.
