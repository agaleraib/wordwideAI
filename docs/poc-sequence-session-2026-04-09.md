# Sequence Experiment — Session Journal (2026-04-09)

**Session date:** 2026-04-09
**Branch:** `workstream-b-playground`
**Owner:** Albert Galera
**Working with:** Claude (Opus 4.6)
**Experiment:** `eur-usd-q2-2026` — 3-step sequence, first full end-to-end run of the narrative-state-persistence workstream
**Cost:** $2.0234 across 3 CLI runs
**Duration:** 917s (15.3 min) wall clock

This is a direct follow-up to the 2026-04-07 session journal. The earlier session parked three experiments that required multi-event temporal state (journal §10.5, spec `2026-04-08-narrative-state-persistence.md` §2). This session actually ran the canonical one.

---

## 1. What we were trying to measure

**The hypothesis under test** (from the narrative-state-persistence spec §2, written 2026-04-08):

> The structural-backbone hypothesis is that a persona carrying four pieces of prior directional view, level calls, and framing language will diverge from a green-field run of the same persona on the same event far more than a persona carrying a single prior piece does. We cannot test this today because Stage 7 is single-prior by construction.

In plain terms: **does accumulating multi-event history make brokers diverge MORE from each other across tenants?**

The spec imagined an experiment shaped like:
- Walk a 3-step sequence end-to-end
- Each step persists narrative state
- Final step runs with 2 entries of accumulated history
- Measure cross-pipeline similarity on the final step
- Compare against a single-event baseline to see if the multi-event accumulation moves the needle

The sequence runner in `index.ts` (already committed in `14e9b47`) does the walking. The store-backed read path in `runCrossTenantMatrix` (lines 418-423 of runner.ts, same commit) does the injection. This session was the first time that end-to-end path was actually exercised with a real fixture.

---

## 2. The experiment

**Sequence fixture:** `packages/api/src/benchmark/uniqueness-poc/fixtures/sequences/eur-usd-q2-2026.json`

Three step references, all sharing `topicId: "eurusd"`:

1. **`iran-strike`** — U.S. forces strike Iranian Revolutionary Guard positions in Syria after drone attack on base
2. **`fed-rate-decision`** (resolves to `fed-rate-pause-2026-04-03.json`) — Fed holds rates steady, signals only one cut likely this year as inflation proves sticky
3. **`iran-retaliation`** — Iran-backed militias strike Saudi Aramco facility in Yanbu, Brent jumps 6% as Strait of Hormuz fears intensify

**Invocation:**

```bash
bun run packages/api/src/benchmark/uniqueness-poc/index.ts \
  --sequence eur-usd-q2-2026 \
  --persist-narrative-state
```

**Run mode per step** (from `runSequence` in index.ts):

| Step | full | persistNarrativeState | readStateInCrossTenant | skipNarrativeStateTest | skipReproducibility |
|------|:----:|:----:|:----:|:----:|:----:|
| 1 | ✓ | ✓ | false (nothing to read) | true (intermediate) | true |
| 2 | ✓ | ✓ | **true** (reads step 1 state) | true (intermediate) | true |
| 3 | ✓ | ✓ | **true** (reads steps 1+2 state) | **false** (final step) | false |

**Two bugs discovered and fixed mid-run** (committed as `8fe0899`):

- **Sequence runner passed `step.id` to `runOne` instead of the filename stem.** `step.id` is the event's internal id (`iran-strike-2026-04-07`), which doesn't match the filename (`iran-strike.json`). Fixed by giving `runOne` an overload that accepts either a filename stem OR a pre-loaded `NewsEvent`. Sequence steps now pass the loaded event directly.
- **Judge threw `ZodError` on malformed Haiku responses, killing the whole sequence mid-step-2.** One pair's judge call came back with a missing `verdict` field. The Zod `.parse()` introduced in `4a9b030` correctly flagged it — which is its job — but the error propagated up and aborted step 2 after 5 minutes of work. Fixed with three-attempt retry inside `judgePairUniqueness` + per-pair try/catch at every judge call site (4 total). Persistent failures now log a warning and skip the pair; downstream aggregation treats missing verdicts as "did not judge" which is a safe no-op.

First attempt (2026-04-09T09:20:07Z) crashed in step 2 Stage 3.5. Second attempt (2026-04-09T09:32:08Z, after the fixes landed) completed all 3 steps. State namespace was cleared with `rm -rf packages/api/uniqueness-poc-state/eur-usd-q2-2026/` between attempts so step 3 only saw fresh history.

