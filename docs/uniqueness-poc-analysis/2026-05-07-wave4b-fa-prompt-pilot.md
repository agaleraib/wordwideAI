# Wave 4b FA Prompt Pilot - v2 Judge Rerun

**Date:** 2026-05-07
**Fixture:** `fed-rate-decision` / `fed-rate-pause-2026-04-03`
**Variant run:** `uniqueness-poc-runs/2026-05-07T14-45-51-519Z_fed-rate-pause-2026-04-03/`
**Today's v1 comparison run:** `uniqueness-poc-runs/2026-05-07T10-59-15-389Z_fed-rate-pause-2026-04-03/`
**Surface B baseline:** `uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/`

## 1. Pilot disposition

**ITERATE.** Surface B is the decision surface: the v2 pilot produced 3/15 `fabrication_risk` pairs, equal to the Wave 4 K=6 baseline's 3/15, so the OEC is neutral rather than `GO-FULL`. Surface B secondaries moved in the right direction (`distinct_products` 10/15 -> 11/15; `reskinned_same_article` 2/15 -> 1/15), but the pilot rule requires at least a one-pair drop in `fabrication_risk`.

Raw v2 Stage 6 metrics: `meanCosine = 0.8554835199504193`; `verdict = FAIL`; counts are 11/15 `distinct_products`, 1/15 `reskinned_same_article`, and 3/15 `fabrication_risk`. Total run cost was `$1.05582354`, under the `$1.20` cap.

Pre-flight: the v2 run receipt confirms `promptVersions.judge = v2-2026-05-07`, 6 personas, 15 Stage 6 pairs, `identityIds = [in-house-journalist]`, and Postgres editorial memory. The Surface B baseline predates the Wave M reproducibility receipt, but its persisted manifest and matrix confirm the same fixture, same 6 persona IDs, same identity, and 15 Stage 6 pairs; treat this as geometry-confirmed but receipt-incomplete.

## 2. v2-vs-v1 fabrication count

Today's v1 run flagged 4/15 Stage 6 pairs as `fabrication_risk`. The v2 run flagged 3/15. The v2 flagged pairs contain 4 factual-divergence entries: 4 are `fabrication_b`; 0 are `fabrication_a`; 0 are `disagreement`; 0 are `omits_a` or `omits_b`.

| Run | Judge | Stage 6 `distinct_products` | Stage 6 `reskinned_same_article` | Stage 6 `fabrication_risk` | Divergence attribution in fabrication-risk pairs |
|---|---:|---:|---:|---:|---|
| Today's v1 | `v1-2026-05-06` | 8/15 | 3/15 | 4/15 | no v2 attribution fields |
| Fresh v2 | `v2-2026-05-07` | 11/15 | 1/15 | 3/15 | 4 `fabrication_b`, 0 `omits_*` |

The v2 contract also surfaced two non-fabrication pairs with `omits_b` divergences that did not trigger the hard rule, which is the intended source-aware behavior.

## 3. Surface A direction tag

Surface A is sensitivity only, not gating: it filters the v2 K=6 generation to broker-a/b/c/d and compares directionally against the Wave 3 r2 K=4 baseline. The generation contexts differ, so there is no CI claim and no cross-surface absolute-count inference.

| Surface A metric | Wave 3 r2 baseline | v2 variant filtered to broker-a/b/c/d | Direction tag |
|---|---:|---:|---|
| `distinct_products` | 5/6 | 3/6 | directionally inconsistent |
| `reskinned_same_article` | 0/6 | 0/6 | directionally consistent |
| `fabrication_risk` | 1/6 | 3/6 | **inverted** |

Wave-3-recovery blocker check: **fires**. The OEC (`fabrication_risk`) is inverted on Surface A, so the pilot cannot emit `GO-FULL` even if Surface B secondaries improved.

## 4. Tier 2 agreement

The v2 Tier 2 inter-rater check sampled 3/15 Stage 6 pairs and recorded `agreementRate = 0.6666666666666666`; `judgeUnreliableFlag = true`. This improves on today's v1 baseline of 0.3333333333333333 agreement, but it remains below the 0.85 reliability threshold.

The only v2 Tier 2 disagreement was non-factual: `2_helix-markets__4_meridian-macro` changed from `distinct_products` to `reskinned_same_article` on swapped order, with no swapped factual divergences. So v2 appears to reduce omission-as-fabrication, but presentation-similarity position sensitivity remains.

## 5. Attribution verdict

The FA-prompt layer is **not apparently the lever under these run conditions**. The v1 judge artifact was real enough to reduce the count from 4/15 to 3/15 and to stop `omits_*` from firing the hard rule, but the remaining v2 flags are not omissions: all are source-absent `fabrication_b` historical anchors.

The flagged content is concentrated in downstream pieces referencing prior coverage or the Yanbu supply disruption absent from the FA Core. Because the run used editorial memory and the v2 judge only received the FA Core as ground truth, the clean attribution is not "FA prompt caused fabrication"; it is "the bundled FA prompt did not remove source-absent downstream historical anchors under the current editorial-memory run conditions."

## 6. Caveats

- N=1 event. This is descriptive-only and cannot support statistical inference.
- `judgeUnreliableFlag = true` under v2, despite improvement from 33.3% to 66.7% agreement.
- The Surface B baseline lacks a Wave M reproducibility receipt; its geometry is confirmed from persisted manifest and matrix fields, but prompt-version receipt parity cannot be proven.
- Editorial memory is a confound: identity outputs received memory context, while the v2 judge's ground truth was the FA Core only. If editorial memory is intended to be a legitimate source, the judge contract should include that source context too.

## 7. Next step recommendation

**Ablation, not full run.** Do not spend on the four-event Wave 4b full run yet. First isolate whether the remaining v2 `fabrication_b` flags come from editorial-memory injection or identity/persona prompt behavior: run the same pilot with editorial memory disabled, or extend the v2 judge ground truth to include the injected editorial-memory block before re-judging. Only after that measurement issue is resolved should the FA prompt bundle be split into §4.1/§4.2/§4.3/§4.4 ablations.
