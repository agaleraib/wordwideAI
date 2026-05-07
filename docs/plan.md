# Plan — FinFlow (wordwideAI)

**Last updated:** 2026-05-06 (later in same day)
**Current focus:** Methodology baseline implementation is the active Wave 4 successor. Codex-converged audit at `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` identifies 11 gaps and 7 baseline items; the §5.1 reproducibility receipt + §5.4 two-baseline rule + §4.9.4 stratified-clustered-bootstrap statistics module are preconditions for ANY future wave A/B. FA prompt iteration spec (`2026-05-06-fa-prompt-iteration.md`) stays parked behind this — it runs once methodology lands.
**This session:** scoped + drafted + Codex-adversarial-reviewed the test-methodology audit (3 substantive rounds + confirmation pass; converged 2026-05-06). Decision: persona-prompt vs pipeline-guardrail vs identity-prompt is no longer the open Wave 4 successor question — it's been displaced by the audit's finding that the prior-wave attribution evidence cannot rigorously support any of those layer choices until methodology fixes ship. Added research docs (FA/TA prompt reference, MCP connector schema) earlier in session.

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
- **C — next action (methodology baseline) — ACTIVE WAVE 4 SUCCESSOR:** Implement Wave M (six sub-tasks) from the test-methodology audit. Spec: `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md`. Estimated ~4 days code work; no LLM cost for harness changes; Tier 2 (WM6) adds ~+20% judge spend per future wave. Sub-tasks: WM1 RunManifest reproducibility receipt + report.md surface + conformance-cost-rollup fix + judge prompt versioning; WM2 stratified-clustered-bootstrap statistics module at `statistics.ts`; WM3 wave-writeup template + analyze.ts auto-fill + two-baseline rendering; WM4 amend FA prompt iteration spec §5; WM5 per-run report.md two-column verdict (judge raw vs post-override); WM6 Tier 2 position-swap sampling (20% of pairs, agreement reporting). Once shipped, FA prompt iteration unblocks; subsequent prompt-iteration waves use the new baseline. Full breakdown in "Wave Plan — Methodology Baseline" section below.
- **C — next action (structural variants) — DEFERRED behind methodology baseline:** ~~Phase 1~~ done in `c317102`; ~~Phase 2 (Wave 1)~~ done in merge `73da433` (2026-04-19); ~~Phase 3 (Wave 2)~~ done in merge `b62db17` (2026-04-19); ~~Phase 4 (Wave 3 — validation run + writeup)~~ done in merge `2fac649` (2026-04-19) — verdict **ITERATE**. **Wave 4 paused 2026-04-20:** items 1–3 shipped on master (`91a9018`, `096f52d`, `cd48e4b`). Item 4 pilot regressed the gate metric (`distinct_products` 5/6 → 10/15) (memory `project_wave4_persona_layer_ceiling.md`). **Audit calibration update 2026-05-06:** the Wave 4 conclusion ("persona layer is not the lever") is supported with low confidence per audit §4.7.5 — the persona-set expansion confounder (broker-a..d → broker-a..f) means the regression cannot be rigorously attributed to persona-prompt edits alone. Resolving the open layer-choice decision (FA prompt / pipeline guardrail / identity-prompt) is no longer urgent — the audit's preconditions block all of them equally. Brand-fragmentation still tracked as Wave 5 candidate (blocked on new spec).
- **C — ongoing:** run full corpus validation for advisor loop (blocker — see `feedback_unified_pass_risk.md`). Editorial memory Phase 3 near-complete — ~~Task 10: Drizzle schema~~ (done in 1141dd8), ~~Task 11: Postgres store~~ (done in ef147c4), Task 12 blocked on production pipeline.
- **Pipeline audit trail (demo → production bridge):** `PipelineRun` type + `PipelineRunStore` interface ship with demo (in-memory); `PostgresRunStore` implementation ships with Postgres workstream. Pipeline History UI works against the interface — same screens serve both. See `docs/specs/2026-04-13-demo-mvp.md` Tasks 1, 7, and new history tasks (13c, 13d).
- **D — next action:** none (planned). First adapter scoping waits on C reaching first-tenant-shipping milestone.

