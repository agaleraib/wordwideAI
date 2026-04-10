# FinFlow Architecture

**Last updated:** 2026-04-07
**Branch of record:** `feat/translation-engine`

This document describes the actual current architecture of the codebase. It is not aspirational. For the forward roadmap see Second Brain (project: WordwideAI) and `docs/specs/`.

**Forward decisions (not yet implemented):** the production stack, deployment model (SaaS + per-client appliance), and LLM provider abstraction (Vercel AI SDK over Anthropic/OpenAI/Google) are locked in [`docs/specs/2026-04-07-deployment-stack.md`](specs/2026-04-07-deployment-stack.md). Anything in this document about the *current* state — Anthropic SDK directly, in-memory stores, no DB — is correct *today* and will change per that spec.

---

## Top-level layout

Bun monorepo with two active TypeScript packages plus a partially-deleted Python reference directory.

```
wordwideAI/
├── packages/
│   ├── api/          @finflow/api    — translation engine + benchmark suite
│   └── web/          finflow-web     — React UI
├── finflow/          legacy Python prototype (reference only, see end of doc)
└── docs/             architecture, specs, metrics reference
```

A third package `packages/sources/` (universal ingest) is planned but not yet scaffolded.

---

## Backend — `packages/api/`

### Stack
- **Runtime:** Bun
- **API framework:** Hono with `cors` middleware
- **Validation:** Zod
- **LLM:** `@anthropic-ai/sdk` — structured output via `tool_use` exclusively
- **Document ingest:** `mammoth` (`.docx`)
- **Storage:** repository pattern over interfaces in `lib/types.ts`; in-memory implementations in `lib/store.ts`. Real DB deferred.

### Entry point
`src/index.ts` mounts three route groups on a Hono app:
- `/translate` → `routes/translate.ts`
- `/profiles` → `routes/profiles.ts`
- `/health`

Stores are constructed at startup as `InMemoryProfileStore` + `InMemoryTranslationStore` and held behind the `ProfileStore` / `TranslationStore` interfaces so a real DB can be swapped in later without touching the engine.

### Source layout
```
packages/api/src/
├── index.ts                      Hono app + route mounting
├── routes/
│   ├── translate.ts              POST /translate, POST /translate/stream (SSE)
│   └── profiles.ts               CRUD + POST /profiles/extract
├── pipeline/
│   ├── translation-engine.ts     Main orchestrator (runTranslationEngine)
│   ├── glossary-patcher.ts       Deterministic + Haiku glossary enforcement
│   └── events.ts                 SSE event emission
├── agents/
│   ├── translation-agent.ts      Profile-aware translator (Opus)
│   ├── scoring-agent.ts          13-metric scorer (Opus, tool_use)
│   ├── quality-arbiter.ts        Plans correction sequence (Haiku)
│   ├── profile-extraction-agent.ts
│   └── specialists/
│       ├── shared.ts             SpecialistResult, FailedMetricData types
│       ├── terminology.ts
│       ├── style.ts
│       ├── structural.ts
│       └── linguistic.ts
├── scoring/
│   ├── metrics.ts                13-metric definitions
│   ├── deterministic.ts          6 code-computed metrics
│   ├── llm-judge.ts              7 LLM-judge metrics (tool_use)
│   └── scorecard.ts              Scorecard type, aggregation, gating
├── profiles/
│   ├── types.ts                  ClientProfile, getLanguageProfile, METRIC_CATEGORIES
│   └── store.ts                  File-backed profile persistence
├── lib/
│   ├── anthropic.ts              SDK wrapper
│   ├── model-router.ts           Opus vs Haiku routing
│   ├── cross-agent.ts            Shared agent helpers
│   ├── store.ts                  In-memory ProfileStore + TranslationStore
│   └── types.ts                  Repository interfaces, EventHandler
└── benchmark/                    See "Benchmark suite" below
```

### Pipeline core — `pipeline/translation-engine.ts`

`runTranslationEngine(sourceText, clientId, language, options)` implements:

