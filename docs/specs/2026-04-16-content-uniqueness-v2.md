# Content Uniqueness v2 — Framework Archetype Model

**Status:** Proposal -- decision pending.
**Date:** 2026-04-16
**Author:** Alex + Claude
**Related:**
- `docs/specs/2026-04-07-content-uniqueness.md` -- v1 uniqueness gate (pre-allocation + verification)
- `docs/specs/2026-04-07-content-pipeline.md` -- the pipeline this sits inside
- `docs/specs/2026-04-15-house-position-framework.md` -- **superseded by this spec** (position-as-input absorbed into archetype model)
- `docs/specs/2026-04-12-editorial-memory.md` -- editorial memory system (convergence finding triggered this)
- `docs/pipeline-reference.md` -- current divergence layers table

---

## 1. Problem Restatement

### 1.1 Why v1 uniqueness doesn't work at scale

The v1 uniqueness gate (`2026-04-07-content-uniqueness.md`) was designed around per-tenant identity calls:

```
1 event --> 1 FA call (shared) --> N identity calls (1 per tenant x pipeline) --> N outputs
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                   O(N) LLM calls, each $0.02-0.14
```

At N=4 tenants this is fine. At N=50 it is $1-7 per event in identity-layer costs alone. At N=200 it is untenable. And the uniqueness gate (v1 sections 5-7) assumes cross-tenant diversity emerges from per-tenant persona overlays on the same shared core analysis -- which the 2026-04-15 editorial memory convergence finding (`project_editorial_memory_convergence.md`) showed fails: tenants converge at 0.87-0.91 cosine regardless of persona configuration.

**Root causes (from the convergence finding):**

1. **Shared upstream anchor.** All tenants adapt from the same Stage 1 core analysis. The shared facts, directional view, and narrative skeleton dominate the output. No downstream layer compensates.
2. **Opus-as-implicit-analyst ceiling.** Prompting Opus to "adopt a contrarian lens" produces rhetorical contrarianism with analytical regression to the model's own priors. The divergence ceiling is real and probably around cosine 0.85.
3. **Persona overlays are cosmetic.** Brand voice, CTAs, company background, and audience level produce measurable but insufficient divergence (~0.10-0.20 cosine drop from conformance pass, per PoC validation). The pre-allocation algorithm (v1 section 5) assigns different angles, but two tenants with similar `preferredAngles` can still collide.

### 1.2 What the House Position brief got right

The `2026-04-15-house-position-framework.md` correctly identified that position should be an input, not an LLM output. Its proposal -- per-tenant Layer 2 capture with three operating modes -- was sound but had a scaling problem of its own: it requires per-tenant engagement (even coach mode is a touchpoint per event), and the rules engine is deceptively hard.

### 1.3 The insight: most tenants cluster into a few analytical archetypes

Real-world financial content publishers don't each have unique analytical frameworks. They cluster:

- **Conservative wealth advisors** use the same hedged, macro-focused, long-horizon approach
- **Active trading desks** use the same momentum-driven, terse, short-horizon approach
- **Retail educators** use the same neutral, explanatory, educational approach
- **Contrarian strategists** use the same counter-consensus, institutional, strategic approach

Instead of asking each tenant to express their framework (House Position brief) or asking the LLM to generate N different analytical stances (v1), we pre-build K frameworks (K = 3-4) that cover the analytical-archetype space. Tenants pick one at onboarding. The shared core FA analysis feeds into K framework-specific identity calls. Per-tenant overlays (brand, glossary, CTA, company background) are cheap deterministic transforms.

---

## 2. Framework Archetype Model

### 2.1 Architecture

```
1 event --> 1 FA call (shared, facts-only)
         --> K identity calls (K = 3-4 frameworks, NOT K x N)
         --> K base articles
         --> per-tenant deterministic overlay (brand, glossary, CTA, companyBackground)
         --> N outputs

Cost: O(K) LLM calls + O(N) cheap transforms
```

Compare to v1:
```
1 event --> 1 FA call (shared) --> N identity calls --> N outputs
Cost: O(N) LLM calls
```

