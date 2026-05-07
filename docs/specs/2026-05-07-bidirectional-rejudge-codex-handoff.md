# Wave 4b Bidirectional v2.1 Re-Judge — Codex CLI `/goal` handoff

**Status:** Handoff brief (not a design spec — execution-only)
**Date:** 2026-05-07
**Author:** Albert Galera + Claude
**Target executor:** OpenAI Codex CLI (codex-cli ≥ 0.128.0), via `/goal <argument>`
**Related:**
- `docs/specs/2026-05-07-wave4b-full-run-codex-handoff.md` — the prior /goal (Wave 4b full run; ITERATE-OEC-uninformative; baseline-on-fed-rate 0/15; variant 4-event mean 0.75 fabrication/event; Tier 2 mean 58.3%)
- `docs/specs/2026-05-07-judge-memory-context-fix-codex-handoff.md` — v2.1 contract handoff (commit `59685e2`)
- `docs/specs/2026-05-07-wm4-v2-judge-pilot-codex-handoff.md` — v2 contract + variant FA handoff
- `docs/specs/2026-05-06-fa-prompt-iteration.md` — design spec; locked at `74095a2`; do NOT modify
- `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` — methodology audit; §4.3 inter-rater reliability is the foundation for this /goal
- `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-full.md` — single-direction Wave 4b writeup (the verdict this /goal revises)
- Run dirs to re-judge: today's variant fed-rate pilot `uniqueness-poc-runs/2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03/`, plus the four Wave 4b runs from the prior /goal (Phase 1 baseline-on-fed-rate + Phase 2 variant on bitcoin-etf-approval / oil-supply-shock / us-cpi-surprise) — Codex captured those paths in the prior /goal's writeup; reference §1 of `2026-05-07-wave4b-fa-prompt-full.md` for the exact paths
- Memory: `project_judge_position_bias_2026_05_06.md` (the empirical position-bias measurements that motivated this fix), `feedback_judge_source_context_completeness.md`, `project_wm4_fa_prompt_pre_reg.md`, `project_uniqueness_poc_audit_2026_05_06.md` (audit §4.3 — inter-rater protocol), `feedback_pair_iid_bootstrap_forbidden.md`

---

## Why this handoff exists

Wave 4b full run produced an ambiguous verdict: ITERATE-OEC-uninformative because the OEC was at floor-zero on baseline (0/15 fed-rate fabrication), but variant produced 3 fabrication-risk pairs across 2 of the 3 non-fed-rate events under v2.1 single-direction judge (bitcoin-etf-approval=1, oil-supply-shock=0, us-cpi-surprise=2). Tier 2 mean inter-rater agreement was 58.3% — well below the audit §4.3's 85% reliability threshold.

