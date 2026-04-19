# Plan — FinFlow (wordwideAI)

**Last updated:** 2026-04-16
**Current focus:** Workstream C — content pipeline (framework archetype model design + TA port)
**This session:** wrote two new decision briefs — Content Uniqueness v2 (framework archetype model) and TA TypeScript Port. The framework archetype model supersedes the House Position brief (2026-04-15). See memory `project_house_position_framework.md`.

**2026-04-16 architectural decision — Framework Archetype Model:** instead of per-tenant LLM identity calls (O(N) cost), the platform uses 3-4 pre-built framework archetypes (Conservative Advisor, Active Trader Desk, Retail Educator, Contrarian Strategist). Tenants pick a framework at onboarding, get a shared base article, then a cheap deterministic overlay (brand, glossary, CTA, company background) makes it theirs. Cost: O(K) LLM calls + O(N) cheap transforms. Decision brief: `docs/specs/2026-04-16-content-uniqueness-v2.md`.

**Source of truth for workstream definitions:** `.harness-profile`

## Shipping product — Translation Engine

`packages/api` + `packages/web`. Spec: `docs/specs/2026-04-02-translation-engine.md`. Status: shipping to tester environment (LXC 101); not yet on a dedicated production VM. Per `.harness-profile`: high-stakes B2B, production quality bar, typecheck-blocking.

## Branch model

- `master` — single source of truth for active development
- `playground-live` — FF-only promotion gate; LXC 101 (Proxmox, WireGuard) tracks this
- Workflow: develop on `master` → `live-promote` pushes `master` → `origin/playground-live` (ff-only) + triggers `update-live.sh` on LXC 101 (ff-merge → `bun install` if lockfile changed → `bun run build` → restart `finflow-api-live`).
- See memory `project_branching_model_2026_04_11.md` for full migration record.

## Branch hygiene rules

- `workstream-b-sources-spec` — **frozen ancestor**, do NOT merge or delete (see memory `project_workstream_b_branches.md`)
- `archive/web-mockup-2026-04` — leave alone, reference only
- Tag `archive/workstream-b-playground-2026-04-11` — preserves restore path for the retired playground branch (cooling-period delete ~2026-04-25)
- `poc/advisor-tool` — deleted 2026-04-11

## Workstreams

| ID | Name | Status | Lead spec | Done when |
|----|------|--------|-----------|-----------|
| A  | Cleanup & docs | ongoing | _n/a — maintenance track_ | `finflow/` legacy Python directory deleted; `architecture.md` + `pipeline-reference.md` current |
| B  | @wfx/sources (universal ingest) | **paused** — no code | `docs/specs/2026-04-07-data-sources.md` (Draft) | `packages/sources/` published with RSS + YouTube + HTML adapters |
| C  | FinFlow content pipeline | **active — current focus** | `docs/specs/2026-04-07-content-pipeline.md` | demo MVP passes E2E walkthrough with prospect; advisor loop passes full corpus validation; editorial memory system deployed; first tenant shipping content |
| D  | @wfx/publishers (output adapters) | planned | `docs/specs/2026-04-07-publishers.md` | `packages/publishers/` adapters (Telegram/Instagram/WordPress/email) shippable |

> **Note on B vs C:** the now-retired `workstream-b-playground` branch carried uniqueness PoC + MemPalace integration work. That work is **content-pipeline (C)**, not @wfx/sources (B). The branch name was misleading.

## Next concrete actions