And House Position brief:
```
1 event --> 1 FA call (shared, facts-only) --> N identity calls (each with per-tenant Layer 2) --> N outputs
Cost: O(N) LLM calls + O(N) human touchpoints (coach mode)
```

The archetype model is O(K) where K is fixed at 3-4 regardless of tenant count. Adding the 50th tenant is zero incremental LLM cost if they pick an existing framework.

### 2.2 The four archetypes

| Archetype | Audience | Analytical stance | Horizon | Position style | Tone |
|-----------|----------|-------------------|---------|----------------|------|
| **Conservative Advisor** | HNW individuals, wealth management clients | Hedged, macro-focused, balanced scenarios | Weeks to months | Rarely directional; "we see risks tilted toward..." | Measured, institutional, formal |
| **Active Trader Desk** | Active day/swing traders | Momentum-driven, level-focused, explicit | Intraday to 5 days | Always directional; explicit entry/exit levels | Terse, signal-oriented, urgent |
| **Retail Educator** | Beginner-intermediate retail | Neutral explainer, no directional commitment | Context-dependent | Never directional; "here's what to watch" | Warm, accessible, educational |
| **Contrarian Strategist** | Institutional, sophisticated retail | Counter-consensus, challenges the obvious read | Strategic (quarters+) | Directional but against prevailing consensus | Provocative, data-dense, institutional |

**These are not personas.** Personas (ContentPersona) are per-tenant brand overlays. Archetypes are analytical frameworks that determine *how the same facts get interpreted*. A Conservative Advisor framework always produces hedged, scenario-based content regardless of whether the tenant is Tier1FX or AlphaWealth.

### 2.3 What an archetype defines

```ts
type FrameworkArchetype = {
  id: FrameworkArchetypeId;
  name: string;
  description: string;

  // Analytical framing
  analyticalStance: {
    defaultDirectionality: 'hedged' | 'explicit' | 'neutral' | 'contrarian';
    horizonRange: { min: string; max: string };  // e.g. { min: "1d", max: "5d" }
    positionStyle: string;                       // 1-2 sentence directive
    scenarioStyle: 'balanced-scenarios' | 'signal-extract' | 'educational' | 'counter-consensus';
  };

  // Structural template
  structuralTemplate: {
    sectionOrder: string[];     // e.g. ["context", "analysis", "scenarios", "levels"]
    typicalWordCount: { min: number; target: number; max: number };
    headlineStyle: string;      // e.g. "question-hook" or "signal-first" or "narrative"
  };

  // Voice directives (fed to identity agent)
  voiceDirectives: {
    formality: 1 | 2 | 3 | 4 | 5;
    sentenceLengthTarget: number;   // avg words per sentence
    hedgingFrequency: 'low' | 'moderate' | 'high';
    jargonLevel: 1 | 2 | 3 | 4 | 5;
    personPreference: 'we' | 'I' | 'impersonal';
  };

  // Which TA timeframes this framework cares about
  taTimeframes: ('daily' | 'weekly' | 'monthly')[];
  taEmphasis: 'levels-only' | 'patterns-and-levels' | 'full-technical' | 'none';

  // How to compose FA + TA when both are available
  faWeight: number;  // 0-1; TA weight = 1 - faWeight
  compositionStyle: 'integrated-narrative' | 'split-sections' | 'fa-with-ta-sidebar' | 'ta-with-fa-context';

  // How to handle FA-TA disagreements (see ta-typescript-port.md §6.4)
  tensionResolution: {
    levelDivergence: 'zone' | 'ta-primary' | 'explain-both' | 'contrarian-pick';
    directionalConflict: 'scenario-tree' | 'ta-wins-fa-risk' | 'explain-both' | 'tension-is-thesis';
    timingMismatch: 'longer-horizon-wins' | 'shorter-horizon-wins' | 'explain-both' | 'exploit-gap';
    convictionGap: 'defer-to-higher' | 'trade-confirmed-only' | 'explain-uncertainty' | 'probe-weakness';
    defaultFraming: string;  // 1-sentence directive for the identity agent
  };
};

type FrameworkArchetypeId =
  | 'conservative-advisor'
  | 'active-trader-desk'
  | 'retail-educator'
  | 'contrarian-strategist';
```

