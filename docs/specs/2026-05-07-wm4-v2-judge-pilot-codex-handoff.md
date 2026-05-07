# WM4 v2-Judge Pilot — Codex CLI `/goal` handoff

**Status:** Handoff brief (not a design spec — execution-only)
**Date:** 2026-05-07
**Author:** Albert Galera + Claude
**Target executor:** OpenAI Codex CLI (codex-cli ≥ 0.128.0), via `/goal <argument>`
**Related:**
- `docs/specs/2026-05-06-fa-prompt-iteration.md` — design spec; locked at master `74095a2`; do NOT modify
- `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` — methodology baseline (audit §4.10.4 etc.)
- Working tree state at handoff: 4 files modified on top of master `74095a2` (`packages/api/src/benchmark/uniqueness-poc/{llm-judge.ts, runner.ts, types.ts, prompts/fa-agent.ts}`), all uncommitted
- Memory: `project_wm4_fa_prompt_pre_reg.md`, `project_judge_omission_as_fabrication_2026_05_07.md`, `project_fa_layer_eliminated_2026_05_07.md`, `reference_codex_cli_goal_command.md`

---

## How to use this file

Copy everything between the two `===` lines below and paste it as the argument to Codex CLI's `/goal` command:

```
/goal <paste the block here>
```

The structure follows OpenAI's published Codex prompting best-practices (Goal / Context / Constraints / Done when), since the `/goal` command itself is under-documented (issue [openai/codex#20536](https://github.com/openai/codex/issues/20536)). See `reference_codex_cli_goal_command.md` for the conventions.

---

=== BEGIN /goal ARGUMENT ===

**Goal:** Determine whether the WM4 FA-prompt-iteration variant's apparent fabrication-risk regression on `fed-rate-decision` is a real FA-layer effect or a v1-judge artifact, by landing Tier 0 (the v2 source-aware judge) + the bundled variant FA prompt, running a fresh full pilot, and producing a written verdict.

**Context (working tree state, all uncommitted on top of master `74095a2`):**
- `packages/api/src/benchmark/uniqueness-poc/llm-judge.ts` — Tier 0 v2 judge contract: `JUDGE_PROMPT_VERSION` = `v2-2026-05-07`; new `divergence_type` enum (`fabrication_a | fabrication_b | disagreement | omits_a | omits_b`) + required `faCoreSays` field on each `factualDivergences` entry; FA Core embedded in user message before Doc A; source-aware hard-rule override (fires only on `fabrication_a/b` and `disagreement`, NOT on `omits_a/b`).
- `packages/api/src/benchmark/uniqueness-poc/runner.ts` — FA core threaded into 4 judge call sites (intra-tenant Stage 3.5, cross-tenant Stage 6, Stage 7 control+treatment, Tier 2 swap).
- `packages/api/src/benchmark/uniqueness-poc/types.ts` — `FactualDivergenceRecord` adds optional `divergence_type` + `faCoreSays` (optional for v1-data backward compat).
- `packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts` — bundled variant FA prompt (Wave 4b Task 1 per `docs/specs/2026-05-06-fa-prompt-iteration.md` §4.1–§4.4): citation discipline, untrusted-content guardrail, mandatory probability bands, source-tier priority list. ~+1986 chars in `FA_AGENT_SYSTEM_PROMPT`.
- Spec already adversarially reviewed and committed at `74095a2` (`approve` from Codex). Spec status header reads "Proposal — decision pending"; the run produces the disposition.
- Prior v1 pilot run (this morning): `uniqueness-poc-runs/2026-05-07T10-59-15-389Z_fed-rate-pause-2026-04-03/`. Verdict under v1 judge: 4/15 fabrication_risk, Tier 2 agreement 33.3%, judge-unreliable. All four flagged divergences inspected manually were omissions, not contradictions — see `project_judge_omission_as_fabrication_2026_05_07.md`. Wave 4 pilot baseline (Surface B reference): `uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/` — 3/15 fabrication_risk (under v1 judge; not directly comparable to v2 verdicts but the persisted pair outputs ARE the comparison surface).

**Run command:** from `packages/api/`, `bun run poc:node:full -- fed-rate-decision --editorial-memory --identity in-house-journalist`. Source `.env` from repo root first (`set -a && source ../../.env && set +a`). `bun run` script wires through to `tsx` to avoid the Bun.promise-all deadlock (memory: `project_bun_promise_all_deadlock`). Process hangs after completion on Postgres connection — kill the `tsx` PID after `[index] Done` lands. Postgres at `10.1.10.230:5432` via `DATABASE_URL_DEV`.

**Metrics to measure (record verbatim from raw-data.json):**
- Stage 6 cross-tenant: `meanCosine`, `verdict`, count of pairs at each `judgeTrinaryVerdict` (distinct_products / reskinned_same_article / fabrication_risk).
- For each fabrication_risk pair: `judgeFactualDivergences[].divergence_type` distribution. Count how many are `fabrication_a/b/disagreement` (real fabrications under v2) vs `omits_a/b` (would have been false-positive flags under v1).
- Tier 2 inter-rater: `agreementRate`, `judgeUnreliableFlag`. Compare to today's v1 pilot 33.3%.
- `RunManifest.reproducibility.promptVersions.judge` MUST read `v2-2026-05-07`.
- Total `costUsd` ≤ $1.20.

