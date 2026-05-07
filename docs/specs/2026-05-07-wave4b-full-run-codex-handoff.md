# Wave 4b Full Run + v2.1 Baseline Reference — Codex CLI `/goal` handoff

**Status:** Handoff brief (not a design spec — execution-only)
**Date:** 2026-05-07
**Author:** Albert Galera + Claude
**Target executor:** OpenAI Codex CLI (codex-cli ≥ 0.128.0), via `/goal <argument>`
**Related:**
- `docs/specs/2026-05-07-judge-memory-context-fix-codex-handoff.md` — the prior /goal (v2.1 contract; Codex completed it cleanly, commit `59685e2`, pilot 0/15)
- `docs/specs/2026-05-07-wm4-v2-judge-pilot-codex-handoff.md` — the WM4 pilot /goal (v2 contract + variant FA + ITERATE pilot)
- `docs/specs/2026-05-06-fa-prompt-iteration.md` — design spec; locked at `74095a2`; do NOT modify
- `docs/specs/2026-05-06-uniqueness-poc-test-methodology.md` — methodology baseline (audit §4.10.4 etc.)
- Run dirs: today's v2.1 pilot `uniqueness-poc-runs/2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03/` (variant FA, 0/15 fabrication); v2 pilot `2026-05-07T14-45-51-519Z_fed-rate-pause-2026-04-03/` (3/15 fabrication_b all `absent`); Wave 4 baseline `2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/` (v1 judge, 3/15 fabrication, no memory blocks captured)
- Memory: `project_wm4_fa_prompt_pre_reg.md`, `project_judge_omission_as_fabrication_2026_05_07.md`, `project_fa_layer_eliminated_2026_05_07.md`, `feedback_judge_source_context_completeness.md`, `feedback_uniqueness_poc_fixture_id_vs_stem.md`, `feedback_llm_pilot_first.md`

---

## Why this handoff exists

The v2.1 pilot disposition was GO-FULL on the OEC (variant 0/15 fabrication_risk vs v2 3/15 false positives all attributable to memory-source-context gap). Spec §5.4 unblocks the full 4-event run. Two open methodology questions remain that this /goal must resolve before rendering the SHIP/ITERATE/ABANDON verdict:

1. **Baseline contract drift.** Wave 4 pilot baseline (the only persisted Surface B reference at fed-rate-decision) ran under v1 judge with editorial memory blocks NOT captured on `IdentityOutput`. Re-judging Wave 4's persisted outputs under v2.1 isn't viable — the memory blocks are gone. The fix is to **re-run baseline FA on fed-rate-decision under v2.1**, so variant-vs-baseline at that event is on the same judge contract.

2. **OEC floor-zero risk.** Under v2.1 with complete source context, baseline FA may also produce 0 fabrication on fed-rate (because v2.1 correctly recognises that personas legitimately quote from memory blocks, regardless of FA prompt). If both variant AND baseline collapse to 0/15, the OEC is uninformative — the spec's "fabrication strictly improved" SHIP gate can't fire. The verdict shape would shift to secondary-driven (`distinct_products` ↑ / `reskinned_same_article` ↓). The /goal must explicitly handle this case rather than blindly applying the SHIP rule.

Total scope: 1 baseline run (fed-rate under v2.1) + 3 variant runs (bitcoin-etf-approval / oil-supply-shock / us-cpi-surprise under v2.1) + aggregation + writeup. Today's v2.1 pilot already covers variant fed-rate. ~$5-7 LLM, ~50 min.

---

## How to use this file

Copy everything between the two `===` lines below and paste it as the argument to Codex CLI's `/goal` command:

```
/goal <paste the block here>
```

---

=== BEGIN /goal ARGUMENT ===

**Goal:** Execute Wave 4b full-run validation under v2.1 judge — establish a v2.1 baseline reference on `fed-rate-decision`, run variant FA on the remaining 3 events (`bitcoin-etf-approval`, `oil-supply-shock`, `us-cpi-surprise`), aggregate across the 4-event variant bench, and render SHIP / ITERATE / ABANDON verdict per spec §5.4 + §5.6 with explicit handling for the OEC-floor-zero case.