```
load profile from ProfileStore
  → TranslationAgent (Opus) — initial translation, tracks glossary compliance
  → ScoringAgent (Opus) — 13-metric scorecard
  → GlossaryPatcher — deterministic + Haiku surgical fix (BEFORE the gate)
       updates glossary metric in place; no Opus re-score
  → gate check
       passed? → persist + return
  → for round in 1..maxRevisionAttempts:
       QualityArbiter (Haiku) — produces CorrectionPlan
            (which specialists, what order, conflict risks, HITL?)
       if escalateToHitl → persist + return
       for specialist in plan.correctionSequence:
            run specialist (Opus)
            glossary guard: if specialist regressed glossary terms,
                            re-apply patcher's cached replacements
       re-score (Opus)
       gate check → if passed, persist + return
  → exhausted → HITL escalation, persist + return
```

Every stage:
- emits an SSE event via `pipeline/events.ts:emitEvent` (consumed by the web UI)
- appends a structured `AuditEntry` (stage, agent, timestamp, durationMs, tokens, input/output hashes, reasoning, scores or plan dict)

The result (`EngineResult`) is persisted through the `TranslationStore` interface (failures swallowed — translation result is the source of truth, persistence is best-effort).

### Agents — `src/agents/`

| Agent | Model | Output | Responsibility |
|---|---|---|---|
| TranslationAgent | Opus | streamed text + glossary compliance % | Profile-aware initial translation |
| ScoringAgent | Opus | `Scorecard` via tool_use | Run all 13 metrics |
| QualityArbiter | Haiku | `CorrectionPlan` via tool_use | Decide which specialists run, in what order, and whether to escalate |
| ProfileExtractionAgent | Opus | `ClientProfile` via tool_use | Extract a profile from sample documents |
| Specialist (×4) | Opus | `SpecialistResult` (corrected text + reasoning) | Single-responsibility correctors mapped to metric categories via `METRIC_CATEGORIES` |

The four specialists (terminology, style, structural, linguistic) share a `SpecialistResult` / `FailedMetricData` contract defined in `agents/specialists/shared.ts`.

### Scoring — `src/scoring/`

Hybrid 13-metric model:
- **6 deterministic metrics** (`scoring/deterministic.ts`) — pure code, no LLM. Includes glossary compliance and the syntactic-calculus metric (recently replaced passive-voice ratio).
- **7 LLM-judge metrics** (`scoring/llm-judge.ts`) — Opus tool_use calls returning structured scores.
- **`scoring/metrics.ts`** — metric definitions and metadata.
- **`scoring/scorecard.ts`** — `Scorecard` type, per-metric thresholds (sourced from the client profile per language), aggregation, gating, dict serialization for audit entries.

A `Scorecard` exposes `aggregateScore`, `aggregateThreshold`, `passed`, `metrics` (Record), `failedMetrics`, `failedCategories` (used by the arbiter to dispatch specialists).

### Glossary enforcement — `src/pipeline/glossary-patcher.ts`

Two-phase deterministic + Haiku post-processor that runs **before** the gate check:
1. `applyDeterministicReplacements` — string-level replacements for unambiguous terms
2. Haiku pass for ambiguous cases via `enforceGlossary` (skips grammar fix; specialists handle that)

Returns:
```ts
{
  correctedText, replacements[], hitlTerms[],
  complianceBefore, complianceAfter, usage
}
```

The engine **caches `replacements`** and uses them as a "glossary guard" after each specialist round: if `checkCompliance` shows missed terms, the cached replacements are deterministically re-applied. This prevents specialists from regressing glossary compliance while fixing other metrics.

The glossary metric is updated **in place** after the patcher runs — no Opus re-score is needed because the patcher only touches glossary terms.

### Profiles — `src/profiles/`

`ClientProfile` is the heart of personalization. Per-language overrides via `getLanguageProfile(profile, language)` give:
- glossary (terms + alternatives)
- tone profile
- scoring config (per-metric thresholds, aggregate threshold, max revision attempts)
- compliance rules
- brand voice

`METRIC_CATEGORIES` maps metric names → specialist categories (terminology / style / structural / linguistic), used by the engine to gather failed metrics for each specialist.

Profiles persist via `profiles/store.ts` (file-backed, used by the dev `InMemoryProfileStore` wrapper).

### Uniqueness PoC — `src/benchmark/uniqueness-poc/`

PoC harness for cross-tenant content uniqueness. Stages 1-7 test whether different broker personas produce genuinely distinct content from the same source event. Key subsystems:

