# Plan — FinFlow (wordwideAI)

**Last updated:** 2026-04-20
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
- **C — next action (structural variants):** ~~Phase 1~~ done in `c317102`; ~~Phase 2 (Wave 1)~~ done in merge `73da433` (2026-04-19); ~~Phase 3 (Wave 2)~~ done in merge `b62db17` (2026-04-19); ~~Phase 4 (Wave 3 — validation run + writeup)~~ done in merge `2fac649` (2026-04-19) — verdict **ITERATE** with strong upward signal on production-gate metric (A/B vs 2026-04-15 baseline: `distinct_products` 2/6→5/6, `reskinned_same_article` 2/6→0/6, `fabrication_risk` 2/6→1/6). **Scheduled 2026-04-20:** Wave 4 — Structural variants iteration (3 parallel mechanical prep items; extended LLM run post-merge in parent session). Brand-fragmentation still tracked as Wave 5 candidate (blocked on new spec).
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

## Wave Plan — Structural Variants

Source spec: [`docs/specs/2026-04-16-structural-variants.md`](./specs/2026-04-16-structural-variants.md). Phase 1 (type extension + variant-assignment fn) shipped in `c317102` — waves below cover Phases 2-4.

Conventions:
- Sub-bullets are authoritative scope (per `feedback_plan_md_sub_bullets_win.md`).
- Each wave is one rollback-safe batch dispatched via `/run-wave N`.
- All work targets `packages/api/src/benchmark/uniqueness-poc/` — PoC harness, not the production pipeline.

### Wave 1 — Per-identity variant prompt files

**Why this wave:** Phase 2 of the spec. Build the 6 per-identity variant prompts and update the registry. Tasks 3-8 are independent (one file each) and parallelizable; Task 9 depends on them. No harness, runner, or fixture changes — purely additive prompt data behind the existing `buildXxxUserMessage` signature.

