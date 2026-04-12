# Plan — FinFlow (wordwideAI)

**Last updated:** 2026-04-12
**Current focus:** Workstream C — content pipeline (advisor loop validation + editorial memory system)
**This session:** completed branching-model consolidation (Workstream A cleanup) — retired `workstream-b-playground`, repointed `live-promote` at `master`. See memory `project_branching_model_2026_04_11.md`.

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
| C  | FinFlow content pipeline | **active — current focus** | `docs/specs/2026-04-07-content-pipeline.md` | advisor loop passes full corpus validation; editorial memory system deployed; first tenant shipping content |
| D  | @wfx/publishers (output adapters) | planned | `docs/specs/2026-04-07-publishers.md` | `packages/publishers/` adapters (Telegram/Instagram/WordPress/email) shippable |

> **Note on B vs C:** the now-retired `workstream-b-playground` branch carried uniqueness PoC + MemPalace integration work. That work is **content-pipeline (C)**, not @wfx/sources (B). The branch name was misleading.

## Next concrete actions

- **A — next action:** resolve the open naming question below (realign `.harness-profile` or keep as-is); continue Python deletion in `finflow/`.
- **B — next action:** none (paused). Resume by scaffolding `packages/sources/` once C unblocks.
- **C — next action:** run full corpus validation for advisor loop (blocker — see `feedback_unified_pass_risk.md`). ~~Implement editorial memory Phase 1~~ (done in 5797f96 + 0f69454). Next: Phase 2 — contradiction detection.
- **D — next action:** none (planned). First adapter scoping waits on C reaching first-tenant-shipping milestone.

## Active-now focus (Workstream C)

**This week:** advisor loop validation + editorial memory system (supersedes MemPalace integration).

**Active C specs:**
- `docs/specs/2026-04-12-editorial-memory.md` — **Phase 1 complete** (0f69454); Phase 2 next (contradiction detection). Native TS editorial memory (Postgres + pgvector + OpenAI embeddings). Supersedes `2026-04-10-mempalace-integration.md`
- `docs/specs/2026-04-10-advisor-pipeline-loop.md` — implemented, default-on in master (commit `a44fdca`); pending full corpus validation
- `docs/specs/2026-04-10-advisor-tool-poc.md` — active design + implementation in `packages/api/src/pipeline/`
- `docs/specs/2026-04-08-uniqueness-poc-playground.md` — stabilizing (architecture in target zone after 2026-04-08 revision)
- `docs/specs/2026-04-08-narrative-state-persistence.md` — **implemented** (coexists with editorial memory during transition)
- `docs/specs/2026-04-07-content-uniqueness.md` — design (two-axis judge: fidelity × presentation)

**Blockers:** advisor loop needs full corpus validation before shipping (see memory `feedback_unified_pass_risk.md`).

## Cross-cutting / foundation specs

- `docs/specs/2026-04-07-deployment-stack.md` — Ubuntu/Caddy/Bun/Postgres+pgvector/Drizzle/Vercel AI SDK; applies to every workstream
- `docs/specs/2026-04-06-syntactic-calculus.md` — **pending** (design complete, implementation queued)

## Open decision (Workstream A scope)

`.harness-profile` defines **B = @wfx/sources** (universal ingest). The actual playground work was content-pipeline. Either:
- (a) realign B's definition in `.harness-profile` to match what was built, or
- (b) keep B as @wfx/sources (paused) and leave the content work fully under C.

This plan.md follows option **(b)**. Revisit if the realignment happens.
