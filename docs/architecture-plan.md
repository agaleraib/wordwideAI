# FinFlow: Multi-Agent Financial Analysis Report System

## Comprehensive Architecture and Implementation Plan

**Date:** 2026-03-25
**Status:** Planning / Pre-Development
**Built on:** GoBot multi-agent framework
**By:** WordwideFX (est. 2011, Barcelona)

---

## 1. Executive Summary

FinFlow is a B2B SaaS platform that leverages GoBot's battle-tested multi-agent orchestration to produce institutional-grade financial analysis reports for forex brokers, crypto brokers, and financial institutions. The system continuously monitors markets, generates multi-perspective reports through specialized AI agents, enforces regulatory compliance per jurisdiction, and distributes branded content across channels — all with mandatory human-in-the-loop checkpoints at every critical juncture.

The core insight: GoBot already solves the hardest problems (agent orchestration, cross-agent deliberation, HITL workflows, model routing, scheduled pipelines, quality gating). FinFlow repackages these patterns for a specific, high-value vertical.

**WordwideFX Advantage:** 15 years of financial translation for 100+ clients provides pre-trained client profiles, glossaries, tone guides, and compliance terminology that no competitor can replicate.

---

## 2. Architecture Overview

### 2.1 How GoBot's Patterns Map to FinFlow

| GoBot Pattern | GoBot Implementation | FinFlow Equivalent |
|---|---|---|
| Agent system | `src/agents/base.ts` - AgentConfig with name, model, reasoning style, systemPrompt | Each FinFlow agent (TA, FA, Compliance, etc.) becomes an AgentConfig |
| Cross-agent invocation | `[INVOKE:agent\|question]` tags, parsed by `src/lib/cross-agent.ts`, with permission map in `AGENT_INVOCATION_MAP` | TA and FA agents deliberate via invoke tags; Quality agent orchestrates |
| HITL decisions | `src/lib/board/decisions.ts` - inline Telegram buttons (approve/defer/reject/discuss), `async_tasks` in Supabase | Report approval, compliance sign-off, translation approval, publish authorization |
| Board orchestrator | `src/lib/board/orchestrator.ts` - sequential agent execution, structured output via `tool_use`, synthesis | Report generation pipeline: gather data, run agents, synthesize, present for review |
| Model router | `src/lib/model-router.ts` - tiered routing (haiku/sonnet/opus + GPT-4o/Gemini) with budget tracking | News classification (Haiku), translation (Sonnet/GPT-4o per language), analysis (Sonnet), arbitration (Opus) |
| Scheduled jobs | `src/scheduler/executor.ts` - ScheduledJobDef with classification, locking, failure tracking | Market monitoring schedules, report generation cadences, distribution windows |
| Light pipeline | `src/lib/light-pipeline.ts` - Analyze(Sonnet) -> Execute(Local) -> Review(Sonnet) | News triage: Classify(Haiku) -> Summarize(Qwen) -> Relevance(Haiku) |
| Task queue | `src/lib/task-queue.ts` - async tasks with inline keyboards, stale reminders | Client review queue with approval buttons per report |
| Personalization | `config/profile.md` loaded by agents at runtime | Per-client `config/clients/{client-slug}/profile.md` with branding, tone, templates |
| Approval system | `src/lib/approval.ts` - impact detection patterns, pre-execution check | Compliance approval with jurisdiction-specific impact patterns |

### 2.2 High-Level Architecture