- [x] **V1 Identity variant prompts — Size: M** (closed in merge `73da433`; summary `docs/2026-04-19-wordwideAI-wave1-summary.md`)
  - [spec: structural-variants](./specs/2026-04-16-structural-variants.md)
  - Task 3: Trading Desk variants (3 variants) — `prompts/identities/trading-desk.ts` (done in `40280be`)
  - Task 4: In-House Journalist variants (3 variants) — `prompts/identities/in-house-journalist.ts` (done in `6ae8178`)
  - Task 5: Senior Strategist variants (3 variants) — `prompts/identities/senior-strategist.ts` (done in `c1b42c0`)
  - Task 6: Newsletter Editor variants (2 variants) — `prompts/identities/newsletter-editor.ts` (done in `ab6e327`)
  - Task 7: Educator variants (3 variants) — `prompts/identities/educator.ts` (done in `4816dea`)
  - Task 8: Beginner Blogger variants (2 variants) — `prompts/identities/beginner-blogger.ts` (done in `a7f58d8`)
  - Task 9: Identity registry exposes variant maps + `variantCount` — `prompts/identities/index.ts` (done in `de6d30c`)
  - CHANGELOG entry (resolves OQ#4) — `prompts/identities/CHANGELOG.md` (done in `e682c40`)

**Wave 1 exit gate — result:** PASS. `bun run typecheck` 0 errors from `packages/api/`. All 16 variant headers verified (6 identities × 2+ variants each). Variant 1 output is byte-identical to the pre-change template for all 6 identities (12 diff-zero checks: undefined + explicit variant 1). `IDENTITY_VARIANT_COUNTS` sums to 16 (3+3+3+2+3+2). Combined verification suites: 43 pass / 0 fail.

**Pre-implementation decisions — resolved at merge:**
- OQ#1: User message injection (system prompts untouched; prompt-hash tracker unchanged).
- OQ#2: Metadata-carrying variant entry shape — `StructuralVariantEntry = { directive; targetWordCount? }`. Only `SENIOR_STRATEGIST_VARIANTS[3]` carries the override today.
- OQ#4: CHANGELOG entry added (`e682c40`). No other hash tracker needed updating because system prompts are unchanged.

### Wave 2 — Harness integration (fixtures, runner, manifest)

**Why this wave:** Phase 3 of the spec. Wire the variant prompts through the runner and persist variant choice in run output. Single rollback-safe unit — fixtures, runner wiring, and manifest recording are all harness plumbing inside `packages/api/src/benchmark/uniqueness-poc/` and fail/succeed together. Includes a small spec amendment (code-adjacent maintenance, not silent).

- [x] **V2 Harness integration — Size: M** (closed in merge `b62db17`; summary `docs/2026-04-19-wordwideAI-wave2-summary.md`)
  - [spec: structural-variants](./specs/2026-04-16-structural-variants.md)
  - Task 10: broker fixtures distribute variants 1/2/3/1 (done in `a2afa41`)
  - Task 11: runner threads `persona.structuralVariant` through Stage 5/6 + guardrail log on non-default (done in `743a6e6`)
  - Task 12: `IdentityOutput.structuralVariant` field + persist propagation + report annotation (done in `4709ec7`)
  - Spec amendment: §6.10, §7 Task 11 Verify, §10 OQ#5 narrowed to Stage 5/6 (done in `c4ae6ae`)
  - CHANGELOG entry: `prompts/identities/CHANGELOG.md` Wave 2 entry (done in `e008876`)

**Wave 2 exit gate — result:** PASS on every mechanical and documentation clause. `bun run typecheck` clean. Spec amended (3 edits, no unrelated text changed). CHANGELOG entry appended. `IdentityOutput.structuralVariant` field, runner guardrail log, and report annotations (`(variant N)` headers, `· structural variant N` stats line, `Variants` column in pairwise matrix) all verified offline. Live `--full` Stage 6 LLM run + visual sanity check intentionally deferred to Wave 3 (same `--full --editorial-memory` run already planned there — avoids spending the LLM budget twice).

### Wave 3 — Validation run + writeup

**Why this wave:** Phase 4. Pure measurement — no code. Always runs after Wave 2; the writeup verdict (ship vs. iterate) is the output, not a gate. Post-Wave-3 production wiring is a separate conversation, not a wave.

- [x] **V3 Structural variant validation — Size: S (no code, ops + analysis)** — merged in `2fac649` (2026-04-19)
  - [spec: structural-variants](./specs/2026-04-16-structural-variants.md)
  - Task 13: Run `--full --editorial-memory` on ≥2 events, capture cosine + ROUGE-L for pairs that differ in variant vs pairs that share variant 1, writeup under `docs/uniqueness-poc-analysis/2026-04-19-wave3.md` (deviation: durable writeup lives under `docs/uniqueness-poc-analysis/` instead of gitignored `uniqueness-poc-runs/<run-id>/analysis.md` — pre-approved at dispatch)

**Wave 3 exit gate — result:** PASS with deviation noted. ≥2 events run (fed-rate-decision r2 + bitcoin-etf-approval). Mean cosine drop against 2026-04-15 same-event baseline: −0.044 (in spec §5.1 range). ROUGE-L drop: −0.028 (below the 0.08-0.15 estimate, directionally correct — code drift between baselines is a confounder). Judge fidelity aggregate ≥ 0.90 PASS (0.904 fed-rate, 0.932 bitcoin). One pair regressed to fid=0.75 (premium↔fasttrade fed-rate) — measured as persona-prompt-driven (same fid=0.75 on variant 1 baseline AND variant 2 Wave 3 — variant-independent), not variant-driven; spec deviation §1 in `docs/2026-04-19-wordwideAI-wave3-summary.md` documents the per-pair triage reasoning. Verdict line: "ITERATE" (with strong upward signal on production-gate metric per post-hoc A/B: distinct_products 2/6→5/6, reskinned_same_article 2/6→0/6, fabrication_risk 2/6→1/6).

**Dependencies:** Wave 2.

### Wave 4 — Structural variants iteration (Wave 3 follow-on)

**Why this wave:** Wave 3 closed with verdict ITERATE and four mechanical prep items before the extended validation run can go. Items below are independent (different files, no shared state) and parallel-safe. The extended LLM run itself is deliberately NOT in this wave per `feedback_orchestrator_bg_bash_hibernation.md` — it runs from the parent session after merge.

- [ ] **V4 Structural variants iteration — Size: S**
  - [spec: structural-variants](./specs/2026-04-16-structural-variants.md)
  - [analysis: 2026-04-19-wave3 §§1–3](./uniqueness-poc-analysis/2026-04-19-wave3.md)
  - Item 1 — Grow same-variant control set: add `broker-e.json` (variant 2) + `broker-f.json` (variant 3) under `packages/api/src/benchmark/uniqueness-poc/personas/`, matching shape of existing broker-a/b/c/d. Pair distribution becomes 2 same-variant pairs/event (vs 1 today). Addresses Wave 3 analysis §1 (sample size).
  - Item 2 — Triage `fasttrade-pro` persona (`personas/broker-b.json`): tighten `forbiddenClaims` (add bans on fabricated probabilities, un-sourced directional calls, invented price levels); soften `personalityTags` (keep energy/urgent; drop prescriptive/high-conviction); add `brandVoice` sentence requiring facts-only anchoring to source doc. Preserve brand identity. Root cause documented in memory `project_fasttrade_pro_persona_rootcause.md`. Addresses Wave 3 analysis §2 (fid=0.75 outlier) and resolves parking-lot item 2026-04-19.
  - Item 3 — Widen Stage 6 to ≥3 identities in `runner.ts`: expose identity set via CLI flag (`--stage6-identities <csv>`) or default-loop over `[in-house-journalist, trading-desk, educator]`. Handle v3-clamps on 2-variant identities gracefully (educator has 3, in-house-journalist has 3, trading-desk has 3 — no clamping risk with this default set). Addresses Wave 3 analysis §3 and priority #4.

**Wave 4 exit gate:** `bunx tsc --noEmit` 0 errors from `packages/api/`. New broker fixtures parse as valid `ContentPersona` (spot-check via runtime load or `JSON.parse` test). Fasttrade-pro JSON edit preserves schema (all required fields present). Stage 6 widening: dry-run or unit test shows ≥3 identities enumerate correctly without triggering v3-clamp warnings on the default identity set. **No LLM call required in the wave** — live run is deferred to parent session (see below).

**Out of scope — parent session after merge:** Run `--full --editorial-memory` on 3-4 events spanning topic diversity (candidates: fed-rate-decision r3, bitcoin-etf-approval r2, oil-supply-shock, us-cpi-surprise) against the widened fixture set + widened Stage 6. Produce durable analysis under `docs/uniqueness-poc-analysis/2026-04-20-wave4-iteration.md` comparing cross-variant vs same-variant pair distributions with n≥2 same-variant pairs per event. Budget: ~$3–5 LLM spend (4 events × ~$0.75 each + judge overhead). This step is priority #3 from the Wave 3 post-merge note.

**Dependencies:** Wave 3 (merged). None within this wave (all three items independent).

---

### Wave 5 candidate — Brand-fragmentation test for intra-tenant cross-pipeline (NEW SPEC NEEDED, NOT SCHEDULED)

**Why this candidate exists:** Wave 3 surfaced a metric-architecture gap. The PoC's existing "intra-tenant" verdict (Stage 3.5) compares 6 different identity agents *with no persona overlay applied* — it measures **identity-format diversity** (do different identity templates produce visibly different formats? — design intent, should be high), NOT brand coherence. The actual intra-tenant brand-fragmentation question — *does the same identity for the same tenant produce a recognizable house voice across multiple pipeline runs?* — is **unmeasured anywhere in the PoC today**. This matters before scaling cross-tenant variant rollout, because variants could amplify within-tenant brand drift without us noticing.

User-facing labels in `index.ts` / `report.ts` / `analyze.ts` were renamed in Wave 3 follow-up to clarify the semantics ("Intra-tenant verdict" → "Identity-format diversity verdict (no-persona)"). Internal `Stage` discriminator (`"intra-tenant" | "cross-tenant"`) stays for raw-data.json compatibility.

**Pre-requisite (blocking):** new spec at `docs/specs/2026-04-XX-brand-fragmentation.md` (not yet written). Spec should define:
- Test design — same tenant + same identity, N invocations across N events (or N briefs for the same event)
- Inverted judge rubric polarity for intra-tenant: `reskinned_same_article` = PASS (consistent house voice), `distinct_products` = yellow flag (brand fragmenting), `fabrication_risk` = HALT (universal — factual integrity is context-free)
- Threshold semantics — spec already permits cosine < 0.92 / ROUGE < 0.50 for intra-tenant cross-pipeline; new test should USE those, not the strict cross-tenant 0.80/0.40
- Where the gate sits in the production pipeline (per-article post-conformance vs. periodic audit)
- What "consistent house voice" looks like to the judge (extends `judgePairUniqueness` rubric or new prompt variant)

**Likely runner change:** new test stage in `runner.ts` (Stage 7 or 4.5) running same-identity across N events for one persona, plus a context-aware verdict aggregator (`computeIntraTenantBrandVerdict` with inverted polarity). New judge rubric variant in `llm-judge.ts` or a rubric flag on the existing call.

**Estimated effort:** spec (M), runner extension (M), validation run (S — but needs ≥3 events × ≥1 persona × ≥1 identity = 3+ harness runs at ~$0.75 each).

**Not scheduled** — gated on whether continued investment in structural variants (post-Wave-3 ITERATE verdict) makes sense. The brand-fragmentation question still applies regardless of variant rollout direction (it's a persona-overlay-layer concern), so worth specifying even if structural variants stall.

**Operating Rules (apply to all waves):**
- Stage files explicitly — never `git add -A` / `git add .`
- `--no-ff` merges on the wave branch into master
- Strict TS, no `any` — `bun run typecheck` is blocking
- Variant 1 = current template for every identity (backward compat is non-negotiable per spec §8)
- No system-prompt changes — variants inject via user message only (spec §8, OQ#1 caveat)

## Open decision (Workstream A scope)

`.harness-profile` defines **B = @wfx/sources** (universal ingest). The actual playground work was content-pipeline. Either:
- (a) realign B's definition in `.harness-profile` to match what was built, or
- (b) keep B as @wfx/sources (paused) and leave the content work fully under C.

This plan.md follows option **(b)**. Revisit if the realignment happens.
