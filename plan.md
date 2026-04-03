# FinFlow Production Application — Implementation Plan

**Date**: 2026-03-27
**Status**: Planning complete, ready for implementation
**UI Mockup**: `mockup/finflow-ui-mockup.html` (open in browser for interactive preview)

---

## Context

FinFlow is WordwideFX's pivot from human financial translation to an AI-powered financial content platform. The product deck at https://agaleraib.github.io/finflow-deck/ defines the full vision. A Python prototype (~6,100 lines) exists in `finflow/` for reference. The Translation Engine has been migrated to TypeScript in `packages/api/src/` (24 files, ~2,900 lines). Patterns adapted from upstream GoBot (`autonomee/gobot`).

**Key decisions:**
- **Pure TypeScript architecture**: Bun runtime + Hono API + Zod validation + Anthropic SDK with tool_use. No Python sidecar — TS alternatives exist for all data/charting needs (yahoo-finance2, arquero, plotly.js+kaleido, technicalindicators)
- **Standalone project**: Adapt GoBot's architectural patterns (AgentConfig, INVOKE, model-router), no runtime dependency on GoBot
- **Database deferred**: Convex vs Supabase TBD. Repository pattern with in-memory store for dev. GoBot community migrated to Convex (Feb 2026) for TS-everywhere benefits
- **Target**: Demo-ready product first, then pursue clients
- **Data sources**: 3-tier model (Essential free / Professional client-keys / Institutional client-license)
- **UI**: Premium dark theme, Bloomberg meets Linear.app, spectacular animations, no AI aesthetic

---

## Core Workflow (Autonomous, Event-Driven)

FinFlow is an **always-on intelligence engine**, not a manually-triggered tool. The system scans 24/7 and proactively suggests reports.

```
[24/7 Data Source Scanning]
  Essential (included):    Finnhub, Economic Calendar, Yahoo Finance
  Professional (client keys): Polygon.io, Benzinga, TradingView Webhooks
  Institutional (client license): Bloomberg API, Reuters/Refinitiv
        │
        ▼
[Event Detection + Impact Analysis]
  Classifies events: breaking / high / medium / low / noise
  Determines which instruments are affected
  Semantic dedup via pgvector embeddings
        │
        ▼
[Suggested Reports Queue]
  Auto-generates 1-3 report suggestions per event
  Shows: affected pair/commodity, expected direction, impact level
  *** CLIENT PICKS which suggestions to run *** ← primary interaction
        │
        ▼
[Pipeline Executes for Selected]
  TA Agent ↔ FA Agent deliberation (max 3 rounds)
  Quality Arbitration (consensus or documented disagreement)
  HITL: Analyst Review (optional per package)
  Compliance Review (per jurisdiction: MiFID II, SEC, FCA, ASIC, MAS)
  HITL: Compliance Sign-off (required)
  Translation (40+ languages, client glossaries + tone profiles)
  HITL: Translation Review (optional, adaptive 100%→10% over 12 months)
  Report Generation (3 audience levels: beginner/intermediate/professional)
  HITL: Publish Authorization (required)
        │
        ▼
[Distribution]
  Email (SendGrid), Blog (WordPress/Ghost API), Social (Twitter, LinkedIn, Telegram)
  PDF export, Webhook (generic POST) — all channels, all languages, all branded
```

---

## UI Design System

### Aesthetic
Bloomberg Terminal meets Linear.app meets Apple. Dark, muted, professional. No bright colors, no AI aesthetic, no playful elements. Motion communicates state changes — never decorative.

### Design Tokens
- **Backgrounds**: Near-black with blue undertone (`#060608` → `#1a1a22`) for depth
- **Accent**: Muted teal `#5ba8a0` (from prototype, not bright)
- **Semantic**: Desaturated — success `#4a9a6a`, danger `#c96b6b`, warning `#c9a85b`, info `#6b8fc9`
- **Typography**: Inter (UI), Playfair Display (headings), JetBrains Mono (data/prices)
- **Spacing**: 4px grid, generous whitespace (16-24px card padding)
- **Borders**: `rgba(255,255,255,0.06)` — barely visible structure
- **Radius**: 6-16px range