### 2.4 Tenant-to-archetype mapping

At onboarding, a tenant picks one archetype per pipeline. The selection can be:

1. **Questionnaire-driven.** 5-8 questions from the House Position brief's Layer 1 (sections A and B) narrow to an archetype recommendation. The tenant confirms or overrides.
2. **Direct selection.** Tenant reads the 4 archetype descriptions and picks one.
3. **Sample-inferred.** If the tenant provides sample content during onboarding, the `ProfileExtractionAgent` proposes an archetype match.

A tenant can run multiple pipelines with different archetypes (e.g., a broker runs "Active Trader Desk" for their trading alerts pipeline and "Retail Educator" for their blog pipeline). This is already supported by the `ContentPipeline` entity -- the archetype becomes a new field:

```ts
// Addition to ContentPipeline (content-pipeline spec section 4.1)
type ContentPipeline = {
  // ... existing fields ...
  frameworkArchetype: FrameworkArchetypeId;  // NEW -- replaces implicit identity selection
  // identityAgent: IdentityAgentId;  // CHANGED -- still present, but constrained by archetype
};
```

### 2.5 Relationship to identity agents

Identity agents (BeginnerBlogger, InHouseJournalist, TradingDesk, etc.) still exist but become **format agents** within an archetype. An archetype defines the analytical framework; the identity defines the output format:

| Archetype | Compatible identities |
|-----------|----------------------|
| Conservative Advisor | InHouseJournalist, NewsletterEditor, raw-fa |
| Active Trader Desk | TradingDesk, raw-ta, raw-fa+ta |
| Retail Educator | BeginnerBlogger, Educator |
| Contrarian Strategist | Strategist, NewsletterEditor, InHouseJournalist |

The identity agent's prompt is composed: archetype voice directives + structural template + identity-specific format rules + tenant persona overlay.

---

## 3. Uniqueness Under Archetypes

### 3.1 The uniqueness problem shifts

Under v1, uniqueness was a cross-tenant N x N problem: any two tenants on the same event could collide. Under archetypes, there are three distinct uniqueness concerns:

| Comparison | Gate | Why |
|-----------|------|-----|
| **Cross-framework** (K x K, e.g. Conservative vs Trader) | Must be naturally distinct | Different analytical stance + structure + voice should produce genuinely different content by construction. If they don't, the archetypes are poorly defined. |
| **Same-framework, cross-tenant** (tenants A and B both on Conservative Advisor) | Shared base article + deterministic overlay must feel bespoke | Brand, glossary, CTA, companyBackground are the only differentiators. The question is: does the overlay make it feel like different work? |
| **Same-tenant, cross-pipeline** (tenant A with two pipelines, different archetypes) | Must be naturally distinct | Same as cross-framework -- different archetype, different output. |

### 3.2 Cross-framework uniqueness (the load-bearing gate)

This is where the real differentiation lives. Two frameworks processing the same FA core analysis should produce content with:

- **Different directional framing:** Conservative says "risks tilted toward bearish"; Trader says "short EUR/USD at 1.0850, stop 1.0920"
- **Different structural shape:** Conservative uses scenario-tree; Trader uses signal-extract; Educator uses Q&A; Contrarian opens with "the consensus is wrong because..."
- **Different emphasis:** Conservative foregrounds macro context; Trader foregrounds levels; Educator foregrounds "what does this mean for you"; Contrarian foregrounds what the market is missing
- **Different voice register:** Conservative is formal/hedged; Trader is terse/direct; Educator is warm/accessible; Contrarian is provocative/institutional

**Expected cross-framework cosine:** 0.60-0.75 (well below the v1 cross-tenant threshold of 0.80). This is the hypothesis to validate.

### 3.3 Same-framework uniqueness (the overlay gate)

Two tenants on the same framework get the **same base article**. Their outputs differ only by deterministic overlay:

1. **Glossary substitution** -- different terms for the same concepts (e.g., "pip" vs "point", "position" vs "trade")
2. **Brand voice enforcement** -- formality level, sentence length, hedging frequency (within the archetype's range)
3. **CTA insertion** -- different CTAs appropriate to each tenant's product
4. **Company background weaving** -- unique factual claims about each company
5. **Section labels** -- per-tenant label vocabulary

The question is whether these overlays produce enough differentiation to pass the **product perception bar** (a discerning reader should perceive them as distinct work) and the **SEO bar** (Google's duplicate-content detector should not flag them).

**Honest assessment: this is where the model is weakest.** Two tenants on Conservative Advisor with similar glossaries and similar company backgrounds will produce similar-looking content. The overlay is cosmetic by design. Options if this proves insufficient:

- **Accept it as a product reality.** Two similar brokers targeting HNW with hedged macro analysis will naturally produce similar content. This is true of real analyst teams too. The uniqueness bar may need to be different for same-framework tenants than for cross-framework tenants.
- **Sub-framework variation.** Allow tenants to customize 2-3 archetype parameters (e.g., a Conservative Advisor with higher directional commitment, or a shorter horizon). This creates archetype variants that increase K without full N-scaling.
- **Editorial memory as differentiator.** Per-tenant editorial memory (accumulated position history, past coverage) creates genuine divergence over time even within the same framework, because each tenant's position history accumulates differently.

### 3.4 Which v1 mechanisms survive

| v1 Mechanism | Status under v2 | Why |
|---|---|---|
| **Pre-allocation algorithm** (v1 section 5) | **Replaced by framework selection.** Angle pre-allocation per-pipeline becomes archetype selection per-pipeline. The framework defines the analytical stance; no per-brief angle allocation needed. | Archetypes are a coarser, more reliable diversification mechanism than angle pre-allocation. |
| **Embedding similarity gate** (v1 section 6.1) | **Kept with modified thresholds.** Cross-framework threshold loosened (expect lower cosine). Same-framework threshold may need a separate, looser threshold. | Still the cheapest first-pass check. |
| **ROUGE-L gate** (v1 section 6.2) | **Kept for same-framework comparisons.** Cross-framework pairs should be naturally distinct enough that ROUGE-L rarely triggers. Same-framework pairs sharing a base article will have higher ROUGE-L -- the overlays need to push it below the threshold. | The SEO bar is unchanged regardless of architecture. |
| **LLM judge** (v1 section 6.3) | **Kept for borderline cases.** Judge criteria updated to account for shared-base-article reality. | Qualitative call on whether the overlay is sufficient. |
| **Failure path** (v1 section 7) | **Simplified.** Cross-framework failures mean archetypes are poorly defined (fix the archetype, not the output). Same-framework failures get one overlay-enhancement attempt, then HITL. | Regeneration is less useful when the divergence is structural, not generative. |
| **ContentPersona** (v1 section 4) | **Kept as the overlay layer.** Now explicitly the deterministic overlay, not a generative diversification lever. | Persona is what makes the shared framework article feel like a specific tenant's work. |
| **Verification thresholds** (v1 section 6.1) | **Need recalibration for the two-tier model.** Cross-framework thresholds should be generous (0.80+). Same-framework thresholds are the real tuning challenge. | The similarity distribution will be bimodal: cross-framework (low cosine) and same-framework (higher cosine). |

### 3.5 Updated thresholds (first-pass, needs calibration)

| Comparison | Cosine threshold | ROUGE-L threshold | Rationale |
|---|---|---|---|
| Cross-framework | 0.80 | 0.35 | Should be naturally well below this; if triggered, the archetypes need work |
| Same-framework, cross-tenant | 0.92 | 0.55 | Deliberately generous -- overlay divergence is limited; SEO risk is lower because same-framework tenants are publishing to different audiences |
| Intra-tenant, cross-pipeline | 0.92 | 0.50 | Same as v1 intra-tenant |

**Key change from v1:** the same-framework cross-tenant threshold (0.92) is deliberately looser than v1's cross-tenant threshold (0.80). This reflects the architectural reality: same-framework tenants share a base article and differ only by overlay. The product claim shifts from "every piece is unique work" to "every piece is adapted to your brand from an authoritative shared analysis." This is a commercial decision as much as a technical one.

---

## 4. TA Under Archetypes

Technical analysis follows the same archetype pattern but at a different granularity:

```
Per instrument:
  1 TA call per timeframe (daily, weekly, monthly) = 3 TA calls max
  NOT 3 x N calls

Framework selects which timeframes matter:
  Conservative Advisor: weekly + monthly (macro horizon)
  Active Trader Desk:   daily + weekly (trading horizon)
  Retail Educator:      daily only (simple, accessible)
  Contrarian Strategist: weekly + monthly (strategic horizon)
```

The TA output is cached per `(instrument, timeframe)` with the same 24h TTL as FA. Each framework's identity call receives only the timeframes it cares about, selecting which levels, patterns, and indicators to foreground.

**See `docs/specs/2026-04-16-ta-typescript-port.md` for the full TA agent specification.**

---

## 5. Editorial Memory Under Archetypes

The editorial memory system (`2026-04-12-editorial-memory.md`) needs to be split under the archetype model:

### 5.1 Per-framework positional memory

Position facts (`stated_position`, `cited_level`, `thesis`) track per **framework**, not per tenant. If the Conservative Advisor framework produced "risks tilted bearish on EUR/USD" on Tuesday, all Conservative Advisor tenants share that positional memory on Thursday's follow-up event.

This means the editorial memory `tenant_id` field needs reinterpretation:
- **Position/level/thesis facts:** keyed by `(framework_id, topic_id)`, shared across all tenants on that framework
- **Voice/structure/analogy facts:** keyed by `(tenant_id, topic_id)`, per-tenant (these are overlay-level differentiators)

### 5.2 Per-tenant voice memory

Voice-related facts (analogies used, structural patterns, CTA patterns, companyBackground facts cited) remain per-tenant. This is where editorial memory contributes to same-framework divergence: over time, each tenant accumulates a unique set of analogies, structural choices, and thematic threads that make their content feel less like a template and more like a living editorial voice.

### 5.3 Contradiction detection under archetypes

The contradiction detector compares the new FA core analysis against active position facts. Under archetypes, it runs **once per framework** (not once per tenant), because position facts are per-framework. Each framework can have a different position on the same event (Conservative says "risks tilted bearish"; Contrarian says "market is overreacting, bullish setup"). The contradiction detector runs K times per event, not N times.

---

## 6. Relationship to House Position Brief

This spec **supersedes** `2026-04-15-house-position-framework.md`. Specifically:

| House Position concept | Status in archetype model |
|---|---|
| Layer 1 -- Standing Framework (23-question questionnaire) | **Absorbed.** Reduced to 5-8 questions that map to archetype selection + a few per-tenant customizations (taboos, compliance, audience segment). The full 23-question depth is overkill when archetypes handle the analytical stance. |
| Layer 2 -- Per-event Position (6-8 fields, per-tenant) | **Replaced by per-framework position.** The framework's identity call produces the position; no per-tenant human input needed. Coach mode (House Position brief section 2.3) is eliminated. |
| Position Resolver (3 backends) | **Eliminated.** No per-tenant position capture needed. |
| Fidelity Judge (article matches Layer 2 position) | **Simplified to per-framework check.** The framework's identity call is the position source; fidelity check confirms the identity call's output matches the framework's analytical stance. |
| FA Agent demoted to facts-only | **Kept.** This is the right call regardless of archetype model. FA produces shared facts; frameworks interpret them. |
| Rules Engine for Layer 2 | **Eliminated.** The archetype IS the rules engine -- it encodes the analytical stance as a fixed configuration, not a per-event computation. |

**What the House Position brief got right that we keep:**
- P2 (fabrication risk collapses) -- still true; frameworks have explicit analytical stances
- P3 (honest product claim) -- still true; "your framework, your brand, at wire speed"
- P4 (regulatory posture) -- still true; the LLM does not generate unsolicited investment advice
- P9 (low disruption to translation pipeline) -- still true

**What the House Position brief got right that we improve on:**
- C1 (tenant labor) -- eliminated; no per-event touchpoint
- C3 (rules engine complexity) -- eliminated; no rules engine
- C4 (coach mode rubber stamp risk) -- eliminated; no coach mode
- C5 (onboarding weight) -- reduced; 5-8 questions vs 23

---

## 7. Test Strategy

### 7.1 Synthetic fixture design

Build a fixture set of 3 events x 4 frameworks x 2 overlays = 24 outputs:

**Events:**
1. FOMC rate decision (macro-dominant, high impact)
2. EUR/USD technical breakout (TA-dominant)
3. Geopolitical escalation (mixed FA+TA)

**Frameworks:** all 4 archetypes

**Overlays:** two tenants per framework with maximally different personas:
- Framework A tenant 1: formal, hedged, no CTAs, institutional background
- Framework A tenant 2: casual, direct, aggressive CTAs, retail background

### 7.2 Cross-framework validation

**Metric:** cosine similarity between framework pairs on the same event.

| Pair | Expected cosine | FAIL if above |
|---|---|---|
| Conservative vs Trader | 0.55-0.70 | 0.80 |
| Conservative vs Educator | 0.60-0.75 | 0.80 |
| Conservative vs Contrarian | 0.50-0.65 | 0.80 |
| Trader vs Educator | 0.55-0.70 | 0.80 |
| Trader vs Contrarian | 0.50-0.65 | 0.80 |
| Educator vs Contrarian | 0.55-0.70 | 0.80 |

**Method:** embed with `text-embedding-3-small` (same model as production), compute cosine. Run 3x per pair to check variance. Also compute ROUGE-L F1.

**Pass criteria:**
- All 6 cross-framework pairs have mean cosine < 0.80 across 3 events
- All 6 pairs have ROUGE-L F1 < 0.35 across 3 events
- Two-axis LLM judge scores all cross-framework pairs as "DISTINCT"

### 7.3 Same-framework overlay validation

**Metric:** cosine similarity between two tenants on the same framework.

| Comparison | Expected cosine | FAIL if below | FAIL if above |
|---|---|---|---|
| Same framework, max-different overlays | 0.82-0.90 | 0.75 (overlays broke the content) | 0.95 (overlays did nothing) |
| Same framework, similar overlays | 0.88-0.94 | 0.80 | 0.96 |

**Pass criteria:**
- With max-different overlays: mean cosine between 0.75 and 0.93
- ROUGE-L F1 < 0.55 (same-framework threshold)
- Two-axis LLM judge scores at least 50% of same-framework pairs as "DISTINCT" (this is the weakest link -- we expect some "RESKINNED" verdicts and need to decide if that's acceptable)
- Product perception: human review of 6 same-framework pairs confirms they "feel like different work" for at least 4 of 6

### 7.4 Shadow mode plan

Before enforcing archetype-based uniqueness in production:

1. **Week 1:** Run archetype identity calls in shadow mode alongside existing per-tenant calls. Compare outputs. Gather similarity distributions.
2. **Week 2:** Enforce cross-framework thresholds only (generous). Same-framework pairs run in shadow.
3. **Week 3:** Enforce same-framework thresholds. Monitor HITL escalation rate.
4. **Week 4+:** Tune based on real data.

---

## 8. Cost Model Comparison

### 8.1 Per-event cost at scale

Assume: 1 event, 4 frameworks, N tenants, FA+TA pipeline, 2 target languages.

**v1 (current architecture):**

| Component | Cost per unit | Units | Total (N=4) | Total (N=50) |
|---|---|---|---|---|
| FA core analysis (Opus, shared) | $0.21 | 1 | $0.21 | $0.21 |
| Identity adaptation (Sonnet) | $0.023 | N | $0.09 | $1.15 |
| Conformance pass (Sonnet) | $0.015 | N | $0.06 | $0.75 |
| Uniqueness verification (embed + judge) | $0.005 | N | $0.02 | $0.25 |
| Translation + quality loop | $0.73 | N x 2 langs | $5.84 | $73.00 |
| **Total per event** | | | **$6.22** | **$75.36** |

**v2 (archetype model):**

| Component | Cost per unit | Units | Total (N=4) | Total (N=50) |
|---|---|---|---|---|
| FA core analysis (Opus, shared, facts-only) | $0.15 | 1 | $0.15 | $0.15 |
| Framework identity calls (Sonnet) | $0.03 | K=4 | $0.12 | $0.12 |
| Per-tenant overlay (deterministic) | ~$0.001 | N | $0.004 | $0.05 |
| Uniqueness verification (embed + judge) | $0.005 | K cross-fw + N same-fw | $0.03 | $0.27 |
| Translation + quality loop | $0.73 | N x 2 langs | $5.84 | $73.00 |
| **Total per event** | | | **$6.14** | **$73.59** |

### 8.2 Analysis

At N=4 (demo scale): costs are nearly identical. The archetype model saves ~$0.08 per event. Negligible.

At N=50: the archetype model saves **$1.78 per event** on identity + conformance costs. Still small relative to translation costs, which dominate.

**The real savings are not in identity calls -- they're in eliminating the per-tenant human touchpoints (House Position brief's coach mode) and in the architectural simplification.** The cost argument for archetypes is about cognitive and operational cost, not LLM cost.

### 8.3 Where translation costs dominate

The elephant in the room: translation + quality loop is $0.73 per output per language. At N=50 x 2 languages, that's $73/event -- 97% of the total cost. This is independent of v1 vs v2. The archetype model does not change translation costs.

**Implication:** cost optimization efforts should focus on the translation engine (the advisor loop spec `2026-04-10-advisor-pipeline-loop.md` addresses this) rather than the uniqueness architecture.

---

## 9. Pros and Cons

### Pros

**P1. Eliminates the Opus-as-analyst ceiling.** Frameworks define analytical stances explicitly. No more coaxing Opus into divergent positions.

**P2. O(K) not O(N).** LLM identity calls scale with framework count, not tenant count. Adding a 50th tenant is zero incremental LLM cost.

**P3. No per-tenant touchpoint.** Unlike the House Position brief's coach mode, tenants do not need to engage per event. Onboarding picks a framework; the pipeline runs autonomously.

**P4. Cross-framework uniqueness is structural.** Different frameworks produce different content by construction -- different analytical stance, structure, voice, emphasis. The uniqueness gate confirms but does not create the divergence.

**P5. Fabrication risk collapses.** Frameworks have defined analytical stances. The identity call executes that stance, not generates one. Fidelity is checkable.

**P6. Onboarding is lighter.** 5-8 questions to select a framework vs 23 questions for House Position brief's full standing framework.

**P7. Commercial story is clean.** "Pick your analytical style. We handle the rest." Maps to subscription tiers naturally.

**P8. Editorial memory becomes more effective.** Per-framework positional memory means the contradiction detector and continuity features work with a coherent analytical thread, not N slightly-different threads that converge anyway.

### Cons

**C1. Same-framework tenants share a base article.** This is the central trade-off. Two tenants on the same framework get differentiation only from deterministic overlays. If a discerning reader compares the two, they may recognize the shared structure. This is a product perception risk.

**C2. Four archetypes may not cover the space.** Some tenants may not fit any archetype cleanly. "Macro-fundamental with explicit trades" is neither Conservative nor Trader. We need either sub-archetype customization or a 5th+ archetype.

**C3. Archetype design is a one-time high-stakes decision.** The 4 archetypes define the product's analytical capability. Getting them wrong means either tenants can't find a fit, or two archetypes produce insufficiently different content. Must be validated with real financial content expertise.

**C4. Same-framework uniqueness may fail the SEO bar.** If two tenants on the same framework publish on the same event, their ROUGE-L scores could exceed the duplicate-content detection threshold. The overlay (glossary, brand voice, CTAs, companyBackground) may not produce enough n-gram divergence. This is the hardest technical risk to assess without real data.

**C5. Reduces tenant-level analytical customization.** A tenant who wants "mostly Conservative Advisor but with more explicit levels" cannot get that without a sub-archetype variant. The House Position brief's Layer 1 questionnaire captured this nuance; the archetype model sacrifices it for scalability.

**C6. Makes the demo less impressive for same-framework comparisons.** Showing two Conservative Advisor tenants side by side will reveal the shared base. Cross-framework comparisons will be impressive. Sales demos should focus on cross-framework differentiation.

**C7. Per-framework editorial memory is a new persistence pattern.** The existing editorial memory system is keyed by `tenant_id`. Splitting into per-framework (positions) and per-tenant (voice) requires schema changes and conceptual complexity.

---

## 10. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | **Is K=4 the right number?** Too few and tenants don't fit; too many and the cost advantage weakens. Should we start with K=3 (drop Contrarian Strategist, the riskiest) and add later? | Core architecture | Before Phase 1 implementation |
| 2 | **Sub-archetype customization scope.** Should tenants be able to tweak 2-3 parameters (e.g., directional commitment level, horizon preference) within an archetype? This creates archetype variants and increases effective K. | Increases product fit at the cost of increased K | Before Phase 2 |
| 3 | **Same-framework SEO risk.** Is ROUGE-L < 0.55 achievable between two same-framework outputs with only deterministic overlay? Needs empirical validation before we can commit to same-framework cross-tenant publishing. | Potentially blocks same-framework multi-tenant publishing | Before production launch |
| 4 | **Do we need a "custom framework" escape hatch?** For enterprise tenants who don't fit any archetype and are willing to pay for a bespoke framework (effectively a per-tenant identity call). This would be O(1) for that tenant, priced as a premium feature. | Product completeness | Phase 2 |
| 5 | **Re-baseline study status.** The House Position brief called for collecting 12+ real analyst notes to measure real-world cosine distribution. Has this been done? The archetype model's thresholds depend on knowing where real analyst-vs-analyst content clusters. | Threshold calibration | Before Phase 1 validation |
| 6 | **Editorial memory schema migration.** How do we migrate from per-tenant to per-framework positional memory without losing existing data? Discriminator on `editorial_fact.fact_type`? New `framework_id` field? | Implementation complexity | Before Phase 2 |
| 7 | **TA timeframe selection.** Should tenants be able to override the framework's default timeframe selection (e.g., a Conservative Advisor tenant who also wants daily TA)? | Per-pipeline config complexity | Phase 2 |

---

## 11. Decision Criteria

Adopt the archetype model if:

1. Cross-framework validation (section 7.2) passes: mean cosine < 0.80 across all 6 pairs
2. Same-framework overlay validation (section 7.3) passes: ROUGE-L < 0.55, product perception passes for at least 4 of 6 human-reviewed pairs
3. At least 2 design-partner prospects confirm they would pick one of the 4 archetypes for their content

Do NOT adopt if:

1. Cross-framework cosine is > 0.80 for any pair -- the archetypes are not sufficiently different
2. Same-framework ROUGE-L is > 0.55 with maximum overlay -- SEO risk is too high for multi-tenant same-framework publishing
3. Design partners consistently describe their needs as "between" two archetypes and the sub-archetype customization (Q2) is insufficient

---

## 12. Decision Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-16 | Framework archetype model proposed as replacement for v1 per-tenant identity calls | O(K) vs O(N) scaling; addresses convergence finding; eliminates per-tenant human touchpoints |
| 2026-04-16 | House Position brief (`2026-04-15`) superseded by this spec | Archetype model achieves the same goals (position-as-input, fabrication reduction) without per-tenant labor |
| 2026-04-16 | FA Agent demoted to facts-only (carried from House Position brief) | Correct regardless of archetype model; shared facts + per-framework interpretation is the right split |
| 2026-04-16 | Same-framework cross-tenant threshold set deliberately loose (0.92) | Architectural reality: overlay-only divergence is limited; product claim shifts to "adapted to your brand" rather than "unique work" |
| 2026-04-16 | K=4 archetypes proposed (Conservative, Trader, Educator, Contrarian) | Covers the observed clustering of real financial content publishers; open question on whether K=3 is better for MVP |