This means the 3 residual fabrication flags carry position-bias risk. Some / all of them may be artifacts of the asymmetric way the judge reads omissions when A or B happens to be the more aggressive voice (per `project_judge_position_bias_2026_05_06.md`'s 3-measurement history of distinct↔fabrication flips on swap). The cheap and leverage-existing-data fix is to **re-judge the existing 5 Wave 4b run dirs in BOTH A→B and B→A directions** and apply a consensus rule: `fabrication_risk` fires only when both directions agree. Pairs where one direction says fabrication and the other doesn't are downgraded — the position-bias artifact class.

This /goal does NOT regenerate any persona output (that's already paid for, ~$5 of v2.1 generation costs). It only adds the swap-direction judge call for the 75 cross-tenant pairs already in the run dirs. Cost ~$0.30-0.50 total.

If after bidirectional the variant 4-event mean collapses to 0 fabrication and secondaries still clear ceilings, **SHIP becomes defensible** despite OEC being uninformative on fed-rate. If 1-2 residual flags persist under consensus, those are real and a follow-up /goal runs baseline-arm on the 3 non-fed-rate events for proper variant-vs-baseline comparison. If 3 still persist under consensus, ABANDON is the call.

This is also Tier 2 of the judge-fix sequence per `project_judge_omission_as_fabrication_2026_05_07.md`. Tier 0 (v2 contract) and Tier 0.5 / v2.1 (memory in source context) shipped in `aadd003` + `59685e2` + `1b67868`. Tier 2 has been deferred; this /goal lands the post-hoc bidirectional re-judge variant of it without making bidirectional the runner default (the latter is a separate, larger /goal for after Wave 4b's verdict is settled).

---

## How to use this file

Copy everything between the two `===` lines below and paste it as the argument to Codex CLI's `/goal` command:

```
/goal <paste the block here>
```

---

=== BEGIN /goal ARGUMENT ===

**Goal:** Apply bidirectional v2.1 judging post-hoc to the 5 existing Wave 4b run dirs (today's v2.1 fed-rate variant pilot + Phase 1 baseline-on-fed-rate + Phase 2 variant on bitcoin-etf-approval / oil-supply-shock / us-cpi-surprise), apply a strict consensus combination rule (`fabrication_risk` fires only when both A→B and B→A agree), aggregate revised counts, and render a revised Wave 4b verdict that disambiguates real fabrication from position-bias artifacts.

**Context (clean working tree on master `59685e2` + the prior /goal's commit; no uncommitted carry-in):**
- Today's verdict: ITERATE-OEC-uninformative. Baseline-on-fed-rate v2.1 = 0/15; variant 4-event mean 0.75 fabrication/event (3 total across the 4 events: fed-rate=0, bitcoin-etf-approval=1, oil-supply-shock=0, us-cpi-surprise=2); secondaries `distinct_products` 13.00/event, `reskinned_same_article` 1.25/event (both non-regressive); Tier 2 mean agreement 58.3% across the runs (judge-unreliable per WM6 ≥85% threshold).
- The 3 residual fabrication flags' single-direction reasoning is persisted in each run's `raw-data.json` under `crossTenantMatrix.similarities[].judgeFactualDivergences[]` with `divergence_type` and `sourceLabel` set per the v2.1 contract. Each fabrication-flagged pair has `judgeFactualFidelity < 0.9` AND/OR a hard-rule-firing divergence with `divergence_type ∈ {fabrication_a, fabrication_b, disagreement}` and `sourceLabel="absent"` (not in FA Core, not in either memory block).
- Wave M's `runTier2InterRaterSampling` already wires the swap-direction judge call (`runner.ts:1376` neighbourhood, `judgePairUniqueness({..., swapOrder: true})`); the infrastructure for swap calls exists and works under v2.1.
- The audit's §4.3 inter-rater protocol calls bidirectional-by-default the right Tier 2 fix; Wave M deferred it pending empirical evidence of unreliability — three measurements now have it (Wave M smoke 33.3%, v1 pilot 33.3%, v2 pilot 66.7%, v2.1 pilot 0% on presentation axis, today's Wave 4b 58.3% mean across runs). Evidence is sufficient; bidirectional is overdue.

**Implementation surface (single commit, ≤120 LOC):**

`packages/api/src/benchmark/uniqueness-poc/rejudge.ts` (NEW file, sibling to `analyze.ts`):
- CLI entry point: `bun run poc:node:rejudge -- <run-dir-path-or-glob>`. Accepts one or more run-dir paths (or a glob); processes each in turn.
- For each run dir: load `raw-data.json`. For each pair in `crossTenantMatrix.similarities` (15 pairs at K=6): call `judgePairUniqueness({contentA, contentB, faCoreAnalysis: coreAnalysis.body, memoryBlockA, memoryBlockB, cosineSimilarity, rougeL, swapOrder: true, ...})` to get the swap-direction verdict. The persona memory blocks are persisted on `identityOutputs[].editorialMemoryBlock` per the v2.1 contract — look them up by persona id matching `identityA` / `identityB`.
- For each pair, combine raw verdict (already in `raw-data.json`) with swap verdict via the consensus rule below.
- Output: write `bidirectional-verdict.json` into each run dir (NEW FILE — do NOT mutate `raw-data.json`). Schema: `{rule_version: "v1-2026-05-07", judge_prompt_version: "v2.1-2026-05-07", pairs: [{pairId, raw_verdict, swap_verdict, swap_factualDivergences, swap_sourceSays, swap_hardRuleFired, agree: bool, final_verdict: "fabrication_risk" | "distinct_products" | "reskinned_same_article" | "presentation_borderline" | "fabrication_borderline", final_verdict_reason}], summary: {raw_fabrication_count, bidirectional_fabrication_count, fabrication_axis_flip_count, presentation_axis_flip_count, agreement_rate}, costUsd}`.

**Consensus combination rule (bidirectional v1-2026-05-07):**
- raw = swap → consensus, `final_verdict = raw_verdict`, `agree = true`.
- raw ≠ swap:
  - one says `fabrication_risk`, other says `distinct_products` or `reskinned_same_article` → `final_verdict = "fabrication_borderline"` (downgrade fabrication; the asymmetric flag is the position-bias artifact class). Track in `fabrication_axis_flip_count`.
  - raw=`distinct_products`, swap=`reskinned_same_article` (or vice versa) → `final_verdict = "presentation_borderline"`. Track in `presentation_axis_flip_count`.
- A pair contributes to `bidirectional_fabrication_count` ONLY if `final_verdict == "fabrication_risk"` (i.e. consensus on fabrication). The `fabrication_borderline` class is NOT counted as fabrication — that's the position-bias-artifact class.

`packages/api/package.json`:
- Add `"poc:node:rejudge": "tsx src/benchmark/uniqueness-poc/rejudge.ts"` script.

NO changes to `llm-judge.ts`, `runner.ts`, `types.ts`, `prompts/fa-agent.ts`, `analyze.ts`, `report.ts`, or any spec doc. This is a strict additive script.

**Run command:** from `packages/api/`, `set -a && source ../../.env && set +a && bun run poc:node:rejudge -- '../../uniqueness-poc-runs/2026-05-07T15-*' '../../uniqueness-poc-runs/<phase-1-baseline-dir>' '../../uniqueness-poc-runs/<phase-2-bitcoin-dir>' '../../uniqueness-poc-runs/<phase-2-oil-dir>' '../../uniqueness-poc-runs/<phase-2-us-cpi-dir>'`. Exact paths from `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-full.md` §1. The script processes each in turn, writes a `bidirectional-verdict.json` into each, and prints a summary table.

**Metrics to measure (record verbatim from each `bidirectional-verdict.json`):**
- Per run: `raw_fabrication_count`, `bidirectional_fabrication_count`, `fabrication_axis_flip_count`, `presentation_axis_flip_count`, `agreement_rate`.
- Across the 4 variant events: mean per-event `bidirectional_fabrication_count`, total `fabrication_axis_flip_count` and `presentation_axis_flip_count`, mean `agreement_rate`.
- Phase 1 baseline-on-fed-rate `bidirectional_fabrication_count` (still 0 expected — but verify; if it goes to 1+ under swap, that's surprising and worth surfacing).
- Total cost across the 5 re-judge runs ≤ $1.

**Constraints (do NOT cross these):**
- ZERO changes to FA prompt, judge contract, runner, types, or any spec doc. The script is strictly additive.
- ONE commit max: `feat(uniqueness-poc): bidirectional v2.1 re-judge script` (rejudge.ts + package.json script entry). Run code-reviewer agent before committing. typecheck + tests must pass.
- DO NOT push to remote. DO NOT modify `docs/plan.md`. DO NOT modify `docs/specs/2026-05-06-fa-prompt-iteration.md`.
- Do not `git add -A`; stage explicit paths.
- LLM budget cap: $1 across all 5 re-judge runs. Kill if total exceeds $1.20.
- Editorial memory blocks for re-judging must come from the persisted `identityOutputs[].editorialMemoryBlock` field (v2.1 contract); do NOT call `getContext` afresh — that would inject memory state from the CURRENT Postgres at re-judge time, which differs from the state at original-run time and would invalidate apples-to-apples comparison. If a run dir's `identityOutputs[].editorialMemoryBlock` is missing or empty (would be the case for any run dir generated before commit `59685e2`), the script must surface that as a hard error and skip the run rather than silently re-judge without memory blocks.
- The `.harness-profile` says typecheck-blocking, production bar, drift-detector off. Honor that.

**Done when (all of the following are true):**
1. `rejudge.ts` script committed on master (typecheck clean, tests clean, code-reviewer passed).
2. 5 re-judge runs completed; `bidirectional-verdict.json` written into each of the 5 run dirs; total cost ≤ $1.20.
3. Each `bidirectional-verdict.json` validates: `judge_prompt_version = v2.1-2026-05-07`; `rule_version = v1-2026-05-07`; pair count = 15 per run.
4. Writeup at `docs/uniqueness-poc-analysis/2026-05-07-wave4b-bidirectional-rejudge.md` with: §1 bidirectional methodology summary (consensus rule, what `fabrication_borderline` means, how it relates to spec §5.6); §2 per-run table — for each of the 5 runs, raw fabrication count vs bidirectional fabrication count + flip rates per axis + agreement rate; §3 4-event variant aggregate under bidirectional vs single-direction (e.g. "single-direction 0.75/event → bidirectional X/event"); §4 Phase 1 baseline-on-fed-rate revised count (expected 0; flag if not); §5 revised Wave 4b verdict per the discriminating-signal table below; §6 caveats (consensus rule favors non-fabrication on disagreement; presentation-axis position bias may still be present even when fabrication consensus holds); §7 production recommendation (SHIP / ITERATE / ABANDON / further work).
5. Memory updates: `project_wm4_fa_prompt_pre_reg.md` reflects the bidirectional verdict; `project_fa_layer_eliminated_2026_05_07.md` row table updated to reflect the layer-attribution call under bidirectional v2.1; `project_judge_position_bias_2026_05_06.md` appended with Wave 4b's per-axis flip rate (4th and 5th independent measurement of the position-bias rate).
6. Final report: 4-6 sentence summary in your final assistant reply naming the variant 4-event mean fabrication count under bidirectional, the fabrication-axis flip count (how many single-direction flags collapsed under consensus), the revised disposition (SHIP / SHIP-secondary-driven / ITERATE / ABANDON), and the production recommendation.

**Failure modes / how to recover:**
- If any of the 5 run dirs lacks `identityOutputs[].editorialMemoryBlock` (would mean the run predates `59685e2` v2.1 contract): hard stop on that run dir, surface the path, exit `blocked` with the list. Do NOT silently re-judge without memory blocks — that would be v2 contract drift and invalidate comparison.
- If the rejudge script throws on any run dir mid-batch: log the error, skip that run, continue with the rest, surface failures in the final report. Don't let one bad run dir block the others.
- If `bidirectional_fabrication_count` aggregates to > 5 across the 4 variant events (would indicate variant genuinely fabricates at scale even under consensus): surface as ABANDON-with-evidence, not as a methodology issue. The bidirectional gate is conservative — surviving it means the fabrication is real.
- If `agreement_rate` is unexpectedly LOW under bidirectional (e.g. < 50% of pairs agree on raw vs swap): surface this; it suggests the v2.1 judge has substantial position-bias residual EVEN with source context complete. Recommend the next /goal be Tier 3 (two-judge ensemble — Sonnet + Haiku consensus) rather than another bidirectional refinement.
- If LLM cost exceeds $1.20: kill, surface what landed, exit `budget-limited`.

=== END /goal ARGUMENT ===

---

## Out of scope for this handoff

- **Bidirectional-by-default in the runner** — promoting `runTier2InterRaterSampling`'s 20%-sample bidirectional check to 100%-coverage on every Stage 6 run. That doubles judge cost on every future run; warranted only if Wave 4b's bidirectional re-judge proves the fabrication-axis flip rate is structurally high. Separate /goal AFTER this re-judge produces an empirical flip-rate measurement.
- **Two-judge ensemble** (Tier 3 of fix sequence) — Sonnet + Haiku consensus on disagreements. Separate /goal IF bidirectional reveals the v2.1 judge has substantial position-bias residual that consensus rule alone can't resolve.
- **Hybrid deterministic / LLM judge** (Tier 4) — regex-extract numerical claims, deterministic Axis 1 comparison, LLM Axis 2 only. Substantial engineering; separate /goal.
- **3-event baseline arm** (running baseline FA on bitcoin-etf-approval / oil-supply-shock / us-cpi-surprise to establish v2.1 baseline OEC across 4 events for proper paired-stratified-bootstrap) — ~$3 LLM. Conditionally needed AFTER this /goal: only if bidirectional preserves 1-2 fabrication flags AND the user wants to disambiguate variant-vs-baseline on those events. Separate /goal.
- **Wave 4b SHIP merge** — gated on this /goal's revised verdict.
- **Spec §5.4 OEC choice amendment** — if bidirectional confirms variant has 0 fabrication and the OEC is at floor-zero on both arms across the bench, the right long-term fix is to elevate a secondary metric to OEC for any future FA-prompt-iteration spec. Out of scope here; record as an open question if the case fires.
- **`report.ts` / `analyze.ts` rendering of bidirectional fields** — deferred per Tier 0 implementation note. Data lives in `bidirectional-verdict.json`; reporting can follow.

## Expected `/goal` outcomes

- **achieved** — all 6 done-when items hold; revised Wave 4b verdict landed (one of: SHIP, SHIP-secondary-driven, ITERATE, ABANDON, with explicit reasoning).
- **paused** — user interrupts; resume with `/goal resume`.
- **blocked** — any run dir lacks v2.1-contract memory blocks (predates `59685e2`); rejudge script can't complete its contract.
- **budget-limited** — total LLM spend > $1.20; surface what landed.

## Discriminating-signal guide for the revised verdict

After the 5 re-judge runs land, the verdict follows from this 2D table:

| Variant 4-event bidirectional fabrication count (sum across 4 events) | Phase 1 baseline bidirectional count | Verdict |
|---|---|---|
| 0 | 0 | **SHIP-secondary-driven** if secondaries (`distinct_products`, `reskinned_same_article`) clear ceilings non-regressively; **ITERATE** otherwise. The v2.1+bidirectional contract clears variant of fabrication entirely; OEC neutrality on a floor-zero baseline doesn't block a secondary-driven SHIP. |
| 1 | 0 | **ITERATE** — variant fabricates marginally on bench events under consensus; investigate flagged pair's sourceLabel + factualDivergences for root cause; spawn ablation on §4.1/§4.2/§4.3/§4.4 to find which block produced the flag. |
| 2-3 | 0 | **ITERATE-with-baseline-arm-needed** — variant has clear residual fabrication on non-fed-rate events. Cannot ABANDON yet without baseline-arm data on those 3 events (variant might be matching baseline-FA's fabrication rate, not introducing new fabrication). Recommend follow-up /goal to run baseline FA on bitcoin-etf-r2 / oil-supply-shock / us-cpi-surprise under v2.1 + bidirectional. |
| 4+ | 0 | **ABANDON** — variant introduces real fabrication at scale even under consensus; even if baseline-arm matched, the magnitude is too high for SHIP. FA-prompt layer is not the lever. |
| any | 1+ | **investigate** — Phase 1 baseline was 0/15 single-direction; if it goes to 1+ under bidirectional, that's a contradiction (consensus is more conservative; counts shouldn't INCREASE). Likely a script bug or memory-block mismatch; debug before drawing conclusions. |

The presentation-axis flip count (`presentation_axis_flip_count`) and `agreement_rate` enter the writeup as caveats / next-step recommendations, not as verdict cells.
