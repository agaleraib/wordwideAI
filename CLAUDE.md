# FinFlow — AI Financial Translation Platform

## Build & Run
```bash
cd packages/api && bun install
bun run dev                       # Hono dev server (hot reload)
bun run typecheck                 # tsc --noEmit (strict, no any)
```

## Stack
- TypeScript (Bun runtime) + Hono (API framework) + Zod (validation)
- Anthropic Claude API via @anthropic-ai/sdk (tool_use for structured output)
- Database: deferred (Convex vs Supabase TBD) — repository pattern with in-memory store for dev
- Patterns adapted from upstream autonomee/gobot (standalone, no runtime dependency)

## API Routes
- `POST /translate` — run translation pipeline (body: `{ sourceText, clientId, language }`)
- `POST /translate/stream` — SSE for real-time pipeline events
- `GET/POST/DELETE /profiles` — client profile CRUD
- `GET /health` — health check

## Conventions
- Multi-agent architecture: Translation, Scoring, Quality Arbiter, 4 Specialists (terminology, style, structural, linguistic)
- 13-metric quality scoring: 6 deterministic (code) + 7 LLM-as-judge (tool_use)
- HITL escalation when correction rounds exhausted
- Client profiles define: tone, glossary, compliance rules, brand voice, scoring thresholds
- All structured output via Anthropic tool_use (no JSON-in-text parsing)

## Legacy Python Prototype
The `finflow/` directory contains the original Python prototype (~6,100 lines). It is preserved for reference but is **not the active codebase**. The active code is in `packages/api/src/`.

## Key Reference
- `docs/finflow-personalization-engine.html` in finflow-deck repo — full technical spec
- `plan.md` — implementation roadmap (note: some sections still reference the hybrid TS+Python architecture; the decision is now pure TypeScript)