## Active-now focus (Workstream C)

**Status:** ACTIVE — methodology baseline implementation as Wave 4 successor (per audit `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` §5).

**Why this displaced the layer-choice decision:** the audit's §4.7.5 attribution-risk warning establishes that prior-wave evidence cannot rigorously support layer choices (persona-prompt / FA prompt / pipeline guardrail / identity-prompt) until the reproducibility receipt + two-baseline rule ship. Picking a layer to iterate on without those fixes inherits the same mis-attribution pathology Wave 4 just exhibited. Methodology first, layer second.

**This week's deliverables (Wave M, ~4 days total):**
1. WM1 — `RunManifest.reproducibility` extension + report.md surface + conformance-cost-rollup fix + judge prompt versioning (~1 day)
2. WM2 — Stratified-clustered-bootstrap statistics module (~1 day)
3. WM3 — Wave-writeup template + analyze.ts auto-fill + two-baseline rendering (~1 day)
4. WM4 — Amend FA prompt iteration spec §5 (~hour)
5. WM5 — Per-run report.md methodology surface (judge raw vs post-override columns) (~1 hour)
6. WM6 — Tier 2 judge-reliability sampling (20% position-swap, agreement reporting) (~3 hours)

**Once methodology lands, the next active piece becomes:** FA prompt iteration spec runs as the first wave under the new methodology. Other queued items (framework archetype validation Phase 3, TA TS port Phase 1, advisor-loop full-corpus validation, editorial memory Task 12) remain unstarted but are not blocked by the audit — they can run in parallel if capacity allows.

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
- `docs/specs/2026-05-06-uniqueness-poc-audit-plan.md` — **complete** (gates the audit, audit converged 2026-05-06)
- `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` — **Final, Codex-converged 2026-05-06**. Gates all future uniqueness-PoC prompt-iteration A/B tests until §5.1 + §5.4 + §4.9.4 fixes ship.

## Wave Plan — Methodology Baseline (Wave 4 successor)

Source spec: [`docs/specs/2026-05-06-uniqueness-poc-test-methodology.md`](./specs/2026-05-06-uniqueness-poc-test-methodology.md). Codex-adversarial-reviewed 2026-05-06 (3 substantive rounds + confirmation pass). Implementing §5.1 + §5.4 + §4.9.4 is the precondition for any future uniqueness-PoC prompt-iteration A/B test.

Conventions:
- All work targets `packages/api/src/benchmark/uniqueness-poc/` — PoC harness only.
- No LLM cost for harness changes (WM1-WM5); Tier 2 (WM6) adds ~+20% judge spend per future wave.
- Estimated ~4 days total (revised from 2-3 days after reporting + Tier 2 surface-area review).

### Wave M — Methodology baseline implementation