- **A — next action:** resolve the open naming question below (realign `.harness-profile` or keep as-is); continue Python deletion in `finflow/`.
- **B — next action:** none (paused). Resume by scaffolding `packages/sources/` once C unblocks.
- **C — next action (design):** validate framework archetype model -- build 3-event x 4-framework fixture set, measure cross-framework cosine (target < 0.80), measure same-framework overlay divergence (ROUGE-L < 0.55). See `docs/specs/2026-04-16-content-uniqueness-v2.md` section 7.
- **C — next action (TA port):** Phase 1 tasks (types, indicator computation, instrument catalog, fixture data provider). See `docs/specs/2026-04-16-ta-typescript-port.md` Tasks 1-4.
- **C — next action (structural variants):** ~~Phase 1 (Tasks 1-2: type extension + assignment fn)~~ done in `c317102`. Phase 2 next — per-identity variant prompts (Tasks 3-9, parallelizable across the 6 identity files). See `docs/specs/2026-04-16-structural-variants.md`.
- **C — ongoing:** run full corpus validation for advisor loop (blocker — see `feedback_unified_pass_risk.md`). Editorial memory Phase 3 near-complete — ~~Task 10: Drizzle schema~~ (done in 1141dd8), ~~Task 11: Postgres store~~ (done in ef147c4), Task 12 blocked on production pipeline.
- **Pipeline audit trail (demo → production bridge):** `PipelineRun` type + `PipelineRunStore` interface ship with demo (in-memory); `PostgresRunStore` implementation ships with Postgres workstream. Pipeline History UI works against the interface — same screens serve both. See `docs/specs/2026-04-13-demo-mvp.md` Tasks 1, 7, and new history tasks (13c, 13d).
- **D — next action:** none (planned). First adapter scoping waits on C reaching first-tenant-shipping milestone.

## Active-now focus (Workstream C)

**This week:** framework archetype model validation + TA port foundation. Also: advisor loop corpus validation + editorial memory Phase 3 completion.

**Active C specs:**
- `docs/specs/2026-04-16-content-uniqueness-v2.md` — **Proposal** (decision brief). Framework archetype model — O(K) LLM calls instead of O(N). Supersedes House Position brief, reframes v1 uniqueness gate. Decision gated on cross-framework validation + design-partner calls.
- `docs/specs/2026-04-16-ta-typescript-port.md` — **Proposal** (decision brief). TA agent port from Python to TS, multi-timeframe model, fixture-based data provider for Phase 1. 10 tasks across 4 phases.
- `docs/specs/2026-04-13-demo-mvp.md` — **Draft** (20 tasks across 4 phases). Sales-ready E2E demo with full pipeline, publishing, per-client rebranding, and pipeline audit trail
- `docs/specs/2026-04-12-editorial-memory.md` — **Phase 3 near-complete** (Tasks 10-11 done; Task 12 blocked on workstream C production pipeline). PoC testable now via `--editorial-memory` flag against Postgres. Supersedes `2026-04-10-mempalace-integration.md`
- `docs/specs/2026-04-12-postgres-lxc.md` — **Phases 1-2 Complete** (CT 230 live, Postgres 16.13 + pgvector 0.8.2). Phases 3-5 pending (firewall, backup, CT 101 connectivity)
- `docs/specs/2026-04-10-advisor-pipeline-loop.md` — implemented, default-on in master (commit `a44fdca`); pending full corpus validation
- `docs/specs/2026-04-10-advisor-tool-poc.md` — active design + implementation in `packages/api/src/pipeline/`
- `docs/specs/2026-04-08-uniqueness-poc-playground.md` — stabilizing (architecture in target zone after 2026-04-08 revision)
- `docs/specs/2026-04-08-narrative-state-persistence.md` — **implemented** (coexists with editorial memory during transition)
- `docs/specs/2026-04-07-content-uniqueness.md` — v1 design (two-axis judge: fidelity × presentation). **Being superseded by v2 archetype model** (`2026-04-16-content-uniqueness-v2.md`)
- `docs/specs/2026-04-15-house-position-framework.md` — **Superseded** by framework archetype model (`2026-04-16-content-uniqueness-v2.md`). Position-as-input and FA-facts-only concepts carried forward; per-tenant Layer 2 capture and rules engine eliminated.

**Blockers:** advisor loop needs full corpus validation before shipping (see memory `feedback_unified_pass_risk.md`).

## Cross-cutting / foundation specs

- `docs/specs/2026-04-07-deployment-stack.md` — Ubuntu/Caddy/Bun/Postgres+pgvector/Drizzle/Vercel AI SDK; applies to every workstream
- `docs/specs/2026-04-06-syntactic-calculus.md` — **pending** (design complete, implementation queued)

## Open decision (Workstream A scope)

`.harness-profile` defines **B = @wfx/sources** (universal ingest). The actual playground work was content-pipeline. Either:
- (a) realign B's definition in `.harness-profile` to match what was built, or
- (b) keep B as @wfx/sources (paused) and leave the content work fully under C.

This plan.md follows option **(b)**. Revisit if the realignment happens.