### Animation Stack (~160KB total, code-split per route)
| Library | Size | Purpose |
|---|---|---|
| **Framer Motion** | ~35KB | Page transitions, card enter/exit, layout animations, gestures |
| **GSAP + ScrollTrigger** | ~28KB | Pipeline timeline animations, data streaming effects |
| **TradingView Lightweight Charts** | ~45KB | All financial charts (dark by default) |
| **Nivo** | ~40KB | Dashboard KPI charts (animated transitions) |
| **Aceternity UI** (cherry-pick) | ~10KB | Spotlight cards, background effects — hero moments only |
| **Magic UI** (cherry-pick) | ~5KB | Number tickers, animated borders |

### UI Component Foundation
- **shadcn/ui + Radix UI** — Accessible primitives, zero runtime, full customization
- **Tailwind CSS** — Utility-first, CSS variables for white-label theming per tenant

### Screens (in workflow order)
1. **Login** — Centered card, ambient glow, grid background, fadeUp animation
2. **Data Sources** — 3-tier source cards (Essential/Professional/Institutional), live scan activity bars, connection status pulses, scan KPIs
3. **Command Center** — Live event feed with impact classification, auto-suggested report chips per event (client selects which to run). Right sidebar: active pipelines with progress bars + queue + daily stats. Scanning status bar at top.
4. **Pipeline Monitor** — 3-column: stage sidebar with dots/connectors + event stream with agent blocks/deliberation cards + detail panel with consensus/cost/chart
5. **Report Viewer** — Audience level tabs (Beginner/Intermediate/Professional), language switcher, compliance approval bar, TradingView chart, analysis sections, scenario cards
6. **HITL Approval** — Mobile-first, token-based deep link, compliance flags, big approve/correct/reject buttons
7. **Glossary Manager** — Searchable table, human/AI correction badges, language filter tabs, import CSV
8. **Onboarding Wizard** — 5-step progress (Company → Branding → Instruments → Languages → Compliance), live preview, plan limit indicator
9. **Admin Panel** — Platform KPIs (clients, reports, LLM cost, automation rate), client list with tiers, pipeline health
10. **Animation Demos** — Reference implementations: pipeline flow, data streaming, number ticker, approval pulse

### Key Animation Patterns
- **Event cards**: Slide in from bottom with spring physics (Framer Motion `eventSlide`)
- **Pipeline flow**: Nodes light up sequentially (stagger), data streams between them (GSAP timeline)
- **Stage transitions**: Running dot pulses with expanding glow ring, complete morphs to checkmark
- **HITL waiting**: Ripple pulse expanding from approval dot, gentle bounce on icon
- **KPI counters**: Number ticker rolls on mount (Magic UI), smooth interpolation on updates
- **Scan activity**: Animated bar chart showing real-time source activity
- **Page transitions**: View Transitions API (progressive enhancement) + Framer Motion layout

---

## Architecture