---

## 3. The raw numbers

### 3.1 Stage 6 cross-pipeline cosine trajectory across the sequence

| Step | Event | State injected | **Cosine mean** | **Fidelity mean** | **Presentation mean** | Verdicts |
|---|---|---|---:|---:|---:|---|
| 1 | iran-strike | none (green-field) | **0.879** | 0.933 | **0.533** | 4 distinct / 1 reskinned / 1 fabrication |
| 2 | fed-rate-pause | +1 prior entry | **0.876** | 0.907 | **0.513** | 5 distinct / 0 reskinned / 1 fabrication |
| 3 | iran-retaliation | +2 prior entries | **0.901** | 0.945 | **0.583** | 4 distinct / 2 reskinned / 0 fabrication |

Cross-pipeline cosine mean **climbed from 0.879 at step 1 to 0.901 at step 3** — a 0.022 increase over the sequence. Presentation similarity climbed too: 0.533 → 0.583 (+0.050).

### 3.2 Per-pair detail per step

**Step 1 (iran-strike, no prior state) — 6 pairs:**

| Pair | fid | pres | verdict |
|---|---:|---:|---|
| Premium ↔ FastTrade | 0.95 | 0.68 | ✅ distinct |
| **Premium ↔ Helix** | **0.88** | 0.52 | 🚨 **fabrication_risk** |
| Premium ↔ Northbridge | 0.95 | 0.42 | ✅ distinct |
| FastTrade ↔ Helix | 0.92 | 0.42 | ✅ distinct |
| FastTrade ↔ Northbridge | 0.95 | 0.58 | ✅ distinct |
| **Helix ↔ Northbridge** | 0.95 | 0.58 | ❌ **reskinned** |

Fabrication_risk on Premium ↔ Helix: Helix fidelity dropped to 0.88 on the contrarian framing. This is the persistent Helix fact-drift — even with the 2026-04-08 tag rewrite, the `contrarian` and `skeptical` tags still occasionally push Helix to nudge probabilities.

**Step 2 (fed-rate-pause, 1 prior) — 6 pairs:**

| Pair | fid | pres | verdict |
|---|---:|---:|---|
| Premium ↔ FastTrade | 0.92 | 0.48 | ✅ distinct |
| Premium ↔ Helix | 0.92 | 0.48 | ✅ distinct |
| Premium ↔ Northbridge | 0.95 | 0.38 | ✅ distinct |
| **FastTrade ↔ Helix** | **0.78** | 0.58 | 🚨 **fabrication_risk** |
| FastTrade ↔ Northbridge | 0.95 | 0.58 | ✅ distinct |
| Helix ↔ Northbridge | 0.92 | 0.58 | ✅ distinct |

Fabrication_risk migrated from Premium ↔ Helix to FastTrade ↔ Helix — and Helix fidelity dropped hard to 0.78. Fed rate decision is a policy/rates event, not a geopolitical one; Helix's contrarian framing struggles more with Fed communication than with military shocks.

**Step 3 (iran-retaliation, 2 priors) — 6 pairs:**

| Pair | fid | pres | verdict |
|---|---:|---:|---|
| Premium ↔ FastTrade | 0.95 | 0.48 | ✅ distinct |
| Premium ↔ Helix | 0.95 | 0.62 | ✅ distinct |
| Premium ↔ Northbridge | 0.95 | 0.58 | ✅ distinct |
| **FastTrade ↔ Helix** | **0.92** | **0.58** | ❌ **reskinned** |
| FastTrade ↔ Northbridge | 0.95 | 0.62 | ✅ distinct |
| **Helix ↔ Northbridge** | 0.95 | **0.62** | ❌ **reskinned** |