- [x] **WM Methodology baseline — Size: L (~4 days)** — commits `58580e4` (WM1 receipt + judge semver + cost-rollup), `71a4977` (WM2 stats module + 20 tests), `820082e` (WM3 template + analyze.ts auto-fill), `0cbe4da` (WM5 two-column verdict + reserved Tier 2), `f266900` (WM6 Tier 2 sampling + 6 tests), `8de352e` (post-merge fix — Tier 2 lookup keyed by persona.name not id; caught by smoke). Merge `a196de9`. WM4 (FA prompt iteration spec — pre-registration block + WM2 stats wiring) closed 2026-05-08 in `8f1243b` (post-Wave-M follow-on; spec authored from scratch this session). Summary: `docs/waves/waveM-methodology-baseline.md`.
  - [spec: uniqueness-poc-test-methodology](./specs/2026-05-06-uniqueness-poc-test-methodology.md)
  - WM1: `RunManifest.reproducibility` extension + per-run reporting surface — pinned model versions per call, prompt versions (semver + SHA-256), fixture content hash, package version hash; surface receipt block at top of `report.md`; fix conformance-pass cost silently omitted from `totalCostUsd` (per Explore finding §10.3); add `judge_prompt_version` semver alongside hash. (~1 day; audit §5.1 + §4.1.4 + §4.3.4 Tier 1)
  - WM2: Stratified clustered bootstrap statistics module at `packages/api/src/benchmark/uniqueness-poc/statistics.ts` — events as top-level resampling unit, within-event-only pair reconstruction, paired-arms variant comparison primitive, mandatory N_events + estimand reporting, descriptive-only floor at N_events < 3. (~1 day; audit §5.2 + §4.9.4)
  - WM3: Two-baseline-rule wave-spec template + analyze.ts integration + writeup auto-fill — wave-writeup template at `docs/uniqueness-poc-analysis/_template.md` codifies §6 operating-procedure checklist; `analyze.ts` auto-fills the template with stratified-bootstrap CIs + N_events + estimand stubs from `raw-data.json`; renders historical-vs-freshly-rerun two-baseline comparison block; if drift > MDE, debug before evaluating variant. (~1 day; audit §5.4 + §4.4.4 + §6 + §4.10.4)
  - WM4: ~~Update FA prompt iteration spec (`2026-05-06-fa-prompt-iteration.md`) §5 to reference the new statistics primitives + add a Pre-registration block per audit §4.10.4.~~ **Done 2026-05-08 in `8f1243b`** — spec authored from scratch this session (was absent at Wave M close); added §5.6 Pre-registration with all 8 audit §4.10.4 fields (oec=fabrication_risk, paired-stratified-bootstrap CI gate, MDE honesty for N_events=4) and explicit WM2 statistics.ts citations (`pairedStratifiedBootstrap`, `proportionCi`, `effectSize`, `DEFAULT_ITERS`, `MIN_CLUSTERS_FOR_INFERENCE`, `BootstrapCiResult`). Side-effect: §9 OQ#1 closed-by-pre-reg (rotation seed pinned). Spec NOT yet adversarially reviewed — `/planning-loop --revise` is the next step before any Wave 4b dispatch.
  - WM5: Per-run report.md methodology surface — judge verdict reported in two columns ("judge raw" vs "post hard-rule override"); inter-rater check section reserved for WM6 output; reproducibility receipt rendered above similarity matrix. (~1 hour; audit §4.3.4 Tier 1 + §5.5)
  - WM6: Tier 2 judge-reliability sampling — `runner.ts` samples 20% of cross-tenant pairs (≥3 pairs whichever larger) for position-swap judge call; agreement rate computed and persisted in `raw-data.json.tier2`; `report.md` renders the inter-rater check section with raw + swapped verdicts + agreement %; flag wave as judge-unreliable if disagreement > 15% on the gate metric. Adds ~+20% judge spend per future wave. (~3 hours; audit §4.3.4 Tier 2 + §5.5)

**Wave M exit gate (PASS 2026-05-07, merge `a196de9`):** ✓ `bunx tsc --noEmit` clean on `packages/api/`. ✓ existing PoC re-execution under new manifest schema validated via smoke run `2026-05-06T16-39-08-259Z_fed-rate-pause-2026-04-03` (in-band metrics, manifest.reproducibility populated). ✓ statistics module unit-tests 20/20 pass on synthetic 3-event × 4-cell fixture. ✓ FA-spec amendment **(2026-05-08 follow-up — closed in `8f1243b`; was DEFERRED at Wave M close 2026-05-07)**. ✓ `_template.md` shipped + `analyze.ts --writeup` validated against existing run. ✓ Tier 2 inter-rater section renders with real data via smoke run `2026-05-06T16-56-39-388Z_fed-rate-pause-2026-04-03` after fix `8de352e`. **Substantive finding (NOT a defect):** Haiku judge agreement only 33.3% on cross-tenant gate metric — audit §4.3 hypothesis empirically confirmed; audit §7 OQ#1 (inter-judge ensemble) now actionable. See memory `project_judge_position_bias_2026_05_06`.