```
                        ┌─────────────────────────┐
                        │   Next.js Frontend       │
                        │   (Command Center,       │
                        │    Pipeline, Reports,    │
                        │    HITL, Admin)           │
                        └────────┬─────────────────┘
                                 │
                        ┌────────▼─────────────────┐
                        │   TypeScript API (Bun)    │
                        │   Hono router             │
                        │   ─ Agent orchestration   │
                        │   ─ Event scanner/detector│
                        │   ─ Report suggestion     │
                        │   ─ HITL workflows        │
                        │   ─ Auth / Multi-tenant   │
                        │   ─ BullMQ job queues     │
                        └──┬─────────┬─────────────┘
                           │         │
              ┌────────────▼──┐  ┌───▼──────────────┐
              │  Database     │  │  TS Data Layer   │
              │  (TBD:       │  │  ─ yahoo-finance2│
              │  Convex or   │  │  ─ technicalind. │
              │  Supabase)   │  │  ─ plotly+kaleido│
              │  ─ Auth      │  │  ─ arquero       │
              │  ─ Realtime  │  │  ─ finnhub       │
              └───────────────┘  └───────────────────┘
                                         │
                                    ┌────▼────┐
                                    │  Redis  │
                                    │ (BullMQ │
                                    │  Cache) │
                                    └─────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **API/Orchestration** | TypeScript + Bun + Hono | GoBot patterns, agent orchestration, async-first |
| **Job Queue** | BullMQ + Redis | Scheduled scanning, pipeline jobs, concurrent multi-tenant |
| **AI Agents** | @anthropic-ai/sdk (tool_use for structured output) | Claude Haiku/Sonnet/Opus per task via model-router |
| **Data Processing** | yahoo-finance2 + technicalindicators + arquero | Pure TS — market data, indicators, OHLCV transforms |
| **Database** | TBD: Convex or Supabase | Repository pattern (in-memory for dev). Convex = TS-everywhere; Supabase = PostgreSQL + pgvector |
| **Frontend** | Next.js 14 + Tailwind + shadcn/ui | SSR for reports, responsive HITL approvals |
| **Charts (interactive)** | TradingView Lightweight Charts | Financial-grade, themeable, open-source |
| **Charts (static)** | plotly.js + kaleido | Server-side PNG/SVG without Puppeteer |
| **Cache/Broker** | Redis 7 | BullMQ broker + data/news caching |

---

## Project Structure

```
finflow/
├── packages/
│   ├── api/                          # TypeScript API (Bun + Hono)
│   │   ├── src/
│   │   │   ├── scanner/              # 24/7 data source scanning
│   │   │   │   ├── sources/          # Source adapters (Finnhub, Polygon, Bloomberg...)
│   │   │   │   │   ├── base.ts       # DataSource interface
│   │   │   │   │   ├── finnhub.ts
│   │   │   │   │   ├── calendar.ts
│   │   │   │   │   ├── polygon.ts
│   │   │   │   │   └── bloomberg.ts
│   │   │   │   ├── detector.ts       # Event detection + impact classification
│   │   │   │   ├── dedup.ts          # Semantic dedup (pgvector cosine similarity)
│   │   │   │   └── suggester.ts      # Auto-suggest reports for affected instruments
│   │   │   ├── agents/               # Copied/adapted from GoBot patterns
│   │   │   │   ├── base.ts           # Agent base (model, reasoning, streaming)
│   │   │   │   ├── ta-agent.ts       # Technical Analysis
│   │   │   │   ├── fa-agent.ts       # Fundamental Analysis
│   │   │   │   ├── quality-agent.ts  # Arbitration + deliberation
│   │   │   │   ├── compliance-agent.ts
│   │   │   │   └── translation-agent.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── orchestrator.ts   # Main pipeline (GoBot board pattern)
│   │   │   │   ├── stages.ts         # Stage definitions
│   │   │   │   └── events.ts         # SSE event system
│   │   │   ├── hitl/
│   │   │   │   ├── approval.ts       # Channel-agnostic approval service
│   │   │   │   ├── telegram.ts       # Telegram adapter (grammy)
│   │   │   │   ├── slack.ts          # Slack adapter (Phase 5)
│   │   │   │   └── web.ts            # Web UI adapter
│   │   │   ├── lib/
│   │   │   │   ├── anthropic.ts      # SDK wrapper: streaming + tool_use
│   │   │   │   ├── cross-agent.ts    # [INVOKE:agent|question] parsing
│   │   │   │   ├── model-router.ts   # Haiku/Sonnet/Opus selection
│   │   │   │   ├── store.ts          # Repository pattern (in-memory; Convex/Supabase later)
│   │   │   │   ├── types.ts          # AgentConfig, store interfaces, shared types
│   │   │   │   └── tenant.ts         # Multi-tenant middleware (planned)
│   │   │   ├── routes/               # Hono API routes
│   │   │   │   ├── events.ts         # GET /events (SSE live feed)
│   │   │   │   ├── suggestions.ts    # GET/POST /suggestions
│   │   │   │   ├── pipeline.ts       # POST /pipeline/run, GET /pipeline/:id/events
│   │   │   │   ├── approvals.ts      # GET/POST /approvals
│   │   │   │   ├── reports.ts        # GET /reports
│   │   │   │   ├── instruments.ts    # CRUD /instruments
│   │   │   │   ├── glossaries.ts     # CRUD /glossaries
│   │   │   │   └── sources.ts        # CRUD /sources (data source config)
│   │   │   ├── jobs/                 # BullMQ job definitions
│   │   │   │   ├── scan.ts           # Scheduled scanning (every 5min)
│   │   │   │   ├── pipeline.ts       # Pipeline execution
│   │   │   │   └── distribution.ts   # Report distribution
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   │   │   ├── market/                # TS data layer (replaces Python data-service)
│   │   │   │   ├── data-fetcher.ts    # yahoo-finance2 + finnhub
│   │   │   │   ├── indicators.ts      # technicalindicators wrapper
│   │   │   │   ├── ohlcv.ts           # arquero OHLCV transforms
│   │   │   │   └── charts.ts          # plotly.js + kaleido (server-side)
│   │
│   └── web/                          # Next.js frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/login/
│       │   │   ├── (dashboard)/
│       │   │   │   ├── sources/      # Data Sources config screen
│       │   │   │   ├── command/      # Command Center (event feed + suggestions)
│       │   │   │   ├── pipeline/     # Pipeline monitor
│       │   │   │   ├── reports/      # Report list + viewer
│       │   │   │   ├── instruments/  # Instrument config
│       │   │   │   ├── glossary/     # Glossary manager
│       │   │   │   └── admin/        # Admin panel (WordwideFX only)
│       │   │   ├── approve/[token]/  # Mobile-first HITL approval (public, token-auth)
│       │   │   ├── onboarding/       # Client onboarding wizard
│       │   │   └── reports/[id]/     # Public report viewer (SSR, SEO)
│       │   ├── components/
│       │   │   ├── ui/               # shadcn/ui primitives
│       │   │   ├── scanner/          # Source cards, scan activity bars, event feed
│       │   │   ├── suggestions/      # Suggestion chips, run button
│       │   │   ├── pipeline/         # Stage sidebar, event stream, agent blocks
│       │   │   ├── reports/          # Report viewer, chart widget, audience tabs
│       │   │   └── hitl/             # Approval form, compliance flags
│       │   └── lib/
│       │       ├── supabase.ts
│       │       ├── sse.ts            # SSE hooks (events + pipeline)
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

