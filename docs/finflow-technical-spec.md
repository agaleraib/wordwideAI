# FinFlow — Technical Specification

**Version:** 1.0  
**Date:** April 2026  
**Status:** Pre-implementation, architecture finalized  
**Authors:** WordwideFX Engineering  
**UI Mockup:** [Interactive Demo](https://agaleraib.github.io/finflow-deck/mockup/finflow-ui-mockup.html)

---

## Table of Contents

1. [Overview & Design Philosophy](#1-overview--design-philosophy)
2. [System Architecture](#2-system-architecture)
3. [Core Workflow](#3-core-workflow)
4. [Agent System](#4-agent-system)
5. [Data Layer](#5-data-layer)
6. [Database Schema](#6-database-schema)
7. [HITL Workflow](#7-hitl-workflow)
8. [Translation Engine](#8-translation-engine)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Multi-Tenancy & Security](#10-multi-tenancy--security)
11. [Infrastructure](#11-infrastructure)
12. [API Surface](#12-api-surface)
13. [LLM Cost Model](#13-llm-cost-model)
14. [Phased Implementation](#14-phased-implementation)
15. [Risks & Mitigations](#15-risks--mitigations)

---

## 1. Overview & Design Philosophy

FinFlow is an autonomous, event-driven financial content platform that monitors markets 24/7, detects significant events, and produces institutional-grade multilingual analysis reports through a pipeline of specialized AI agents with human-in-the-loop checkpoints.

### Design Principles

- **Event-driven, not manually triggered.** The system's entry point is always: event detected → suggestions presented → client selects → pipeline runs. There is no "Run Analysis" button.
- **Hybrid architecture.** TypeScript (Bun) for API, orchestration, and agent execution. Python (FastAPI) for data processing where the ecosystem is stronger (pandas, numpy, mplfinance).
- **Standalone project.** Copies proven architectural patterns from the GoBot multi-agent framework, but does not depend on GoBot as a runtime dependency.
- **Multi-tenant from day one.** Row-Level Security (RLS) in PostgreSQL, tenant-scoped everything, white-label branding per client.
- **Translation as a first-class pipeline stage.** Not an afterthought. Translation with client-specific glossaries, tone profiles, brand voice, and adaptive human review is a core differentiator.
- **Deep personalization across all agents.** Every agent — analysis, compliance, translation — is configured per client with tone, terminology, aggressiveness, allowed content, and brand voice. This is the platform's primary competitive advantage: 15 years of financial client data shaping every output.

### Technology Rationale

| Decision | Choice | Why |
|----------|--------|-----|
| TS for orchestration | Bun + Hono | GoBot's proven patterns, async-first, streaming SSE, structured output via Anthropic SDK |
| Python for data | FastAPI | pandas/numpy/mplfinance ecosystem irreplaceable for market data processing and chart generation |
| Supabase | PostgreSQL + Auth + Storage + Realtime + pgvector | Managed multi-tenant DB with RLS, real-time subscriptions for live UI, vector search for semantic dedup |
| BullMQ + Redis | Job queue | Per-tenant concurrency control, scheduled scanning, pipeline job management |
| Next.js | Frontend | SSR for public reports (SEO), responsive HITL approvals, shadcn/ui component system |

---

## 2. System Architecture

```
                        ┌─────────────────────────────┐
                        │     Next.js Frontend         │
                        │     (Command Center,         │
                        │      Pipeline Monitor,       │
                        │      Reports, HITL, Admin)   │
                        └────────────┬────────────────┘
                                     │
                        ┌────────────▼────────────────┐
                        │     TypeScript API (Bun)     │
                        │     Hono router              │
                        │     ─ Agent orchestration    │
                        │     ─ Event scanner/detector │
                        │     ─ Report suggestion      │
                        │     ─ HITL workflows         │
                        │     ─ Auth / Multi-tenant    │
                        │     ─ BullMQ job queues      │
                        └──┬──────────────┬───────────┘
                           │              │
              ┌────────────▼────┐  ┌──────▼────────────┐
              │   Supabase      │  │  Python Services   │
              │   ─ PostgreSQL  │  │  (FastAPI)         │
              │   ─ Auth        │  │  ─ Market data     │
              │   ─ Storage     │  │  ─ Indicators      │
              │   ─ Realtime    │  │  ─ Chart gen       │
              │   ─ pgvector    │  │  ─ News fetching   │
              └─────────────────┘  └───────────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │    Redis     │
                                    │   (BullMQ    │
                                    │    Cache)    │
                                    └─────────────┘
```

### Tech Stack

| Layer | Technology | Version/Notes |
|-------|-----------|---------------|
| **API/Orchestration** | TypeScript + Bun + Hono | Async-first, agent orchestration |
| **Job Queue** | BullMQ + Redis 7 | Scheduled scanning, pipeline jobs, per-tenant concurrency |
| **AI Agents** | Anthropic SDK (TS) | Claude API with structured output (`tool_use`) |
| **Data Processing** | Python 3.12 + FastAPI | pandas, numpy, yfinance, mplfinance |
| **Database** | Supabase (PostgreSQL 15 + Auth + Storage + Realtime + pgvector) | Multi-tenant RLS, self-hosted option |
| **Frontend** | Next.js 14 + Tailwind CSS + shadcn/ui + Radix UI | SSR for reports, responsive HITL |
| **Charts (interactive)** | TradingView Lightweight Charts | Financial-grade, themeable, open-source |
| **Charts (static)** | mplfinance (Python) | PDF/email report images |
| **Cache/Broker** | Redis 7 | BullMQ broker + data/news caching |
| **HITL Channels** | Web (token-based) + Telegram (grammy) | Slack/Teams in Phase 5 |

---

## 3. Core Workflow

FinFlow operates as an autonomous loop. The system is always scanning, always suggesting, always ready to execute.

```
[24/7 Data Source Scanning]
  Essential (included):      Finnhub, Economic Calendar, Yahoo Finance
  Professional (client keys): Polygon.io, Benzinga, TradingView Webhooks
  Institutional (client license): Bloomberg API, Reuters/Refinitiv
        │
        ▼
[Event Detection + Impact Analysis]
  Classifies events: breaking / high / medium / low / noise
  Determines which instruments are affected
  Semantic dedup via pgvector embeddings (cosine similarity > 0.92 = skip)
        │
        ▼
[Suggested Reports Queue]
  Auto-generates 1–3 report suggestions per significant event
  Shows: affected pair/commodity, expected direction, impact level
  *** CLIENT PICKS which suggestions to run *** ← primary interaction
        │
        ▼
[Pipeline Executes for Selected Suggestions]
  Stage 1:  Data Collection (market data + news context)
  Stage 2:  Technical Analysis Agent
  Stage 3:  Fundamental Analysis Agent
  Stage 4:  TA ↔ FA Deliberation (max 3 rounds)
  Stage 5:  Quality Arbitration (consensus or documented disagreement)
  Stage 6:  HITL — Analyst Review (optional per package)
  Stage 7:  Compliance Review (per jurisdiction)
  Stage 8:  HITL — Compliance Sign-off (required)
  Stage 9:  Translation (40+ languages, client glossaries + tone profiles)
  Stage 10: HITL — Translation Review (optional, adaptive 100%→10%)
  Stage 11: Report Generation (3 audience levels)
  Stage 12: HITL — Publish Authorization (required)
        │
        ▼
[Distribution]
  Email (SendGrid), Blog (WordPress/Ghost API),
  Social (Twitter/X, LinkedIn, Telegram),
  PDF export, Webhook (generic POST)
  — all channels, all languages, all branded
```

### Pipeline State Machine

Each `pipeline_run` follows this state machine:

```
queued → running → awaiting_approval → running → ... → completed
                                                    └→ failed
```

HITL checkpoints pause the pipeline (`awaiting_approval`). On approval, the pipeline resumes from the next stage. On rejection, the pipeline either loops back to the relevant agent for reprocessing or terminates, depending on the checkpoint type.

---

## 4. Agent System

All agents follow the base pattern adapted from GoBot's `src/agents/base.ts`. Each agent is defined by a configuration object and produces structured output via Claude's `tool_use` capability.

### 4.1 Agent Base

```typescript
interface AgentConfig {
  name: string;
  model: string;           // claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6
  reasoning: string;       // CoT, ReAct, ToT, RoT
  systemPrompt: string;
  tools: ToolDefinition[];
  maxTokens: number;
  temperature: number;
  retryPolicy: { maxRetries: number; backoffMs: number };
}

// Every agent receives a client personalization profile at runtime
interface ClientProfile {
  tenantId: string;
  companyName: string;
  tone: 'formal' | 'approachable' | 'institutional' | 'retail-friendly';
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
  allowedContent: {
    instruments: string[];          // which instruments can be discussed
    forwardLooking: boolean;        // can the content make predictions?
    tradeSetups: boolean;           // can it suggest entries/exits?
    priceTargets: boolean;          // can it name specific prices?
    restrictedTopics: string[];     // topics to never discuss
  };
  brandVoice: {
    examples: string[];             // actual paragraphs from client's existing content
    vocabulary: Record<string, string>; // preferred terms ("units" not "lots")
    avoidTerms: string[];           // terms the client never uses
    formattingRules: string[];      // e.g., "use comma for decimals in European markets"
  };
  compliance: {
    jurisdictions: string[];        // MiFID II, SEC, FCA, etc.
    internalPolicies: string[];     // client-specific content restrictions
    requiredDisclaimers: string[];  // per-jurisdiction disclaimers
  };
  glossaries: Record<string, GlossaryTerms>; // per-language glossary
}
```

**Every agent in the pipeline** receives the `ClientProfile` and adapts its behavior accordingly. This is not cosmetic — it fundamentally shapes the output. A conservative wealth manager and an aggressive CFD broker analyzing the same EUR/USD movement will receive meaningfully different content: different framing, different terminology, different level of directional conviction, different risk language.

All agent calls use streaming via `@anthropic-ai/sdk`, with token tracking per call for cost attribution.

### 4.2 Technical Analysis Agent

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Reasoning** | Chain-of-Thought (CoT) |
| **Input** | OHLCV data, indicator values (RSI, MACD, BB, MAs), recent price action, **client profile** |
| **Output** | Trend analysis, key levels (support/resistance), pattern recognition, indicator readings, trade setup (entry/stop/targets), confidence score + dissenting signals |

**Personalization:** The TA agent adapts based on the client's `aggressiveness` and `allowedContent` settings. A conservative client gets hedged language ("potential support zone") while an aggressive broker gets direct calls ("strong buy at 1.1550"). If `tradeSetups` or `priceTargets` are disabled in the client profile, the agent omits those sections entirely.

### 4.3 Fundamental Analysis Agent

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Reasoning** | ReAct (Reason-Act-Observe) |
| **Input** | News articles, economic calendar events, central bank decisions, macro data, **client profile** |
| **Output** | Macro environment summary, central bank stance, economic calendar impact, cross-asset correlations, geopolitical risk assessment, sentiment indicators (COT, positioning) |

**Personalization:** The FA agent adjusts depth and focus based on the client's audience. An institutional client gets COT positioning data and yield curve analysis; a retail broker gets simplified macro context. The agent respects `restrictedTopics` (e.g., some clients cannot discuss geopolitical events) and uses the client's preferred terminology throughout.

### 4.4 Quality/Arbitration Agent

| Property | Value |
|----------|-------|
| **Model** | `claude-opus-4-6` (Enterprise) / `claude-sonnet-4-5` (Hybrid/Automated) |
| **Reasoning** | Tree-of-Thought (ToT) |
| **Role** | Receives both TA and FA reports. Scores each on accuracy, completeness, consistency, evidence quality. |

**Deliberation flow:**
1. Quality agent reviews both reports
2. If TA and FA diverge: `[INVOKE:ta_agent|FA analysis shows bearish macro — how does your bullish pattern hold up?]`
3. TA responds. `[INVOKE:fa_agent|TA identifies a breakout with 78% historical success. Does the macro data invalidate this?]`
4. FA responds. Quality agent synthesizes consensus or documents disagreement with reasoning.
5. Maximum deliberation depth: 3 rounds.

Cross-agent invocation uses the `[INVOKE:agent|question]` tag pattern, parsed by a dedicated `cross-agent.ts` module (adapted from GoBot's `src/lib/cross-agent.ts`).

### 4.5 Compliance Agent

| Property | Value |
|----------|-------|
| **Model** | `claude-sonnet-4-5` |
| **Reasoning** | Recursion-of-Thought (RoT) |
| **Input** | Synthesized report, client's jurisdiction configuration |
| **Output** | Compliance flags, required disclaimers, removed/modified claims, risk score |

**Jurisdiction modules:**

| Jurisdiction | Regulator | Key Rules |
|-------------|-----------|-----------|
| EU | ESMA / MiFID II | Investment advice vs. opinion, risk warnings, past performance disclaimers |
| US | SEC / FINRA | Reg FD, anti-fraud provisions, suitability, FINRA 2210 |
| UK | FCA | COBS 4 (fair/clear/not misleading), financial promotions |
| Australia | ASIC | RG 234 (advertising), DDO (target market determinations) |
| Singapore | MAS | FAA (financial advisory), SFA (securities/futures) |
| South Africa | FSCA | FAIS Act, advertising requirements |
| Bermuda | BMA | Investment Business Act communications rules |

The compliance agent applies a hybrid approach: rule-based checks for mechanical requirements (disclaimer presence, risk warning format) combined with LLM reasoning for subjective assessments (is this claim misleading? does this constitute advice?).

**Personalization:** Beyond jurisdiction rules, the compliance agent loads the client's `internalPolicies` — restrictions that go beyond regulatory requirements. For example, a client may prohibit all forward-looking price statements even in jurisdictions where they're legally permitted, or require specific risk language that exceeds the regulatory minimum. The agent also applies the client's `requiredDisclaimers` which may differ from the regulatory default.

### 4.6 Translation Agent

| Property | Value |
|----------|-------|
| **Model** | Per-language routing (see Section 8) |
| **Input** | English report, client-specific glossary, tone profile |
| **Output** | Translated report preserving formatting, financial terminology, and brand voice |

### 4.7 Model Router

Tiered model selection adapted from GoBot's `src/lib/model-router.ts`. All models are API-based — no local inference.

| Task | Primary Model | Fallback | Est. Cost |
|------|--------------|----------|-----------|
| News triage + event classification | `claude-haiku-4-5` | `gpt-4.1-nano` | ~$0.02 |
| Technical Analysis | `claude-sonnet-4-5` | `gpt-4o` | ~$0.15 |
| Fundamental Analysis | `claude-sonnet-4-5` | `gpt-4o` | ~$0.15 |
| Quality arbitration (Enterprise) | `claude-opus-4-6` | `claude-sonnet-4-5` | ~$0.80 / ~$0.15 |
| Compliance review | `claude-sonnet-4-5` | `gpt-4.1` | ~$0.10 |
| Translation (European, Tier 1) | `claude-sonnet-4-5` | `gpt-4o` | ~$0.07/lang |
| Translation (CJK) | `gpt-4o` / `claude-sonnet-4-5` | `gemini-2.5-pro` | ~$0.07/lang |
| Translation (Arabic/RTL) | `gpt-4o` | `gemini-2.5-pro` | ~$0.07/lang |
| Translation (volume/drafts) | `gpt-4o-mini` | `gemini-2.0-flash` | ~$0.003/lang |
| Personalization / rewriting | `claude-sonnet-4-5` | `gpt-4o` | ~$0.10 |

**Model selection rationale for translation:**
- **Claude Sonnet 4** is the primary translation model due to best-in-class instruction adherence — critical for maintaining glossary terms, tone profiles, and brand voice constraints across long documents.
- **GPT-4o** excels for CJK financial content (particularly Chinese) and serves as a strong fallback for all language tiers.
- **Gemini 2.5 Pro** is competitive for Korean and South/Southeast Asian languages where Google has strong training data.
- **GPT-4o-mini / Gemini 2.0 Flash** provide cost-efficient draft translations for internal summaries or lower-priority languages (~$0.003 per language per report).
- **DeepL API** (optional) can run in parallel as a quality-assurance cross-reference for European pairs — flagging significant divergences for human review.

---

## 5. Data Layer

### 5.1 Data Source Tiers

| Tier | Sources | Access | Included In |
|------|---------|--------|-------------|
| **Essential** | Finnhub (WebSocket + REST), Economic Calendar (scraping), Yahoo Finance (yfinance) | Free / included | All plans |
| **Professional** | Polygon.io (WebSocket), Benzinga (REST), TradingView Webhooks | Client provides API keys | Hybrid, Enterprise |
| **Institutional** | Bloomberg API (B-PIPE), Reuters/Refinitiv Eikon | Client provides license | Enterprise |

### 5.2 Scanner Architecture

The scanner runs as a BullMQ scheduled job:

- **Frequency:** Every 5 minutes for Essential sources, configurable per Professional/Institutional source
- **Process:** Fetch → Classify (Haiku) → Deduplicate (pgvector cosine similarity) → Store → Suggest
- **Event classification:** `breaking` | `high` | `medium` | `low` | `noise`
- **Deduplication:** Events with cosine similarity > 0.92 to existing events (within 24h window) are skipped
- **Suggestion generation:** For `high` and `breaking` events, the system determines affected instruments from the tenant's configured list and generates 1–3 report suggestions with direction and rationale

### 5.3 Data Source Interface

```typescript
interface DataSource {
  name: string;
  tier: 'essential' | 'professional' | 'institutional';
  connect(config: SourceConfig): Promise<void>;
  scan(): AsyncGenerator<RawEvent>;
  disconnect(): Promise<void>;
}
```

Each source adapter (Finnhub, Polygon, Bloomberg, etc.) implements this interface. Source adapters handle authentication, rate limiting, and format normalization.

### 5.4 Python Data Service

The FastAPI service handles computationally intensive data work:

| Endpoint | Purpose | Ported From |
|----------|---------|-------------|
| `GET /data/market/{ticker}` | OHLCV + computed indicators (RSI, MACD, BB, MAs) | `finflow/data/market_data.py` |
| `GET /data/news/{category}` | News articles with sentiment scoring | `finflow/data/news_scraper.py` |
| `POST /data/charts` | Generate chart images (PNG) for reports | `finflow/output/generate_charts.py` |
| `POST /data/indicators` | Compute technical indicators for given OHLCV data | `finflow/data/market_data.py` |

---

## 6. Database Schema

All tenant-scoped tables enforce Row-Level Security via `tenant_id`. PostgreSQL 15 with pgvector extension.

### Core Tables

**`tenants`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| name | TEXT | Company name |
| slug | TEXT (UNIQUE) | URL-safe identifier |
| plan | ENUM | `automated` \| `hybrid` \| `enterprise` |
| branding | JSONB | Logo URL, colors, fonts, CSS variables |
| settings | JSONB | Default languages, instruments, compliance jurisdictions |
| created_at | TIMESTAMPTZ | |

**`users`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | RLS scope |
| email | TEXT | |
| role | ENUM | `admin` \| `editor` \| `viewer` \| `compliance_officer` |
| supabase_auth_id | UUID | Links to Supabase Auth |

**`instruments`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| ticker | TEXT | e.g., `EURUSD`, `XAUUSD` |
| name | TEXT | e.g., "Euro vs US Dollar" |
| slug | TEXT | URL-safe |
| asset_class | TEXT | `forex` \| `crypto` \| `commodity` \| `index` |
| config | JSONB | Timeframes, indicators, source preferences |

**`data_sources`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| name | TEXT | |
| type | TEXT | `finnhub` \| `polygon` \| `bloomberg` \| ... |
| tier | ENUM | `essential` \| `professional` \| `institutional` |
| api_key_encrypted | TEXT | Encrypted client API key |
| config | JSONB | Source-specific configuration |
| enabled | BOOLEAN | |
| last_scan_at | TIMESTAMPTZ | |

**`market_events`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| headline | TEXT | |
| summary | TEXT | |
| source | TEXT | Source adapter name |
| impact | ENUM | `breaking` \| `high` \| `medium` \| `low` \| `noise` |
| category | TEXT | |
| sentiment | FLOAT | -1.0 to 1.0 |
| affected_instruments | TEXT[] | Ticker array |
| embedding | VECTOR(1536) | For semantic dedup |
| published_at | TIMESTAMPTZ | |
| detected_at | TIMESTAMPTZ | |

**`report_suggestions`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| event_id | UUID (FK → market_events) | Triggering event |
| instrument_id | UUID (FK → instruments) | |
| direction | ENUM | `bullish` \| `bearish` \| `neutral` |
| impact_summary | TEXT | Why this suggestion was generated |
| status | ENUM | `pending` \| `accepted` \| `dismissed` \| `running` \| `completed` |
| created_at | TIMESTAMPTZ | |

**`pipeline_runs`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| instrument_id | UUID (FK → instruments) | |
| suggestion_id | UUID (FK → report_suggestions, nullable) | |
| status | ENUM | `queued` \| `running` \| `awaiting_approval` \| `completed` \| `failed` |
| trigger | ENUM | `event` \| `manual` \| `scheduled` |
| current_stage | TEXT | Current pipeline stage name |
| result | JSONB | Final pipeline output |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

**`pipeline_events`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| run_id | UUID (FK → pipeline_runs) | |
| stage | TEXT | Stage name |
| status | TEXT | `started` \| `completed` \| `failed` \| `waiting` |
| message | TEXT | Human-readable status |
| data | JSONB | Stage-specific output |
| timestamp | TIMESTAMPTZ | |

**`approvals`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| run_id | UUID (FK → pipeline_runs) | |
| checkpoint | ENUM | `quality` \| `compliance` \| `translation` \| `publish` |
| status | ENUM | `pending` \| `approved` \| `rejected` |
| channel | ENUM | `web` \| `telegram` \| `slack` \| `teams` |
| summary | TEXT | What the approver sees |
| token | TEXT (UNIQUE) | Deep-link token for one-tap approval |
| decided_by | UUID (FK → users, nullable) | |
| decided_at | TIMESTAMPTZ | |

**`reports`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| run_id | UUID (FK → pipeline_runs) | |
| tenant_id | UUID (FK → tenants) | |
| instrument_id | UUID (FK → instruments) | |
| level | ENUM | `beginner` \| `intermediate` \| `professional` |
| language | TEXT | ISO 639-1 code |
| content | JSONB | Structured report content |
| storage_path | TEXT | Supabase Storage path |
| created_at | TIMESTAMPTZ | |

**`glossaries`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| name | TEXT | e.g., "OANDA Japanese Glossary" |
| language | TEXT | ISO 639-1 |
| terms | JSONB | `{ "margin call": "マージンコール", ... }` |
| tone | TEXT | Formal/casual/institutional |
| brand_rules | TEXT | Additional translation guidelines |

**`glossary_corrections`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| glossary_id | UUID (FK → glossaries) | |
| tenant_id | UUID (FK → tenants) | |
| english_term | TEXT | |
| original | TEXT | AI translation |
| corrected | TEXT | Human correction |
| corrected_by | UUID (FK → users) | |
| applied_at | TIMESTAMPTZ | |

**`news_articles`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| headline | TEXT | |
| summary | TEXT | |
| source | TEXT | |
| url | TEXT | |
| sentiment | FLOAT | |
| category | TEXT | |
| embedding | VECTOR(1536) | |
| published_at | TIMESTAMPTZ | |
| fetched_at | TIMESTAMPTZ | |

**`audit_log`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | |
| tenant_id | UUID (FK → tenants) | |
| user_id | UUID (FK → users, nullable) | |
| action | TEXT | `approval.approved`, `report.published`, etc. |
| resource_type | TEXT | |
| resource_id | UUID | |
| details | JSONB | |
| timestamp | TIMESTAMPTZ | |

---

## 7. HITL Workflow

### 7.1 Checkpoint Overview

| # | Checkpoint | After Stage | Approver | Required? | Timeout Behavior |
|---|-----------|-------------|----------|-----------|-----------------|
| 1 | Analyst Review | Quality Arbitration | Client analyst/editor | Optional (per plan) | Stale reminder at 2h |
| 2 | Compliance Sign-off | Compliance Review | Licensed compliance officer | Required | Escalate after 4h |
| 3 | Translation Review | Translation | WordwideFX translator | Optional (adaptive) | English-only if 24h timeout |
| 4 | Publish Authorization | Report Generation | Client's authorized publisher | Required | Holds indefinitely |

### 7.2 Channel-Agnostic Approval Service

```typescript
interface ApprovalService {
  request(approval: ApprovalRequest): Promise<string>;  // returns approval ID
  decide(id: string, decision: Decision): Promise<void>;
  onDecision(id: string, callback: (decision: Decision) => void): void;
}

type Decision = {
  status: 'approved' | 'rejected';
  feedback?: string;
  corrections?: Record<string, string>;
  decidedBy: string;
};
```

The service dispatches approval requests to the configured channel (web, Telegram, Slack). The pipeline pauses at the checkpoint, writes to the `approvals` table, and resumes when a webhook callback is received.

### 7.3 Token-Based Deep Links

Each approval generates a unique token. The URL `/approve/{token}` renders a mobile-first approval page (no login required — the token IS the auth). This enables one-tap approvals from Telegram notifications, email links, or SMS.

### 7.4 Adaptive Translation Review

The translation HITL percentage decreases automatically based on correction rate:

- If < 5% of translations are corrected in a rolling 30-day window, reduce review percentage by 10%
- Minimum review percentage: 10% (spot-check mode)
- Client can override to maintain 100% review at any time
- All corrections feed into `glossary_corrections` and are applied to future translations

---

## 8. Translation Engine

Translation is the core competitive advantage of FinFlow. Unlike competitors who bolt on generic machine translation, FinFlow's translation agents are deeply personalized per client and per language, backed by 15 years of financial translation expertise from WordwideFX.

### 8.1 Per-Language Model Routing

All translation uses API-based LLMs. Model selection is optimized per language tier for quality and personalization adherence.

**Tier 1: European Languages** (EN, DE, FR, ES, IT, PT, NL, PL, SV, DA, NO, FI, etc.)

| Model | Role | Cost/Language/Report |
|-------|------|---------------------|
| Claude Sonnet 4 | **Primary** — best instruction adherence for glossary/tone/voice constraints | ~$0.07 |
| GPT-4o | Fallback — comparable quality, slightly more "creative" deviations from style | ~$0.06 |
| DeepL API | Optional QA cross-reference — flags divergences for review | ~$0.02 |

**Tier 2: CJK Languages** (Chinese, Japanese, Korean)

| Model | Role | Cost/Language/Report |
|-------|------|---------------------|
| GPT-4o / GPT-4.1 | **Primary for Chinese** — strongest financial Chinese training data | ~$0.07 |
| Claude Sonnet 4 | **Primary for Japanese** — best keigo/formality control via instructions | ~$0.07 |
| Gemini 2.5 Pro | **Primary for Korean** — Google's strong Korean training data | ~$0.07 |

**Tier 3: Arabic / RTL Languages** (Arabic, Hebrew, Farsi)

| Model | Role | Cost/Language/Report |
|-------|------|---------------------|
| GPT-4o | **Primary** — best MSA financial content | ~$0.07 |
| Claude Sonnet 4 | Secondary — strong instruction-following for dialect specification | ~$0.07 |

**Tier 4: South/Southeast Asian** (Hindi, Thai, Vietnamese, Bahasa, etc.)

| Model | Role | Cost/Language/Report |
|-------|------|---------------------|
| Gemini 2.5 Pro | **Primary** — Google's regional language strength | ~$0.07 |
| GPT-4o | Fallback | ~$0.06 |
| Google Cloud Translation | Baseline fallback for languages where LLMs are unreliable | ~$0.02 |

**Volume/Draft Tier** (internal summaries, lower-priority content)

| Model | Role | Cost/Language/Report |
|-------|------|---------------------|
| GPT-4o-mini | Draft translations — adequate glossary adherence | ~$0.003 |
| Gemini 2.0 Flash | Ultra-cheap drafts | ~$0.002 |

### 8.2 Translation Personalization Architecture

The translation agent is the most heavily personalized agent in the pipeline. Each translation call is constructed with a structured system prompt:

```
[ROLE]
You are a financial translation specialist for {client_name}.
You have been translating their content for years and know their voice intimately.

[TONE PROFILE]
Register: {formal | approachable | institutional | retail-friendly}
Aggressiveness: {conservative | moderate | aggressive}
Style notes: {client-specific style guide excerpts}

[GLOSSARY — {language}]
{english_term}: {approved_translation}
{english_term}: {approved_translation}
... (top 50-100 client-specific terms for this language)

[BRAND VOICE EXAMPLES]
{2-3 actual paragraphs from the client's existing published content in the target language}

[CONSTRAINTS]
- Terms to NEVER use: {avoid_terms}
- Formatting: {locale-specific rules — decimal separators, date formats, number grouping}
- Content restrictions: {what to omit or soften based on client's internal policies}

[SOURCE DOCUMENT]
{English report to translate}
```

Claude Sonnet 4 is the primary model because it demonstrates the highest fidelity to these multi-layered instructions. In testing, it maintains glossary term usage, tone consistency, and style constraints across documents of 5,000+ words without instruction drift.

### 8.3 Translation Pipeline

1. Load `ClientProfile` for the target tenant
2. Load client-specific glossary for target language from `glossaries` table
3. Load tone profile, brand voice examples, and content constraints
4. Select optimal model for this language tier
5. Construct personalized translation prompt (see architecture above)
6. Execute translation with selected model (streaming for UI responsiveness)
7. **Post-process validation:**
   - Verify glossary terms were used correctly (automated term-matching)
   - Validate number/date formatting per locale (e.g., `1.1602` → `1,1602` for EU)
   - Flag any content that appears to deviate from brand voice constraints
   - Optional: run DeepL/Google NMT in parallel, flag significant divergences
8. If HITL is active for this language: create approval request with highlighted changes
9. If corrected by human reviewer: store corrections in `glossary_corrections`, apply to glossary for next run

### 8.4 Translation Learning Loop

```
Client profile loaded (tone, glossary, brand voice, constraints)
        ↓
AI translates with full personalization context
        ↓
Human reviewer checks output
        ↓
Corrections stored in glossary_corrections table
        ↓
Glossary + brand voice examples updated
        ↓
Next translation uses enriched profile
        ↓
Fewer corrections needed → HITL percentage decreases automatically
        ↓
System measurably improves → client sees correction rate declining
        ↓
Switching cost grows every month (competitor starts from zero)
```

### 8.5 Cost Estimates Per Report (40 languages)

| Strategy | Model Mix | Est. Cost | Quality |
|----------|-----------|-----------|---------|
| **Premium** (all languages via Sonnet/GPT-4o) | Tier 1-3 models for all | ~$2.80 | Highest — full personalization |
| **Hybrid** (top 10 via Sonnet, rest via mini) | Sonnet + GPT-4o-mini | ~$1.00 | High for key languages, adequate for rest |
| **Budget** (all via GPT-4o-mini) | GPT-4o-mini only | ~$0.12 | Adequate — glossary adherence but weaker tone control |

Recommended default: **Premium** for Hybrid/Enterprise plans, **Hybrid** for Automated plan.

---

## 9. Frontend Architecture

### 9.1 Framework & Tooling

- **Next.js 14** with App Router
- **Tailwind CSS** with CSS custom properties for white-label theming per tenant
- **shadcn/ui + Radix UI** for accessible component primitives
- **Supabase client** for auth, real-time subscriptions, and storage

### 9.2 Design System

Aesthetic: **Bloomberg Terminal meets Linear.app meets Apple.** Dark, muted, professional. No bright colors, no AI aesthetic, no playful elements.

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg-root` | `#060608` | Root background — near-black with blue undertone |
| `--bg-surface` | `#0f0f14` | Card/panel backgrounds |
| `--accent` | `#5ba8a0` | Muted teal — primary interactive color |
| `--text-primary` | `#e8e6e3` | Primary text — warm off-white |
| `--text-muted` | `#4a4a50` | Tertiary text |
| `--border` | `rgba(255,255,255,0.06)` | Barely visible structural borders |
| `--font-serif` | Playfair Display | Headings — editorial feel |
| `--font-sans` | Inter | UI text |
| `--font-mono` | JetBrains Mono | Data, prices, timestamps |

### 9.3 Animation Stack (~160KB total, code-split per route)

| Library | Size | Purpose |
|---------|------|---------|
| Framer Motion | ~35KB | Page transitions, card enter/exit, layout animations, gestures |
| GSAP + ScrollTrigger | ~28KB | Pipeline timeline animations, data streaming effects |
| TradingView Lightweight Charts | ~45KB | All interactive financial charts |
| Nivo | ~40KB | Dashboard KPI charts with animated transitions |
| Aceternity UI (cherry-pick) | ~10KB | Spotlight cards, background effects — hero moments only |
| Magic UI (cherry-pick) | ~5KB | Number tickers, animated borders |

### 9.4 Screens

| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 1 | Login | `/(auth)/login` | Supabase Auth, ambient glow, centered card |
| 2 | Data Sources | `/(dashboard)/sources` | 3-tier source cards, live scan activity bars, connection status |
| 3 | Command Center | `/(dashboard)/command` | Live event feed, suggestion chips (client picks here), active pipelines sidebar |
| 4 | Pipeline Monitor | `/(dashboard)/pipeline` | 3-column: stage sidebar + event stream + detail panel |
| 5 | Report Viewer | `/(dashboard)/reports` | Audience tabs, language switcher, compliance bar, TradingView charts |
| 6 | HITL Approval | `/approve/[token]` | Mobile-first, token-based, big approve/correct/reject buttons |
| 7 | Glossary Manager | `/(dashboard)/glossary` | Searchable table, human/AI correction badges, CSV import |
| 8 | Onboarding Wizard | `/onboarding` | 5-step: Company → Branding → Instruments → Languages → Compliance |
| 9 | Admin Panel | `/(dashboard)/admin` | Platform KPIs, client list, pipeline health, LLM cost tracking |
| 10 | Public Report | `/reports/[id]` | SSR, SEO-optimized, shareable report viewer |

### 9.5 Key Animation Patterns

- **Event cards:** Slide in from bottom with spring physics (`eventSlide`)
- **Pipeline flow:** Nodes light up sequentially (stagger), data streams between them (GSAP timeline)
- **Stage transitions:** Running dot pulses with expanding glow ring, complete morphs to checkmark
- **HITL waiting:** Ripple pulse expanding from approval dot, gentle bounce on icon
- **KPI counters:** Number ticker rolls on mount, smooth interpolation on updates
- **Scan activity:** Animated bar chart showing real-time source activity
- **Page transitions:** View Transitions API (progressive enhancement) + Framer Motion layout

---

## 10. Multi-Tenancy & Security

### 10.1 Tenant Isolation

- **Database:** Row-Level Security (RLS) on all tenant-scoped tables. Every query is automatically filtered by `tenant_id` extracted from the authenticated user's JWT.
- **API middleware:** Tenant context middleware extracts `tenant_id` from Supabase JWT, sets RLS context, and injects it into all downstream operations.
- **Storage:** Supabase Storage buckets scoped per tenant (`/{tenant_id}/reports/`, `/{tenant_id}/charts/`).
- **API keys:** Encrypted at rest using AES-256. Client-provided API keys (Polygon, Bloomberg) are never exposed in logs or API responses.

### 10.2 Authentication

- **Frontend:** Supabase Auth (email/password, SSO for Enterprise)
- **HITL approvals:** Token-based (no login required — the token IS the auth)
- **API (Enterprise):** API key authentication for programmatic access
- **Roles:** `admin`, `editor`, `viewer`, `compliance_officer` — enforced at both API and RLS level

### 10.3 White-Label Branding

Per-tenant branding via Tailwind CSS custom properties:
- Logo URL, company name
- Primary/secondary/accent colors
- Font overrides
- Chart theme (candlestick colors, background)
- Email template customization
- PDF header/footer branding

Branding is stored in `tenants.branding` (JSONB) and injected via middleware into every response.

---

## 11. Infrastructure

### 11.1 Docker Compose (Development & Self-Hosted)

```yaml
services:
  api:          # Bun + Hono (TypeScript API)
  data-service: # Python + FastAPI
  web:          # Next.js frontend
  redis:        # BullMQ broker + cache
  # Supabase runs separately (managed or self-hosted)
```

### 11.2 Production Deployment Options

| Option | Target | Notes |
|--------|--------|-------|
| **Managed** | WordwideFX-hosted | Supabase Cloud, Fly.io/Railway for API, Vercel for frontend |
| **Self-hosted** | Enterprise clients | Docker Compose + env vars, client's infrastructure |
| **Kubernetes** | Large-scale | Helm chart (Phase 5) |

### 11.3 Observability (Phase 5)

- Structured logging (JSON, correlation IDs per pipeline run)
- OpenTelemetry tracing (API → agents → Python service)
- Error alerting (Sentry or equivalent)
- LLM cost tracking per tenant, per pipeline run
- Pipeline health dashboard (Grafana)

---

## 12. API Surface

### 12.1 REST Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/events` | SSE — live event feed |
| `GET` | `/api/suggestions` | List pending suggestions for tenant |
| `POST` | `/api/suggestions/:id/run` | Accept suggestion → launch pipeline |
| `POST` | `/api/suggestions/:id/dismiss` | Dismiss suggestion |
| `GET` | `/api/pipeline/:id/events` | SSE — pipeline stage events |
| `GET` | `/api/pipeline` | List pipeline runs for tenant |
| `POST` | `/api/pipeline/run` | Manual pipeline trigger |
| `GET` | `/api/approvals` | List pending approvals |
| `POST` | `/api/approvals/:id/decide` | Submit approval decision |
| `GET` | `/api/reports` | List reports for tenant |
| `GET` | `/api/reports/:id` | Get report content |
| `CRUD` | `/api/instruments` | Manage instruments |
| `CRUD` | `/api/glossaries` | Manage glossaries |
| `CRUD` | `/api/sources` | Manage data source configurations |
| `GET` | `/api/admin/stats` | Platform KPIs (WordwideFX admin only) |

### 12.2 SSE Event Format

```typescript
// Pipeline events (GET /api/pipeline/:id/events)
interface PipelineSSE {
  type: 'stage_started' | 'stage_completed' | 'stage_failed'
      | 'agent_output' | 'deliberation' | 'approval_requested'
      | 'approval_decided' | 'pipeline_completed' | 'pipeline_failed';
  stage: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// Event feed (GET /api/events)
interface EventSSE {
  type: 'new_event' | 'new_suggestion' | 'suggestion_updated';
  data: MarketEvent | ReportSuggestion;
  timestamp: string;
}
```

### 12.3 Real-Time (Supabase)

In addition to SSE for pipeline streaming, Supabase Realtime subscriptions are used for:
- New suggestions appearing in Command Center
- Approval status changes
- Report availability notifications

---

## 13. LLM Cost Model

All inference is API-based. Costs are optimized through intelligent model routing — each task uses the most cost-efficient model that meets the quality bar for that task.

### Per-Report Breakdown (assuming 10 languages)

| Task | Model | Cost |
|------|-------|------|
| News classification | Haiku | ~$0.02 |
| Technical Analysis | Sonnet | ~$0.15 |
| Fundamental Analysis | Sonnet | ~$0.15 |
| Quality Arbitration | Opus (Enterprise) / Sonnet | ~$0.80 / ~$0.15 |
| Deliberation rounds (2x) | Sonnet | ~$0.20 |
| Compliance review | Sonnet | ~$0.10 |
| Personalization / rewriting | Sonnet | ~$0.10 |
| Translation (10 langs, Premium) | Sonnet / GPT-4o mix | ~$0.70 |
| Translation (10 langs, Hybrid) | Sonnet (top 3) + GPT-4o-mini (7) | ~$0.23 |
| **Total (Enterprise, 10 langs, Premium)** | | **~$2.22** |
| **Total (Hybrid, 10 langs)** | | **~$1.10** |
| **Total (Automated, 10 langs)** | | **~$0.95** |

### Scaling to 40 Languages

| Strategy | 40-Lang Translation Cost | Total Report Cost (Enterprise) |
|----------|------------------------|-------------------------------|
| Premium (all Sonnet/GPT-4o) | ~$2.80 | ~$4.32 |
| Hybrid (top 10 Sonnet + 30 mini) | ~$1.00 | ~$2.52 |
| Budget (all GPT-4o-mini) | ~$0.12 | ~$1.64 |

### At Scale

| Scale | Reports/Day | Monthly LLM Cost | Monthly Revenue | Gross Margin |
|-------|------------|-------------------|-----------------|-------------|
| 10 clients | 20 | ~$1,500 | $20K+ | 92% |
| 50 clients | 100 | ~$7,500 | $100K+ | 92% |
| 100 clients | 200 | ~$15,000 | $200K+ | 92% |

**Key insight:** Even with all-API translation, gross margins remain >90% because the personalization moat supports premium pricing. Clients pay for their unique voice, not generic AI output. As API costs continue declining (industry trend: ~30% YoY price drops), margins improve automatically.

---

## 14. Phased Implementation

### Phase 1: Foundation (Weeks 1–3)

**Goal:** Standing infrastructure — TypeScript API + Python data service + database + basic scanning.

- Initialize Bun workspace with `packages/api`, `packages/data-service`, `packages/web`
- Supabase project with initial migration (all core tables + RLS policies)
- TypeScript API skeleton: Hono router, Supabase JWT auth middleware, tenant context middleware
- Instrument, glossary, data source CRUD routes
- Python data service: port `market_data.py`, `news_scraper.py`, `generate_charts.py`
- Scanner foundation: `DataSource` base interface + Finnhub adapter, BullMQ scheduled scan (every 5min), event detection with Haiku classification, pgvector embedding + semantic dedup
- Docker Compose: api (Bun), data-service (Python), Redis
- Seed DB with instruments (EUR/USD, Gold, Oil) + glossaries

**Verification:** `curl` API endpoints, confirm CRUD + RLS isolation, verify Python service returns indicators/charts, confirm scanner detects and stores events.

### Phase 2: Agent Pipeline + Suggestions (Weeks 3–5)

**Goal:** Full agent pipeline + auto-suggestion system.

- Agent base class (from GoBot patterns): Claude API streaming, structured output via `tool_use`, retry + token tracking
- Model router: Haiku for triage, Sonnet for TA/FA/Compliance/Translation, Opus for arbitration
- Port all agent system prompts from Python prototype to TypeScript
- Report suggestion engine: high/medium events → determine affected instruments → generate suggestions → push via Supabase Realtime
- Pipeline orchestrator: 12-stage sequential pipeline with SSE event emission, state persistence, rejection/reprocessing loops
- BullMQ pipeline jobs with per-tenant concurrency

**Verification:** Event detected → suggestion created → selected → pipeline runs → SSE streams agent output → deliberation occurs → results persisted.

### Phase 3: HITL + Reports + Frontend (Weeks 5–7)

**Goal:** Human approval workflow + report generation + interactive frontend.

- Channel-agnostic `ApprovalService`: dispatches to web or Telegram, token-based deep links, pipeline pause/resume
- Telegram adapter (grammy): inline buttons, auto-approval timeout
- Web approval page at `/approve/[token]` (mobile-first)
- Report generation: TS orchestrator calls Python data-service for charts, HTML rendering, 3 audience levels, Supabase Storage
- Next.js frontend: Login, Data Sources, Command Center, Pipeline Monitor, Report Viewer, HITL Approval

**Verification:** Full flow: event → suggestion → Command Center → select → pipeline → Telegram notification → approve → report viewable. Test rejection → reprocessing.

### Phase 4: Demo Polish (Weeks 7–9)

**Goal:** Demo-ready product for prospect presentations.

- Additional source adapters (Economic Calendar, Yahoo Finance)
- Compliance agent with all 7 jurisdictions
- Multi-language output (EN, ES, ZH — port glossaries)
- White-label branding (per-tenant CSS variables, logo, colors)
- Interactive TradingView Lightweight Charts in report viewer
- Pipeline demo mode (pre-cached data for instant demos)
- Onboarding wizard (5-step)
- Admin panel (tenant list, pipeline health, usage stats, LLM cost tracking)
- Translation learning loop (`glossary_corrections` fed back to agent)

**Verification:** Full demo: configure new tenant → set sources + instruments → events auto-detected → suggestions → approve → view white-labeled report in 3 languages/3 levels → interactive charts.

### Phase 5: Production Readiness (Weeks 9–12)

**Goal:** Secure, scalable, ready for paying clients.

- Multi-channel distribution (email via SendGrid, PDF export, blog API push)
- Slack + MS Teams approval adapters
- Premium data source adapters (Polygon.io WebSocket, Bloomberg)
- Audit trail + GDPR compliance (data export, deletion per tenant)
- API key authentication (Enterprise)
- Rate limiting per tenant/plan
- Observability (structured logging, OpenTelemetry, error alerting)
- Self-hosted deployment guide (Docker Compose + env vars + Helm chart)
- Security review (RLS validation, input sanitization, auth hardening)

**Verification:** Security (tenant isolation), load (concurrent pipelines), email/PDF distribution, self-hosted Docker deploy on clean machine.

---

## 15. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM hallucination in financial content | High | Critical | Compliance agent gate; all claims must cite data; HITL before publish; explicit "not financial advice" disclaimers |
| Regulatory liability | Medium | Critical | "Informational purposes only" positioning; compliance templates per jurisdiction; external legal review |
| Data source API changes/outages | Medium | High | Multiple sources per data type; circuit breaker pattern; graceful degradation to cached data |
| Client data isolation failure | Low | Critical | Supabase RLS on all tables; tenant middleware; penetration testing; separate storage buckets |
| LLM API cost at scale | Medium | Medium | Intelligent model routing (Haiku/mini for triage, Sonnet for quality); daily budget tracking per tenant; per-client cost caps; model downgrade fallbacks; API costs trending down ~30% YoY |
| Translation quality for niche languages | Medium | Medium | Start with top 10 languages; HITL mandatory for new language pairs; correction feedback loop; fallback to NMT for unreliable LLM languages |
| Pipeline latency exceeding 30-min target | Medium | High | Parallel agent execution where possible; cached market data; pre-computed indicators; streaming SSE for perceived responsiveness |
| Personalization profile drift | Low | Medium | Periodic human review of output quality; correction rate monitoring per client; alert if correction rate increases after a period of decline |

---

## Appendix A: Project Structure

```
finflow/
├── packages/
│   ├── api/                          # TypeScript API (Bun + Hono)
│   │   ├── src/
│   │   │   ├── scanner/              # 24/7 data source scanning
│   │   │   │   ├── sources/          # Source adapters
│   │   │   │   │   ├── base.ts       # DataSource interface
│   │   │   │   │   ├── finnhub.ts
│   │   │   │   │   ├── calendar.ts
│   │   │   │   │   ├── polygon.ts
│   │   │   │   │   └── bloomberg.ts
│   │   │   │   ├── detector.ts       # Event detection + impact classification
│   │   │   │   ├── dedup.ts          # Semantic dedup (pgvector)
│   │   │   │   └── suggester.ts      # Auto-suggest reports
│   │   │   ├── agents/
│   │   │   │   ├── base.ts           # Agent base class
│   │   │   │   ├── ta-agent.ts       # Technical Analysis
│   │   │   │   ├── fa-agent.ts       # Fundamental Analysis
│   │   │   │   ├── quality-agent.ts  # Arbitration + deliberation
│   │   │   │   ├── compliance-agent.ts
│   │   │   │   └── translation-agent.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── orchestrator.ts   # Main pipeline
│   │   │   │   ├── stages.ts         # Stage definitions
│   │   │   │   └── events.ts         # SSE event system
│   │   │   ├── hitl/
│   │   │   │   ├── approval.ts       # Channel-agnostic approval service
│   │   │   │   ├── telegram.ts       # Telegram adapter (grammy)
│   │   │   │   ├── slack.ts          # Slack adapter (Phase 5)
│   │   │   │   └── web.ts            # Web UI adapter
│   │   │   ├── lib/
│   │   │   │   ├── cross-agent.ts    # [INVOKE:] tag parsing
│   │   │   │   ├── model-router.ts   # Tiered LLM selection
│   │   │   │   ├── tenant.ts         # Multi-tenant middleware
│   │   │   │   └── supabase.ts       # DB client with RLS
│   │   │   ├── routes/               # Hono API routes
│   │   │   ├── jobs/                 # BullMQ job definitions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── data-service/                 # Python microservice (FastAPI)
│   │   ├── app/
│   │   │   ├── market_data.py
│   │   │   ├── news_scraper.py
│   │   │   ├── indicators.py
│   │   │   ├── charts.py
│   │   │   └── main.py
│   │   └── requirements.txt
│   │
│   └── web/                          # Next.js frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/login/
│       │   │   ├── (dashboard)/
│       │   │   │   ├── sources/
│       │   │   │   ├── command/
│       │   │   │   ├── pipeline/
│       │   │   │   ├── reports/
│       │   │   │   ├── instruments/
│       │   │   │   ├── glossary/
│       │   │   │   └── admin/
│       │   │   ├── approve/[token]/
│       │   │   ├── onboarding/
│       │   │   └── reports/[id]/
│       │   ├── components/
│       │   │   ├── ui/               # shadcn/ui primitives
│       │   │   ├── scanner/
│       │   │   ├── suggestions/
│       │   │   ├── pipeline/
│       │   │   ├── reports/
│       │   │   └── hitl/
│       │   └── lib/
│       │       ├── supabase.ts
│       │       ├── sse.ts
│       │       └── api.ts
│       ├── package.json
│       └── next.config.ts
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
│
├── docker-compose.yml
├── package.json                      # Workspace root (Bun workspaces)
└── README.md
```

---

## Appendix B: GoBot Patterns to Adapt

| GoBot File | FinFlow Equivalent | What to Copy |
|-----------|-------------------|--------------|
| `src/agents/base.ts` | `packages/api/src/agents/base.ts` | Agent config, streaming, structured output |
| `src/lib/cross-agent.ts` | `packages/api/src/lib/cross-agent.ts` | `[INVOKE:]` tag parsing for deliberation |
| `src/lib/board/orchestrator.ts` | `packages/api/src/pipeline/orchestrator.ts` | Sequential agent execution |
| `src/lib/model-router.ts` | `packages/api/src/lib/model-router.ts` | Tiered model selection |
| `src/lib/board/decisions.ts` | `packages/api/src/hitl/approval.ts` | Inline approval system |
| `src/scheduler/executor.ts` | `packages/api/src/jobs/scan.ts` | BullMQ scheduled jobs |
| `src/lib/task-queue.ts` | `packages/api/src/jobs/pipeline.ts` | Async task management |

## Appendix C: Python Prototype Files to Port

| Prototype File | Target | Strategy |
|---------------|--------|----------|
| `finflow/agents/*.py` (system prompts) | TS agents | Copy prompts, rewrite parsing to `tool_use` |
| `finflow/data/market_data.py` | `packages/data-service/app/market_data.py` | Port directly |
| `finflow/data/news_scraper.py` | `packages/data-service/app/news_scraper.py` | Port directly |
| `finflow/output/generate_charts.py` | `packages/data-service/app/charts.py` | Port directly |
| `finflow/output/generate_reports.py` | React components | Adapt templates |
| `finflow/hitl/telegram_bot.py` | `packages/api/src/hitl/telegram.ts` | Port to TS with grammy |
| `finflow/instruments.py` | DB seed data | Extract to migration |
| `finflow/glossaries/*.json` | DB seed data | Import to `glossaries` table |
