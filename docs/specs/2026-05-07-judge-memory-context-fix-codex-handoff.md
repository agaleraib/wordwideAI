# Judge v2.1 — Editorial-Memory Source Context Fix — Codex CLI `/goal` handoff

**Status:** Handoff brief (not a design spec — execution-only)
**Date:** 2026-05-07
**Author:** Albert Galera + Claude
**Target executor:** OpenAI Codex CLI (codex-cli ≥ 0.128.0), via `/goal <argument>`
**Related:**
- `docs/specs/2026-05-07-wm4-v2-judge-pilot-codex-handoff.md` — yesterday's handoff (v2 judge + variant FA pilot); the v2 result motivates this follow-up
- `docs/specs/2026-05-06-fa-prompt-iteration.md` — design spec for WM4; locked at `74095a2`; do NOT modify
- `docs/specs/2026-04-12-editorial-memory.md` — editorial memory system spec (the producer-side source the v2 judge currently can't see)
- `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-pilot.md` — v2 pilot writeup (ITERATE; 3/15 fabrication_b all `(absent from FA Core)`)
- Run dirs: `uniqueness-poc-runs/2026-05-07T14-45-51-519Z_fed-rate-pause-2026-04-03/` (v2, 3/15) and `uniqueness-poc-runs/2026-05-07T10-59-15-389Z_fed-rate-pause-2026-04-03/` (v1, 4/15)
- Memory: `feedback_judge_source_context_completeness.md` (the methodological principle this fix implements), `project_judge_omission_as_fabrication_2026_05_07.md` (v2 implementation + post-mortem), `project_wm4_fa_prompt_pre_reg.md` (current WM4 status), `feedback_editorial_memory_tenant_not_persona.md` (why memory must stay)

---

## Why this handoff exists

Yesterday's v2 judge fix correctly removed the omission-as-fabrication false-positive class. But the v2 pilot still flagged 3/15 cross-tenant pairs as `fabrication_risk`, ALL with `divergence_type = fabrication_b` and `faCoreSays = "(absent from FA Core)"`. Inspection found the source-absent claims are historical anchors / prior-position references that the personas legitimately surfaced from their **injected editorial memory blocks** — which the v2 judge does NOT see. The judge's verdict is technically correct relative to its incomplete source set; the contract is incomplete.

Editorial memory is intentional product behavior (per-tenant continuity; `project_stage7_ab_result_2026_04_13.md` validated +3.4% cosine improvement). The fix is to **extend the judge's source-context set to include each producer's memory block alongside FA Core**, NOT to disable memory.

This /goal lands the v2.1 contract extension and re-runs the pilot to disambiguate: do the remaining 3/15 flags collapse (memory was the source) or persist (genuine fabrication beyond either source)?

---

## How to use this file

Copy everything between the two `===` lines below and paste it as the argument to Codex CLI's `/goal` command:

```
/goal <paste the block here>
```

Same Goal/Context/Constraints/Done-when structure validated 2026-05-07 by yesterday's WM4 v2-judge handoff (Codex completed in 1817s with full audit). See `reference_codex_cli_goal_command.md` for conventions.

---

=== BEGIN /goal ARGUMENT ===

**Goal:** Land judge contract v2.1 — extend the v2 source-aware judge to include each producer's editorial-memory block in its source ground truth alongside FA Core — and re-run the WM4 pilot under v2.1 on `fed-rate-decision` to determine whether the v2 pilot's 3/15 `fabrication_b` flags collapse (editorial memory was the source) or persist (genuine source-absent fabrication beyond either source).

**Context (clean working tree on master `1b67868`, no uncommitted changes carried in):**
- Yesterday's commits: `aadd003` Tier 0 v2 judge contract, `1b67868` WM4 §4.1–§4.4 bundled FA variant. Both stay; this /goal does NOT touch the FA prompt.
- v2 pilot result: `uniqueness-poc-runs/2026-05-07T14-45-51-519Z_fed-rate-pause-2026-04-03/` — 3/15 `fabrication_risk` Stage 6, ALL `divergence_type=fabrication_b`, ALL `faCoreSays="(absent from FA Core)"`, 0 `omits_*`. Disposition ITERATE. Tier 2 agreement 66.7% (judge-unreliable ≥85% threshold not cleared).
- Diagnostic (per `feedback_judge_source_context_completeness.md`): the personas got editorial memory blocks injected via `getContext` → `renderedBlock` from `PostgresEditorialMemoryStore`, but the v2 judge user message contained only the FA Core. So a persona faithfully quoting a memory-stored historical anchor reads as "absent from FA Core" → `fabrication_b` → hard rule fires.
- Editorial memory must remain enabled. Per `project_stage7_ab_result_2026_04_13.md` it improved cosine by 3.4% in the Stage 7 A/B; per `feedback_editorial_memory_tenant_not_persona.md` it's tenant-scoped continuity infrastructure with independent product value. Disabling memory for cleaner judge numbers trades a real production property for measurement convenience — wrong direction.

**Implementation surface (single commit, ≤80 LOC across 3 files):**

`packages/api/src/benchmark/uniqueness-poc/llm-judge.ts`:
- Bump `JUDGE_PROMPT_VERSION` from `v2-2026-05-07` to `v2.1-2026-05-07`.
- Add optional `memoryBlockA?: string` and `memoryBlockB?: string` to `judgePairUniqueness` args. Both default to `undefined` so callers without memory keep working.
- Update user message: when `memoryBlockA` or `memoryBlockB` is present, embed it AFTER FA Core and BEFORE Doc A in a fenced section labelled `# Editorial Memory Block — ${labelA} (additional ground truth available to ${labelA} only)` — same for B. When swapOrder is true, swap the memory blocks too (so the persona's memory follows its document's labelling).
- Update the system prompt's "FA Core is your GROUND TRUTH" anchor to: "Ground truth = the FA Core PLUS each document's editorial memory block (if provided). A fact present in EITHER the FA Core OR the document's memory block is faithful — only facts absent from BOTH count as fabrication."
- Update `divergence_type` semantics in the system prompt to clarify: `fabrication_a` = "A asserts X; X is absent from BOTH the FA Core AND A's memory block"; `fabrication_b` = same for B; `omits_a/b` extends to both source kinds (FA Core OR memory).
- Rename `faCoreSays` → `sourceSays` in the Zod schema + tool input_schema + prompt instructions. Add a new required `sourceLabel: "fa_core" | "memory_a" | "memory_b" | "absent"` field on each `factualDivergences` entry (so the v2.1 raw-data.json explicitly records WHICH source contained the matched fact, enabling source-distribution analysis post-run). Keep the OLD `faCoreSays` field name on the Zod schema as `.optional()` for backward-compat with v2 raw-data.json files in analysis tools.
- Hard-rule code-level override is unchanged structurally — `HARD_RULE_DIVERGENCE_TYPES` still fires on `fabrication_a/b/disagreement`, NOT on `omits_*`. The semantics widen via the system prompt + sourceLabel, not via the override set.

`packages/api/src/benchmark/uniqueness-poc/runner.ts`:
- Add `editorialMemoryBlock?: string` to the `IdentityOutput` shape (write the path through `runIdentity` — when an editorial-memory block is rendered for the persona, persist it on the returned output).
- Thread `memoryBlockA` / `memoryBlockB` into all 4 judge call sites:
  - `judgeBorderlinePairs` (Stage 3.5 intra-tenant) — pass identity-output blocks.
  - `runCrossTenantMatrix` Stage 6 — load each persona's block from its output.
  - `buildCrossTenantMatrixFromOutputs` Stage 7 control + treatment — same.
  - `runTier2InterRaterSampling` — pass through; preserve swapOrder semantics.

`packages/api/src/benchmark/uniqueness-poc/types.ts`:
- Add optional `editorialMemoryBlock?: string` to `IdentityOutput` (typed string; undefined when memory is off or `getContext` returned empty).
- Extend `FactualDivergenceRecord` with optional `sourceLabel?: "fa_core" | "memory_a" | "memory_b" | "absent"` and rename `faCoreSays` → `sourceSays` (keep `faCoreSays?` optional alongside for backward compat with v2 raw-data.json).

**Run command (same as v2 pilot):** from `packages/api/`, source `.env` from repo root first (`set -a && source ../../.env && set +a`), then `bun run poc:node:full -- fed-rate-decision --editorial-memory --identity in-house-journalist`. Process hangs after completion on Postgres connection — kill the `tsx` PID after `[index] Done` lands.

**Metrics to measure (record verbatim from raw-data.json):**
- Stage 6 cross-tenant: `meanCosine`, `verdict`, count of pairs at each `judgeTrinaryVerdict` (distinct_products / reskinned_same_article / fabrication_risk).
- For each fabrication_risk pair: `judgeFactualDivergences[].divergence_type` distribution AND `sourceLabel` distribution. Specifically: how many of the v2.1 flags have `sourceLabel="memory_a"` or `"memory_b"` (would have been false positives under v2)? How many have `sourceLabel="absent"` (genuine source-absent under v2.1)?
- Tier 2 inter-rater: `agreementRate`, `judgeUnreliableFlag`. Compare to v2 pilot 66.7%, v1 pilot 33.3%.
- `RunManifest.reproducibility.promptVersions.judge` MUST read `v2.1-2026-05-07`.
- Total `costUsd` ≤ $1.20.

**Constraints (do NOT cross these):**
- No scope expansion. Do NOT touch FA prompt (`prompts/fa-agent.ts`), the spec at `docs/specs/2026-05-06-fa-prompt-iteration.md`, `docs/plan.md`, or any file outside the 3 listed in implementation surface. Tier 2/3/4 of the fix sequence (bidirectional judging, two-judge ensemble, hybrid deterministic) stay deferred to separate /goals.
- `bunx tsc --noEmit` from `packages/api/` MUST pass before commit. `bun test` MUST pass.
- Single commit: contract change (llm-judge.ts + runner.ts + types.ts) with message `feat(uniqueness-poc): v2.1 judge contract — extend ground truth with editorial memory`. Run code-reviewer agent before committing.
- DO NOT push to remote. DO NOT reset or discard the working tree. DO NOT modify `docs/plan.md`. The handoff spec itself (`docs/specs/2026-05-07-judge-memory-context-fix-codex-handoff.md`) is OK to commit alongside the contract change as a chore preamble OR ignore — your choice, but if committed, use a SEPARATE commit `docs(specs): add v2.1 judge handoff brief` BEFORE the contract commit.
- Do not `git add -A`; stage explicit paths.
- LLM budget cap: ~$1.20 for the pilot. If the run exceeds $1.30, kill it and surface the spend overrun.
- Editorial memory MUST remain enabled (`--editorial-memory`). If Postgres is unreachable, retry once; if still unreachable, mark the goal `blocked` (NOT `achieved`) — running without memory defeats the purpose of this /goal.
- The `.harness-profile` says typecheck-blocking, production bar, drift-detector off. Honor that.

**Done when (all of the following are true):**
1. v2.1 contract commit landed on master (typecheck clean, tests clean, code-reviewer passed).
2. Fresh pilot run completed; `RunManifest.reproducibility.promptVersions.judge = v2.1-2026-05-07` confirmed in raw-data.json; cost ≤ $1.20; `--editorial-memory` was active (memory backend logged as `editorial-memory-postgres`).
3. Tier 2 inter-rater check ran on the v2.1 outputs; `agreementRate` recorded.
4. Pilot writeup landed at `docs/uniqueness-poc-analysis/2026-05-07-judge-memory-context-fix.md` with: §1 v2.1-vs-v2 fabrication_risk count comparison (e.g. "v2 flagged 3/15, v2.1 flags X/15"); §2 sourceLabel distribution on remaining flags ("Y of X have sourceLabel=memory_*; Z have sourceLabel=absent"); §3 pilot disposition under §5.4 vocabulary — **GO-FULL** if count drops to 0–1 with no `absent` flags, **ITERATE** if 2 mixed (some memory-resolved, some genuinely absent), **ABANDON** if 3 still and ≥2 are `absent` (FA layer not the lever even under complete source context); §4 Surface A direction tag re-evaluation under v2.1; §5 Tier 2 agreement v2.1 vs v2 (66.7% baseline) and whether `judgeUnreliableFlag` clears; §6 caveats (N=1 descriptive-only); §7 next-step recommendation.
5. Memory updated: append v2.1 result to `project_judge_omission_as_fabrication_2026_05_07.md` post-implementation section (the "Validation pending" hypothesis-test from yesterday now resolves); update `project_wm4_fa_prompt_pre_reg.md` with the v2.1 disposition; update `project_fa_layer_eliminated_2026_05_07.md` row table to reflect either ABANDON-confirmed (FA layer ruled out under complete source context), GO-FULL-revealed (full run dispatch unblocked), or ITERATE-with-source (genuine source-absent fabrication remains; FA layer mixed).
6. Final report: a 4–6 sentence summary in your final assistant reply naming the v2.1 vs v2 count, the sourceLabel distribution on flags, the pilot disposition, and what to do next (Wave 4b GO-FULL if cleared / pipeline-guardrail or identity-prompt /goal if ABANDON-confirmed / further ablation if ITERATE).

**Failure modes / how to recover:**
- If typecheck or tests break after the v2.1 commit: revert (`git reset --soft HEAD~1`), fix, re-stage explicit paths, re-commit. Do not skip checks with `--no-verify`.
- If Postgres is unreachable: retry once. If still unreachable, exit with `blocked` (the InMemoryEditorialMemoryStore fallback won't replicate yesterday's run conditions; results would be incomparable). Do NOT proceed without memory.
- If the v2.1 pilot's count is 3/15 with all `sourceLabel=absent`: the FA-prompt layer is genuinely producing source-absent fabrications under both FA Core AND memory ground-truth — strong ABANDON signal. Report cleanly; recommend pipeline-guardrail or identity-prompt as next layer (NOT another FA-prompt iteration).
- If Tier 2 agreement still <85% under v2.1: source-context completeness was orthogonal to position bias. Caveat the writeup verdict; recommend bidirectional judging (Tier 2 of the fix sequence) as the next /goal.
- If `sourceLabel` field is missing from any flag's factualDivergences entry (Haiku omits it): retry policy in `judgePairUniqueness` should already handle this via Zod retry. If retries exhaust, the writeup must note the missing-data subset rather than treating the count as complete.

=== END /goal ARGUMENT ===

---

## Out of scope for this handoff

- **Bidirectional judging** (Tier 2 of fix sequence) — fires the v2 judge in BOTH A→B and B→A orders for every cross-tenant pair, requires both to agree to fire fabrication_risk. Separate /goal if v2.1 still shows judge-unreliable Tier 2.
- **Two-judge ensemble** (Tier 3) — Haiku + Sonnet on disagreement, 2-of-3 majority. Separate /goal if Tier 1+2 leaves measurement ambiguity.
- **Hybrid deterministic / LLM judge** (Tier 4) — regex-extract numerical claims, deterministic comparison for Axis 1, LLM keeps Axis 2. Substantial engineering; separate /goal.
- **Wave 4b full-run dispatch** (4 events) — gated on this pilot's GO-FULL disposition under v2.1.
- **`report.ts` / `analyze.ts` rendering** of new `sourceLabel` field — deferred per Tier 0 implementation note. Data lives in raw-data.json; reporting can follow.
- **FA prompt iteration / ablation** — pending result of this /goal. Don't pre-commit to splitting §4.1/§4.2/§4.3/§4.4 before the v2.1 source-distribution data lands.
- **Persona-prompt re-validation** — `project_wave4_persona_layer_ceiling.md` ABANDON was under v1 judge; would need re-running under v2.1 with memory. Separate /goal if/when the layer-choice decision returns to persona.

## Expected `/goal` outcomes

- **achieved** — all 6 done-when items hold; final report delivered. Disposition is one of GO-FULL / ITERATE / ABANDON depending on the count drop.
- **paused** — user interrupts; resume with `/goal resume`.
- **blocked** — Postgres unreachable + retry failed (cannot run with memory disabled per constraint). Recovery path documented in failure modes.
- **budget-limited** — pilot LLM spend overrun (>$1.30); kill + surface.
- **unmet** — judge contract committed but pilot can't run (Postgres blocked) AND cannot defer to InMemory fallback per constraint. Practically equivalent to `blocked`; user resumes after fixing Postgres.

## Discriminating-signal guide for the writeup

Use this shape so the disposition follows from the data mechanically, not from interpretation:

| v2.1 fabrication count | sourceLabel distribution | Disposition | Why |
|---|---|---|---|
| 0 / 15 | n/a | **GO-FULL** | Editorial memory was the only source of v2's 3/15. Judge contract complete; FA-prompt layer cleared. Wave 4b full-run unblocked. |
| 1 / 15 | `memory_*` | **GO-FULL with caveat** | One residual flag was a near-miss in memory matching (Haiku quoted-fact-resolution). Wave 4b dispatch acceptable; flag the caveat in writeup. |
| 1–2 / 15 | mostly `absent` | **ITERATE** | A small number of genuine source-absent flags remain. Could be persona-prompt or identity-prompt source. Spawn ablation /goal before full run. |
| 3 / 15 | all `absent` | **ABANDON** | FA-prompt + variant produces source-absent claims even when memory IS visible to the judge. FA layer is not the lever. Return Wave 4 successor decision to layer-choice (pipeline-guardrail / identity-prompt / persona-revisit). |
| 3 / 15 | all `memory_*` | **GO-FULL but methodology gap** | All v2 flags resolve to memory; the count didn't drop because the fields' renamed-but-still-flagged. Verify the count semantics — should be 0 if all resolved. If true 0 collapsed but the table-row counter wasn't updated, report ship + open a fix /goal for the runner aggregation. |
| 4+ / 15 | mixed | **NEW BUG** | v2.1 introduced a regression. Hold; investigate before any disposition. |