## Database Schema (Supabase/PostgreSQL)

All tenant-scoped tables enforce Row-Level Security via `tenant_id`.

**Core tables:**
- **`tenants`** — id, name, slug, plan (automated|hybrid|enterprise), branding (JSONB), settings (JSONB)
- **`users`** — id, tenant_id, email, role (admin|editor|viewer|compliance_officer), supabase_auth_id
- **`instruments`** — id, tenant_id, ticker, name, slug, asset_class, config (JSONB)
- **`data_sources`** — id, tenant_id, name, type (finnhub|polygon|bloomberg|...), tier (essential|professional|institutional), api_key_encrypted, config (JSONB), enabled, last_scan_at
- **`market_events`** — id, headline, summary, source, impact (breaking|high|medium|low|noise), category, sentiment, affected_instruments (TEXT[]), embedding (vector), published_at, detected_at
- **`report_suggestions`** — id, tenant_id, event_id (FK), instrument_id (FK), direction (bullish|bearish|neutral), impact_summary, status (pending|accepted|dismissed|running|completed), created_at
- **`pipeline_runs`** — id, tenant_id, instrument_id, suggestion_id (FK, nullable), status (queued|running|awaiting_approval|completed|failed), trigger (event|manual|scheduled), result (JSONB), started_at, completed_at
- **`pipeline_events`** — id, run_id, stage, status, message, data (JSONB), timestamp
- **`approvals`** — id, run_id, checkpoint (quality|compliance|translation|publish), status (pending|approved|rejected), channel (web|telegram|slack|teams), summary, decided_by, decided_at
- **`reports`** — id, run_id, tenant_id, instrument_id, level (beginner|intermediate|professional), language, content (JSONB), storage_path, created_at
- **`glossaries`** — id, tenant_id, name, language, terms (JSONB), tone, brand_rules
- **`glossary_corrections`** — id, glossary_id, tenant_id, english_term, original, corrected, corrected_by, applied_at
- **`news_articles`** — id, headline, summary, source, url, sentiment, category, embedding (vector), published_at, fetched_at
- **`audit_log`** — id, tenant_id, user_id, action, resource_type, resource_id, details (JSONB), timestamp

---

## Phased Implementation

### Phase 1: Foundation (Weeks 1-3)

**Goal**: Standing infrastructure — TypeScript API + database + basic scanning.

> **DONE (Translation Engine):** `packages/api/src/` contains the migrated Translation Engine (24 files, ~2,900 lines). See `packages/api/src/pipeline/translation-engine.ts` for the core orchestrator.