```
[Data Layer]
  News APIs (Bloomberg, Reuters, Refinitiv, NewsAPI)
  Market Data APIs (TradingView, Alpha Vantage, OANDA)
  Economic Calendars (Forex Factory, Investing.com)
  Regulatory Feeds (ESMA, SEC/EDGAR, ASIC, FCA)
        |
        v
[Ingestion Engine] -- Scheduled jobs (src/scheduler pattern)
  News Aggregator (continuous polling, dedup, relevance scoring)
  Market Data Collector (OHLCV, indicators, order flow)
  Economic Data Fetcher (GDP, CPI, NFP, central bank decisions)
        |
        v
[Analysis Pipeline] -- Board orchestrator pattern
  +--> Technical Analysis Agent (chart patterns, indicators, price action)
  +--> Fundamental Analysis Agent (macro, earnings, economic data)
  +--> Each produces structured AgentReport (GoBot's tool_use pattern)
        |
        v
[Quality/Arbitration Agent] -- Critic agent pattern
  Reviews both reports, scores them, forces deliberation if divergent
  Uses [INVOKE:ta_agent|...] and [INVOKE:fa_agent|...] for back-and-forth
        |
        v
[HITL Checkpoint 1: Report Selection]
  Human reviewer sees both reports + arbitration analysis
  Approve / Request Changes / Reject (inline buttons, async_tasks)
        |
        v
[Compliance Agent] -- Content/Compliance agent pattern (RoT reasoning)
  Jurisdiction-specific review (MiFID II, SEC, ASIC, FCA, MAS, etc.)
  Adds disclaimers, removes non-compliant claims, flags risk
        |
        v
[HITL Checkpoint 2: Compliance Approval]
  Compliance officer reviews, signs off (tracked in async_tasks)
        |
        v
[Personalization Agent]
  Applies client branding, tone, template, audience level (beginner/intermediate/pro)
  Chart styling per client brand
        |
        v
[Translation Agents]
  Language-specific agents with best model per pair
  EN->ES (Qwen), EN->ZH (Claude), EN->AR (Gemini), etc.
        |
        v
[HITL Checkpoint 3: Translation Approval] (optional per package)
  WordwideFX translator reviews, corrections feed back to AI
  Adaptive learning curve: 100% HITL → 90% automated over 12 months
        |
        v
[HITL Checkpoint 4: Publish Authorization]
  Final review of complete package before distribution
        |
        v
[Distribution Engine]
  Email (per client list), Blog (WordPress/Ghost API),
  Social (Twitter/X, LinkedIn, Telegram channels), PDF export
```

---

## 3. Agent Design (Detailed)

### 3.1 News Aggregation Engine

**Not an agent — a scheduled data pipeline.** Follows GoBot's `ScheduledJobDef` pattern with handlers.

```
Classification: trivial (handler)
Schedule: */5 * * * *  (every 5 minutes for breaking, hourly for regular)
Pattern: Fetch data via REST APIs -> Classify with Qwen 7B -> Store in Supabase
```

**Data sources and APIs:**
- **Bloomberg Terminal API** or **Bloomberg B-PIPE** — institutional ($2K+/month). Alternative: Bloomberg RSS (free, delayed)
- **Reuters/Refinitiv Eikon API** — institutional. Alternative: Reuters RSS
- **NewsAPI.org** — $449/month business plan
- **Alpha Vantage** — Free tier (25 req/day), premium $49/month. News sentiment + market data
- **Forex Factory calendar** — Free scraping (no official API)
- **OANDA v20 API** — Free with account. Real-time forex rates, historical OHLCV
- **TradingView Webhooks** — Free. Alert-based triggers
- **SEC EDGAR** — Free. US company filings
- **Polygon.io** — $49.99-249.99/month. WebSocket support, scalable

**Relevance scoring:** Qwen 7B classifies as `breaking | high | medium | low | noise`, Haiku second pass on `high` items.

**Storage:** `news_items` table in Supabase with pgvector embeddings for semantic deduplication.

### 3.2 Technical Analysis Agent

```typescript
{
  name: "Technical Analysis Agent",
  model: "claude-sonnet-4-5-20250929",
  reasoning: "CoT",  // Chain-of-Thought
  personality: "precise, data-driven, pattern-focused",
}
```

**Structured output:**
- Trend analysis (direction, strength, timeframe)
- Key levels (support/resistance with price + confidence)
- Pattern recognition (formations with completion %)
- Indicator readings (RSI, MACD, Bollinger, moving averages)
- Trade setup (entry, stop, targets with R:R ratio)
- Confidence score + dissenting signals

### 3.3 Fundamental Analysis Agent

```typescript
{
  name: "Fundamental Analysis Agent",
  model: "claude-sonnet-4-5-20250929",
  reasoning: "ReAct",  // Reason-Act-Observe
  personality: "thorough, macro-aware, citation-focused",
}
```

**Structured output:**
- Macro environment summary (rates, inflation, employment)
- Central bank stance and forward guidance
- Economic calendar impact (upcoming events + expected moves)
- Cross-asset correlations (DXY, yields, commodities)
- Geopolitical risk assessment
- Sentiment indicators (COT, positioning, flow data)

