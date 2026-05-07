# Wave 4b FA Prompt Full Run - v2.1 Judge

**Date:** 2026-05-07
**Judge:** `v2.1-2026-05-07`
**Memory backend:** `editorial-memory-postgres`
**Variant fed-rate pilot:** `uniqueness-poc-runs/2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03/`
**v2.1 baseline fed-rate run:** `uniqueness-poc-runs/2026-05-07T16-44-19-941Z_fed-rate-pause-2026-04-03/`
**Variant additional runs:** `2026-05-07T16-54-59-570Z_bitcoin-etf-approval-2026-03-15`, `2026-05-07T17-05-31-732Z_oil-supply-shock-2026-03-22`, `2026-05-07T17-15-48-480Z_us-cpi-surprise-2026-03-12`

## 1. Phase 1 baseline and checkpoint

Phase 1 restored the baseline FA prompt from `1b67868^`, ran `fed-rate-decision` under v2.1 with editorial memory enabled, then restored the variant FA prompt. `git diff --stat packages/api/src/benchmark/uniqueness-poc/prompts/fa-agent.ts` was empty after restore.

| Run | FA arm | Stage 6 `distinct_products` | Stage 6 `reskinned_same_article` | Stage 6 `fabrication_risk` | Mean cosine | Tier 2 | Cost |
|---|---|---:|---:|---:|---:|---:|---:|
| `2026-05-07T16-44-19-941Z_fed-rate-pause-2026-04-03` | baseline | 13/15 | 2/15 | 0/15 | 0.8772 | 66.7% | `$1.09147332` |
| `2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03` | variant | 14/15 | 1/15 | 0/15 | 0.8554 | 0.0% | `$1.11530452` |

Checkpoint outcome: **OEC floor-zero on baseline.** The variant pilot's `0/15` is neutral on fabrication, not a strict improvement. Per the handoff, the final verdict must be secondary-driven and descriptive-only rather than a normal SHIP claim.

## 2. Variant 4-event aggregate

All four variant runs used `promptVersions.judge = v2.1-2026-05-07`; all used `editorial-memory-postgres`; all had `judgeFailures = []`.

| Event | Run ID | `distinct_products` | `reskinned_same_article` | `fabrication_risk` | Mean cosine | Tier 2 | Judge unreliable |
|---|---|---:|---:|---:|---:|---:|---|
| fed-rate-decision | `2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03` | 14/15 | 1/15 | 0/15 | 0.8554 | 0.0% | true |
| bitcoin-etf-approval | `2026-05-07T16-54-59-570Z_bitcoin-etf-approval-2026-03-15` | 13/15 | 1/15 | 1/15 | 0.8549 | 66.7% | true |
| oil-supply-shock | `2026-05-07T17-05-31-732Z_oil-supply-shock-2026-03-22` | 13/15 | 2/15 | 0/15 | 0.8724 | 66.7% | true |
| us-cpi-surprise | `2026-05-07T17-15-48-480Z_us-cpi-surprise-2026-03-12` | 12/15 | 1/15 | 2/15 | 0.8574 | 100.0% | false |

Aggregate per-event means:

| Metric | Values by event | Mean | SD |
|---|---:|---:|---:|
| `fabrication_risk` count | 0, 1, 0, 2 | 0.75 | 0.9574 |
| `distinct_products` count | 14, 13, 13, 12 | 13.00 | 0.8165 |
| `reskinned_same_article` count | 1, 1, 2, 1 | 1.25 | 0.5000 |
| mean cosine | 0.8554, 0.8549, 0.8724, 0.8574 | 0.8600 | 0.0083 |
| Tier 2 agreement | 0.0%, 66.7%, 66.7%, 100.0% | 58.3% | 41.9pp |

Variant four-event cost was `$4.50668590`. The Phase 1 plus Phase 2 live-run spend was `$4.48285470`, under the `$8` cap.

## 3. Delta_full(OEC), descriptive only

Phase 1 baseline-on-fed-rate has `0/15 fabrication_risk`; the variant four-event mean is `0.75/15` per event. Point estimate: `Delta_full(fabrication_risk) = +0.75 pairs/event` versus the v2.1 baseline reference.

