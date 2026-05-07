# Judge v2.1 Editorial-Memory Context Fix

**Date:** 2026-05-07
**Fixture:** `fed-rate-decision` / `fed-rate-pause-2026-04-03`
**v2.1 run:** `uniqueness-poc-runs/2026-05-07T15-33-47-618Z_fed-rate-pause-2026-04-03/`
**v2 comparison run:** `uniqueness-poc-runs/2026-05-07T14-45-51-519Z_fed-rate-pause-2026-04-03/`
**Contract commit:** `59685e2` (`feat(uniqueness-poc): v2.1 judge contract — extend ground truth with editorial memory`)

## 1. v2.1 vs v2 fabrication count

**v2.1 drops the Stage 6 fabrication count from 3/15 to 0/15.**

| Run | Judge | Memory backend | Stage 6 `distinct_products` | Stage 6 `reskinned_same_article` | Stage 6 `fabrication_risk` | Cost |
|---|---|---|---:|---:|---:|---:|
| v2 | `v2-2026-05-07` | `editorial-memory-postgres` | 11/15 | 1/15 | 3/15 | `$1.05582354` |
| v2.1 | `v2.1-2026-05-07` | `editorial-memory-postgres` | 14/15 | 1/15 | 0/15 | `$1.11530452` |

Raw v2.1 Stage 6 metrics: `meanCosine = 0.8554409211082334`; `verdict = FAIL`; `judgeFailures = []`. The remaining Stage 6 failure is one `reskinned_same_article` pair (`1_fasttrade-pro__4_meridian-macro`), not a fabrication-risk pair.

The v2 comparison run had 4 factual-divergence entries inside the 3 fabrication-risk pairs, all `fabrication_b`, all absent from the FA Core under the v2 source set. The v2.1 run has no Stage 6 fabrication-risk pairs.

## 2. sourceLabel distribution on remaining flags

There are no remaining Stage 6 fabrication-risk flags under v2.1, so the sourceLabel distribution is empty:

| `sourceLabel` | Count in Stage 6 fabrication-risk divergences |
|---|---:|
| `fa_core` | 0 |
| `memory_a` | 0 |
| `memory_b` | 0 |
| `absent` | 0 |

This resolves the v2 diagnostic: the 3/15 v2 flags were not genuine source-absent fabrication once the judge saw each producer's editorial-memory source context.

## 3. Pilot disposition

**GO-FULL.** Under the handoff's v2.1 disposition table, `0/15` Stage 6 fabrication-risk pairs with no `absent` source labels clears the fabrication OEC and unblocks the Wave 4b full-run dispatch.

This is not a clean production-pass signal. Stage 6 still reports `verdict = FAIL` because `1/15` pair is `reskinned_same_article`, and Tier 2 remains unreliable. The narrow disposition is: the FA-prompt layer is no longer blocked by source-absent fabrication on this pilot once editorial memory is included in judge ground truth.

## 4. Surface A direction tag

Surface A filtered to the broker-a/b/c/d-equivalent subset under v2.1 is `6/6 distinct_products`, `0/6 reskinned_same_article`, `0/6 fabrication_risk`.

| Surface A metric | Wave 3 r2 baseline | v2 pilot filtered subset | v2.1 pilot filtered subset | Direction tag |
|---|---:|---:|---:|---|
| `distinct_products` | 5/6 | 3/6 | 6/6 | directionally improved |
| `reskinned_same_article` | 0/6 | 0/6 | 0/6 | directionally consistent |
| `fabrication_risk` | 1/6 | 3/6 | 0/6 | directionally improved |

The Wave-3-recovery blocker that fired under v2 clears under v2.1.

## 5. Tier 2 agreement

v2.1 Tier 2 sampled 3/15 Stage 6 pairs and recorded `agreementRate = 0`; `judgeUnreliableFlag = true`. This regresses from the v2 pilot's `agreementRate = 0.6666666666666666`, and both remain below the 0.85 reliability threshold.

The Tier 2 failures are now mostly position/presentation sensitivity rather than load-bearing Stage 6 fabrication. One swapped sample did produce `fabrication_risk` with `sourceLabel = memory_a`, which means source-context completeness did not solve judge order effects. Bidirectional judging remains the next measurement-integrity fix if the full-run result is close or disputed.

## 6. Caveats

- N=1 event. This pilot is descriptive-only.
- The v2.1 source-context fix clears the Stage 6 fabrication count on this fixture, but it does not clear `judgeUnreliableFlag`.
- Stage 6 still has one `reskinned_same_article` pair, so a full run should track reskin regeneration behavior separately from fabrication risk.
- The identity-format diversity verdict remains `FAIL` because the Stage 3.5 intra-tenant matrix still contains one `fabrication_risk` pair (`educator__senior-strategist`); that is not the load-bearing cross-tenant OEC for this handoff.

## 7. Next-step recommendation

Run the Wave 4b four-event full set under v2.1 with editorial memory enabled and treat `v2.1-2026-05-07` as the judge baseline. Do not spend another FA-prompt ablation before the full set; the pilot's source-absent fabrication blocker collapsed from 3/15 to 0/15. Keep Tier 2 reliability work queued as a separate /goal: if full-run conclusions depend on close `reskinned_same_article` calls or swapped-order instability, implement bidirectional judging before making a layer-choice decision.