### 3.4 Quality/Arbitration Agent

```typescript
{
  name: "Quality Arbitration Agent",
  model: "claude-opus-4-6",
  reasoning: "ToT",  // Tree of Thought
  personality: "skeptical, balanced, consensus-seeking",
}
```

**Deliberation flow:**
1. Quality agent receives both reports
2. Scores each on: accuracy, completeness, internal consistency, evidence quality
3. If TA and FA diverge: `[INVOKE:ta_agent|FA analysis shows bearish macro — how does your bullish pattern hold up?]`
4. Receives TA response. `[INVOKE:fa_agent|TA identifies a breakout with 78% historical success. Does the macro data invalidate this?]`
5. Synthesizes consensus view or documents disagreement with reasoning
6. Maximum deliberation depth: 3 rounds

### 3.5 Compliance Agent

```typescript
{
  name: "Compliance Agent",
  model: "claude-sonnet-4-5-20250929",
  reasoning: "RoT",  // Recursion of Thought
}
```

**Jurisdiction modules:**

| Jurisdiction | Regulator | Key Rules |
|---|---|---|
| EU | ESMA/MiFID II | Investment advice vs. opinion, risk warnings, past performance disclaimers |
| US | SEC/FINRA | Reg FD, anti-fraud provisions, suitability, FINRA 2210 |
| UK | FCA | COBS 4 (fair/clear/not misleading), financial promotions |
| Australia | ASIC | RG 234 (advertising), DDO (target market determinations) |
| Singapore | MAS | FAA (financial advisory), SFA (securities/futures) |
| South Africa | FSCA | FAIS Act, advertising requirements |
| Bermuda | BMA | Investment Business Act communications rules |

### 3.6 Personalization Agent

Per-client configuration:
```
config/clients/{client-slug}/
  profile.md          # Company info, audience, tone
  branding.json       # Colors, logo path, fonts, chart theme
  glossary.json       # Client-specific financial terminology
  templates/          # Report templates per level
    beginner.md
    intermediate.md
    professional.md
  disclaimers/        # Jurisdiction-specific disclaimers
  distribution.json   # Channel configs
```

### 3.7 Translation Agents

**LLM selection per language tier (all API-based):**

| Language Tier | Primary Model | Fallback | Cost/Lang/Report |
|---|---|---|---|
| European (ES, PT, DE, FR, IT, NL, etc.) | Claude Sonnet 4 | GPT-4o | ~$0.07 |
| Chinese (Simplified) | GPT-4o / GPT-4.1 | Claude Sonnet 4 | ~$0.07 |
| Japanese | Claude Sonnet 4 | GPT-4o | ~$0.07 |
| Korean | Gemini 2.5 Pro | GPT-4o | ~$0.07 |
| Arabic / RTL | GPT-4o | Claude Sonnet 4 | ~$0.07 |
| South/Southeast Asian | Gemini 2.5 Pro | GPT-4o | ~$0.07 |
| Volume/Draft tier | GPT-4o-mini | Gemini 2.0 Flash | ~$0.003 |

**Model selection rationale:** Claude Sonnet 4 is the default for its best-in-class instruction adherence — critical for maintaining client-specific glossary terms, tone profiles, and brand voice constraints. GPT-4o excels for CJK financial content. Gemini 2.5 Pro is strongest for Korean and South/Southeast Asian languages.

**Translation Learning Loop (WordwideFX advantage):**
1. AI generates initial translation using client-specific glossary + tone profile
2. Human translator reviews (HITL checkpoint)
3. Corrections are fed back to fine-tune the translation model for this client
4. Over 6-12 months, HITL percentage decreases: 100% → 70% → 50% → 20% → 10%
5. Client retention is built into the learning curve — the system gets better over time

### 3.8 Chart & Visual Generation

**Technology stack:**
- TradingView Lightweight Charts (open-source) — server-side via Puppeteer
- Plotly for custom indicators, correlation matrices
- SVG templates for branded overlays
- Sharp for image composition

**Design principles:** Bloomberg-terminal-inspired, no AI artifacts, professional typography, client brand colors on accents.

### 3.9 Distribution Engine

**Channels:** Email (SendGrid/Mailgun), Blog (WordPress/Ghost API), Social (Twitter/X, LinkedIn, Telegram), PDF Export (Puppeteer), Webhook (generic POST).

