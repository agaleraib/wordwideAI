# Uniqueness PoC Test-Methodology Audit and Baseline

**Status:** Round 1 draft — pending Codex adversarial review per `2026-05-06-uniqueness-poc-audit-plan.md` §7
**Date:** 2026-05-06
**Author:** Claude (Opus 4.7) drafting; Codex (GPT-5.4) adversarial reviewer
**Plan that gates this:** `docs/specs/2026-05-06-uniqueness-poc-audit-plan.md`
**Code under audit:** `packages/api/src/benchmark/uniqueness-poc/` at master commit `484359a`
**Prior writeups examined:** `docs/uniqueness-poc-analysis/2026-04-19-wave3.md`

---

## 0. TL;DR

The uniqueness PoC harness is a structurally sound experimental rig with **decision-grade evidentiary value** for ship/iterate/abandon calls — *not* publication-grade. With N = 6 pairs per event, a single LLM judge with no inter-rater data, and several reproducibility primitives missing or implicit, the strongest defensible claim from a single test is *"the variant moved metric X by Y on this fixture under these run conditions, with bootstrap CI [a,b]."* The audit identifies **eleven verdict-relevant gaps** (four high-risk, five medium, two low) and recommends a baseline methodology that can be implemented incrementally without code rewrites — most fixes are reproducibility receipts, pre-registration of thresholds, and a Phase-2 lightweight inter-rater protocol. **One calibration finding is verdict-changing in retrospect:** Wave 4's pivot to persona-layer fixes was based on an attribution claim (variant-independence of the fasttrade-pro fidelity outlier) that the methodology cannot rigorously support given current confounders, which means the persona-layer regression Wave 4 produced may not actually rule out the layer.

---

## 1. Scope and bar

### 1.1 Scope

This audit covers the uniqueness PoC harness in `packages/api/src/benchmark/uniqueness-poc/`. Specifically:

- The seven-stage runner (`runner.ts`)
- The LLM judge (`llm-judge.ts`)
- Similarity metrics — cosine + ROUGE-L (`similarity.ts`)
- Verdict aggregation (`runner.ts` lines 1130–1179, 750–768)
- Fixture structure and persona schema (`personas/*.json`, `types.ts`)
- Reproducibility primitives — `RunManifest` (`types.ts` lines 21–58), `persistRun` (`persist.ts`)
- Wave-validation pattern as practiced (pilot/full, baselines, SHIP/ITERATE/ABANDON)

### 1.2 Out of scope (deliberate, per audit-plan §3.2)

- Translation engine 13-metric scoring (`packages/api/src/scoring/`) — different decision type, different N regime; deferred to its own audit when triggered
- Editorial memory contradiction detector (Haiku) — same LLM-as-judge methodology family but separate decision surface; deferred
- Run comparator (`run-comparator/`) — tooling, not a measurement system
- Production translation pipeline metrics
- A unified "FinFlow measurement-quality framework" — premature abstraction; foundations sections in this audit (tagged `<foundations>`) provide the seed for it when a second audit triggers

### 1.3 The bar

Restating from the plan, with this audit's conclusions added:

**This audit produces decision-grade evidence**, defined as: evidence good enough to make ship/iterate/abandon decisions Albert will defend in 6 months and to a design partner if asked.

It **does not** produce publication-grade or peer-review-grade statistics. The PoC's operating constraints — N = 6 pairs/event, 1–4 events/study, single Haiku judge with no inter-rater architecture, evolving prompts, ~$0.73/event LLM cost, no semantic versioning of judge prompts — preclude:

- Frequentist NHST claims at p < 0.05 thresholds
- Multiple-comparisons-corrected significance over the metric panel
- External-validity claims beyond the tested fixture set
- Effect-size attribution without explicit confounder control

What this audit *does* enable, when its recommendations are implemented:

- Bootstrap confidence intervals over metric distributions
- Bayesian effect-size estimates with explicit priors anchored on prior wave outcomes
- Inter-rater reliability spot-checks via judge-twice-on-same-pair sampling
- Reproducibility receipts (seed, prompt hash, model version pinning, fixture content hash, package version) sufficient for cross-time comparability
- Verdict shape (SHIP / ITERATE / ABANDON) defended against pre-registered threshold criteria with explicit garden-of-forking-paths defense

