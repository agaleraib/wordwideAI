# FinFlow — AI Financial Translation Platform

## Build & Run
```bash
cd packages/api && bun install
bun run dev                       # Hono dev server (hot reload)
bun run typecheck                 # tsc --noEmit (strict, no any)

cd packages/web && bun install
bun run dev                       # Vite dev server
```

## Stack
- **Runtime/API:** Bun + Hono + Zod (strict TypeScript, no `any`)
- **LLM:** Anthropic Claude via `@anthropic-ai/sdk`, structured output via `tool_use` (no JSON-in-text parsing)
- **Web:** React 19 + Vite 8 + Tailwind v4 + framer-motion + react-router 7
- **Playground:** React 19 + Vite 6 + Tailwind v4 + Recharts + Radix UI + lucide-react (icons). Light/dark theme via `data-theme="light"` on `<html>`, CSS variable swap in `index.css`.
- **Storage:** Repository pattern over interfaces in `lib/types.ts`; in-memory impls today (`InMemoryProfileStore`, `InMemoryTranslationStore`). Real DB deferred (Convex vs Supabase TBD).
- **Document ingest:** `mammoth` for `.docx`

## Monorepo Layout
```
packages/
  api/        @finflow/api    — translation engine + benchmark suite
  playground/ finflow-playground — uniqueness PoC playground (Vite + React)
  web/        finflow-web     — React UI (login, dashboard, pipeline monitor)
finflow/                  — legacy Python prototype (reference only, partially deleted)
docs/                     — architecture, specs, metrics reference
```

See `docs/architecture.md` for the full architecture description.

## API Routes (`packages/api/src/routes/`)
- `POST /translate` — run translation pipeline (`{ sourceText, clientId, language }`)
- `POST /translate/stream` — SSE for real-time pipeline events
- `GET/POST/DELETE /profiles` — client profile CRUD
- `POST /profiles/extract` — extract profile from text samples
- `GET /health`

## Translation Engine

**Conceptually a *client-conformance engine* that optionally translates.** Of the 13 metrics it enforces, 12 apply to any content regardless of language (glossary, brand voice, formality, regional variant, fluency, meaning preservation, etc.). When `sourceLanguage === targetLanguage`, the `TranslationAgent` step is a pass-through and the rest of the pipeline still runs to enforce the client's editorial standard. The function name and file path stay as-is for now to minimize churn — the reframe is conceptual. See `docs/specs/2026-04-07-content-pipeline.md` §5.9 and `docs/architecture.md` theme #9.

Multi-agent quality pipeline (`packages/api/src/pipeline/translation-engine.ts`):
```
load profile → translate (Opus) → score (13 metrics)
  → glossary patcher (deterministic + Haiku, pre-gate)
  → gate check
  → for round in 1..maxRounds:
       quality arbiter (Haiku) → specialists in sequence
         → glossary guard re-applies patcher results if a specialist undid them
       re-score
       gate check
  → exhausted → HITL escalation
```

**Agents** (`packages/api/src/agents/`): translation, scoring, quality-arbiter, profile-extraction, and 4 specialists (terminology, style, structural, linguistic).

**13-metric scoring** (`packages/api/src/scoring/`): 6 deterministic (code) + 7 LLM-as-judge (tool_use). Per-language thresholds from the client profile gate the result.

**Glossary enforcement** (`packages/api/src/pipeline/glossary-patcher.ts`): handled outside the LLM translation step — translate naturally first, apply glossary deterministically. The "glossary guard" re-applies cached replacements after each specialist round to prevent regressions.

**Audit trail:** every stage emits SSE events (`pipeline/events.ts`) and writes a structured `AuditEntry` with hashes, tokens, durations, and reasoning. Results persist via the `TranslationStore` interface.

## Benchmark Suite
First-class subsystem at `packages/api/src/benchmark/` (not test code). Used to prove the value prop:
- `consistency-test.ts` — N-run variance proof (consistency at scale)
- `ab-test.ts` + `comparison-agent.ts` — A/B comparisons
- `extract.ts` / `extract-glossary-v2.ts` / `profile-merge.ts` — profile + glossary extraction from sample corpora
- `aggregation.ts` / `report.ts` / `csv-export.ts` — results rollup

## Conventions
- Strict TS, no `any`. Run `bun run typecheck` before claiming done.
- Multi-agent: separate agents have narrow contracts (`SpecialistResult`, `CorrectionPlan`).
- All structured output via Anthropic `tool_use`.
- Repository pattern over storage — engine depends on `ProfileStore` / `TranslationStore` interfaces, not concrete DBs.
- Client profiles drive translation tone, glossary, thresholds, and specialist behavior. Extractable from sample documents via `ProfileExtractionAgent`.
- Specs go in `docs/specs/YYYY-MM-DD-<topic>.md`.

## Roadmap (April 2026)
Tracked in Second Brain (project: WordwideAI). 4 active workstreams:
- **A. Cleanup & docs** — finish Python deletion, write architecture + specs
- **B. `@wfx/sources`** — universal ingest package (`packages/sources/`), adapters for RSS/YouTube/HTML scraping; designed to be reusable across non-FinFlow projects
- **C. FinFlow content pipeline** — port the unmigrated Python content stack (FA/TA agents, compliance, report/chart generation, Telegram HITL, instrument catalog) to TS, consuming `@wfx/sources` for inputs and the existing translation engine for the polish layer
- **D. `@wfx/publishers`** — output adapters (Telegram, Instagram, WordPress, Discourse, email, webhook), reusable across projects

## Legacy Python Prototype
The `finflow/` directory contains the original Python prototype. The translation-engine portions (~3,200 lines: translation_engine, scoring, quality_arbiter, 4 specialists, profiles, base) have been deleted after migration. The remaining files (~2,400 lines: content_pipeline, FA/TA/compliance agents, report/chart generators, Telegram HITL, instrument catalog, data fetchers) are preserved as reference for the workstream-C TS rebuild and are **not the active codebase**.
