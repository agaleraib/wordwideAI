# FinFlow Development Phases

**Date:** 2026-03-25
**Total estimated timeline:** 24 weeks (6 months)
**Tech base:** GoBot multi-agent framework

---

## Phase 1: Core Pipeline (Weeks 1-4)

**Delivers:** Single-instrument report generation for one client, English only.

- [ ] Fork GoBot's agent system into `packages/api/src/agents/` with TA, FA, and Quality agents
- [ ] Implement `packages/api/src/pipeline/report-generator.ts` following GoBot's `src/lib/board/orchestrator.ts` pattern
- [ ] Build news aggregation with 2-3 free/cheap APIs (Alpha Vantage, NewsAPI, Forex Factory)
- [ ] OANDA integration for market data
- [ ] Basic chart generation (TradingView Lightweight, server-side)
- [ ] Single HITL checkpoint (report approval via Telegram or dashboard)
- [ ] Store reports in Supabase
- **Milestone:** Generate a daily EUR/USD report that passes human review

---

## Phase 2: Quality + Compliance (Weeks 5-8)

**Delivers:** Multi-instrument reports with agent deliberation and compliance gating.

- [ ] Quality/Arbitration agent with deliberation flow (`[INVOKE:]` pattern)
- [ ] Agent-to-agent conversation (TA↔FA, max 3 rounds)
- [ ] Compliance agent with EU/MiFID II module (first jurisdiction)
- [ ] Compliance HITL checkpoint with audit trail
- [ ] Report versioning (track changes between drafts)
- [ ] Expand to 5-10 major forex pairs
- [ ] Add crypto pairs (BTC, ETH) with crypto-specific prompts
- **Milestone:** Reports pass MiFID II compliance review for a sample client

---

## Phase 3: Multi-Tenant + Personalization (Weeks 9-12)

**Delivers:** Per-client branding, three audience levels, client onboarding.

- [ ] Client configuration system (`config/clients/` pattern)
- [ ] Personalization agent with template engine
- [ ] Three-level output (beginner, intermediate, professional)
- [ ] Multi-tenant database with RLS
- [ ] Client onboarding flow (create client, upload branding, configure instruments)
- [ ] Client dashboard for report management
- [ ] BullMQ job queue for concurrent multi-client processing
- [ ] Import existing WordwideFX client glossaries and tone profiles
- **Milestone:** Two distinct clients receive differently branded reports

---

## Phase 4: Translation + HITL Learning Loop (Weeks 13-16)

**Delivers:** Multi-language output with adaptive human review.

- [ ] Translation agent framework with per-language model routing
- [ ] Client-specific glossary loading for each language
- [ ] Translation HITL checkpoint (optional per package)
- [ ] Feedback loop: human corrections → stored → used to improve next translation
- [ ] HITL percentage tracking and adaptive reduction over time
- [ ] Translation quality scoring (automated + human)
- [ ] Email distribution (SendGrid)
- [ ] Blog integration (WordPress REST API)
- [ ] Social media posting (Twitter/X, LinkedIn)
- [ ] PDF export with branded templates
- [ ] Publish authorization HITL checkpoint
- **Milestone:** Reports published in 3 languages across email + blog + social

---

## Phase 5: Scale + Regulatory Expansion (Weeks 17-20)

**Delivers:** Institutional-grade data sources, advanced charts, more jurisdictions.

- [ ] Bloomberg/Refinitiv integration (requires client's own license keys)
- [ ] Advanced chart types (multi-timeframe, correlation matrices, flow analysis)
- [ ] Additional jurisdiction modules: US/SEC, UK/FCA, Australia/ASIC, Singapore/MAS
- [ ] Compliance audit trail export
- [ ] Real-time alerts for breaking news
- [ ] Performance analytics (report accuracy vs. actual price action)
- [ ] API endpoints for client systems to request on-demand reports
- **Milestone:** System handles 50+ clients across 3 jurisdictions

---

## Phase 6: Intelligence + Self-Improvement (Weeks 21-24)

**Delivers:** Self-improving system, analytics, full automation option.

- [ ] Report accuracy scoring (backtest predictions vs. outcomes)
- [ ] Agent performance metrics (which agent's calls were most accurate)
- [ ] Auto-tuning: adjust agent prompts based on accuracy data
- [ ] Client engagement analytics (open rates, click-through, feedback)
- [ ] White-label deployment option
- [ ] Regulatory update auto-detection (monitor regulator feeds for rule changes)
- [ ] Translation model fine-tuning from accumulated feedback data
- **Milestone:** Production system serving paying clients with measurable accuracy

---

## Dependencies & Prerequisites

- GoBot codebase access (MIT licensed ✓)
- Supabase instance (running at 10.1.10.233 ✓)
- Mac Studio for local LLM (Qwen 32B/235B ✓)
- Anthropic API key (existing ✓)
- Market data API accounts (to be set up in Phase 1)
- WordwideFX client glossaries and translation memories (to be imported in Phase 3)