The bar is restated in §5 (Recommended baseline) and §4.12 (What this can and can't tell us) — three independent reminders, per success criterion §9.f of the plan.

---

## 2. Reference frameworks

The audit cites load-bearing ideas from the following frameworks — not exhaustive surveys.

### 2.1 Trustworthy Online Controlled Experiments — Kohavi, Tang, Xu (2020)

The canonical A/B-testing methodology from Microsoft / Bing. Used for: Sample Ratio Mismatch (SRM) checks, peeking discipline, the Overall Evaluation Criterion (OEC) framing, multiple-comparisons hygiene. Adapted from high-N tech (10⁶+ users) to low-N research; many primitives (OEC, randomization unit, novelty/primacy effects) survive the adaptation. Cited in §4.5, §4.6, §4.10.

### 2.2 HELM — Holistic Evaluation of Language Models — Liang et al. (2022, Stanford CRFM)

Multi-axis LM-evaluation framework. Used for: scenario coverage, multi-metric evaluation, prompt-sensitivity rigour, robustness checks. Cited in §4.3, §4.6, §4.8.

### 2.3 BIG-bench — Srivastava et al. (2023)

Collaborative LLM benchmark. Used for: prompt sensitivity, evaluation cost-vs-value, judge selection, evaluation reproducibility primitives. Cited in §4.1, §4.3.

### 2.4 Bayesian Workflow — Bürkner, Gabry, Kennedy, Vehtari et al. (2023)

Bayesian approach to model evaluation when N is small and decisions are sequential. Used for: posterior intervals over metric distributions; weakly-informative priors anchored on prior wave outcomes. Cited in §4.9.

### 2.5 Replication-crisis literature — OSF Reproducibility Project (Many Labs, 2015); Ioannidis (2005, *PLoS Medicine*)

Concrete failure modes of small-N research: file-drawer, p-hacking, garden of forking paths, hypothesizing after results are known (HARKing). Cited in §4.10, §4.12.

### 2.6 Troubling Trends in ML Scholarship — Lipton & Steinhardt (2018)

Specific ML methodology pitfalls: conflating hypotheses, suggestive language, wrongly chosen baselines, mathiness. Used as a checklist against this audit's own claims and against past wave writeups. Cited in §4.4, §4.12.

### 2.7 NLG-evaluation and LLM-judge literature

- Reiter (2018) survey of NLG evaluation
- Celikyilmaz, Clark, Gao (2020) — eval methods for text generation
- Zheng et al. (2023) "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" — known LLM-judge biases (verbosity, position, self-preference)
- Chiang & Lee (2023) "Can Large Language Models Be an Alternative to Human Evaluations?" — judge calibration
- Liu et al. (2023) "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment"

Cited in §4.3, §4.7.

### 2.8 FinFlow-internal evidence

- Wave 3 writeup `docs/uniqueness-poc-analysis/2026-04-19-wave3.md`
- Wave 4 pilot run analysis (`uniqueness-poc-runs/2026-04-20T14-36-49-400Z_fed-rate-pause-2026-04-03/`)
- Memories: `feedback_validation_wave_pattern.md`, `feedback_llm_pilot_first.md`, `feedback_bundle_not_slice_prompt_ab.md`, `project_uniqueness_poc_full_run_cost.md`, `project_uniqueness_poc_stage_semantics.md`, `project_wave4_persona_layer_ceiling.md`, `project_fasttrade_pro_persona_rootcause.md`

Empirical anchor — methodology must fit what we've actually been doing, not an abstract ideal.

---

## 3. Current methodology

### 3.1 The seven stages

The runner (`runner.ts`) executes up to seven stages per event, gated on CLI flags:

| # | Stage | Trigger | Code | What it produces |
|---|---|---|---|---|
| 1 | Core analysis (FA) | Always | `runner.ts` 1312–1316 → `runCoreAnalysis()` | One Opus 4.1 (`claude-opus-4-1-20250514`) call to `FA_AGENT_SYSTEM_PROMPT` (`prompts/fa-agent.ts`); ~400-token analysis body that becomes the shared upstream content |
| 2 | Identity adaptation | Always | 1324–1329 → `runAllIdentities()` | 6 parallel Sonnet calls — one per registered identity; outputs versioned by `structuralVariant` if the persona declares one |
| 3 | Embeddings + intra-tenant pairwise matrix | Always | 1331–1338 → `embedOutputs()`, `buildPairwiseMatrix()` | C(6,2) = 15 pairs, each with cosine (OpenAI `text-embedding-3-small`) + ROUGE-L F1 |
| 3.5 | Intra-tenant LLM judge on borderline pairs | Conditional (cosine ≥ 0.92 OR ROUGE-L ≥ 0.5) | 1340–1357 → `judgeBorderlinePairs()` | Two-axis verdict per borderline pair from `claude-haiku-4-5-20251001` |
| 4 | Reproducibility test | `--full` and `withReproducibility` | 1359–1369 | Same identity run N times (default 3) on same core; pairwise cosine over the N |
| 5 | Persona differentiation | `--full` and `withPersonaDifferentiation` | 1371–1382 | One identity × two personas; cosine between the outputs; boolean `differentiated` |
| 6 | Cross-tenant matrix (the load-bearing test) | `--full` and `withCrossTenantMatrix` | 1390+ | One identity × N personas (typically 4–6); judge called on **all** pairs (not just borderline); stricter thresholds (cosine < 0.80, ROUGE-L < 0.40) |
| 7 | Narrative-state continuity test | `--full` and `withNarrativeStateTest` | ~896+ | Control vs treatment groups on second event; tests whether per-persona narrative memory increases differentiation |

**Stage labelling gotcha (preserved verbatim from `project_uniqueness_poc_stage_semantics.md`):** Stage 3.5's "intra-tenant" verdict measures **identity-format diversity** (do different identity templates produce visibly different formats?) — *not* brand fragmentation. The actual brand-coherence question — does the same identity for the same tenant produce a recognizable house voice across multiple pipeline runs? — is unmeasured anywhere in the harness today. User-facing labels were renamed in Wave 3 follow-up (`"Identity-format diversity verdict (no-persona)"`). The internal `Stage` discriminator stays for raw-data.json compatibility.

### 3.2 The LLM judge

`llm-judge.ts` lines 286–426. Structured-output pattern via Anthropic `tool_use` (`submit_uniqueness_verdict`).

- **Model:** `claude-haiku-4-5-20251001` — pinned by date suffix.
- **System prompt:** ~182 lines, two axes (Factual Fidelity, Presentation Similarity), trinary verdict (`distinct_products`, `reskinned_same_article`, `fabrication_risk`), calibration anchors at 0.0/0.5/1.0.
- **User prompt:** Document A + Document B excerpts plus the precomputed cosine + ROUGE-L for context (told NOT to defer to them).
- **Output (JudgeVerdict):** `factualFidelity ∈ [0,1]`, `presentationSimilarity ∈ [0,1]`, `factualDivergences[]` with `kind ∈ {level, probability, direction, stop, confidence, historical_anchor, transmission_chain_set, conclusion, other}`, `verdict`, plus token/cost.
- **Hard-rule enforcement:** code-side override (lines 381–386). Any divergence with `kind ∈ {level, probability, direction, stop, historical_anchor}` overrides the model's verdict to `fabrication_risk`. The model is told the hard rule but has been observed returning `distinct_products` alongside a `level` divergence — code, not prompt, is the actual gate.
- **Retries:** up to 3 on retriable errors (Zod validation failure, missing tool_use). Non-retriable (401/403/429 etc.) propagate. Persistent failures land in `judgeFailures[]`.
- **Inter-rater:** **none.** No second independent judge call on the same pair; no human spot-check sampling. This is the most consequential single architectural property of the harness.

### 3.3 Similarity metrics

`similarity.ts`:
- **Cosine** — OpenAI `text-embedding-3-small` (line 14), one call per output, computed over `embedOutputs(...)`. Embeddings cached in memory only. Not pinned; the model can be silently upgraded by OpenAI.
- **ROUGE-L F1** — pure-TS LCS over Unicode-aware lowercase tokens with non-alphanumerics stripped (lines 85–134). Deterministic given input.

### 3.4 Verdict aggregation

Two layers:

**Per-pair (judge → code-enforced override):**
1. Judge returns raw verdict.
2. Hard-rule check — if any divergence kind is in the fabrication set, override.

**Per-run (cross-tenant):**
1. Any `fabrication_risk` → FAIL.
2. Any `reskinned_same_article` → FAIL (after fabrication check).
3. Borderline pairs cleared by judge → PASS.
4. Mixed verdicts on borderline pairs → BORDERLINE.
5. Otherwise → PASS.

Wave writeups report this aggregate plus three count-form metrics — `distinct_products`, `reskinned_same_article`, `fabrication_risk` — as fractions over the pair set (e.g., `5/6`, `0/6`, `1/6`).

### 3.5 What `RunManifest` captures

Per `types.ts` 21–58 and `index.ts` 196–203:

**Captured:** `version`, `timestamp`, `gitCommitHash` (short SHA), `runtime` (bun/node + version), `memoryBackend`, `stagesEnabled` (boolean flags), `cliFlags` (raw argv), `fixtureId`, `eventIds`, `personaIds`, `identityIds`, `promptHashes` (SHA-256 first 8 chars of each identity's `systemPrompt`), `sequenceId/Step`.

**Not captured:**
- Concrete model versions used per call (`IdentityOutput.model` is a string but not strictly pinned by ID; embedding model is hardcoded; judge model is hardcoded; conformance-pass model is hardcoded).
- Judge prompt version — no semantic version or date marker on the judge system prompt itself.
- Fixture content hash (fixture loaded from JSON; no per-run integrity check).
- Package versions (`package.json` / `bun.lockb` hash).
- Random seed — none set; relies on temperature 0 + model version stability for "determinism."

### 3.6 Output structure

`uniqueness-poc-runs/<runId>/` contains `report.md`, `core-analysis.md`, `raw-data.json`, `similarity-matrix.json`, and per-stage outputs under `outputs/`. `raw-data.json` is the canonical machine-readable record; `report.md` is human-facing.

---

## 4. Audit findings

Each subsection: current state → reference-framework expectation → gaps with risk → recommendation. Subsections marked `<foundations>` are tagged for reuse by future 13-metric and contradiction-detector audits.

### 4.1 Reproducibility primitives

<!-- foundations:start -->

#### 4.1.1 Current state

`RunManifest` captures `gitCommitHash`, `runtime`, `cliFlags`, `promptHashes` (per-identity SHA-256 of system prompt), `personaIds`, `identityIds`. Persistence via `persistRun()` writes `raw-data.json`, `similarity-matrix.json`, plus per-stage markdown outputs to a per-run directory under `uniqueness-poc-runs/`.

#### 4.1.2 Reference-framework expectations

Kohavi (2020, ch. 13) and BIG-bench (2023, §4) require: pinned model versions for every model call; content-addressable fixtures; package/dependency versions; deterministic seed when applicable; full prompt provenance (not just system prompt hash but user-message templates and tool-schema hashes too).

#### 4.1.3 Gaps

| Gap | Risk | Why |
|---|---|---|
| Embedding model not pinned | **High** | `text-embedding-3-small` is hardcoded in `similarity.ts` line 14. OpenAI can silently upgrade it. A future cosine "drift" between waves could be embedding model drift, not content drift. Cosine appears in the gate threshold (0.80 cross-tenant). |
| Judge model version captured at time of call but not in manifest | **High** | The judge call uses `claude-haiku-4-5-20251001` (date-pinned), good. But the manifest does not record this — only stage flags. A future judge upgrade silently changes verdict semantics. |
| Judge system prompt has no version marker | **High** | Per Explore finding §10.8 — no semantic version or date in the prompt. If the rubric or hard-rule kinds change, old and new runs are incomparable without git-archaeology. |
| Fixture content hash not stored | **Medium** | Fixtures are git-tracked but the manifest doesn't record content-hash. If a fixture is edited mid-experiment without a commit, the test silently changes. Common in iteration. |
| Package versions not captured | **Medium** | No `bun.lockb` hash or dependency-tree snapshot. A model SDK version bump can change tokenization or retry behavior. |
| User-message templates not hashed | **Low** | Only system-prompt hashes are captured. User-message builders (`buildUserMessage(...)`) can change without surfacing in the manifest. |
| Conformance-pass cost silently omitted from `totalCostUsd` | **Medium** (audit-trail integrity, not reproducibility per se) | Per Explore finding §10.3 — `stage6PersistCost` incremented in `ConformanceDetail[]` but never added to the run total. Cost reports under-state. |
| No deterministic seed on Stage 4 reproducibility test | **Low** | Stage 4 is meant to measure non-determinism; relies on model temperature + sampling for variance. Acceptable as long as it's documented. |

#### 4.1.4 Recommendation

A single "reproducibility receipt" extension to `RunManifest`:

```ts
manifest.reproducibility = {
  models: {
    fa: "claude-opus-4-1-20250514",
    identity: "claude-sonnet-4-20250514",     // resolved at call time
    judge: "claude-haiku-4-5-20251001",
    embedding: "text-embedding-3-small",
    conformance: "claude-sonnet-4-20250514",
  },
  promptVersions: {
    judge: "v3-2026-04-15",                    // hand-bumped semver
    fa: sha256(FA_AGENT_SYSTEM_PROMPT),
    identities: { ... },                       // already captured
  },
  fixtureHash: sha256(fixtureFile),
  packageHash: sha256(bunLockfile),
  temperatureOverrides: { ... },               // any non-default
};
```

Implementation cost: ~half a day. Highest leverage of any single audit recommendation. **This is the keystone fix** — without it, no other audit recommendation has reproducible meaning.

<!-- foundations:end -->

### 4.2 Sample adequacy

#### 4.2.1 Current state

Each event produces 6 cross-tenant pairs (C(4,2) = 6 with 4 personas, or up to C(6,2) = 15 with the widened broker-a..f fixture from Wave 4). A "full" run is 4 events → 24–60 pairs total. Wave writeups report categorical-verdict counts as fractions (e.g., `distinct_products: 5/6`).

#### 4.2.2 Reference-framework expectations

Kohavi (2020, ch. 17) on minimum detectable effect (MDE): for a binomial proportion with N = 6 and α = 0.05, the 95% CI half-width at p = 0.5 is ±0.40 — i.e., we cannot distinguish 30% from 70% rates with N = 6. With N = 24, half-width drops to ±0.20.

For continuous metrics (cosine, ROUGE-L), Bayesian-Workflow (Bürkner et al. 2023) recommends posterior intervals via bootstrap or weakly-informative priors when N is small. Effect sizes need explicit reporting; point estimates without CIs are misleading.

#### 4.2.3 Gaps

| Gap | Risk |
|---|---|
| Verdict counts reported as fractions without CIs | **High** — `5/6 → 2/6` reads as a strong signal but the 95% CI on the difference between two binomial proportions with N=6 each is roughly ±0.55. Even with N=24 vs N=24, ~±0.30. |
| Wave writeups state effect sizes (`+3/6 distinct_products`) without bootstrap | **High** |
| No explicit MDE (minimum detectable effect) declared per wave | **Medium** — without an MDE, a "no significant change" verdict is unbounded; we don't know if the test was capable of detecting the effect |
| Continuous metrics (mean cosine, mean fidelity) reported as point estimates | **Medium** — Wave 3's "−0.044 cosine drop" point estimate has no CI; could be noise |

#### 4.2.4 Recommendation

For every wave writeup:
1. Report all categorical metrics with **bootstrap 95% CIs** (resample pairs with replacement, ≥10,000 iterations).
2. For mean continuous metrics, report bootstrap CI on the mean.
3. Pre-declare the **MDE for the metric the wave most cares about**, given the planned N.
4. Explicit "underpowered for X" disclaimers when MDE > expected effect.

Implementation: a small bootstrap helper in `analyze.ts` (or a sibling `statistics.ts`); roughly half a day.

### 4.3 Judge reliability

<!-- foundations:start -->

#### 4.3.1 Current state

Single judge call per pair, model `claude-haiku-4-5-20251001`, up to 3 retries on Zod failures. No second independent call. No periodic human spot-check. Judge prompt has no version marker.

#### 4.3.2 Reference-framework expectations

Zheng et al. (2023) "Judging LLM-as-a-Judge" documents three pervasive biases: **verbosity bias** (longer outputs preferred), **position bias** (first-listed preferred), **self-preference** (judge from same model family preferred). Mitigations: swap A/B order, run twice per pair, calibrate on human-rated pairs.

HELM (Liang et al. 2022, §6) recommends multi-judge ensembles for robust evaluation, with explicit reporting of inter-rater agreement (Cohen's κ or similar).

Chiang & Lee (2023) showed that single-LLM-judge correlation with human judgment can range from 0.50 to 0.85 depending on task and rubric — high enough to be useful but with non-trivial variance that single calls do not reveal.

#### 4.3.3 Gaps

| Gap | Risk |
|---|---|
| No inter-rater architecture | **High** — if the judge has σ = 0.10 on `factualFidelity`, a 0.04 reported drop between waves is likely noise |
| Position-bias unmeasured | **Medium** — Document A always presented first; never swapped |
| Verbosity-bias unmeasured | **Medium** — pairs of different lengths may systematically receive different verdicts |
| Judge-prompt drift unobservable | **High** — no version marker means any rubric change since Wave 1 is invisible to the comparison surface |
| Hard-rule override happens code-side, not judge-side | **Medium** — when the model returns `distinct_products` with a `level` divergence, the override produces a `fabrication_risk` count. This count is correct *given the rule*, but the "judge agreement" reported in writeups conflates judge + rule. They should be reported separately. |
| No periodic human calibration | **High** — the judge could have drifted into a rubric the team would now disagree with, and no signal would surface |

#### 4.3.4 Recommendation

Three-tier reliability protocol:

**Tier 1 — Always (zero-cost addition):**
- Add a `judge_prompt_version` semver. Bump on any rubric edit.
- Capture the judge prompt hash + version in `RunManifest`.
- Report verdict counts in two columns: "judge raw" and "post hard-rule override."

**Tier 2 — Per wave (small added cost):**
- For 20% of pairs (or ≥3 pairs whichever larger), run the judge **twice** with A/B order swapped. Report agreement rate. If disagreement > 15% on the gate metric, flag the wave as judge-unreliable.

**Tier 3 — Quarterly or on judge model upgrade:**
- Human spot-check 10 pairs from a recent wave. Compare verdicts; report Cohen's κ between human and judge. Anchor recalibration against this.

Tier 1 is the keystone for this dimension. Tier 2 doubles judge cost on sampled pairs (still bounded since it's 20% of pairs ≈ +20% on judge spend). Tier 3 is human time (~1 hour quarterly).

<!-- foundations:end -->

### 4.4 Baseline integrity

<!-- foundations:start -->

#### 4.4.1 Current state

Each wave reports its variant against a "baseline" — the most recent prior wave's output for the same event. Wave 3 compared variant prompts to Wave 2 baseline; Wave 4 pilot compared to Wave 3. The baseline is implicit — a directory under `uniqueness-poc-runs/` from a prior run.

The Wave 3 writeup explicitly notes: *"ROUGE-L drop: −0.028 (below the 0.08-0.15 estimate, directionally correct — code drift between baselines is a confounder)."* — i.e., even the writeup author knew the baseline had drifted.

#### 4.4.2 Reference-framework expectations

Lipton & Steinhardt (2018) §3.2 calls out "wrongly chosen baselines" as one of four most-common ML methodology failures — specifically, comparing to a baseline that has changed in the period since it was set, where changes are not the variable under study.

Kohavi (2020, ch. 21) on holdback experiments: reuse of historical baselines requires that *no other variable be changing simultaneously*; otherwise the comparison is confounded.

#### 4.4.3 Gaps

| Gap | Risk |
|---|---|
| Baselines are implicit, not declared | **High** — the writeup names a date but the comparison is to whatever ran on that date with whatever code/prompts/models existed then |
| No baseline-validity check | **High** — no mechanical check that the baseline's reproducibility receipt matches the dimensions held constant in the current variant |
| Code drift between baselines silently confounds | **High** — the Wave 3 ROUGE-L finding above is a confessed example. There may be others undetected. |
| Model-version drift confounds | **Medium** — Anthropic ships new model versions. A 2026-04-15 baseline used a Sonnet snapshot that a 2026-05-06 run may not be able to invoke; if it was run today, the result would differ. |
| Wave-on-wave comparison without re-running the baseline | **High** — if Wave 5 variant is compared only to Wave 4 baseline, but Wave 4 baseline was already drifted from Wave 3's, error compounds wave over wave |

#### 4.4.4 Recommendation

**Two-baseline rule:** every wave reports against **both**
1. The most recent prior wave (continuous chain), AND
2. A **freshly re-run baseline** — i.e., the prior wave's variant re-executed under the current run's reproducibility receipt. The cost: one extra full run per wave (~$3–4) but it cleanly separates "did the variant move things?" from "did model/prompt drift move things?"

If the freshly re-run baseline differs from the historical baseline by more than the wave's MDE, **the wave's verdict is not actionable** — you've measured drift, not the variant.

Pre-merger of variant: confirm the freshly-rerun baseline reproduces the historical baseline's verdict within MDE. If not, debug drift before evaluating the variant.

Implementation cost: ~$3–4 LLM spend per wave; doubles budget but provides what the existing methodology cannot — confounder-free attribution.

<!-- foundations:end -->

### 4.5 Verdict-shape soundness

#### 4.5.1 Current state

SHIP / ITERATE / ABANDON verdicts in spec writeups. Thresholds are qualitative ("strictly improved", "non-regressive"). The FA prompt iteration spec (`2026-05-06-fa-prompt-iteration.md` §5.4) reads:

> SHIP — pilot + full run both show: `fabrication_risk` strictly improved AND `distinct_products` non-regressive AND `reskinned_same_article` non-regressive vs. **both** baselines.

#### 4.5.2 Reference-framework expectations

Kohavi (2020, ch. 7) on the OEC: a single composite metric, decided in advance, against which the experiment is judged. Multi-metric scorecards permitted but require a pre-declared decision rule.

#### 4.5.3 Gaps

| Gap | Risk |
|---|---|
| "Strictly improved" is undefined given N | **High** — with N=6 and bootstrap CI ±0.55 on a binomial, "strictly improved" without a magnitude or CI is ambiguous |
| "Non-regressive" similarly undefined | **High** — does a 1/6 → 0/6 count as regression? Probably no. 5/6 → 4/6? With the CI, statistically indistinguishable from 5/6. |
| Three metrics treated as conjunction with no priority | **Medium** — what if `fabrication_risk` improves but `distinct_products` regresses by 1? Spec is silent; depends on writeup author's judgment |
| Verdict shape post-hoc-tunable | **Medium** — without pre-registration, the threshold can drift to match the result |

#### 4.5.4 Recommendation

For each wave's spec, **pre-register**:
1. The OEC — the single primary metric the wave is built to move (e.g., FA prompt iteration: `fabrication_risk` count).
2. The pre-declared decision rule on the OEC, with magnitude:
   - SHIP — OEC improves by ≥ X (with CI not crossing zero) AND no secondary metric regresses by > Y (CI not crossing zero on the regression direction).
   - ITERATE — OEC moves in the right direction but CI crosses zero; OR a secondary metric regresses ambiguously.
   - ABANDON — OEC regresses with CI not crossing zero; OR no movement after X spend.
3. The pre-declared X and Y, defended with a back-of-envelope MDE calculation for the planned N.

This cannot be done retroactively. It must live in the wave's own spec, before any run.

### 4.6 Multiple-comparisons surface

#### 4.6.1 Current state

Three count metrics + cosine + ROUGE-L + factualFidelity + presentationSimilarity = at least seven correlated measurements per pair. Wave writeups report all of them. The three-metric verdict is a conjunction with no formal correction.

#### 4.6.2 Reference-framework expectations

Kohavi (2020, ch. 17) and Lipton & Steinhardt (2018) §3 call out family-wise error rate inflation when reporting many correlated metrics. Bonferroni correction is one option (conservative); HELM's recommendation is to declare a single primary metric and treat others as secondary/diagnostic.

#### 4.6.3 Gaps

| Gap | Risk |
|---|---|
| All three count metrics treated as primary | **Medium** — with three metrics, family-wise α inflates from 0.05 to ~0.14 if naively interpreted |
| Cosine, ROUGE-L, fidelity, presentation correlated | **Low** — these are diagnostic in current writeups, but if any are weighted into a verdict, correction needed |
| Per-pair detail dredging | **Medium** — wave writeups regularly dive into pair-level diffs ("premium ↔ fasttrade fid=0.75"); informative but a fishing expedition without correction |

#### 4.6.4 Recommendation

Designate **one** primary metric per wave (the OEC, per §4.5). Treat others as secondary/diagnostic and apply Bonferroni-correction when used in the SHIP/ABANDON decision (i.e., effective α = 0.05/k for k secondary metrics).

Pair-level inspection ("which specific pairs regressed") remains valuable for **interpreting** verdicts but cannot itself determine SHIP/ABANDON.

### 4.7 Confounders

<!-- foundations:start -->

#### 4.7.1 Current state

Confounders the harness contends with implicitly: model drift (Anthropic and OpenAI updates), judge drift (single-judge, no version marker), fixture drift (no content hash), prompt drift (system prompts change between waves; user-message templates not hashed at all).

#### 4.7.2 Reference-framework expectations

Kohavi (2020, ch. 12) on history effects, novelty/primacy effects, and segment drift. NLG/LLM-judge literature on judge family drift.

#### 4.7.3 Gaps

Combined with §4.1 reproducibility gaps. Specifically named confounders not currently controllable:

| Confounder | Visible? | Risk |
|---|---|---|
| Anthropic model snapshot drift | Partial (model name in `IdentityOutput.model`) | **High** |
| OpenAI embedding drift | No | **High** |
| Judge prompt drift | No | **High** |
| Fixture edits without commit | No | **Medium** |
| User-message template drift | No | **Medium** |
| Persona-prompt iteration confounding variant evaluation | Partial | **High** — see §4.4.3 case study |

#### 4.7.4 Recommendation

The §4.1 reproducibility receipt resolves the visibility problem. For drift *control*, the §4.4 two-baseline rule (re-run the baseline under current conditions) is the load-bearing fix.

Persona-vs-variant attribution (the Wave 4 motivating example) is the central case: until both reproducibility receipts and two-baseline are in place, attribution claims of the form *"X is variant-independent because we measured it constant across variants"* are not rigorously defensible.

#### 4.7.5 Calibration finding (verdict-changing in retrospect)

This is the §9.e plan-required finding.

The Wave 3 → Wave 4 pivot — *"the fasttrade-pro fid=0.75 outlier is persona-prompt-driven, not variant-driven"* — was based on comparing identical-persona runs across variant 1 and variant 2 conditions. The attribution rests on the assumption that **only variant changed** between those runs.

Per the audit, that assumption is unverifiable with the current methodology:
- Judge prompt may have changed between the runs (no version marker).
- Embedding model may have drifted (not pinned).
- Persona JSON may have been edited mid-stream (no content hash).
- User-message templates were not hashed.

The Wave 4 spec then pursued persona-layer fixes based on this attribution, regressed `distinct_products` 5/6 → 10/15, and concluded *"persona layer is not the lever."*

A different reading consistent with the data: **the attribution itself was wrong.** Variant *was* a contributing cause to the fid=0.75 outlier, persona-layer fixes were targeting the wrong lever, and the regression was a (now-explainable) downstream consequence.

If the §4.1 + §4.4 fixes had been in place, the Wave 3 attribution claim would either have been (a) confirmed under controlled conditions, vindicating the Wave 4 design, or (b) disproved, redirecting Wave 4 to a different layer (perhaps the FA layer, which is where FA prompt iteration is now headed).

This finding does not invalidate the Wave 4 conclusion that persona-prompt is *currently* not the lever — that's still the data. It does suggest the Wave 4 design was built on a non-rigorous attribution, and the same kind of mis-attribution will recur in future waves until the methodology is upgraded.

<!-- foundations:end -->

### 4.8 Selection bias

<!-- foundations:start -->

#### 4.8.1 Current state

Event picking and persona/identity rotation are author-judgment-driven. Wave 3 ran on `fed-rate-decision` and `bitcoin-etf-approval`. Wave 4 ran on `fed-rate-pause` (replaced Wave 3 due to event-availability). Personas grew from a/b/c/d (Wave 3) to a/b/c/d/e/f (Wave 4) — an expansion mid-iteration.

#### 4.8.2 Reference-framework expectations

HELM (Liang et al. 2022, §3) requires: pre-declared scenario coverage; no cherry-picking of scenarios mid-experiment.

#### 4.8.3 Gaps

| Gap | Risk |
|---|---|
| Event set varies across waves | **Medium** — comparing across waves is comparing across scenarios as well as variants |
| Persona set expanded mid-iteration | **High** — Wave 4's wider persona set is a confounder when comparing to Wave 3 results |
| No pre-declared event/persona universe | **Medium** |

#### 4.8.4 Recommendation

Define a **fixed wave-comparable bench**: a stable set of (events, personas, identities) used across multiple waves. Variants are compared against the bench; the bench changes infrequently and bench-changes are themselves announced waves.

Suggested initial bench:
- Events: `fed-rate-decision`, `bitcoin-etf-approval`, `oil-supply-shock`, `us-cpi-surprise` — four events spanning topic diversity.
- Personas: broker-a/b/c/d/e/f (current Wave 4 widened set).
- Identities: rotating across all 6 from `IDENTITY_REGISTRY`, ≥3 per wave.

When the bench changes, the next wave's writeup explicitly reports baseline-on-old-bench vs baseline-on-new-bench so drift is visible.

<!-- foundations:end -->

### 4.9 Statistical procedures

#### 4.9.1 Current state

Point estimates only. No bootstrap. No Bayesian inference. No CI reporting on metric differences.

#### 4.9.2 Reference-framework expectations

Bürkner et al. (2023) Bayesian Workflow: small-N inference with weakly informative priors yields more honest uncertainty quantification than frequentist NHST. Bootstrap (Efron & Tibshirani 1993) is the non-parametric workhorse for CI estimation.

#### 4.9.3 Gaps

| Gap | Risk |
|---|---|
| No CIs on count metrics | **High** |
| No CIs on continuous metrics (mean cosine etc.) | **Medium** |
| No effect-size reporting (e.g., Cohen's h on proportion differences) | **Medium** |
| No Bayesian posterior reporting | **Low** — bootstrap CIs are sufficient for current bar; Bayesian is "nice to have" |

#### 4.9.4 Recommendation

Implement a small statistics module:
- `bootstrapCi(samples, statistic, iters=10000)` returns 95% CI on any sample statistic
- `proportionCi(k, n)` returns Wilson CI for binomial proportions (better than normal-approx for N=6)
- `effectSize(controlSamples, treatmentSamples)` returns Cohen's d for continuous, Cohen's h for proportions

Wave writeups must report at minimum: each headline metric with bootstrap or Wilson CI; effect size between conditions with CI.

Implementation cost: ~half a day, ~150 LOC.

### 4.10 Pre-registration

<!-- foundations:start -->

#### 4.10.1 Current state

Wave specs declare hypotheses informally. Verdict thresholds qualitative. Analysis methods chosen in writeup (post-run).

#### 4.10.2 Reference-framework expectations

OSF (2015) Many Labs and Munafò et al. (2017) "Manifesto for reproducible science" identify pre-registration as the single highest-leverage intervention against the garden-of-forking-paths.

#### 4.10.3 Gaps

| Gap | Risk |
|---|---|
| Verdict threshold not quantitative pre-registered | **High** |
| Analysis method (which pairs to highlight, which metrics to report) chosen after seeing results | **Medium** — Wave 3 writeup admits writing per-pair detail tables only after the aggregate looked promising |
| HARKing risk (Hypothesizing After Results are Known) | **Medium** |

#### 4.10.4 Recommendation

Each wave spec includes a `Pre-registration` section before any code change:

```yaml
oec: fabrication_risk
oec_decision_rule:
  ship: count drops by ≥ 2 with bootstrap CI not crossing zero
  iterate: count moves direction-positive but CI crosses zero
  abandon: count rises with CI not crossing zero
secondary_metrics:
  - distinct_products: must not regress by > 1 with CI clearance
  - reskinned_same_article: must not regress by > 1 with CI clearance
analysis_plan:
  - Bootstrap 10,000 iters on count differences
  - Report per-pair table only if aggregate moves OEC
  - Report variant×event interaction only if main effect is unambiguous
mde:
  - With N=24 pairs (4 events × 6), MDE on a binomial proportion difference is ~0.30
  - This wave is underpowered for OEC effects < 0.30
events: [fed-rate-decision, bitcoin-etf-approval, oil-supply-shock, us-cpi-surprise]
personas: [broker-a, ..., broker-f]
identities: rotated 1 per event from {trading-desk, in-house-journalist, senior-strategist}
```

The wave's spec is git-committed before the variant runs. Post-run analysis can deviate from the plan but must explicitly say so and justify.

<!-- foundations:end -->

### 4.11 Operating procedures

#### 4.11.1 Current state

Wave specs include task lists with verify blocks. No standardized "how to run a methodology-compliant test" checklist exists.

#### 4.11.2 Recommendation

§6 of this audit (Operating procedures) ships a runnable checklist. Each future wave spec links to it.

### 4.12 What this can and can't tell us

Explicit limitations, restated for clarity (per §1.3 bar):

**Valid claims** (post-recommendations implementation):

- *"Variant V moved metric M by Δ on this fixture under these run conditions, with bootstrap 95% CI [a, b]."*
- *"At N = 24 pairs the wave is underpowered to detect effects below MDE."*
- *"The pre-registered SHIP rule was met / not met."*
- *"Judge agreement on the position-swap subsample was X%; below the 85% threshold this run is judge-unreliable."*

**Forbidden claims** (under any conditions until methodology upgraded substantially):

- *"Variant V is statistically significantly better than baseline at p < 0.05."* — no.
- *"Effect size is robust to model drift."* — no, until the §4.1 + §4.4 fixes are in place.
- *"This wave proves [layer] is/isn't the lever."* — no; can support "is/isn't apparently the lever under these run conditions."
- *"The result generalizes to all retail FX broker scenarios."* — no; bench scope only.
- *"The judge is calibrated against human review."* — no, until §4.3 Tier 3 protocol runs.

---

## 5. Recommended methodology baseline

Synthesizing the §4 dimensions into a baseline. Each item below should be explicitly satisfied before a wave's verdict is treated as actionable.

### 5.1 Reproducibility receipt (§4.1 keystone)

Every run captures, in `RunManifest.reproducibility`:
- Pinned model versions (FA, identity, judge, embedding, conformance)
- Prompt versions (semver where applicable; SHA-256 hashes always)
- Fixture content hash
- Package version hash
- Temperature overrides (any)

### 5.2 Statistics

Bootstrap CIs on every reported metric. Wilson CIs on binomial counts. Effect sizes with CIs on every variant-vs-baseline comparison.

### 5.3 Pre-registration (§4.10 + §4.5)

Wave spec contains a `Pre-registration` section with: OEC, decision rule with magnitude, secondary metric ceilings, analysis plan, MDE calculation, fixed bench (events × personas × identities).

### 5.4 Two-baseline rule (§4.4)

Every variant evaluated against:
1. Historical baseline (most recent prior wave on same bench)
2. Freshly-rerun baseline (prior variant re-executed under current reproducibility receipt)

If freshly-rerun differs from historical by > MDE, debug drift before evaluating variant.

### 5.5 Judge reliability protocol (§4.3)

Tier 1 (every wave): judge prompt version captured in manifest; verdict-counts reported in two columns (raw judge / post-override).

Tier 2 (every wave): position-swap on 20% of pairs; report agreement.

Tier 3 (quarterly): human spot-check 10 pairs; Cohen's κ.

### 5.6 Fixed bench (§4.8)

Initial bench: 4 events × 6 personas × 3 rotated identities. Bench changes are themselves announced waves with explicit drift-bench reporting.

### 5.7 Forbidden claims discipline (§4.12)

Wave writeups include a "Limitations" section restating what the data cannot support. Reviewers (Albert, Codex, future-Claude) check writeups against this list.

---

## 6. Operating procedures — runnable checklist

Use this checklist when running any methodology-compliant test from now on.

### Pre-run

- [ ] Wave spec exists and is committed to master
- [ ] Wave spec contains §5.3 Pre-registration block
- [ ] OEC, decision rule, MDE, and fixed bench are all declared
- [ ] Reproducibility receipt extension to `RunManifest` is in place (one-time setup; check `types.ts` for `manifest.reproducibility`)
- [ ] Bootstrap statistics module is available in `analyze.ts` or `statistics.ts`
- [ ] Codex (or other reviewer) has approved the wave spec, including pre-registration

### Run

- [ ] Pilot first per `feedback_llm_pilot_first.md`
- [ ] Pilot uses the pre-registered bench fixture set (no cherry-picking)
- [ ] Run from parent session per `feedback_orchestrator_bg_bash_hibernation.md`
- [ ] `.env` sourced explicitly per `feedback_run_wave_env_loading.md`
- [ ] Capture raw stdout+stderr to a file for the run (provenance)
- [ ] Two-baseline rule: also run the freshly-rerun baseline; if not run, declare and accept the limitation in writeup

### Post-run analysis

- [ ] Bootstrap CIs computed on every reported metric
- [ ] Position-swap reliability check on 20% sampled pairs
- [ ] Verdict computed against pre-registered decision rule (no post-hoc threshold tuning)
- [ ] Writeup includes:
  - [ ] Pre-registered plan referenced verbatim
  - [ ] OEC result with CI
  - [ ] Secondary metric results with CIs
  - [ ] Two-baseline comparison (historical vs freshly-rerun)
  - [ ] Judge-reliability check result (Tier 2)
  - [ ] Effect sizes with CIs
  - [ ] Limitations section restating §4.12 forbidden claims
  - [ ] Verdict: SHIP / ITERATE / ABANDON, with justification mapped to the pre-registered rule

### Pre-merge

- [ ] If SHIP, the variant + the freshly-rerun baseline are both committed
- [ ] If ITERATE or ABANDON, the writeup names the open question or the closed lever
- [ ] Memory updated: project memory recording new production baseline if SHIP; feedback memory recording the methodology lesson if ITERATE/ABANDON

---

## 7. Open methodology questions

Items the audit identifies but cannot resolve without significant new work.

1. **Inter-judge architecture** — Tier 2 position-swap is a stopgap. A second-judge ensemble (e.g., Sonnet judge alongside Haiku, or two independent Haiku calls with different system-prompt phrasings) is a real architectural change. Estimated: 1–2 day spec + ~1.5× judge cost. Defer until Tier 2 surfaces a real reliability problem.
2. **Human gold-standard set** — Tier 3 needs a stable human-rated reference set for κ computation. Building this is ~3–5 hours of human effort once. Worth doing the next time Albert is doing pair review anyway.
3. **Attribution under multi-confounder drift** — Even with the §4.1 + §4.4 fixes, model-version forced upgrades by Anthropic/OpenAI could invalidate baselines mid-experiment. Open: should the bench be re-baselined automatically when a model version changes, or should the wave be aborted?
4. **What happens when fabrication_risk is zero** — current verdict logic does not specify what to do when both variants have 0/N fabrication. Effective floor on the OEC; need an alternative sub-OEC.
5. **Cross-event effect interaction** — current writeups average across events but don't formally test event × variant interaction. With N=4 events × 6 pairs, interaction tests are deeply underpowered; treat as descriptive only or formally defer.
6. **External validity beyond bench** — even when SHIP'd on the bench, does the variant generalize? This audit does not enable a generalization claim; defer to design-partner deployment evidence.

---

## 8. References

- Kohavi, R., Tang, D., & Xu, Y. (2020). *Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*. Cambridge University Press.
- Liang, P., Bommasani, R., Lee, T., et al. (2022). "Holistic Evaluation of Language Models." *arXiv:2211.09110*. Stanford CRFM.
- Srivastava, A., Rastogi, A., Rao, A., et al. (2023). "Beyond the Imitation Game: Quantifying and extrapolating the capabilities of language models." *arXiv:2206.04615*.
- Bürkner, P.-C., Gabry, J., Kennedy, L., Vehtari, A., et al. (2023). "Bayesian Workflow." *arXiv:2011.01808*.
- Open Science Collaboration. (2015). "Estimating the reproducibility of psychological science." *Science* 349(6251).
- Ioannidis, J. P. A. (2005). "Why Most Published Research Findings Are False." *PLoS Medicine* 2(8):e124.
- Lipton, Z. C., & Steinhardt, J. (2018). "Troubling Trends in Machine Learning Scholarship." *arXiv:1807.03341*.
- Reiter, E. (2018). "A Structured Review of the Validity of BLEU." *Computational Linguistics* 44(3).
- Celikyilmaz, A., Clark, E., & Gao, J. (2020). "Evaluation of Text Generation: A Survey." *arXiv:2006.14799*.
- Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." *arXiv:2306.05685*.
- Chiang, C.-H., & Lee, H. (2023). "Can Large Language Models Be an Alternative to Human Evaluations?" *ACL 2023*.
- Liu, Y., Iter, D., Xu, Y., Wang, S., Xu, R., & Zhu, C. (2023). "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment." *EMNLP 2023*.
- Munafò, M. R., Nosek, B. A., Bishop, D. V. M., et al. (2017). "A manifesto for reproducible science." *Nature Human Behaviour* 1(0021).
- Efron, B., & Tibshirani, R. J. (1993). *An Introduction to the Bootstrap*. Chapman & Hall.

---

## Appendix A — Codex review log

*(Placeholder — populated by the planning-loop adversarial review process per audit-plan §7. Round 1 of Codex review fills in here.)*

---

## Appendix B — Pointers for downstream audits

The `<foundations>` sections in §4 are tagged for reuse by future audits of:

1. **13-metric translation engine scoring** (`packages/api/src/scoring/`) — when triggered by calibration concern, customer dispute, or threshold-customization request. Foundations to lift: §4.1 (reproducibility primitives), §4.3 (judge reliability), §4.4 (baseline integrity), §4.7 (confounders), §4.8 (selection bias), §4.10 (pre-registration). Domain-specific deltas: per-language threshold derivation; in-production drift surveillance; correlation with HITL review verdicts.

2. **Editorial memory contradiction detector** — when triggered. Foundations to lift: §4.1, §4.3, §4.4, §4.7. Domain-specific deltas: cross-article-state correctness; precision/recall framing for contradiction kinds.

3. **Future LLM-judge measurement systems** anywhere in the repo — same foundations. The 13-metric and editorial-memory deltas should themselves be short (<10 pages each), referencing this audit for shared methodology.
