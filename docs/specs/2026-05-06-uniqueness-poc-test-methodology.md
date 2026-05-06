# Uniqueness PoC Test-Methodology Audit and Baseline

**Status:** Final — Codex 3-round adversarial review converged on substance; Round 3 surfaced only a mechanical threshold inconsistency in the §6 checklist (N_events < 3 vs. < 6) which has been fixed inline. See `Appendix A — Codex review log` for the full review trail.
**Date:** 2026-05-06
**Author:** Claude (Opus 4.7) drafting; Codex (GPT-5.4) adversarial reviewer
**Plan that gates this:** `docs/specs/2026-05-06-uniqueness-poc-audit-plan.md`
**Code under audit:** `packages/api/src/benchmark/uniqueness-poc/` at master commit `484359a`
**Prior writeups examined:** `docs/uniqueness-poc-analysis/2026-04-19-wave3.md`

---

## 0. TL;DR

The uniqueness PoC harness is a structurally sound experimental rig with **decision-grade evidentiary value** for ship/iterate/abandon calls — *not* publication-grade. With N = 6 pairs per event, N_events typically 2–4 per study, a single LLM judge with no inter-rater data, and several reproducibility primitives missing or implicit, the strongest defensible claim from a single test is *"the variant moved metric X by Y on this fixture under these run conditions, with stratified-clustered-bootstrap CI [a,b] over N_events events. Estimand: population mean of X across the bench's event distribution."* The audit identifies **eleven verdict-relevant gaps** (four high-risk, five medium, two low) and recommends a baseline methodology that can be implemented incrementally without code rewrites — most fixes are reproducibility receipts, pre-registration of thresholds, clustered uncertainty estimation, and a Phase-2 lightweight inter-rater protocol. **One unresolved attribution-risk finding is surfaced (§4.7.5):** Wave 4's pivot to persona-layer fixes rested on an attribution claim (variant-independence of the fasttrade-pro fidelity outlier) that the current methodology cannot verify or refute, because the relevant confounders (judge prompt drift, embedding drift, persona JSON edits, model-version drift) are not currently tracked. This warning is *not* a retrospective verdict reversal — the audit does not have run-level evidence to assert that Wave 4's persona-layer conclusion is wrong; it asserts only that the conclusion's evidentiary basis is weaker than the wave's writeup conveyed, and that the same mis-attribution risk recurs in future waves until the §4.1 + §4.4 fixes ship.

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

**Framework principles.** Kohavi (2020) emphasizes the general principle that controlled experiments require holding non-experimental variables constant — concretely framed for tech A/B against shared-codebase deployments, but the underlying constraint applies anywhere comparisons are made over time. BIG-bench (Srivastava et al. 2023) discusses prompt-sensitivity and model-version effects on benchmark reproducibility. Neither framework prescribes the LLM-specific provenance fields below; those are FinFlow-local choices derived from the principle.