| File | Purpose |
|---|---|
| `runner.ts` | Orchestration: core analysis → identity adaptation → embeddings → similarity → judge |
| `conformance-pass.ts` | Brand voice enforcement pass (Style & Voice from translation engine, dedicated prompt). Opt-in via `withConformancePass: true`. Drops presentation similarity ~0.20 (validated 2026-04-10) |
| `llm-judge.ts` | Two-axis judge (fidelity × presentation → trinary verdict) |
| `types.ts` | `ContentPersona` (incl. `companyBackground`), `IdentityOutput`, `CrossTenantMatrixResult` |
| `personas/` | Broker persona fixtures (Premium, FastTrade, Helix, Northbridge) |
| `prompts/identities/` | Identity agent system prompts (Beginner Blogger, Trading Desk, etc.) |

**Content pipeline ↔ translation engine boundary.** The conformance pass reuses the translation engine's `callAgentWithUsage` infrastructure and `parseSpecialistResponse` parser but uses a dedicated brand-voice-enforcement prompt, NOT the translation-specific `correctStyle` specialist. Only the Style & Voice category crosses the boundary; Terminology, Structural, and Linguistic remain translation-only. See `docs/specs/2026-04-07-content-pipeline.md` §5.9 for the full scope decision.

### Benchmark suite — `src/benchmark/`

First-class subsystem, not test code. Exists to **prove the value prop** (consistency at scale) and produce CSV deliverables.

| File | Purpose |
|---|---|
| `run.ts`, `runner.ts` | Batch translation runs |
| `consistency-test.ts` | N-run variance test (the consistency proof) |
| `ab-test.ts`, `comparison-agent.ts` | A/B comparisons between translation approaches |
| `extract.ts`, `extract-glossary-v2.ts` | Profile + glossary extraction from sample corpora |
| `profile-merge.ts` | Merge extracted profiles |
| `docx-reader.ts` | `.docx` ingest via `mammoth` |
| `aggregation.ts`, `report.ts`, `csv-export.ts` | Rollup, reporting, 3-file CSV export |
| `test-guard.ts` | Guardrail checks |
| `types.ts` | Shared benchmark types |

---

## Frontend — `packages/web/`

### Stack
- React 19, Vite 8, TypeScript
- Tailwind v4 (via `@tailwindcss/vite`)
- React Router 7
- framer-motion for animation
- `clsx` + `tailwind-merge` (`lib/cn.ts`)

### Layout
```
packages/web/src/
├── main.tsx              entry
├── App.tsx               router
├── pages/
│   ├── LoginPage.tsx     centered card, ambient glow, grid bg, fadeUp
│   ├── DashboardPage.tsx
│   └── PipelinePage.tsx  live SSE-driven pipeline monitor
├── components/
│   ├── layout/           AppShell, Sidebar, Topbar
│   ├── dashboard/        KPICard, InstrumentCard
│   └── pipeline/         StageTimeline, EventCard, StreamingText
└── lib/
    ├── api.ts            backend client
    ├── useSSE.ts         SSE hook for /translate/stream
    ├── types.ts
    └── cn.ts
```

The pipeline page consumes the SSE event stream emitted by `pipeline/events.ts`, rendering stage progression (`StageTimeline`), per-event cards (`EventCard`), and token-by-token translation output (`StreamingText`).

---

## Architectural themes

1. **Multi-agent quality pipeline.** Translation, scoring, arbitration, and four specialist correctors are separate agents with narrow contracts. Single-responsibility agents are easier to test, swap, and reason about than monoliths.

2. **Deterministic + LLM hybrid scoring.** 6 code metrics + 7 tool_use judges. Code metrics are cheap, deterministic, and can't drift. LLM judges handle the things code can't measure (fluency, fidelity, naturalness). Per-language thresholds gate the result.

3. **Glossary as a first-class concern, separate from translation.** Handled by a dedicated patcher *outside* the LLM translation step, with a guard that protects it across specialist rounds. Principle: translate naturally, apply glossary deterministically.

4. **Repository pattern over storage.** The engine depends on `ProfileStore` / `TranslationStore` interfaces, never a concrete DB. In-memory today, real DB later, no engine changes needed.

5. **Event-sourced observability.** Every stage emits SSE events and writes a structured `AuditEntry` (hashes, tokens, durations, reasoning). The frontend monitor and any future audit log share one source of truth.

6. **Benchmark as product, not QA.** The `benchmark/` subsystem exists to prove the consistency-at-scale value prop and produce CSV deliverables for prospects. It is a customer-facing artifact, not internal testing.