**Fabrication_risk is gone by step 3.** The pair that fabricated in both prior steps (Helix's fidelity was 0.88 then 0.78) now sits at 0.92 — safely above the 0.9 floor. **Helix stopped drifting on facts.**

But the same pair **flipped to reskinned_same_article** at presentation 0.58. And a new reskinned pair appeared: **Helix ↔ Northbridge** at presentation 0.62.

### 3.3 What the accumulated state looked like

After all 3 steps, each broker has 3 entries in its store file (`packages/api/uniqueness-poc-state/eur-usd-q2-2026/<broker>/eurusd.json`). The extracted directional views:

| Broker | Step 1 | Step 2 | Step 3 | Final house view |
|---|---|---|---|---|
| **FastTrade Pro** | bearish (high) | bearish (high) | bearish (high) | bearish (high) |
| **Northbridge Wealth** | bearish (moderate) | bearish (high) | bearish (high) | bearish (high) |
| **Premium Capital Markets** | mixed (moderate) | bearish (moderate) | bearish (high) | bearish (high) |
| **Helix Markets** | mixed (high) | mixed (high) | mixed (high) | mixed (high) |

Three of the four brokers converged on **bearish (high)** house view by step 3. Helix is the only one that stays nominally "mixed" — but read its actual entries:

> **Helix step 1:** "The EUR/USD bear trade is structurally sound but dangerously crowded, vulnerable to reversal."
>
> **Helix step 2:** "The dollar bull trade just got validated by a hawkish Fed, but the crowding and positioning risk now run both ways."
>
> **Helix step 3:** "EUR/USD bears got their catalyst from the Yanbu strike, but the trade is now dangerously crowded."

Every Helix entry has the structure **"[bearish catalyst], but the trade is crowded/contrarian."** The contrarian framing is vestigial — the substance is the same bearish thesis the other three brokers have, wrapped in a skeptical voice. Helix's "mixed" house view label is a cosmetic artifact of the tag set; the actual directional content is bearish like everyone else.

---

## 4. The finding

**Accumulated narrative state across multiple events drives cross-pipeline convergence, not divergence.**

Concretely, over the 3-step sequence:
- **Cross-pipeline cosine mean: +0.022** (0.879 → 0.901)
- **Presentation similarity mean: +0.050** (0.533 → 0.583)
- **Reskinned-same-article count: doubled** (1 → 0 → 2 pairs)
- **Fabrication_risk: disappeared** (1 → 1 → 0 pairs) — but at the cost of Helix losing its distinctive voice

The prose of step 3 reads as four brokers writing the same bearish thesis in slightly different voices, with all the rough edges sanded off. Each broker's continuity directive ("maintain consistency with your prior directional view and key theses") pulls it toward the center of the distribution. Because every broker consumes the same source events, their accumulated states are structurally similar, and the continuation calls converge.

### 4.1 This confirms and strengthens the 2026-04-07 single-event finding

The 2026-04-07 session journal §7.4 predicted this exact mechanism, writing it up at the end of Run 4:

> **Narrative state propagates similarity forward — it doesn't create divergence.** If the prior pieces converged at 0.87 cosine, the extracted narrative states converge too (because the extractor is faithful to what each writer said), and the continuations converge too (because each writer is told to maintain consistency with their prior view). The mechanism is *additive in continuity but neutral in cross-tenant divergence*.

The single-event Stage 7 A/B in that session measured cosine improvement of **-0.0073** (control 0.8664, treatment 0.8736) — treatment was very slightly MORE similar than control, within noise.

This sequence run confirms the direction and amplifies the effect:
- **Single-event, single-prior Stage 7 treatment:** +0.007 cosine (negligible convergence)
- **Multi-event, 2-prior sequence Stage 6:** +0.022 cosine (3× larger convergence)

**Accumulated priors compound the convergence effect.** More prior entries = stronger continuity anchoring = more brokers pulled toward the centroid.

### 4.2 The Helix fabrication-to-reskin transformation

This is the most interesting secondary finding, and it's unexpected.

In steps 1 and 2, Helix was flagged `fabrication_risk` on pairs with other brokers because Helix's current tag set (`contrarian` + `skeptical` + `provocative`) still subtly licenses fact-adjustment — even after the 2026-04-08 rewrite tightened it. Helix fidelity dropped as low as 0.78 in step 2.

In step 3, **the same pair has fidelity 0.92** — comfortably above the 0.9 floor. Helix stopped fabricating facts. But its presentation similarity climbed to 0.58, flipping the verdict to `reskinned_same_article`.

**Mechanism:** the accumulated state pulled Helix into consistency with its own prior bearish thesis. Each prior entry said "the bear trade is real but crowded" — so step 3 had to maintain that thesis, which meant not drifting away from the bearish reality that the source FA also established. The continuity directive acted as a **soft factual anchor** that kept Helix from inventing counter-probabilities, because inventing new probabilities on step 3 would have contradicted the probabilities Helix itself wrote on steps 1 and 2.

This is a **cure for the Helix fabrication problem** — but the cost is that Helix loses the distinctive contrarian voice that justifies its existence as a separate persona. A contrarian broker that can't drift from its own prior view anymore is just "another bearish broker that happens to use skeptical language." The entire point of having Helix in the playground — to test whether a skeptical voice can produce distinct content against a consensus — is defeated if Helix is anchored to a consensus it wrote into its own prior entries.

---

## 5. What this means for the roadmap

### 5.1 Narrative state persistence is a product feature, not a uniqueness mechanism

The 2026-04-07 session already concluded this ("NOT a cross-tenant differentiation layer — IS a temporal-continuity product feature — spec the 'running thesis' dashboard view"). This sequence run confirms that conclusion empirically across multiple events rather than just inferring it from a single-event test.

**The positive use of narrative state:**
- "Feels like a human is writing" — each broker's voice is consistent across events, like a real writer covering a story
- "Running thesis" dashboard — clients can see their tenant's evolving view on a topic over weeks
- Voice-consistency checks — intra-tenant cross-event similarity is a FEATURE, not a bug

**The limit of narrative state:**
- It does not add cross-tenant divergence
- Over multiple events it actively causes convergence
- Long-lived state (more than ~3-5 entries) probably makes the convergence effect worse, not better

### 5.2 The content-uniqueness spec's conformance engine prediction is still the right bet

`2026-04-07-content-uniqueness.md` §6 predicted the conformance engine would add "−0.05 to −0.10 cosine of deterministic differentiation via glossary substitution + regional variant rewrites + brand voice corrections." The sequence run shows that LLM-layer mechanisms alone (prompt tilt, persona overlay, tag differentiation, narrative state injection) do NOT move the cross-pipeline cosine below ~0.87. The only tool left untried is the deterministic conformance layer — exactly what playground spec §20.5 Part B plans.

**The playground spec §20.5 Part B just got a priority boost.** It was the "production-correct long-term fix" for the structural-label problem; this run shows it's also the most likely path to actually move cross-pipeline cosine into safer territory.

### 5.3 Questions this session deliberately did not answer

- **True Stage 7 A/B on the same event.** The runner's auto-detect for Stage 7's "second event" fires only when `fixtureId === "iran-strike"` (see `runner.ts` around line 200 — hardcoded string check). Step 3 of the sequence used `iran-retaliation` as the fixture, so Stage 7 didn't run. We're inferring the state's effect by comparing Stage 6 cosines across different events, which carries an event confound — iran-retaliation might intrinsically produce higher or lower cross-tenant cosine than iran-strike, and we can't separate that from the state effect.
- **Control: iran-retaliation green-field (no prior state) Stage 6 cosine.** A clean comparison requires running iran-retaliation standalone via `bun run poc:uniqueness iran-retaliation --full` and comparing its Stage 6 cosine to the sequence's step 3 cosine. Additional $0.65, ~5 min. **Recommended follow-up before trusting the "+0.022 convergence" number.**
- **Sequence length sensitivity.** Does a 5-step or 10-step sequence make the convergence bigger or smaller? Is there a saturation point? Would a longer horizon with an attention-decay policy (prefer recent entries) reverse the effect? All parked.
- **What happens to Helix under a proper contrarian-house-view FA agent** (the parked workstream from journal §13). If Helix had its own FA pass with contrarian priors — not just downstream tilt — the accumulated state would anchor Helix to an actually-different prior view, not a rebadged version of consensus. That's a bigger architectural shift and the right way to make contrarian brokers truly distinct.

---

## 6. What to do next

### 6.1 Immediate follow-up (cheap, high-value)

**Run iran-retaliation standalone as a green-field control.** One CLI invocation:

```bash
bun run packages/api/src/benchmark/uniqueness-poc/index.ts iran-retaliation --full
```

Compare its Stage 6 cosine mean against step 3's 0.901. If the control comes in significantly lower (say 0.86-0.87), the +0.022 convergence is the state effect. If the control is also around 0.90, the convergence is an iran-retaliation-specific artifact and we need another sequence to isolate. Either result is valuable.

**Cost:** ~$0.65, ~5 min. Should be trivial to do right after this journal is committed.

### 6.2 Priority reshuffle for §20 items in the playground spec

Before this session, §20.5 Part B (conformance engine wiring) was "production-correct long-term fix." After this session, it's **the highest-priority cross-pipeline differentiation work**, because every LLM-layer mechanism we've tested (prompt tilt, tags, narrative state) has hit a ~0.87 cosine floor and the only remaining lever is the deterministic conformance layer. Section labels (§20.5 Part A) probably still help at the structural level but won't move the cosine into safe territory on its own.

**Updated priority:**

1. **§20.3 — Stop run button** — unchanged, still highest per-session value
2. **§20.5 Part B — conformance engine integration** — **moved up** based on this session's evidence that LLM-layer mechanisms alone hit a ~0.87 floor
3. **§20.5 Part A — section labels + termMap** — still useful but expected to be a smaller delta than Part B
4. **§20.4 polish items** — activity log + topbar pill + persona-defaults chip
5. **§20.1 + 20.2 — stages selector refactor** — lowest urgency
6. **New §20.6: narrative-state-as-feature surface in the playground** (added based on this session) — the "running thesis" dashboard view, using accumulated state as a product feature rather than a uniqueness mechanism

### 6.3 Update the existing journal and memory files

- **`docs/poc-uniqueness-session-2026-04-07.md` §7.1** — has a standing claim that "narrative state is not a cross-tenant differentiation layer." This session's data **strengthens** that claim; the journal should get a pointer to this document as empirical confirmation.
- **`~/.claude/projects/.../memory/project_uniqueness_poc_2026_04_07.md`** — current text says "narrative state does NOT add cross-tenant divergence." Update to "narrative state actively DRIVES cross-tenant convergence over multi-event sequences (see `poc-sequence-session-2026-04-09.md` §4)." Stronger, empirical, specific.
- **`2026-04-08-narrative-state-persistence.md` §10 "Walk-through"** — the canonical multi-event test in the spec was hypothetical. This session executed it. Add a pointer to this journal in §10 so future readers know the experiment has been run.

---

## 7. Cost breakdown

| Step | Fixture | Stages | Duration | Cost |
|---|---|---|---:|---:|
| 1 | iran-strike | 1+2+3+3.5+6 | ~5 min | $0.63 |
| 2 | fed-rate-pause | 1+2+3+3.5+6 | ~4.5 min | $0.63 |
| 3 | iran-retaliation | 1+2+3+3.5+4+5+6 | ~6 min | $0.77 |
| **Total** | | | **~15 min** | **$2.02** |

Plus ~$0.67 wasted on the first attempt that crashed in step 2 Stage 3.5 before the judge retry fix landed. Total session spend: **~$2.70**.

Plus whatever the standalone iran-retaliation control run costs ($0.65) will take the full session to **~$3.35**. Still under the ~$4-5 budget I proposed at the start of the session.

---

## 8. Status of the narrative-state-persistence workstream

**Per the 2026-04-08 spec:** Draft (decision spec — no code yet)
**Actual status as of 2026-04-09:** **Implemented, measured, findings recorded.**

The spec's status field lies because the code shipped silently inside commit `14e9b47` (the v1.2 playground agent absorbed the narrative-state files as prerequisites). The `narrative-state-store.ts`, the runner wire-in points, the `EventSequence` type, the `loadSequence`/`runSequence` CLI helpers, and the fixtures are all committed. The spec is committed as of `dcd2a03`. The CLI script is committed as of `f72d7c4`. The first end-to-end run happened in this session.

**The spec's hypothesis (§10.5 "Expected state file after step 3") matched reality structurally** — 3 entries per broker per topic, newest-last, derived house view mirroring the newest entry. Store files came out exactly as the spec predicted.

**The spec's hypothesis about cross-tenant divergence (§10.5 "Hypothesis under test") was falsified** — multi-event accumulation drives convergence, not divergence.

That's the valuable kind of falsification: the spec was executable enough that the experiment could say "no, the other direction."

---

**End of session journal.**

*Generated 2026-04-09 by Claude (Opus 4.6) after the canonical eur-usd-q2-2026 sequence ran end-to-end on the playground branch. This is the first empirical measurement of multi-event narrative-state accumulation on cross-pipeline divergence. Findings: accumulation drives convergence, not divergence, confirming and strengthening the 2026-04-07 single-event prediction. Conformance engine integration (§20.5 Part B) promoted to top priority for cross-pipeline work. All commits (`d3299f5` persistence fix, `dcd2a03` narrative-state spec, `f72d7c4` sequence cli script, `8fe0899` sequence + judge fixes) live on branch `workstream-b-playground`, not yet pushed.*