This is **descriptive-only**. `MIN_CLUSTERS_FOR_INFERENCE = 3`, and the baseline arm has only one event, so there is no paired-stratified-bootstrap CI and no decision-grade inference claim. The Cohen's h estimate on the fabrication proportion is `+0.4510` versus the one-event baseline, also descriptive-only because `nControl = 1`.

Fabrication-risk source distribution across the four variant runs:

| Scope | Distribution |
|---|---|
| all divergences inside fabrication-risk pairs | `fa_core=4`, `memory_a=2`, `memory_b=1`, `absent=0` |
| hard-rule-relevant divergences only | `disagreement/fa_core=2`, `disagreement/memory_a=1` |

No Stage 6 fabrication divergence had `sourceLabel = absent`. The remaining flags are judged disagreements against FA Core or editorial memory, not v2-style source-context gaps.

## 4. Secondaries

Against the v2.1 baseline-on-fed-rate reference, the variant is neutral on distinct count and better on reskin count:

| Metric | v2.1 baseline fed-rate | Variant 4-event mean | Delta |
|---|---:|---:|---:|
| `distinct_products` | 13.00 | 13.00 | 0.00 |
| `reskinned_same_article` | 2.00 | 1.25 | -0.75 |
| mean cosine | 0.8772 | 0.8600 | -0.0171 |

Cohen's h estimates versus the one-event baseline are `0.0000` for `distinct_products` and `-0.1619` for `reskinned_same_article`, descriptive-only.

Against the Wave 4 v1 fed-rate contextual reference (`2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03`), the variant looks better, but this is not a gate because of judge-contract drift:

| Metric | Wave 4 v1 fed-rate | Variant 4-event mean | Delta | Caveat |
|---|---:|---:|---:|---|
| `fabrication_risk` | 3.00 | 0.75 | -2.25 | v1 judge, no v2.1 memory-block source context |
| `distinct_products` | 10.00 | 13.00 | +3.00 | v1 judge contract drift |
| `reskinned_same_article` | 2.00 | 1.25 | -0.75 | v1 judge contract drift |

Surface A direction tag under v2.1: the fed-rate variant filtered to the broker-a/b/c/d-equivalent 6-pair subset is `6/6 distinct_products`, `0/6 reskinned_same_article`, `0/6 fabrication_risk`. Versus Wave 3 r2's `5/6 distinct_products`, `0/6 reskinned_same_article`, `1/6 fabrication_risk` under the older judge, the direction tag is improved and the Wave-3-recovery blocker clears, with contract-drift caveat.

## 5. Disposition

**ITERATE-OEC-uninformative.**

The SHIP rule cannot fire because Phase 1 established a v2.1 baseline floor of `0/15 fabrication_risk`; the variant does not strictly improve on that floor and the four-event variant run has 3 total Stage 6 fabrication-risk pairs. The secondaries are non-regressive: `distinct_products` is equal to the v2.1 baseline reference, `reskinned_same_article` improves by 0.75 pairs/event, and Surface A is directionally improved. That is enough to avoid ABANDON, but not enough to merge the FA prompt bundle and retire the baseline.

The right interpretation is narrow: v2.1 fixed the editorial-memory source-context artifact, but the bundled FA prompt is not yet proven as the production lever under full-run conditions.

## 6. Tier 2 caveat

Mean Tier 2 agreement across variant runs is 58.3%, and 3 of 4 variant runs set `judgeUnreliableFlag = true`. This is below the 85% reliability threshold and directly affects confidence in borderline `distinct_products` versus `reskinned_same_article` calls.

The fabrication-risk flags were not caused by missing source context (`absent=0`), but the judge still shows order sensitivity. Any production decision that hinges on the 0.75/event fabrication mean or the tight secondary deltas should use bidirectional judging before treating this as settled.

## 7. Next-step recommendation

Do not merge the bundled FA prompt as the new production default yet, and do not retire the baseline FA prompt. The next useful /goal is a measurement-integrity pass: implement or run bidirectional v2.1 judging on the existing Wave 4b outputs, requiring both A->B and B->A to agree before a fabrication-risk hard stop. If the 3 Stage 6 fabrication-risk pairs survive bidirectional judging, split the FA prompt bundle into targeted §4 ablations; if they collapse, the secondary metrics support a renewed SHIP-secondary-driven decision.