1. Initialize Bun workspace with `packages/api`, `packages/web` ✅ (Translation Engine done)
2. Database setup (Convex or Supabase — decision pending) with core tables
3. TypeScript API skeleton: ✅ (Hono routes: /translate, /profiles, /health done)
   - Add auth middleware + tenant context when DB is chosen
   - Add instrument, glossary, data source CRUD routes
4. **TS data layer** (replaces Python data-service):
   - `packages/api/src/market/data-fetcher.ts` — yahoo-finance2 + finnhub
   - `packages/api/src/market/indicators.ts` — technicalindicators (RSI, MACD, BB, etc.)
   - `packages/api/src/market/charts.ts` — plotly.js + kaleido (server-side PNG/SVG)
5. **Scanner foundation:**
   - `DataSource` base interface + Finnhub adapter
   - BullMQ scheduled job: scan every 5 minutes
   - Event detection: classify impact level using Haiku
   - Semantic dedup
6. Docker Compose: api (Bun) + Redis
7. Seed store with instruments (EUR/USD, Gold, Oil) + glossaries (OANDA, Alpari)

### Phase 2: Agent Pipeline + Suggestions (Weeks 3-5)

**Goal**: Full agent pipeline + auto-suggestion system that proposes reports from detected events.

1. Agent base class (copy GoBot `src/agents/base.ts` patterns):
   - Claude API streaming via `@anthropic-ai/sdk`
   - Structured output via `tool_use`
   - Retry with exponential backoff, token tracking per call
2. Model router (copy GoBot `src/lib/model-router.ts`):
   - Haiku: news triage + event classification
   - Sonnet / GPT-4o: TA/FA/Compliance/Translation (best model per language/task)
   - Opus: Quality arbitration (Enterprise tier)
   - GPT-4o-mini / Gemini Flash: volume translation drafts
3. Port remaining agent system prompts from Python prototype:
   - `ta_agent.py` → `ta-agent.ts`
   - `fa_agent.py` → `fa-agent.ts`
   - `quality_agent.py` → `quality-agent.ts` (with `[INVOKE:]` deliberation)
   - `compliance_agent.py` → `compliance-agent.ts` (rule-based + Claude hybrid)
   - ✅ `translation_agent.py` → `translation-agent.ts` (DONE — in `packages/api/src/agents/`)
   - ✅ `scoring_agent.py` → `scoring-agent.ts` + `scoring/deterministic.ts` + `scoring/llm-judge.ts` (DONE)
   - ✅ `quality_arbiter.py` → `quality-arbiter.ts` (DONE)
   - ✅ 4 specialists → `agents/specialists/` (DONE)