**Constraints (do NOT cross these):**
- No scope expansion. Do NOT touch `report.ts` rendering, `analyze.ts` cast, or anything outside what's in working tree now. Tier 0 deferred items stay deferred.
- `bunx tsc --noEmit` from `packages/api/` MUST pass before any commit.
- Two commits, in order: (1) Tier 0 contract change (llm-judge.ts + runner.ts + types.ts) with message `feat(uniqueness-poc): v2 judge contract — pass FA core, source-aware hard rule`; (2) Variant FA prompt (fa-agent.ts) with message `feat(uniqueness-poc): WM4 Task 1 — apply §4.1–§4.4 bundled FA-prompt edits`. Run code-reviewer agent on each before committing.
- DO NOT push to remote. DO NOT reset or discard the working tree. DO NOT modify `docs/plan.md` or `docs/specs/2026-05-06-fa-prompt-iteration.md` (spec is locked at `74095a2`).
- Do not `git add -A`; stage explicit paths.
- LLM budget cap: ~$1.20 for the pilot. If the run exceeds $1.30, kill it and surface the spend overrun.
- The `.harness-profile` says typecheck-blocking, production bar, drift-detector off. Honor that: typecheck must be clean, no shortcuts.

**Done when (all of the following are true):**
1. Tier 0 commit landed on master (typecheck clean, code-reviewer passed).
2. Variant FA prompt commit landed on master (typecheck clean, code-reviewer passed).
3. Fresh pilot run completed; `RunManifest.reproducibility.promptVersions.judge = v2-2026-05-07` confirmed in raw-data.json; cost ≤ $1.20.
4. Tier 2 inter-rater check ran on the v2 outputs; `agreementRate` recorded.
5. Pilot writeup landed at `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-pilot.md` with: §1 pilot disposition (**GO-FULL / ITERATE / ABANDON** per spec §5.4 vocabulary, Surface B anchored); §2 v2-vs-v1 fabrication_risk count comparison (e.g. "v1 flagged 4/15, v2 flags X/15 of which Y are `omits_*` and Z are `fabrication_*/disagreement`"); §3 Surface A direction tag (`directionally consistent` / `directionally inconsistent` / `inverted` vs Wave 3 r2 baseline) + Wave-3-recovery blocker check; §4 Tier 2 agreement v2 vs v1 (33.3% baseline); §5 attribution verdict — "FA layer is/is-not apparently the lever under v2 judge" (use spec §5.6 forbidden-claim guardrail wording, never absolutes); §6 caveats (N=1 descriptive-only, judge unreliability if `judgeUnreliableFlag=true`); §7 next step recommendation (full run, ablation, or close).
6. Memory updated: `project_wm4_fa_prompt_pre_reg.md` reflects the v2-pilot result; `project_judge_omission_as_fabrication_2026_05_07.md` post-implementation section appended with the empirical v2-vs-v1 delta; `project_fa_layer_eliminated_2026_05_07.md` either confirms the rule-out (if v2 still says ABANDON with mostly `fabrication_*` divergences) or reverses it (if v2 says ITERATE/GO-FULL with mostly `omits_*`).
7. Final report: a 4–6 sentence summary in your final assistant reply naming the pilot disposition, the v2-vs-v1 count delta, the attribution verdict (real / artifact / mixed), and what to do next.

**Failure modes / how to recover:**
- If typecheck breaks after Tier 0 commit: revert the commit (`git reset --soft HEAD~1`), fix, re-stage, re-commit. Do not skip typecheck with `--no-verify`.
- If the pilot crashes mid-run with a Postgres error: confirm `DATABASE_URL_DEV` is set in the spawned shell env, retry once. If it crashes again, downgrade to `--editorial-memory`-disabled mode for the pilot only and note in the writeup.
- If Tier 2 sampling produces `agreementRate < 0.5` again under v2, the writeup verdict must include the judge-unreliable caveat per spec §5.6 forbidden-claim guardrails and recommend bidirectional judging (Tier 2 of the fix sequence) before accepting the FA-layer attribution.
- If the variant FA prompt produces `>5/15` `fabrication_a/b` (genuine fabrications, not omissions) under v2, that's a strong ABANDON signal — different from the v1-artifact theory; report accordingly.

=== END /goal ARGUMENT ===

---

## Out of scope for this handoff

- Bidirectional judging (Tier 2 of the fix sequence) — separate spec if v2 still shows judge unreliability.
- Two-judge ensemble (Tier 3) — separate spec if Tier 1+2 leaves measurement ambiguity.
- Hybrid deterministic/LLM judge (Tier 4) — separate spec; substantial engineering.
- Wave 4b full-run dispatch — gated on this pilot's GO-FULL disposition.
- `report.ts` / `analyze.ts` surfacing of new `divergence_type` / `faCoreSays` fields — deferred per Tier 0 implementation note.

## Expected `/goal` outcomes

- **achieved** — all 7 done-when items hold; final report delivered.
- **paused** — user interrupts; resume with `/goal resume`.
- **blocked** — Postgres unreachable + retry failed; recovery path documented.
- **budget-limited** — pilot LLM spend overrun (>$1.30); kill + surface.
- **unmet** — variant FA produces `>5/15 fabrication_*/disagreement` under v2 (genuine ABANDON signal — but goal "produce a verdict" is still achieved by reporting that result, so practically this exits as `achieved` with negative attribution).