**FinFlow-local methodological decisions** (defended by Wave 3's already-confessed code-drift confounder rather than by external prescription): pin model versions per call, capture user-message and tool-schema hashes in the manifest, content-hash fixtures, capture package/dependency hashes. Deterministic seeding is not relevant where temperature is 0 and provider-side determinism is the only available control surface.

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

For continuous metrics (cosine, ROUGE-L), Bürkner et al. (2023) describe a Bayesian workflow centered on posterior intervals from explicit prior+likelihood models — not specifically prescribing the bootstrap. Bootstrap (Efron & Tibshirani 1993) is a separate, non-parametric technique for CI estimation that this audit recommends as the more pragmatic FinFlow-local choice given the absence of a fitted Bayesian model. Both frameworks share the load-bearing principle the audit lifts: point estimates without CIs are misleading at this N regime.

**Critical caveat on independence.** Pair outcomes in this harness are *not* independent. With M generated outputs, C(M,2) = M(M−1)/2 pairs share outputs — each output participates in (M−1) pairs. Naive iid pair-resampling (`bootstrap-resample 24 pairs from 24`) over-states effective N and inflates apparent precision. Clustered/paired bootstrap procedures are required; see §4.2.4 recommendation.

#### 4.2.3 Gaps

| Gap | Risk |
|---|---|
| Verdict counts reported as fractions without CIs | **High** — `5/6 → 2/6` reads as a strong signal but the 95% CI on the difference between two binomial proportions with N=6 each is roughly ±0.55. Even with N=24 vs N=24, ~±0.30. |
| Wave writeups state effect sizes (`+3/6 distinct_products`) without bootstrap | **High** |
| No explicit MDE (minimum detectable effect) declared per wave | **Medium** — without an MDE, a "no significant change" verdict is unbounded; we don't know if the test was capable of detecting the effect |
| Continuous metrics (mean cosine, mean fidelity) reported as point estimates | **Medium** — Wave 3's "−0.044 cosine drop" point estimate has no CI; could be noise |

#### 4.2.4 Recommendation

For every wave writeup, use a **stratified clustered bootstrap** that respects both the pair-graph dependence *and* the event-level comparison structure:

**Why stratification is mandatory.** Pair metrics are only meaningful within an event — a "cosine between premium-capital-markets on the fed-rate event and northbridge-wealth on the bitcoin-etf event" is meaningless because content topic is the dominant signal. Naive cross-event resampling either constructs invalid cross-event pairs or, if filtered to same-event, unpredictably reweights events (some events appear 0× in a given bootstrap, others 3×) and silently changes the estimand. The stratified procedure below preserves the original benchmark's design.

**Procedure — stratified clustered bootstrap:**

1. **Top-level clusters are events.** Resample events with replacement from the bench's E events. Each bootstrap iteration produces a (potentially repeated, potentially missing) multiset of events.
2. **Within each sampled event, preserve the cell structure.** All output cells (persona × identity) within that event are kept together as a block — *do not* sub-resample cells within events. The bench's design (which personas × which identities × which event) is the within-event unit.
3. **Reconstruct only within-event pairs.** For each event in the bootstrap sample, build C(M_e, 2) pairs from the M_e cells in that event. Never construct cross-event pairs.
4. **Compute the metric over the union of within-event pairs.** Aggregate the metric (count, mean, etc.) across the bootstrap sample.
5. **Repeat ≥10,000 iterations.** Report percentile-based 95% CI of the metric.

**For variant-vs-baseline comparisons:** resample **matched event blocks** — the same event appears in both arms (control and treatment) in each bootstrap iteration, preserving the per-event paired structure. Compute Δ within event, then aggregate.

**Effective cluster N reporting (mandatory):** report **N_events** (top-level cluster count) alongside the CI. The pair count is a derived quantity, not the precision driver. Wave writeups should state both: e.g., "OEC moved by 0.12 with stratified-bootstrap 95% CI [0.04, 0.21]; N_events = 4, N_pairs = 24."

**Estimand statement (also mandatory):** every metric reported with a CI must name what it is estimating — e.g., *"the population mean of metric M across the universe of events from which the bench was sampled, holding bench composition constant."* Without an estimand statement, the CI is uninterpretable.

**Pre-declare the MDE** for the wave's primary metric, given the planned **N_events**, not pair count. With E = 4 events, the bootstrap CI half-width on a binomial-style metric runs ~0.30 even at high pair counts — events are the precision constraint.

**Descriptive-only fallback:** if the wave produces fewer than **3 events** (top-level cluster N < 3), the bootstrap is too unstable for decision-grade CI; report point estimates as descriptive only. The 3-event minimum is a FinFlow-local floor (no external prescription); below it, "did the wave move the metric?" is not a decidable question with this method.

**Implementation:** a stratified-clustered-bootstrap helper in `packages/api/src/benchmark/uniqueness-poc/statistics.ts`. The pair-graph reconstruction stays simple because pairs are constrained to within-event; the bootstrap loop is just `for each iter: resample event indices with replacement → for each sampled event idx: take its frozen cell block → compute metric over the union`. ~200 LOC of pure TS, roughly one day.

**Why not iid pair-resampling, restated in plain terms:** if you have 4 generated articles per event and you compare them pairwise (6 pairs/event), then "resampling 6 pairs from 6" is just permuting the same six edges in the same graph — the four underlying articles never change. Inference looks tighter than it should. Resampling at the *event* level (with the within-event cell structure preserved) is what propagates real uncertainty into the CI, because it changes which events the metric was computed over — and event difficulty is the dominant variance source.

### 4.3 Judge reliability

<!-- foundations:start -->

#### 4.3.1 Current state

Single judge call per pair, model `claude-haiku-4-5-20251001`, up to 3 retries on Zod failures. No second independent call. No periodic human spot-check. Judge prompt has no version marker.

#### 4.3.2 Reference-framework expectations

**Framework principles.** Zheng et al. (2023) "Judging LLM-as-a-Judge" documents three pervasive biases in LLM-as-judge systems: **verbosity bias** (longer outputs preferred), **position bias** (first-listed preferred), **self-preference** (judge from same model family preferred). Their proposed mitigations include swapping A/B order, running multiple judges, and calibrating against human-rated pairs. Chiang & Lee (2023) report single-LLM-judge correlation with human judgment ranging from 0.50 to 0.85 depending on task and rubric — useful but with non-trivial variance that single calls do not reveal. HELM (Liang et al. 2022) emphasizes scenario coverage, multi-metric evaluation, and standardization — it does not prescribe a specific multi-judge κ protocol; it does advocate for transparency in evaluator choice and for reporting evaluation uncertainty.

**FinFlow-local methodological decisions** (informed by Zheng + Chiang/Lee, not directly prescribed by them):

- A/B order-swap on a pair sample, treated as a position-bias spot-check.
- Periodic human-rated κ as the long-run calibration anchor.
- Optional second-judge ensemble (different model family) is a future option, not a current requirement; deferred to §7 open questions.

These choices are FinFlow-local; the literature supports the *direction* of the choice but the specific thresholds (15% disagreement triggers unreliable flag, 20% pair sample for swap, quarterly cadence for human κ) are operational tuning, not framework-prescribed.

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

#### 4.7.5 Attribution-risk warning (would-have-changed-the-rigour-bar — case study, not retrospective verdict reversal)

This is the §9.e plan-required finding, downgraded from "verdict-changing" to "attribution-risk warning" after Codex Round 1 review (the original framing speculated about a specific alternative reading without the run-level evidence to support it).

**The Wave 3 → Wave 4 pivot reasoning (verbatim from `project_fasttrade_pro_persona_rootcause.md`):** *"the fasttrade-pro fid=0.75 outlier is persona-prompt-driven, not variant-driven"* — based on comparing identical-persona runs across variant-1 and variant-2 conditions. The attribution rests on the assumption that **only variant changed** between those compared runs.

**What the audit can establish:** the assumption is unverifiable under current methodology. The following confounders could each independently affect the comparison and are not currently tracked:
- Judge prompt edits between the compared runs (no version marker on the prompt).
- Embedding model upgrades by OpenAI (model not pinned in manifest).
- Persona JSON edits between the runs (no content hash).
- User-message template changes (not hashed).
- Anthropic model snapshot drift on the FA, identity, or judge calls.

**What the audit cannot establish:** whether any of those confounders *actually occurred* between the compared runs. That would require a run-level evidence table — exact run IDs, ISO timestamps, code commit hashes, prompt hashes/diffs, persona JSON content hashes, embedding/judge model identifiers, matched denominator comparisons (whether persona expansion broker-d → broker-a..f also affects the comparison) — none of which is currently captured for the Wave 3 attribution decision. Building that evidence table is itself out of scope for this audit (would require run-archeology against `uniqueness-poc-runs/` directories from before the audit's recommendations were in place).

**The conservative claim, which the audit does support:**
- Wave 4's persona-layer pivot was a methodologically reasonable bet given the data the team had at the time.
- The data the team had does not — under this audit's standards — clear the rigour bar required to *exclude* variant as a contributing cause to the fid=0.75 outlier.
- The Wave 4 regression on `distinct_products` (5/6 → 10/15) is itself confounded by the persona-set expansion (broker-a..d → broker-a..f) noted as high-risk in §4.8.3, so it does not by itself prove or disprove the persona-layer-is-the-lever claim.
- Net: Wave 4's conclusion *"persona-prompt is currently not the lever"* should be treated as supported with low confidence rather than as a closed finding. The methodology cannot defend a stronger conclusion either way until the §4.1 + §4.4 fixes are in place.

**Calibration value of this finding (the §9.e clause this audit must satisfy):**
- If the §4.1 reproducibility receipt + §4.4 two-baseline rule had been in place at Wave 3 time, the Wave 4 spec would either have:
  - **Cleared the bar** — comparison ran under known-equal confounders, attribution claim is rigorous, Wave 4 design vindicated, OR
  - **Failed the bar** — the freshly-rerun baseline wouldn't have reproduced the historical baseline within MDE, debugging would have surfaced *which* confounder mattered, and Wave 4 would have either been redirected or re-run under controlled conditions.
- Either outcome would have produced a stronger basis for the layer-of-iteration decision than what currently exists.
- Future waves face the same risk until the methodology fixes ship. The FA prompt iteration spec (`2026-05-06-fa-prompt-iteration.md`) — currently parked behind this audit — should not run without those fixes in place, or it inherits the same attribution-risk pathology.

**This is not a retrospective verdict reversal.** The Wave 4 result is the Wave 4 result. The audit is identifying *unboundedness in what that result can support*, not asserting an alternative result.

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

**Framework principles.** Bürkner et al. (2023) describe a Bayesian workflow centered on prior+likelihood model fitting, posterior interval reporting, and explicit prior sensitivity analysis. Their workflow does *not* prescribe the bootstrap. Efron & Tibshirani (1993) introduced the bootstrap as a separate non-parametric CI-estimation technique. Both share the load-bearing principle: at small N, point estimates without uncertainty intervals are misleading.

**FinFlow-local methodological decisions:**
- Use the bootstrap (clustered variant per §4.2) as the pragmatic CI-estimation procedure. Rationale: no fitted parametric model exists for the metric distributions; non-parametric resampling gets us defensible CIs without the modelling cost.
- Bayesian posterior intervals are a future option (§7 open questions) if a fitted model becomes worthwhile. The audit does not require Bayesian inference today.
- Effect-size measures (Cohen's d, Cohen's h) come from standard meta-analytic statistics; report with bootstrap CI on the effect.

#### 4.9.3 Gaps

| Gap | Risk |
|---|---|
| No CIs on count metrics | **High** |
| No CIs on continuous metrics (mean cosine etc.) | **Medium** |
| No effect-size reporting (e.g., Cohen's h on proportion differences) | **Medium** |
| No Bayesian posterior reporting | **Low** — bootstrap CIs are sufficient for current bar; Bayesian is "nice to have" |

#### 4.9.4 Recommendation

Implement a small statistics module at `packages/api/src/benchmark/uniqueness-poc/statistics.ts`:

- `stratifiedClusteredBootstrapCi(eventBlocks, statistic, iters=10000)` — **load-bearing primitive**. `eventBlocks` is `Array<{ eventId, cells: OutputCell[] }>`. Resamples events with replacement; for each sampled event reconstructs only within-event pairs from the frozen cell block; computes statistic over the union; returns 95% percentile CI. Refuses to run if N_events < 3 (returns descriptive-only label).
- `pairedStratifiedBootstrap(controlBlocks, treatmentBlocks, statistic, iters=10000)` — for variant-vs-baseline. Requires control and treatment to share the same event set. Resamples event indices and computes Δ within each event, aggregates across the bootstrap sample, returns CI on the difference. The matched-by-event design dramatically reduces variance vs. unpaired sampling.
- `bootstrapCi(samples, statistic, iters=10000)` — iid version; **only used for genuinely independent samples** (e.g., one statistic per event used as the unit). Calling code must justify independence in a comment.
- `proportionCi(k, n)` — Wilson CI for binomial proportions; appropriate for cluster-level success counts (e.g., "events on which the wave produced a SHIP-grade verdict"), not pair-level.
- `effectSize(controlSamples, treatmentSamples)` — Cohen's d for continuous, Cohen's h for proportions; report with bootstrap CI on the effect.

Every CI-returning function returns `{ ci: [lo, hi], nClusters: number, descriptiveOnly: boolean, estimand: string }`. The `estimand` field is a free-text label the caller supplies; the function prepends "Population estimand: " and surfaces it in writeups.

Wave writeups must report:
- Each headline metric with **stratified-clustered bootstrap CI** (default for pair-derived metrics) or Wilson CI (for cluster-level proportions)
- N_events alongside CI
- Effect size between conditions with CI on the difference
- Estimand statement per CI
- Explicit "descriptive only" label when N_events < 3

Implementation cost: ~1 day. ~200–250 LOC. Pair-graph reconstruction is simple because pairs are constrained to within-event blocks.

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

- *"Variant V moved metric M by Δ on this fixture under these run conditions, with stratified-clustered-bootstrap 95% CI [a, b] over N_events events. Estimand: population mean of M across the bench's event distribution."*
- *"At N_events = X the wave is underpowered to detect effects below MDE."*
- *"The pre-registered SHIP rule was met / not met."*
- *"Judge agreement on the position-swap subsample was X%; below the 85% threshold this run is judge-unreliable."*

**Forbidden claims** (under any conditions until methodology upgraded substantially):

- *"Variant V is statistically significantly better than baseline at p < 0.05."* — no.
- *"Variant V moved metric M by Δ with iid-bootstrap CI [a, b] over N pairs."* — no; pair-iid resampling violates independence and over-states precision.
- *"…with cell-bootstrap CI over N output cells (cells resampled without event strata)."* — no; unstratified cell resampling either constructs invalid cross-event pairs or silently reweights events. See §4.9.
- *"Effect size is robust to model drift."* — no, until the §4.1 + §4.4 fixes are in place.
- *"This wave proves [layer] is/isn't the lever."* — no; can support "is/isn't apparently the lever under these run conditions."
- *"The result generalizes to all retail FX broker scenarios."* — no; bench scope only.
- *"The judge is calibrated against human review."* — no, until §4.3 Tier 3 protocol runs.
- *"This audit's calibration finding (§4.7.5) reverses Wave 4's verdict."* — no; the calibration finding warns about evidentiary basis, not result correctness.

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

### 5.2 Statistics — stratified clustered uncertainty estimation (§4.2 + §4.9)

**Default for pair-derived metrics:** **stratified clustered bootstrap** — resample *events* (top-level cluster) with replacement, preserve within-event cell blocks, reconstruct only within-event pairs, compute metric, ≥10,000 iters, percentile-based 95% CI.

**Why event-level stratification matters:** content topic dominates the variance of pair metrics. Pairs are only meaningful within an event. Resampling output cells without preserving event strata either constructs invalid cross-event pairs or silently reweights events; either way, the estimand changes and the CI no longer measures what the wave was designed to measure.

**Pair-iid bootstrap is forbidden as a decision-grade gate.** Cell-iid bootstrap (resampling cells across events without stratification) is also forbidden. Use iid bootstrap only when the unit is genuinely independent (e.g., one-event-aggregate-per-event averaged across events).

For variant-vs-baseline comparisons: **paired stratified bootstrap** — same event multiset in both arms each iteration. Per-event Δ aggregated.

Wilson CIs on cluster-level proportions (e.g., proportion of events on which the wave produced a SHIP-grade verdict). Effect sizes (Cohen's d, Cohen's h) with bootstrap CI on every variant-vs-baseline comparison.

**Mandatory in every CI-bearing claim:**
- N_events explicitly reported
- Estimand statement (what population the CI is estimating)
- Descriptive-only label when N_events < 3

This is the most operationally consequential change vs. how Waves 1–4 were analyzed.

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
  - [ ] OEC result with **stratified-clustered-bootstrap CI** + N_events + estimand statement
  - [ ] Secondary metric results with stratified-clustered-bootstrap CIs + N_events + estimands
  - [ ] Two-baseline comparison (historical vs freshly-rerun)
  - [ ] Judge-reliability check result (Tier 2)
  - [ ] Effect sizes with CIs
  - [ ] Explicit "descriptive only" labels on metrics where N_events < 3
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

Adversarial review via `planning-loop` skill (REVISE mode), Codex companion. Three substantive rounds + one cap-time mechanical-fix confirmation pass. Verbatim output preserved per audit-plan §7.2. Full machine-readable log at `.harness-state/planning-loop/2026-05-06-uniqueness-poc-test-methodology-revise-*.md`.

### Round 1 — verdict `needs-attention` (3 findings)

```text
- [high] Pair-level bootstrap treats dependent comparisons as independent (lines 247-268)
  Same generated persona/article appears in multiple cross-tenant pairs, so pair outcomes
  are clustered/correlated, not iid. Bootstrap CI from iid pair-resampling overstates
  effective N. Recommendation: clustered/paired procedure resampling events and/or
  generated output units while preserving the pair graph.

- [high] §4.7.5 calibration finding framed as verdict-changing without evidence (lines 452-464)
  Section establishes attribution assumption is unverifiable but advances a specific
  alternative reading without run-level evidence (judge prompt drift, embedding drift,
  persona edits, template drift) actually being demonstrated. Recommendation: downgrade
  to attribution-risk warning or add a run-by-run evidence table.

- [medium] Reference frameworks cited as requiring procedures they don't (lines 198-200)
  Kohavi/BIG-bench described as requiring LLM-style pinned versions; HELM described as
  recommending multi-judge κ ensembles; Bayesian Workflow used to justify bootstrap.
  Public framework summaries don't directly support these. Recommendation: separate
  "framework says" from "FinFlow-local adaptation".
```

### Round 2 — verdict `needs-attention` (1 new finding; round-1 findings resolved)

```text
- [high] Cluster bootstrap can destroy the event-level comparison structure (lines 267-276)
  Procedure resamples (event × persona × identity) cells from one pool then reconstructs
  induced pairs. Pair metrics are only meaningful within an event; event difficulty is a
  core dependence source. Method either creates invalid cross-event pairs or unpredictably
  reweights events. Recommendation: stratified bootstrap — resample events as top-level
  clusters, preserve within-event cell structure, reconstruct only within-event pairs,
  match event blocks across arms for variant comparisons. State the target estimand.
```

### Round 3 — cap-round, verdict `needs-attention` (single mechanical finding)

```text
- [medium] §6 checklist contradicts the descriptive-only floor used everywhere else (line 765)
  §4.2.4, §4.9.4, §5.2 define the decision-grade floor at N_events < 3. The execution
  checklist in §6 used "cluster N < 6" — left over from earlier draft language. Implementers
  following the checklist would silently downgrade typical 3-4 event studies. Recommendation:
  align §6 with the rest of the doc.
```

### Cap-time mechanical-fix confirmation — verdict `approve`

```text
Verdict: approve
Ship: the reviewed sections consistently use the descriptive-only floor of N_events < 3,
and I found no remaining stale cluster-N-<-6 threshold in the provided diff context.
No material findings.
```

### Loop outcome

Substantive disagreement converged in 2 rounds (Round 2 closed with the stratified-bootstrap fix; Round 3 surfaced only a mechanical inconsistency from Round 2's edit). Cap-time fix verified by confirmation pass. **Spec ready to ship.**

---

## Appendix B — Pointers for downstream audits

The `<foundations>` sections in §4 are tagged for reuse by future audits of:

1. **13-metric translation engine scoring** (`packages/api/src/scoring/`) — when triggered by calibration concern, customer dispute, or threshold-customization request. Foundations to lift: §4.1 (reproducibility primitives), §4.3 (judge reliability), §4.4 (baseline integrity), §4.7 (confounders), §4.8 (selection bias), §4.10 (pre-registration). Domain-specific deltas: per-language threshold derivation; in-production drift surveillance; correlation with HITL review verdicts.

2. **Editorial memory contradiction detector** — when triggered. Foundations to lift: §4.1, §4.3, §4.4, §4.7. Domain-specific deltas: cross-article-state correctness; precision/recall framing for contradiction kinds.

3. **Future LLM-judge measurement systems** anywhere in the repo — same foundations. The 13-metric and editorial-memory deltas should themselves be short (<10 pages each), referencing this audit for shared methodology.