4. **Report suggestion engine:**
   - When high/medium event detected → determine affected instruments (from tenant's configured list)
   - Generate 1-3 suggestions with direction + rationale
   - Write to `report_suggestions` table
   - Push to frontend via Supabase Realtime
5. Pipeline orchestrator (adapt GoBot `board/orchestrator.ts`):
   - 12-stage sequential pipeline with SSE event emission
   - State persistence to `pipeline_runs` + `pipeline_events`
   - Rejection/reprocessing loops
6. API: `POST /api/suggestions/:id/run`, `GET /api/pipeline/:id/events` (SSE)
7. BullMQ: pipeline runs as queued jobs with per-tenant concurrency

**GoBot patterns to copy:**
- `gobot/src/agents/base.ts` → agent config, streaming, structured output
- `gobot/src/lib/cross-agent.ts` → `[INVOKE:]` tag parsing for deliberation
- `gobot/src/lib/board/orchestrator.ts` → sequential agent execution
- `gobot/src/lib/model-router.ts` → tiered model selection

### Phase 3: HITL + Reports + Frontend (Weeks 5-7)

**Goal**: Human approval workflow + report generation + interactive frontend.

1. Channel-agnostic approval service:
   - `ApprovalService` dispatches to configured channel (web, Telegram)
   - Pipeline pauses at checkpoints → writes to `approvals` table → resumes on webhook
   - Token-based deep links for one-tap approvals from any device
2. Telegram adapter (port from `finflow/hitl/telegram_bot.py`, use grammy):
   - Inline buttons: Approve / Correct / Reject
   - Auto-approval timeout (configurable per tenant)
3. Web approval adapter:
   - `POST /api/approvals/:id/decide`
   - Frontend page at `/approve/[token]` (mobile-first)
4. Report generation:
   - TS data layer generates charts via plotly.js + kaleido
   - HTML report rendering (port templates from prototype)
   - 3 audience levels, store in Supabase Storage
5. Next.js frontend:
   - Login (Supabase Auth)
   - **Data Sources** screen (source cards, scan activity, connection status)
   - **Command Center** (live event feed, suggestion chips, run button, active pipelines sidebar)
   - **Pipeline Monitor** (3-column layout with SSE)
   - **Report Viewer** (audience tabs, language switcher, compliance bar, TradingView charts)
   - **HITL Approval** page (mobile-first, token-based)

### Phase 4: Demo Polish (Weeks 7-9)

**Goal**: Demo-ready product for prospect presentations.

1. Additional data source adapters (Economic Calendar, Yahoo Finance)
2. Compliance agent with all 5 jurisdictions (MiFID II, SEC, FCA, ASIC, MAS)
3. Multi-language output (EN, ES, ZH — port glossaries)
4. White-label branding (per-tenant CSS variables, logo, colors via middleware)
5. Interactive TradingView Lightweight Charts in report viewer
6. Pipeline demo mode (pre-cached data for instant demos)
7. Onboarding wizard UI (5-step: Company → Branding → Instruments → Languages → Compliance)
8. Admin panel (tenant list, pipeline health, usage stats, LLM cost tracking)
9. Translation learning loop (`glossary_corrections` fed back to agent)

### Phase 5: Production Readiness (Weeks 9-12)

**Goal**: Secure, scalable, ready for paying clients.

1. Multi-channel distribution (email via SendGrid, PDF export, blog API push)
2. Slack + MS Teams approval adapters
3. Premium data source adapters (Polygon.io WebSocket, client Bloomberg keys)
4. Audit trail + GDPR compliance (data export, deletion per tenant)
5. API key authentication for Enterprise tier
6. Rate limiting per tenant/plan tier
7. Observability (structured logging, OpenTelemetry, error alerting)
8. Self-hosted deployment guide (docker-compose + env vars + Helm chart)
9. Security review (RLS validation, input sanitization, auth hardening)

---

## What to Reuse

### From Python Prototype (`/Users/klorian/workspace/wordwideAI/finflow/`)

| File | Strategy | Status |
|---|---|---|
| `agents/translation_agent.py` | Ported to `packages/api/src/agents/translation-agent.ts` | ✅ Done |
| `agents/scoring_agent.py` | Ported to `packages/api/src/scoring/` (deterministic + llm-judge) | ✅ Done |
| `agents/quality_arbiter.py` | Ported to `packages/api/src/agents/quality-arbiter.ts` | ✅ Done |
| `agents/*_specialist.py` (4) | Ported to `packages/api/src/agents/specialists/` | ✅ Done |
| `engine/translation_engine.py` | Ported to `packages/api/src/pipeline/translation-engine.ts` | ✅ Done |
| `profiles/models.py` + `store.py` | Ported to `packages/api/src/profiles/` (Zod schemas + repo pattern) | ✅ Done |
| `agents/ta_agent.py` | **Copy prompts** to TS agent | Pending |
| `agents/fa_agent.py` | **Copy prompts** to TS agent | Pending |
| `agents/quality_agent.py` | **Copy prompts** + INVOKE deliberation | Pending |
| `agents/compliance_agent.py` | **Copy rules + prompts** | Pending |
| `data/market_data.py` | Port to TS: yahoo-finance2 + technicalindicators | Pending |
| `data/news_scraper.py` | Port to TS: finnhub adapter | Pending |
| `output/generate_charts.py` | Port to TS: plotly.js + kaleido | Pending |
| `output/generate_reports.py` | **Adapt templates** to React components | Pending |
| `pipeline.py` (full 12-stage) | **Adapt logic** to TS orchestrator | Pending |
| `hitl/telegram_bot.py` | **Port** to TS Telegram adapter (grammy) | Pending |
| `instruments.py` | **Seed data** for DB | Pending |
| `glossaries/*.json` | **Seed data** for DB | Pending |

### From GoBot (`/Users/klorian/workspace/gobot/`)

| File | FinFlow Equivalent |
|---|---|
| `src/agents/base.ts` | Agent base with model config, streaming, structured output |
| `src/lib/cross-agent.ts` | `[INVOKE:]` tag parsing for deliberation |
| `src/lib/board/orchestrator.ts` | Pipeline orchestrator (sequential agent execution) |
| `src/lib/model-router.ts` | Tiered LLM routing (Haiku/Sonnet/Opus) |
| `src/lib/board/decisions.ts` | HITL inline approval system |
| `src/scheduler/executor.ts` | BullMQ scheduled job definitions |
| `src/lib/task-queue.ts` | Async task management |

---

## Verification Plan

1. **Phase 1**: `curl` API endpoints, confirm CRUD works, verify TS data layer returns indicators/charts, confirm scanner detects and stores events from Finnhub
2. **Phase 2**: Events trigger suggestions → select suggestion → pipeline runs → SSE streams agent output → deliberation occurs → results persisted to DB
3. **Phase 3**: Full flow: event detected → suggestion appears in Command Center → client selects → pipeline runs → Telegram notification → approve → report viewable in browser. Test rejection → reprocessing
4. **Phase 4**: Full demo: configure new tenant → set data sources + instruments → events auto-detected → suggestions appear → approve → view white-labeled report in 3 languages/3 levels → interactive charts
5. **Phase 5**: Security (tenant isolation), load (concurrent pipelines), email/PDF distribution, self-hosted Docker deploy on clean machine

---

## Pricing Tiers (from deck)

| Tier | Price | Instruments | Languages | Data Sources | HITL |
|---|---|---|---|---|---|
| **Automated** | $999/mo | 5 | 3 | Essential only | AI-only |
| **Hybrid** | $2,999/mo | 20 | 9 | Essential + Professional | Adaptive learning curve |
| **Enterprise** | $7,999+/mo | Unlimited | 40+ | All tiers | Dedicated team |

**Unit economics:** ~$1.50-2.00/report (LLM + infra), 93-97% gross margin, break-even at ~5 Automated clients.

---

## Key Files Reference

### Active TypeScript Codebase (`packages/api/src/`)

| File | Lines | Purpose |
|---|---|---|
| `pipeline/translation-engine.ts` | ~440 | Translation engine orchestrator (translate → score → arbiter → specialists → re-score) |
| `scoring/deterministic.ts` | ~250 | 6 code-based quality metrics |
| `scoring/llm-judge.ts` | ~250 | 7 LLM-as-judge metrics via tool_use |
| `agents/translation-agent.ts` | ~200 | Profile-aware translation with glossary compliance |
| `agents/quality-arbiter.ts` | ~220 | Routes failed metrics to specialists (tool_use + deterministic fallback) |
| `agents/specialists/` | ~400 | 4 specialist agents (terminology, style, structural, linguistic) |
| `profiles/types.ts` | ~170 | Zod schemas: ClientProfile, ToneProfile, ScoringConfig, metric taxonomy |
| `lib/anthropic.ts` | ~110 | SDK wrapper: streaming + tool_use structured output |
| `lib/cross-agent.ts` | ~60 | INVOKE tag parsing (adapted from GoBot) |

### Python Prototype (reference only — `finflow/`)

| File | Lines | Purpose |
|---|---|---|
| `finflow/pipeline.py` | 583 | Full 12-stage pipeline — adapt remaining stages to TS |
| `finflow/agents/quality_agent.py` | 326 | TA/FA deliberation — copy prompts |
| `finflow/agents/compliance_agent.py` | 302 | Regulatory compliance — copy rules + prompts |
| `finflow/data/market_data.py` | 161 | Market data — port to TS (yahoo-finance2) |
| `finflow/output/generate_charts.py` | 686 | Charts — port to TS (plotly.js + kaleido) |
| `finflow/hitl/telegram_bot.py` | 328 | HITL — port to TS (grammy) |

### Documentation

| File | Purpose |
|---|---|
| `docs/architecture-plan.md` | Full architecture reference |
| `docs/specs/2026-04-02-translation-engine.md` | Translation engine spec (updated for TS) |
| `docs/translation-engine-e2e-test.md` | E2E test workflow (updated for TS) |
| `docs/development-phases.md` | Development phases |
| `docs/business-strategy.md` | Business context |
| `mockup/finflow-ui-mockup.html` | Interactive UI mockup (10 screens) |
