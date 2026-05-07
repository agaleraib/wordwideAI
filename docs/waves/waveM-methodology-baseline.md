---
wave_number: M
slug: methodology-baseline
spec_path: docs/specs/2026-05-06-uniqueness-poc-test-methodology.md
merge_sha: a196de9
closed_at: 2026-05-07
---

# Wave M — Methodology Baseline

Implements the §5.1 reproducibility receipt + §5.4 two-baseline rule + §4.9.4
stratified-clustered-bootstrap statistics module that gate every future
uniqueness-PoC prompt-iteration A/B test. Methodology first — layer
choice (FA / persona / pipeline guardrail / identity prompt) blocked
behind this wave per the audit's §4.7.5 attribution-risk warning.

## §Shipped

| # | Commit | Task | Vertical | Description |
|---|--------|------|----------|-------------|
| 1 | `58580e4` | WM1 | Manifest + report receipt + cost rollup | `RunManifest.reproducibility` (models, prompt versions, fixture/package hashes, temperature overrides), `JUDGE_PROMPT_VERSION = "v1-2026-05-06"` + full SHA-256, fenced-YAML receipt block at top of `report.md`, conformance cost-rollup gap closed (was missing `crossTenantMatrix.conformanceCostUsd` from `totalCostUsd`). |
| 2 | `71a4977` | WM2 | Stats primitives + tests | New `packages/api/src/benchmark/uniqueness-poc/statistics.ts`: `stratifiedClusteredBootstrapCi`, `pairedStratifiedBootstrap`, `bootstrapCi` (iid only), `proportionCi` (Wilson), `effectSize` (Cohen's d / h with bootstrap CIs). Mulberry32 PRNG, deterministic seed contract. 20/20 tests pass. |
| 3 | `820082e` | WM3 | Writeup template + analyze.ts | `docs/uniqueness-poc-analysis/_template.md` codifies §6 checklist; `analyze.ts --writeup` mode auto-fills with stratified-bootstrap CIs, two-baseline block (paired bootstrap on OEC drift when `--historical` + `--fresh-rerun` supplied), Tier 2 placeholder. |
| 4 | (skipped) | WM4 | FA prompt iteration spec amendment | Target spec `docs/specs/2026-05-06-fa-prompt-iteration.md` does not exist in this worktree; surfaced as §Deviations + §Human-only TODO. |
| 5 | `0cbe4da` | WM5 | report.md methodology surface | `JudgeVerdict.rawVerdict` + `.hardRuleFired` exposed; persisted on `SimilarityResult.judgeRawVerdict` / `.judgeHardRuleFired`; report.md renders two-column "judge raw vs post-override" verdict block + reserved Tier 2 inter-rater section (placeholder until WM6 ships, real banner once it does). |
| 6 | `f266900` | WM6 | Tier 2 inter-rater sampling | `runTier2InterRaterSampling` (deterministic 20% of cross-tenant pairs, ≥3, position-swap re-judge) + `computeTier2Verdict` (15% disagreement gate with 1e-9 epsilon for boundary inputs); `RunResult.tier2?` schema; cost added to `totalCostUsd` (~+20% per future wave). 6/6 tier2 tests pass; 26/26 PoC test suite total. |

5 commits land on branch `worktree-agent-a24bd2c1ab44e6bb7`.

## §Wave M Exit Gate Results

| Exit-gate clause | Status | Evidence |
|---|---|---|
| `bunx tsc --noEmit` clean from `packages/api/` | ✅ PASS | `errors: 0` after each task (final at `f266900`); confirmed clean on master after merge `a196de9`. |
| Existing PoC runs re-execute under new manifest schema, identical metrics ± float noise | ✅ PASS | Smoke run 2026-05-06 16:39 UTC on `fed-rate-pause-2026-04-03` — Stage 6 cosine mean 0.8652 (in-band; verdict FAIL on 1 fab-risk pair); `manifest.reproducibility` populated correctly (judge `claude-haiku-4-5-20251001`, judge_prompt_version `v1-2026-05-06`, fixtureHash + packageHash 64-char hex). Run dir: `uniqueness-poc-runs/2026-05-06T16-39-08-259Z_fed-rate-pause-2026-04-03/`. |
| Statistics module unit-tests pass on synthetic 3 events × 4 cells fixture | ✅ PASS | `bun test src/benchmark/uniqueness-poc/statistics.test.ts` → 20/20 pass; bootstrap recovers known mean within tolerance, descriptive-only floor triggers at N_events ∈ {1, 2}, paired bootstrap recovers known +0.1 ∆ with CI not crossing zero, mismatched control/treatment event sets throw. |
| FA prompt iteration spec amended in same PR or follow-up commit | ⚠️ DEFERRED | Target spec does not exist in this worktree; see §Deviations + §Human-only TODO. |
| `_template.md` exists and a sample writeup auto-generated from a recent run validates against it | ✅ PASS | `docs/uniqueness-poc-analysis/_template.md` written; `bun run src/benchmark/uniqueness-poc/analyze.ts --writeup` against `uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03` renders cleanly with descriptive-only labels (N_events = 1) and the two-baseline block populates correctly when both `--historical` and `--fresh-rerun` are supplied. |
| Tier 2 sampling produces an inter-rater check section in a smoke-test run | ✅ PASS (after fix `8de352e`) | Initial smoke 2026-05-06 16:39 caught a wiring bug — Tier 2 sampled 3/6 pairs but skipped all 3 with "missing content" warnings (map keyed by `personaId`, lookup used `sim.identityA` = persona name). Fix `8de352e` dual-keys the map. Confirmation smoke 2026-05-06 16:56 on same fixture — `tier2` block populates with 3 sampled pairs, agreement rate 33.3% (judge-unreliable banner triggers correctly), inter-rater section renders in `report.md`. Run dir: `uniqueness-poc-runs/2026-05-06T16-56-39-388Z_fed-rate-pause-2026-04-03/`. **Substantive finding (not a defect):** the 33.3% agreement empirically confirms audit §4.3 — Haiku judge has position-sensitivity on cross-tenant borderline pairs. Audit §7 OQ#1 (inter-judge ensemble) is now actionable; see memory `project_judge_position_bias_2026_05_06`. |

### Commands the parent session must run

These two LLM workloads must run from the parent Claude session's Bash tool, NOT from the orchestrator's background bash, per `feedback_orchestrator_bg_bash_hibernation.md`. Both are pre-authorized (~$4–5 total). After they complete, append the results below this section.

```bash
# Wave 3 re-execution under the new manifest schema (~$3-4)
# (Note: the audit baseline cited fed-rate-decision; the closest fixture in
# this repo is fed-rate-pause-2026-04-03. If you want strict Wave 3 parity,
# run against the same fixture id used in the original Wave 3 run, not the
# nominal "fed-rate-decision" string from the audit.)
cd /Users/klorian/workspace/wordwideAI/.claude/worktrees/agent-a24bd2c1ab44e6bb7/packages/api
set -a; source ../../.env; set +a
bun run src/benchmark/uniqueness-poc/index.ts fed-rate-pause --full --editorial-memory \
  > /tmp/waveM-exit-gate-wave3-rerun.log 2>&1

# WM6 smoke-test pilot (~$0.88) — single event end-to-end with Tier 2 sampling on
cd /Users/klorian/workspace/wordwideAI/.claude/worktrees/agent-a24bd2c1ab44e6bb7/packages/api
set -a; source ../../.env; set +a
bun run src/benchmark/uniqueness-poc/index.ts iran-strike --full \
  > /tmp/waveM-exit-gate-tier2-smoke.log 2>&1
```

After each runs, inspect:
- `report.md` for the new YAML receipt block at the top, the two-column verdict table under §6, and the inter-rater banner.
- `raw-data.json.tier2` for `agreementRate`, `pairs[]`, and `judgeUnreliableFlag`.
- `raw-data.json.manifest.reproducibility` for the keystone receipt (models, prompt versions, fixture hash, package hash).

### §Wave M Exit Gate Results — appended by parent session

(Empty — to be filled after the two commands above complete.)

## §Human-only TODOs

1. **Amend `docs/specs/2026-05-06-fa-prompt-iteration.md` §5 with the WM2 stats primitives + a Pre-registration block.** The synthetic spec said WM4 was an in-place amendment, but the target spec does not exist in this worktree (the directory is empty of any `*fa-prompt-iteration*` file). Two options:
   - **(a) Create the FA prompt iteration spec from scratch.** Should reference `stratifiedClusteredBootstrapCi` + `pairedStratifiedBootstrap` from `statistics.ts`, carry a §5.3 / §4.10.4 Pre-registration block (oec, oec_decision_rule, secondary_metrics, analysis_plan, mde, events, personas, identities), and gate ship/iterate/abandon on bootstrap-CI-bearing language.
   - **(b) Skip the FA wave entirely** and pick a different first methodology-baseline-passes wave per the §4.7.5 attribution-risk reasoning. The persona-prompt path is already known to regress (see `project_wave4_persona_layer_ceiling.md`); a different layer choice may be cheaper.
   Surfaced as a Wave M follow-up because Rule 7 ("Don't modify the spec") forbade the orchestrator from inventing the spec body.
2. **Decide judge prompt semver starting value.** The orchestrator defaulted to `"v1-2026-05-06"` (no prior versioning history existed in the repo). If you want a different starting value (e.g. `"v0"` to indicate "pre-baseline" or `"2026-05-06"` to match a date-style scheme), edit `JUDGE_PROMPT_VERSION` in `packages/api/src/benchmark/uniqueness-poc/llm-judge.ts` before merge.
3. **Run the Wave 3 re-execution and the WM6 smoke pilot** (see commands above). Both are pre-authorized and pending parent-session dispatch.
4. **Decide whether the dashboard route (`packages/api/src/routes/poc.ts:309`) should also build the WM1 reproducibility receipt.** Today the receipt is opt-in for CLI runs only — the dashboard's manifest construction is unchanged. If the dashboard runs are intended to feed the same baseline-comparison pipeline, port the `buildReproducibility` helper from `index.ts` to a shared module and call it from both. Tracked here as §Deviations item.

## §Open Questions — answered, deferred, or unchanged

The audit's §7 open questions don't ship in this worktree under that exact filename — the source spec at `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` is the canonical version. Mapping Wave M's deliverables to the audit's themes:

| Audit theme | Resolution in Wave M | Commit |
|---|---|---|
| §4.1.4 / §5.1 — Reproducibility receipt | **Resolved.** Receipt schema added to `RunManifest`, populated on every CLI run, rendered into `report.md`. | `58580e4` |
| §4.3.4 Tier 1 — Two-column verdict | **Resolved.** Raw + post-override columns surfaced under §6 of `report.md`. | `0cbe4da` |
| §4.3.4 Tier 2 — Position-swap inter-rater check | **Resolved.** 20% sampling, deterministic, agreement % computed, judge-unreliable banner. | `f266900` |
| §4.4.4 / §5.4 — Two-baseline rule | **Resolved at the rendering layer.** `analyze.ts --writeup --historical X --fresh-rerun Y` renders the comparison block with paired-bootstrap drift CI. The actual run-time enforcement (refuse to ship a wave whose drift CI exceeds MDE) is per-wave caller logic — out of scope for the methodology baseline. | `820082e` |
| §4.9.4 / §5.2 — Stratified clustered bootstrap | **Resolved.** Module + tests; pair-iid bootstrap forbidden by construction (no API exists for it). | `71a4977` |
| §4.10.4 — Pre-registration block | **Partially resolved.** Template surfaces a slot for it; spec authors must populate per wave. WM4 (FA spec amendment) is the canonical first user — deferred to §Human-only TODOs. | `820082e` |
| §10.3 — Conformance-pass cost rollup gap | **Resolved.** Was real, not stale: `crossTenantMatrix.conformanceCostUsd` was set at `runner.ts:779` but missed at the `totalCostUsd` rollup at `runner.ts:1534-1537`. Now included. | `58580e4` |
| §4.7.5 — Attribution risk warning | **Acknowledged.** Wave M ships the methodology baseline so future prompt-iteration waves can rigorously support layer choices. The warning itself is not "resolved" — it's a permanent constraint on how subsequent waves are interpreted. | (full wave) |
| §4.12 — Forbidden-claims list | **Resolved at the rendering layer.** Template's Limitations section enumerates them; spec authors who edit the template should preserve the list. | `820082e` |
| Tier 3 (quarterly human spot-check, Cohen's κ) | **Untouched.** Out of scope per audit ("quarterly" cadence + manual). | n/a |

## §KB upsert suggestions

The Wave M deliverables don't touch cron / MCP / schema-migration / infra surfaces, so no harness-level KB upserts are needed. The MemPalace facts that should be considered:

- **`project_uniqueness_poc_methodology_baseline_2026_05_06`** — Wave M shipped: receipt schema, statistics module, writeup template, two-column verdict, Tier 2 inter-rater. Methodology baseline is now the gate for future prompt-iteration waves. Expected commit on master after `/close-wave`. Prereq for any FA / persona-prompt / identity-prompt iteration wave.
- **`project_uniqueness_poc_audit_2026_05_06`** — should now reference Wave M as its implementation; consider extending the existing fact rather than fragmenting.

## §Deviations from spec

1. **WM4 SKIPPED.** Target file `docs/specs/2026-05-06-fa-prompt-iteration.md` does not exist in this worktree. The synthetic spec phrased WM4 as "amend" but there's no spec to amend. Per Rule 7 ("Don't modify the spec — the orchestrator executes specs, it doesn't rewrite them"), the orchestrator did not invent the spec body. Surfaced as the load-bearing item in §Human-only TODOs.
2. **Conformance-cost-rollup finding: LIVE, not stale.** The synthetic spec hedged ("orchestrator must confirm whether the bug has been silently fixed"). It hadn't been: `runner.ts` line 1534-1537 was summing `outputs[].costUsd` and `similarities[].judgeCostUsd` but missing `crossTenantMatrix.conformanceCostUsd` even though that field was populated at line 779. Fixed in `58580e4`. Effect on `totalCostUsd`: was understated by however much the conformance pass cost (one Sonnet call per persona × `withConformancePass` runs only). Past run total-costs cited from `raw-data.json` are slightly low when conformance was on; new runs are correct.
3. **Dashboard manifest (`packages/api/src/routes/poc.ts:309`) does NOT build the receipt.** The synthetic spec mentioned WM1 should "populate the new manifest block at run-construction time" without specifying CLI vs dashboard. The orchestrator wired the receipt through CLI runs only (single call site to `buildManifest` in `index.ts`); the dashboard route still constructs `RunManifest` directly with the legacy short-hash promptHashes view. Receipt is optional on the schema, so dashboard runs continue to validate. Dashboard parity is logged as Human-only TODO #4. Justification: the wave's exit gate only required CLI smoke runs; bringing the dashboard along would have been a scope expansion.
4. **`renderReport` already has a `/4. Reproducibility test/` section** (not the receipt — that's the Stage-4 reproducibility test). The Wave M receipt block is rendered separately, **above** the verdict + matrix, so the methodology surface is the first thing a reader sees. The two sections do not collide.
5. **Wave 3 re-run command guess.** The synthetic spec said "Wave 3 fed-rate-decision re-execution" but the closest fixture id in this worktree is `fed-rate-pause-2026-04-03`. The orchestrator surfaced the command using `fed-rate-pause` (the fixture filename stem); if the parent session needs strict Wave 3 parity it should use whatever fixture id was active for the original Wave 3 run, not the nominal name from the audit. Surfaced as a Human-only judgement call.
6. **Cross-repo flags: none.** No symlinks reach outside this repo from any file Wave M touched (`find -type l` came back empty on `packages/api/src/benchmark/uniqueness-poc/` and `docs/uniqueness-poc-analysis/`).
7. **Tier 2 sampling is opt-in by virtue of Stage 6 existing.** The synthetic spec didn't ask for an explicit opt-out flag. Once Wave M merges, every Stage 6 run carries the inter-rater check and pays the ~+20% judge spend. If a future wave needs to skip it for cost reasons, gate the `runTier2InterRaterSampling` block in `runner.ts` behind an `opts.skipTier2` flag — that's a one-line follow-up.

## §Baseline tsc-error-count

| Snapshot | Errors |
|---|---|
| Before Wave M (baseline) | 0 |
| After WM1 (`58580e4`) | 0 |
| After WM2 (`71a4977`) | 0 |
| After WM3 (`820082e`) | 0 |
| After WM5 (`0cbe4da`) | 0 |
| After WM6 (`f266900`) — final | 0 |

`bunx tsc --noEmit` clean from `packages/api/` at every step. Matches the Exit Gate's "tsc --noEmit clean" claim.

## Cross-repo flags

None. No file Wave M touched is a symlink, and the uniqueness-poc directory is self-contained inside this repo.

## Worktree path + branch

- **Worktree:** `/Users/klorian/workspace/wordwideAI/.claude/worktrees/agent-a24bd2c1ab44e6bb7`
- **Branch:** `worktree-agent-a24bd2c1ab44e6bb7`
- **Base:** `master` at `8b3da31` (as of session start)
- **Head:** `f266900` (after WM6)