7. **Profile-driven personalization.** `ClientProfile` (with per-language overrides) drives translation tone, glossary, thresholds, and specialist behavior. Extractable from sample documents via `ProfileExtractionAgent`.

8. **All structured output via `tool_use`.** No JSON-in-text parsing anywhere in the codebase. If an agent returns structured data, it does so via Anthropic's `tool_use` schema.

9. **The "translation engine" is conceptually a *client-conformance engine* that optionally translates.** *(Forward — see `docs/specs/2026-04-07-content-pipeline.md` §5.9.)* Of the 13 metrics it enforces, 12 apply to any content regardless of language — glossary, brand voice, formality, regional variant, fluency, meaning preservation, and so on. Translation is the first step *only when source language ≠ target language*; for same-language content the `TranslationAgent` is a pass-through and the rest of the pipeline (scoring → glossary patcher → gate → specialists) handles conformance to the client's editorial standard. This means **all content — English-native for English clients, English-source-translated-to-Spanish, etc. — goes through the same enforcement loop.** The function name (`runTranslationEngine`) and file path stay as-is for now to minimize churn; the reframe is conceptual.

10. **Domain reasoning is separated from content composition (workstream C).** *(Forward — see `docs/specs/2026-04-07-content-pipeline.md` §5.7a/b.)* The content pipeline has a **core analytical layer** (`FundamentalAnalystAgent`, `TechnicalAnalystAgent`, `IntegratedAnalystAgent`) that is the only place markets are reasoned about. Its output is cached per `(event_id, topic_id, analytical_method)` with a 24h TTL and **shared across tenants** for canonical topics — one expensive Opus call serves N pipelines. A separate **identity adaptation layer** (`BeginnerBlogger`, `InHouseJournalist`, `TradingDesk`, `NewsletterEditor`, `Educator`, `Strategist`, plus `raw-fa`/`raw-ta`/`raw-fa+ta` pass-through identities) consumes the cached analysis and produces the final product per pipeline, in the identity's native format and voice. Pre-allocated angles are fed to the identity layer, not the core layer, so the cache stays valid across all angles. Principle, generalized from the existing translation engine: **reason naturally first, adapt deterministically after.**

---

## Notably absent (vs the legacy Python prototype)

The TypeScript codebase is **scoped to the translation engine + a UI to watch it run + a benchmark harness to prove it works**. The following Python prototype subsystems have **not** been ported and are tracked in Workstream C of the SB roadmap:

- **Content production stack:** FA agent, TA agent, content_pipeline orchestrator
- **Compliance gate:** compliance agent (5 jurisdictions)
- **Output formatting:** report generator (HTML/PDF), chart generator (matplotlib → plotly.js + kaleido)
- **HITL:** Telegram bot for approval flow
- **Domain data:** instrument catalog
- **Data ingest:** market data fetcher, news scraper

The data ingest layer will be rebuilt as a **standalone, FinFlow-agnostic package** (`@wfx/sources`, Workstream B) reusable across non-FinFlow projects. Output channels likewise become a standalone `@wfx/publishers` package (Workstream D). The FinFlow content pipeline (Workstream C) will then be a thin orchestrator that wires sources → content generation → translation engine → publishers.

---

## Legacy Python prototype

`finflow/` contains the original Python prototype. After the 2026-04-07 cleanup:

**Deleted** (translation-engine bits, fully migrated to TS):
- `engine/translation_engine.py`, `agents/translation_agent.py`, `agents/scoring_agent.py`, `scoring.py`, `agents/quality_arbiter.py`, `agents/{terminology,style,structural,linguistic}_specialist.py`, `agents/base.py`, `profiles/{models,store}.py`

**Preserved** (unmigrated, reference for Workstream C):
- `content_pipeline.py`, `agents/{compliance,fa,ta,quality}_agent.py`, `output/{generate_reports,generate_charts}.py`, `hitl/telegram_bot.py`, `instruments.py`, `data/{market_data,news_scraper}.py`, plus entry points (`api.py`, `cli.py`, `demo.py`, `demo_server.py`, `pipeline.py`, `__main__.py`)

The preserved files are not runnable (their dependencies on the deleted modules are broken) but remain mineable for prompts, rules, and domain logic during the TS rebuild.
