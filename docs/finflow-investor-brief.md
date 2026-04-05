# FinFlow — Investor Brief

**Prepared by:** WordwideFX  
**Date:** April 2026  
**Status:** Pre-launch, Translation Engine complete (TypeScript), benchmarked  
**Live mockup:** [agaleraib.github.io/finflow-deck/mockup/finflow-ui-mockup.html](https://agaleraib.github.io/finflow-deck/mockup/finflow-ui-mockup.html)

---

## 1. The Quality Assurance Bridge

WordwideFX has spent 15 years fixing bad financial translations. We know exactly how they break: a human translator reverses "overbought" and "oversold," transposes a price level from 0.7740 to 0.7440, or softens a directional call into mush. In financial content, these errors move money.

That expertise is now codified into 13 measurable quality metrics — a scoring engine that evaluates every piece of content before it reaches a client's audience. Six metrics are deterministic (numerical accuracy, formatting, structural integrity) and produce identical scores every time. Seven are LLM-judged (tone fidelity, terminology consistency, analytical coherence) running at temperature=0, with measured variance of +/-1-3 points across 5 independent runs. Ten of 13 metrics score identically across all runs.

This scoring engine is the safety net that makes content generation at scale possible. Without it, AI-generated financial content is a liability. With it, every document is scored, gated, and auditable.

**The result for our target customer:** a mid-size forex broker currently publishing 1-2 rebranded white-label pieces per day can publish 10+ original, branded pieces across multiple languages — each one quality-scored and compliance-checked before it goes live.

---

## 2. The Problem We Solve

A small-to-mid forex broker (50-200 employees) has no research team. They cannot afford one ($15-30K/month). Instead, they pay FXStreet or TradingCentral $3-5K/month for white-label content: generic analysis, English-only or machine-translated, published under their brand but indistinguishable from every other broker using the same feed.

This creates three problems:

- **No differentiation.** Their "research" is identical to competitors using the same provider. Clients notice.
- **No multilingual reach.** Brokers serving Latin American, Asian, or Middle Eastern markets get English content. Translation is an afterthought, if it happens at all.
- **No SEO value.** Rebranded white-label content doesn't rank. Two indexed pages per day won't compete with brokers publishing original research.

The broker wants to look like a bigger operation — original analysis, multiple languages, consistent brand voice, steady content cadence — but the economics don't work with human teams.

---

## 3. The Solution: Quality-Scored Content at Scale

FinFlow is a content multiplication engine with a quality scoring core. It monitors markets 24/7, generates branded financial analysis, translates across languages, and scores every output against 13 quality metrics before publication.

### What changes for the broker

| Metric | Before (white-label) | After (FinFlow) |
|--------|---------------------|-----------------|
| **Original content/day** | 1-2 rebranded pieces | 10+ branded originals |
| **Languages** | English (maybe 1 other) | Multiple, quality-scored |
| **SEO indexed pages/day** | ~2 | ~50 |
| **Social posts/day** | 1-2 manual | 10+ across channels |
| **Brand voice** | Generic | Configured per client |
| **Quality assurance** | None | 13-metric scoring, audit trail |
| **Cost** | $3-5K/month (white-label fee) | $999-2,999/month (all-in) |

### How it works

```
Market event detected (e.g., ECB rate decision)
        |
FinFlow auto-suggests: "EUR/USD analysis - bearish bias"
        |
Client approves --> Pipeline launches
        |
Analysis generation (multiple audience levels)
        |
Quality scoring: 13 metrics evaluated
        |
Translation into client's languages
        |
Quality scoring: 13 metrics on translated output
        |
Human checkpoint (adaptive: 100% --> 10% over 12 months)
        |
Published: Blog, Email, Social, PDF - all branded
```

Every step is logged. Every output is scored. The client gets an audit trail showing exactly why each piece passed or was flagged.

---

## 4. The Quality Scoring Engine (Core Product)

### 13 metrics, two categories

**Deterministic (6 metrics) — 100% reproducible:**
- Numerical accuracy (prices, percentages, dates)
- Structural completeness (sections, formatting)
- Glossary adherence (client-specific terms)
- Formatting consistency
- Length compliance
- Reference integrity

**LLM-judged (7 metrics) — temperature=0, measured variance:**
- Tone fidelity to client profile
- Terminology consistency
- Analytical coherence
- Risk disclosure completeness
- Directional language calibration
- Readability for target audience
- Cultural/market appropriateness

### Benchmark results (measured)

| Test | FinFlow | Generic AI (Claude/GPT) | Human translator |
|------|---------|------------------------|-----------------|
| **Numerical accuracy** | 100% | 86% | 92% |
| **Scoring consistency (5 runs)** | 10/13 exact, max drift 3 pts | N/A | N/A |
| **Cost per document** | $2.81 | ~$0.50 (no QA) | $50-150 |

**Specific errors caught in benchmarking:**
- Human translator reversed "overbought" and "oversold" in a technical analysis — FinFlow's deterministic checks catch this automatically
- Human translator transposed price levels (0.7740 became 0.7440) — FinFlow catches 100% of numerical transpositions
- Generic AI used valid but non-standard synonyms for regulated financial terms — acceptable linguistically, but inconsistent with client glossaries

The 86% generic AI accuracy is not because the AI is bad — it is because financial content has domain-specific correctness requirements that general-purpose models don't optimize for. A synonym that is fine in normal text can be wrong in a margin disclosure.

---

## 5. Competitive Positioning

### We replace FXStreet/TradingCentral, not "a person using ChatGPT"

The buyer's current spend is $3-5K/month on white-label research feeds. That is the budget we capture, with a superior product:

| Dimension | FXStreet / TradingCentral | FinFlow |
|-----------|--------------------------|---------|
| **Content** | Generic, shared across all subscribers | Original, branded per client |
| **Languages** | English + limited translation | Multiple, quality-scored per language |
| **Brand voice** | None (their brand, not yours) | Configured per client |
| **Quality assurance** | Editorial review (opaque) | 13-metric scoring (auditable) |
| **Volume** | Fixed feed (X pieces/day) | Scales with plan tier |
| **SEO value** | Low (duplicate content) | High (original content) |
| **Price** | $3-5K/month | $999-2,999/month |

### What we are NOT competing against

- **Bloomberg Terminal** — we augment data sources, not replace them
- **ChatGPT/Claude direct** — no quality scoring, no client profiles, no pipeline orchestration, no audit trail
- **Generic AI writing tools (Jasper, Copy.ai)** — no financial domain expertise, no compliance, no multilingual quality assurance

---

## 6. The Real Moat

### 1. Client relationships and domain knowledge
100+ broker clients served over 15 years. We know the workflows, the compliance requirements, the terminology debates, the approval bottlenecks. This is sales leverage and product insight, not a data moat.

### 2. Quality scoring engine
13 metrics with audit trails. No competitor in the white-label research space offers measurable, reproducible quality scoring. This is the product differentiator that makes enterprise procurement possible — the compliance officer can see exactly why content passed.

### 3. HITL learning loop (switching costs)
Human translators review AI output. Corrections feed back into client profiles. Over 12 months, the system learns each client's exact voice. Switching to a competitor means starting from zero. The cost of switching grows every month.

| Period | Human review rate | What the system has learned |
|--------|------------------|-----------------------------|
| Month 1-2 | 100% | Baseline profile building |
| Month 3-4 | 70% | Common corrections absorbed |
| Month 5-6 | 50% | Tone and terminology stabilized |
| Month 7-12 | 10-20% | Spot-check only |

### 4. Full pipeline orchestration
Market scanning, analysis generation, quality scoring, translation, compliance review, multi-channel distribution — integrated, not bolted together. The value is in the orchestration, not any single component.

---

## 7. Market Opportunity

### Target customer
Small-to-mid forex/crypto broker, 50-200 employees, no research team. Currently spending $3-5K/month on white-label content (FXStreet, TradingCentral, Autochartist) or publishing nothing. Wants to compete on content with larger brokers.

500+ brokers globally fit this profile.

### Market size
- **BFSI AI market:** $56-74B (2025), growing 25-30% CAGR
- **Traditional financial research spending:** $15-20B globally
- **AI adoption in finance:** 58% of finance functions already using AI (Gartner 2025)

### Why now
- LLM quality crossed the threshold for financial content in 2025-2026
- Regulatory pressure (MiFID II updates, ASIC enforcement) is increasing compliance costs
- Incumbent content providers (TradingCentral, Autochartist) have not adapted to AI
- Brokers are experimenting with ChatGPT for content but have no quality controls — creating compliance risk

---

## 8. Business Model and Pricing

| Tier | Monthly Price | Instruments | Languages | Quality Scoring | HITL Model |
|------|-------------|-------------|-----------|-----------------|------------|
| **Automated** | $999 | 5 | 3 | Full 13-metric | AI-only (scored, gated) |
| **Hybrid** | $2,999 | 20 | 9 | Full 13-metric | Adaptive learning curve |
| **Enterprise** | $7,999+ | Unlimited | All supported | Full 13-metric + custom | Dedicated translation team |

### Unit economics
- **Cost per document (production pipeline):** $2.81 (measured)
- **Gross margin:** 90-95%
- **Break-even:** ~5 Automated clients ($4,995 MRR)

### Revenue projections (conservative)

| Milestone | Clients | MRR | ARR |
|-----------|---------|-----|-----|
| Month 6 | 5 (pilot) | $10K | $120K |
| Month 12 | 20 | $45K | $540K |
| Month 18 | 50 | $120K | $1.44M |
| Month 24 | 100 | $250K | $3M |

### Why margins are sustainable
- Smart model routing: each task uses the most cost-efficient model that meets quality requirements
- Translation costs decrease per client over time as HITL automation increases
- Multi-tenant infrastructure — costs shared across clients
- Quality scoring engine creates pricing power: clients pay for auditable quality, not generic AI output

---

## 9. Go-to-Market Strategy

### Phase 1: Warm leads (Month 1-3)
- Pilot with Tier1FX (internal company) — full feature validation
- Approach 5 existing WordwideFX clients — OANDA, Alpari, AXIORY, ThinkMarkets, Hantec Markets
- 4-week free pilot per client — demonstrate the learning curve and quality improvement

### Phase 2: Case studies (Month 3-6)
- Publish pilot results: content volume increase, quality scores, cost comparison vs. white-label
- Demo environment for prospect presentations
- Targeted outreach to 50 mid-size brokers

### Phase 3: Scale (Month 6-12)
- Conference presence: iFX EXPO, Finance Magnates events
- Partnership with broker technology providers (MetaQuotes ecosystem)
- Outreach armed with case studies and benchmark data

### Phase 4: Expansion (Month 12+)
- Wealth management firms, prop trading firms, financial media companies
- White-label partnerships with larger research providers
- Self-hosted enterprise deployments for data sovereignty requirements

---

## 10. Current State and Traction

| Asset | Status | Detail |
|-------|--------|--------|
| **Translation Engine** | Complete | TypeScript (Bun + Hono), 24 files / 2,900 lines, production-ready |
| **Quality Scoring Engine** | Complete | 13 metrics, benchmarked (see Section 4) |
| **Python prototype** | Reference | ~6,100 lines — full pipeline proof-of-concept, archived |
| **Interactive UI mockup** | Complete | 10-screen production-quality mockup ([live demo](https://agaleraib.github.io/finflow-deck/mockup/finflow-ui-mockup.html)) |
| **Benchmark results** | Documented | Numerical accuracy, scoring consistency, cost per document (see Section 4) |
| **Architecture plan** | Complete | Technical spec, database schema, project structure, phased implementation |
| **Business strategy** | Defined | Pricing, go-to-market, competitive positioning |

### Technology stack
- **Runtime:** Bun (TypeScript) + Hono (API framework) + Zod (validation)
- **AI:** Anthropic Claude API via tool_use for structured output
- **Quality:** 13-metric scoring engine (6 deterministic + 7 LLM-judged)
- **Architecture:** Multi-agent pipeline with repository pattern

---

## 11. Team and Background

**WordwideFX** was founded in 2010-2011 in Barcelona. 15+ years of specialized financial translation:

- Deep domain expertise in financial terminology and compliance language
- Client relationships with 100+ financial institutions (OANDA, Goldman Sachs, Alpari, AXIORY, ThinkMarkets)
- Regulatory compliance experience across MiFID II, SEC, FCA, ASIC, MAS
- The team that built FinFlow has been living in the gap between financial content quality expectations and delivery reality for over a decade

---

## 12. Risks and Limitations

**Honest assessment of where we are:**

| Risk | Status | Mitigation |
|------|--------|------------|
| **Only 1 language tested (ES)** | Benchmarks are Spanish only. Other language pairs are untested. | Expanding to PT, FR, AR in next phase. Architecture is language-agnostic. |
| **HITL learning loop is a hypothesis** | The 100%-to-10% automation curve is projected, not measured. We believe it based on 15 years of translator feedback patterns, but we have not run a 12-month client engagement yet. | Pilot with Tier1FX will produce real data within 3-6 months. |
| **LLM dependency** | Core pipeline depends on Anthropic/OpenAI APIs. Pricing and capability changes are outside our control. | Model-agnostic routing layer. Can switch providers per task. Cost per doc ($2.81) has headroom at current pricing. |
| **Market timing** | Incumbents (FXStreet, TradingCentral) could build similar capabilities. | They have the content but not the quality scoring engine or client-level personalization infrastructure. Their business model (sell the same content to everyone) conflicts with per-client customization. |
| **Scoring engine limitations** | 7/13 metrics are LLM-judged. While variance is measured and small (max 3 points), they are not deterministic. | Transparent reporting: clients see which metrics are deterministic and which are LLM-judged. Drift is logged per run. |
| **Scale is unproven** | Pipeline tested on individual documents, not 50 documents/day sustained throughput. | Architecture supports horizontal scaling. Load testing planned for pilot phase. |

---

## 13. What We're NOT Doing

- Not competing on price with generic AI content (race to the bottom)
- Not building a general-purpose translation tool (financial content only)
- Not removing humans entirely (HITL is a feature, not a bug — clients trust it, and it builds the moat)
- Not trying to replace Bloomberg (we augment data sources, not replace them)
- Not building for consumers (B2B only, broker/institutional focus)
- Not claiming 40+ languages on day one (we have 1 language benchmarked, expanding methodically)

---

## Contact

**Product:** [FinFlow Deck](https://agaleraib.github.io/finflow-deck/)  
**UI Mockup:** [Interactive Demo](https://agaleraib.github.io/finflow-deck/mockup/finflow-ui-mockup.html)  
**Repository:** [github.com/agaleraib/finflow-deck](https://github.com/agaleraib/finflow-deck)