---

## 4. Human-in-the-Loop Checkpoints

| Checkpoint | After | Approver | Actions | Timeout |
|---|---|---|---|---|
| 1. Report Selection | Quality arbitration | Client analyst / editor | Approve / Request Changes / Reject | Stale reminder 2h |
| 2. Compliance Sign-off | Compliance review | Licensed compliance officer | Approve / Flag / Reject | Escalate after 4h |
| 3. Translation Approval | Translation complete | WordwideFX translator (optional per package) | Approve / Edit / Retranslate | English-only if 24h timeout |
| 4. Publish Authorization | Final package ready | Client's authorized publisher | Publish All / Select Channels / Hold | Holds indefinitely |

---

## 5. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun (GoBot's existing runtime) |
| Database | Supabase (self-hosted at 10.1.10.233) |
| Queue | BullMQ + Redis (proper job queues for multi-tenant) |
| LLM Primary | Anthropic Claude (Opus/Sonnet/Haiku) |
| LLM Secondary | OpenAI GPT-4o/4.1/4o-mini, Google Gemini 2.5 Pro/2.0 Flash |
| Charts | TradingView Lightweight + Plotly + Puppeteer |
| Storage | Supabase Storage |
| Auth | Supabase Auth + API keys (multi-tenant RLS) |
| Monitoring | Chronicle telemetry + Grafana |

---

## 6. LLM Cost Per Report

| Task | Model | Cost |
|---|---|---|
| News classification | Haiku | ~$0.02 |
| Relevance scoring | Haiku | ~$0.02 |
| Technical Analysis | Sonnet | ~$0.15 |
| Fundamental Analysis | Sonnet | ~$0.15 |
| Quality Arbitration | Opus (Enterprise) / Sonnet | ~$0.80 / ~$0.15 |
| Deliberation rounds (2x) | Sonnet | ~$0.20 |
| Compliance review | Sonnet | ~$0.10 |
| Personalization/rewrite | Sonnet | ~$0.10 |
| Translation (10 langs, Premium) | Sonnet / GPT-4o mix | ~$0.70 |
| **Total per report (Enterprise, 10 langs)** | | **~$2.24** |
| **Total per report (Hybrid, 10 langs)** | | **~$1.10** |

At scale (100 clients, 2 reports/day): ~$600/day, ~$18,000/month. Gross margin: ~92%.

---

## 7. Database Schema (New Tables)

- `finflow_clients` — tenant config, subscription tier, branding
- `finflow_reports` — reports with status workflow (draft → reviewed → compliant → translated → published)
- `finflow_news_items` — aggregated news with embeddings, dedup hash, relevance score
- `finflow_market_data` — cached OHLCV, indicators per instrument per timeframe
- `finflow_compliance_certs` — audit trail per jurisdiction
- `finflow_distributions` — track what was published where, when
- `finflow_glossaries` — per-language per-client financial terminology
- `finflow_templates` — report templates per client per audience level
- `finflow_translation_feedback` — human corrections for learning loop

---

## 8. Codebase Structure

```
src/
  finflow/
    agents/
      ta-agent.ts
      fa-agent.ts
      quality-agent.ts
      compliance-agent.ts
      personalization-agent.ts
      translation-agent.ts
    pipeline/
      report-generator.ts
      news-aggregator.ts
      chart-renderer.ts
      distribution.ts
    lib/
      market-data.ts
      compliance-rules.ts
      client-config.ts
      report-templates.ts
      translation-feedback.ts
    types.ts
    api/
      client-api.ts
      webhook.ts
```

---

## 9. Key Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM hallucination in financial advice | High | Critical | Compliance agent gate; all claims cite data; HITL before publish |
| Regulatory liability | Medium | Critical | "Informational purposes only"; compliance templates; legal review |
| Data source API changes/outages | Medium | High | Multiple sources per type; circuit breaker; graceful degradation |
| Report accuracy credibility | Medium | High | Backtesting (Phase 6); transparent confidence scores |
| Client data isolation failure | Low | Critical | Supabase RLS; separate schemas; penetration testing |
| LLM API cost at scale | Medium | Medium | Intelligent model routing (Haiku/mini for triage, Sonnet for quality); daily budget tracking; per-client caps; API costs trending down ~30% YoY |