**Context (clean working tree on master `59685e2`, no uncommitted carry-in):**
- Today PM the v2.1 judge contract landed at `59685e2` and the v2.1 pilot at `uniqueness-poc-runs/2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03/` reported 0/15 fabrication_risk under variant FA + editorial memory + in-house-journalist. Disposition GO-FULL on OEC.
- Wave 4 pilot baseline (`uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/`) was under v1 judge with editorial memory; v2.1 contract added `editorialMemoryBlock` to `IdentityOutput` but Wave 4's run predates that, so its memory blocks are unrecoverable. Pure judge re-run on the persisted pair outputs would inherit the same source-context gap that v2 had — not apples-to-apples.
- Variant FA at HEAD (commit `1b67868`) is the bundled §4.1–§4.4 prompt. Baseline FA is the parent of `1b67868`, recoverable via `git show 1b67868^:packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts`.
- Spec §5.4 SHIP rule: fabrication_risk strictly improved AND distinct_products non-regressive (within ceiling) AND reskinned_same_article non-regressive (within ceiling) AND Surface A direction tag NOT inverted on OEC. Pilot already cleared the Surface A blocker (per yesterday's writeup; confirm under v2.1).
- Spec §5.6 secondary ceilings: distinct_products must not regress > 2 pairs/event vs Wave 4 pilot; reskinned_same_article must not regress > 2 pairs/event.

**Phases (sequential):**

**Phase 1 — v2.1 baseline reference at fed-rate-decision (~$1, ~10 min):**
1. Save current FA: `cp packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts /tmp/wave4b-variant-fa.ts`.
2. Restore baseline FA into the working tree (NOT committing): `git show 1b67868^:packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts > packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts`.
3. Run baseline pilot: from `packages/api/`, `set -a && source ../../.env && set +a && bun run poc:node:full -- fed-rate-decision --editorial-memory --identity in-house-journalist`. Kill tsx PID after `[index] Done` lands (Postgres connection hangs).
4. Capture the new run dir path; verify `RunManifest.reproducibility.promptVersions.judge = v2.1-2026-05-07`.
5. Restore variant FA: `cp /tmp/wave4b-variant-fa.ts packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts`. Verify `git diff --stat packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts` shows zero changes.
6. Phase-1 output: baseline-on-fed-rate v2.1 fabrication_risk count + secondaries.

**Decision checkpoint after Phase 1 (mandatory; do NOT proceed to Phase 2 without resolving):**

| Phase 1 baseline fed-rate fabrication count | Action |
|---|---|
| 0–1 / 15 | OEC is effectively at floor-zero on baseline. The variant's 0/15 is neutral, not improvement → SHIP rule's "fabrication strictly improved" cannot fire. Phase 2 still proceeds (we still need the secondary distributions across 4 events to render an honest verdict), but mark in writeup that the verdict will be **secondary-driven** rather than OEC-driven. Update §5.6 OEC interpretation: "OEC at floor-zero on both arms under complete source context; SHIP gate fails by definition; verdict rendered on Surface B secondary-metric deltas only." |
| 2 / 15 | OEC marginally informative; variant 0/15 is a real if small improvement. Proceed; note the small effect size. |
| 3+ / 15 | OEC strongly informative; variant 0/15 is a real and large improvement. Proceed; SHIP path open if secondaries clear. |

**Phase 2 — variant on remaining 3 events (~$3-4, ~30 min):**
With variant FA restored on master HEAD, run three separate invocations from `packages/api/`:
1. `bun run poc:node:full -- bitcoin-etf-approval --editorial-memory --identity in-house-journalist`
2. `bun run poc:node:full -- oil-supply-shock --editorial-memory --identity in-house-journalist`
3. `bun run poc:node:full -- us-cpi-surprise --editorial-memory --identity in-house-journalist`

Each run: pre-flight env source, kill tsx after `[index] Done`, verify `promptVersions.judge = v2.1-2026-05-07`. Note: if `--editorial-memory` for a non-fed-rate event has no prior facts in Postgres for the identity rotation, the InMemoryEditorialMemoryStore behaviour shouldn't activate (DATABASE_URL_DEV is set), but the memory block may render as empty for those runs — that's expected and not an error.

**Phase 3 — aggregation + writeup (no LLM):**

Load raw-data.json from all 4 variant runs (today's v2.1 pilot fed-rate + 3 from Phase 2) AND the Phase-1 baseline run. Compute:

- **Per-event variant Stage 6:** fabrication_risk count, distinct_products count, reskinned_same_article count, meanCosine, sourceLabel distribution on any flags, Tier 2 agreementRate.
- **4-event variant aggregate:** mean per-event count for each of the 3 metrics; standard deviation across events; effect-size estimate (Cohen's h on count proportions per `statistics.ts:effectSize`).
- **Δ_full(fabrication_risk):** variant 4-event mean − Phase-1 baseline 1-event count. **Mark descriptive-only**: `MIN_CLUSTERS_FOR_INFERENCE=3` per WM2 contract; baseline N_events=1 cannot support a paired-stratified-bootstrap CI. Report Δ_full as a point estimate with explicit "no CI claim — N_baseline=1" caveat per audit §4.12 forbidden-claim guardrails.
- **Surface B secondaries:** variant 4-event means for distinct_products and reskinned_same_article vs Phase-1 baseline (descriptive-only at N=1) AND vs Wave 4 v1 pilot baseline (with explicit "v1-judge contract drift" caveat — descriptive-only contextual reference, not a gate).
- **Surface A direction tag:** variant fed-rate filtered to broker-a/b/c/d (6-pair subset) under v2.1 vs Wave 3 r2 (under v1; flag the contract drift). Apply Wave-3-recovery blocker check.
- **Tier 2 agreement** across the 4 variant runs; flag if any individual run had `judgeUnreliableFlag=true`; flag if mean Tier 2 agreement < 85%.

Write up at `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-full.md`. Sections: §1 Phase-1 baseline OEC count + decision-checkpoint outcome; §2 variant 4-event aggregate per metric; §3 Δ_full(OEC) descriptive-only with caveats; §4 secondaries with both v2.1-baseline and Wave-4-v1-baseline reference points; §5 disposition under spec §5.4 SHIP/ITERATE/ABANDON — explicit reasoning if OEC is at floor-zero (verdict shifts to secondary-driven); §6 Tier 2 unreliability caveat; §7 next-step recommendation.

**Constraints (do NOT cross these):**
- Master HEAD stays at `59685e2` for the duration. Phase 1's FA revert lives in working tree only; restore variant before Phase 2 starts. Verify with `git diff --stat packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts` showing zero changes after restore.
- ZERO commits in this /goal unless an aggregation helper is genuinely needed (analyze.ts likely covers it). If a commit is unavoidable, ONE commit only, message `feat(uniqueness-poc): wave 4b multi-run aggregation helper` (or similar), code-reviewer must pass, typecheck + tests must pass.
- DO NOT push to remote. DO NOT modify `docs/plan.md`. DO NOT modify `docs/specs/2026-05-06-fa-prompt-iteration.md`.
- Do not `git add -A`; stage explicit paths.
- LLM budget cap: ~$8 across the 4 LLM-invoking runs (Phase 1 + Phase 2). Kill if any run pushes total above $8.50.
- Editorial memory MUST stay enabled (`--editorial-memory`) for every run. If Postgres is unreachable, retry once; on a second failure, exit `blocked` (NOT `achieved`) — InMemory fallback breaks comparability.
- The `.harness-profile` says typecheck-blocking, production bar, drift-detector off. Honor that.

**Done when (all of the following are true):**
1. Phase 1 baseline run completed; raw-data.json written; `promptVersions.judge=v2.1-2026-05-07` confirmed; FA prompt restored to master HEAD before Phase 2 starts (verified via `git diff --stat`).
2. Phase 2 three variant runs completed on bitcoin-etf-approval, oil-supply-shock, us-cpi-surprise; all `promptVersions.judge=v2.1-2026-05-07`; total cost across all 4 LLM runs ≤ $8.
3. Phase 3 aggregation completed (with at most one optional commit if analyze.ts insufficient).
4. Writeup at `docs/uniqueness-poc-analysis/2026-05-07-wave4b-fa-prompt-full.md` with sections §1–§7 per the structure above. Disposition explicit (SHIP / ITERATE / ABANDON / SHIP-secondary-driven / ITERATE-OEC-uninformative). Phase-1-decision-checkpoint outcome documented.
5. Memory updated: `project_wm4_fa_prompt_pre_reg.md` reflects the Wave 4b full-run verdict; `project_fa_layer_eliminated_2026_05_07.md` row table updated to reflect SHIP / ITERATE / ABANDON; `project_judge_omission_as_fabrication_2026_05_07.md` gets a final "v2.1 in production, Wave 4b verdict landed" status note.
6. Final report: 4–6 sentence summary in your final assistant reply naming the variant 4-event mean fabrication count/event, Phase-1 baseline fabrication count, the secondary deltas (variant vs baseline-on-fed-rate AND vs Wave-4-v1-baseline contextually), the disposition, and the production recommendation (merge variant FA + retire baseline / ablate per §4 / pursue different layer).

**Failure modes / how to recover:**
- If Phase 1's FA revert breaks anything (typecheck, etc.): immediately restore via `git checkout HEAD -- packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts`. Do NOT proceed; surface the error and exit `blocked`.
- If any run's `promptVersions.judge != v2.1-2026-05-07`: hard stop. The judge contract drift is a measurement integrity issue. Investigate (likely /tmp/path corruption or wrong file restored) before continuing.
- If Postgres is unreachable on any run after retry: exit `blocked`. Editorial memory MUST stay enabled.
- If Phase 1 baseline-on-fed-rate v2.1 count drops to 0/15 (OEC at floor-zero on baseline): proceed to Phase 2, but the writeup verdict will be secondary-driven. Use spec §5.4 forbidden-claim wording ("FA-prompt layer is/is-not apparently the lever under these run conditions"); never absolutes.
- If any Phase 2 run produces unexpected results (e.g. fabrication count > 5/15 on a single event under variant + v2.1): pause, inspect the run's flagged pairs' factualDivergences for sourceLabel distribution. If most are `absent`, that's genuine fabrication and the verdict shifts toward ITERATE/ABANDON regardless of fed-rate's pilot. Do NOT silently aggregate over outlier runs.
- If aggregate Tier 2 agreement < 85% across runs: caveat the writeup verdict; note that bidirectional judging (Tier 2 of fix sequence) is the next /goal IF secondary deltas are tight.

=== END /goal ARGUMENT ===

---

## Out of scope for this handoff

- **Bidirectional judging** (Tier 2 of fix sequence) — handles position-bias on `distinct_products ↔ reskinned_same_article`. Separate /goal IF Wave 4b's secondaries land tight (within 1–2 pairs/event of ceiling) AND the verdict hinges on them.
- **Two-judge ensemble** (Tier 3) and **hybrid deterministic / LLM judge** (Tier 4) — separate /goals.
- **4-event paired baseline** — running baseline FA on bitcoin-etf-approval, oil-supply-shock, us-cpi-surprise to enable proper paired-stratified-bootstrap on Δ_full. ~$3-4 additional. Deferred unless Phase 1 indicates the OEC is informative AND a CI claim is needed for a SHIP decision. The initial Wave 4b /goal accepts N_baseline=1 descriptive-only because the spec's full-run gate already says CI < 0 — if the point estimate is dramatic enough to obviate CI debate, no extra spend; if it's marginal, a follow-up /goal handles it.
- **Persona-prompt and FA-prompt rule-out re-validation under v2.1** — `project_wave4_persona_layer_ceiling.md` ABANDON was on v1 with editorial memory; same source-context-completeness fix may have partly contaminated that finding. Strict attribution would require re-running Wave 4 persona variants under v2.1. Out of scope here; separate /goal if the layer-choice decision returns to persona.
- **`report.ts` / `analyze.ts` rendering of `sourceLabel`** — deferred per Tier 0 implementation note.
- **Spec §5.4 OEC choice amendment** — if the Phase-1 decision-checkpoint shows OEC at floor-zero on both arms, the right long-term fix is to elevate a secondary metric to OEC for any future FA-prompt-iteration spec. Out of scope for THIS execution; record as an open question if the case fires.

## Expected `/goal` outcomes

- **achieved** — all 6 done-when items hold; Wave 4b verdict landed (one of: SHIP, SHIP-secondary-driven, ITERATE-on-OEC, ITERATE-on-secondary, ABANDON).
- **paused** — user interrupts; resume with `/goal resume`.
- **blocked** — Postgres unreachable + retry failed; FA revert broke the working tree and couldn't be cleanly restored; Phase-1 judge contract mismatch.
- **budget-limited** — total LLM spend across runs > $8.50; surface what landed and what didn't.
- **unmet** — variant under v2.1 produces unexpected fabrication regression on a Phase 2 event (>5/15 with mostly `absent` sourceLabel). Writeup still lands but recommends ABANDON; goal exits `achieved` because a verdict was rendered, just a negative one.

## Discriminating-signal guide for the writeup

After Phase 1 + Phase 2 are complete, the verdict follows from this 2D table mechanically rather than by interpretation:

| Phase 1 baseline fed-rate fabrication count | Variant 4-event mean fabrication count/event | Verdict |
|---|---|---|
| 0–1 / 15 | 0–0.5 / event | **ITERATE-on-OEC-uninformative** + render verdict on secondaries (SHIP-secondary-driven if both clear ceilings) |
| 0–1 / 15 | 1+ / event | **ITERATE** — variant produces some fabrication while baseline doesn't; investigate flagged pairs' sourceLabel distribution before next layer |
| 2–3 / 15 | 0–0.5 / event | **SHIP** if secondaries clear ceilings (modulo Tier 2 caveat) |
| 2–3 / 15 | 1–2 / event | **ITERATE** — partial improvement, ablate §4 |
| 2–3 / 15 | 3+ / event | **ABANDON** — variant doesn't help on OEC at scale despite favourable pilot |
| 4+ / 15 | any | rare; investigate Phase 1 baseline run before drawing conclusions (might indicate v2.1 has a regression we missed) |

The Surface A direction tag and Tier 2 agreement enter the writeup as caveats / blockers, not as additional verdict cells in this table.