**Dependencies:** none. Audit (`docs/specs/2026-05-06-uniqueness-poc-test-methodology.md`) is the design input; this wave implements it.

**Once Wave M ships:** FA prompt iteration (`2026-05-06-fa-prompt-iteration.md`) becomes the first wave under the new methodology. Other layer-choice candidates (pipeline guardrail, identity-prompt) re-enter the candidate pool with rigorous attribution available for future selection.

**Out of scope (deferred):** Tier 3 human κ spot-check (audit §5.5) — quarterly cadence, ~1 hour human time per cycle; not blocking, not recurring per-wave. Inter-judge ensemble (audit §7 open question #1) — separate architectural decision pending Tier 2 disagreement evidence. Multi-comparisons correction reporting (audit §4.6) — wave-spec-level concern in pre-registration blocks, not the harness.

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

- [~] **V4 Structural variants iteration — PAUSED 2026-04-20** (items 1–3 shipped on master `096f52d`/`91a9018`/`cd48e4b`; item 4 pilot run showed persona-layer fixes regressed the production-gate metric — `distinct_products` 5/6 (Wave 3 r2) → 10/15 (pilot). See pilot run `uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/` and memory `project_wave4_persona_layer_ceiling.md`. Iteration continues at a different layer — persona-prompt is not the lever. Live-promote bar per memory `project_live_promote_bar.md` is unchanged regardless.)
  - [spec: structural-variants](./specs/2026-04-16-structural-variants.md)
  - [analysis: 2026-04-19-wave3 §§1–3](./uniqueness-poc-analysis/2026-04-19-wave3.md)
  - [x] Item 1 — Grow same-variant control set: add `broker-e.json` (Meridian Macro, variant 2) + `broker-f.json` (Apex Quant Desk, variant 3) under `packages/api/src/benchmark/uniqueness-poc/personas/`, matching shape of existing broker-a/b/c/d. Pair distribution becomes 3 same-variant pairs/event (a↔d v1, b↔e v2, c↔f v3) vs 1 today. Addresses Wave 3 analysis §1 (sample size). **Done in `91a9018`.**
  - [x] Item 2 — Triage `fasttrade-pro` persona (`personas/broker-b.json`): drop aggressive/prescriptive/high-conviction tags; add opportunistic + calibrated; extend `forbiddenClaims` with 4 fabrication-specific bans (invented probabilities, fabricated point estimates, un-anchored directional calls, unstated forward-guidance); append facts-only anchoring sentence to `brandVoice`. Preserve brand energy. Root cause in memory `project_fasttrade_pro_persona_rootcause.md`. Addresses Wave 3 analysis §2 (fid=0.75 outlier) and resolves parking-lot item 2026-04-19. **Done in `096f52d`.**
  - [x] Item 3 — Widen Stage 6 via `--identity <id>` CLI flag (index.ts) with IDENTITY_REGISTRY validation. Applies to Stages 4/5/6 consistently; default preserves backward compat. Rotation across events gives ≥3-identity coverage without per-event LLM-cost multiplication. Addresses Wave 3 analysis §3 and priority #4. **Done in `cd48e4b`.**
  - [ ] Item 4 — Extended LLM validation run (parent-session, out of wave scope per `feedback_orchestrator_bg_bash_hibernation.md`): `--full --editorial-memory` on 3-4 events × rotating identity, analysis under `docs/uniqueness-poc-analysis/2026-04-20-wave4-iteration.md`. Budget: ~$3–5.

**Wave 4 exit gate — items 1–3 result:** PASS. `bunx tsc --noEmit` 0 errors in `packages/api/`. New broker fixtures parse as valid `ContentPersona` (runtime validated via `require()` — ids + tags + variants enumerate correctly). Fasttrade-pro JSON edit preserves schema (all ContentPersona required fields present). `--identity` CLI validation smoke-tested: rejects `bogus-identity` with valid-list before any API call. Item 4 (LLM run) deferred to parent session.

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
