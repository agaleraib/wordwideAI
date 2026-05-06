# Uniqueness PoC Test-Methodology Audit — Plan

**Status:** Plan — pending approval to proceed
**Date:** 2026-05-06
**Author:** Albert Galera + Claude (Opus 4.7) — Codex (GPT-5.4) participates as adversarial reviewer
**Related:**
- `docs/specs/2026-05-06-fa-prompt-iteration.md` — first downstream test parked behind this audit
- `docs/specs/2026-04-16-structural-variants.md` — last shipped wave; baseline for current methodology
- `docs/uniqueness-poc-analysis/2026-04-19-wave3.md` — most recent verdict-shaped writeup
- Memory: `feedback_validation_wave_pattern.md`, `feedback_llm_pilot_first.md`, `feedback_bundle_not_slice_prompt_ab.md`, `project_uniqueness_poc_full_run_cost.md`, `project_uniqueness_poc_stage_semantics.md`

---

## 1. What this doc IS

A **plan to produce an audit doc** — not the audit itself. This file defines scope, references, process, deliverable shape, and success criteria so that the audit work, when executed, produces something we can defend to ourselves in 6 months and to a design partner if asked.

Approval of this plan gates the audit work. Audit work, in turn, gates `2026-05-06-fa-prompt-iteration.md` and any future prompt-iteration A/B.

---

## 2. Goal of the eventual audit

Produce a single durable document — `docs/specs/2026-05-XX-uniqueness-poc-test-methodology.md` — that:

a. **Codifies** the current test methodology of the uniqueness PoC harness as it exists in `packages/api/src/benchmark/uniqueness-poc/` so future contributors don't have to reverse-engineer it from runs.

b. **Audits** that methodology against established reference frameworks, identifying gaps with explicit risk levels.

c. **Recommends** a baseline methodology — what each dimension SHOULD look like — at a clearly-stated decision-grade rigor bar.

d. **Defines operating procedures** for running future tests in compliance with the recommended baseline.

e. **States explicit limitations** — what the data we generate can and cannot tell us, so we don't over-claim from it.

---

## 3. Scope

### 3.1 In scope (this audit)

- The uniqueness PoC harness in `packages/api/src/benchmark/uniqueness-poc/` — runner, fixtures, identity registry, structural variants, judge wiring, similarity metrics (cosine + ROUGE-L), verdict aggregation.
- The wave-validation pattern as practiced (pilot/full, baselines, SHIP/ITERATE/ABANDON verdicts).
- Methodology dimensions enumerated in §6.

### 3.2 Out of scope (deliberate)

| Out of scope | Why deferred |
|---|---|
| Translation engine's 13-metric scoring (`packages/api/src/scoring/`) | Different decision type (per-article gate vs research validation), different N regime (high vs low). Audit when triggered by a calibration concern, customer dispute, or threshold-customization request. |
| Editorial memory contradiction detector (Haiku-based) | Same LLM-as-judge methodology family but separate decision surface. Audit when triggered. |
| Comparator (`packages/api/src/benchmark/run-comparator/`) | Tooling for cross-run analysis, not a measurement system in itself. |
| Production translation pipeline metrics | Separate audit when needed. |
| Cross-cutting "FinFlow measurement-quality framework" doc | Premature abstraction — extract foundations only when there's a second concrete audit to pull them out for. |

### 3.3 Foundations-for-reuse principle

Methodology dimensions that **apply to any LLM-judge measurement system in this repo** (judge reliability, prompt-hash/version tracking, fixture stability, drift detection) will be tagged in the audit doc with a **`<foundations>`** marker. When the 13-metric or contradiction-detector audits get triggered later, they reference these sections rather than rebuilding them. Avoids duplication; preserves single-source-of-truth.

---

## 4. The bar — decision-grade, not publication-grade

This is the most important framing decision in the audit and must be stated upfront in the eventual doc.

**What we are producing:** evidence good enough to make ship/iterate/abandon decisions we'll defend in 6 months.

**What we are NOT producing:** publication-grade or peer-review-grade statistics. The PoC's operating constraints (N=6 pairs/event, 1-4 events/study, single LLM judge with no inter-rater, evolving prompts, ~$0.73/event cost) preclude:
- Frequentist NHST claims at p < 0.05 thresholds
- Multiple-comparisons-corrected significance over a wide metric panel
- Strong external-validity claims beyond the tested fixture set
- Effect-size claims without bootstrap CIs

**What we ARE producing, when we run a test:**
- Bootstrap confidence intervals over the metric distribution
- Bayesian effect-size estimates with explicit priors
- Inter-rater reliability spot-checks (e.g., judge run twice on same pair, agreement rate)
- Reproducibility receipts (seed, prompt hash, model version, fixture hash)
- Verdict shape (SHIP/ITERATE/ABANDON) defended against pre-registered threshold criteria

The audit doc will be unambiguous about this throughout — ridicule-proofing against future over-claims.

---

## 5. Reference frameworks

Sources the audit will anchor to, with explicit rationale for each. The audit will cite, not just gesture.

| Framework | Source | Why we use it | What we adapt |
|---|---|---|---|
| Trustworthy Online Controlled Experiments | Kohavi, Tang, Xu (2020) — book | The canonical A/B-testing methodology for tech (Microsoft, Bing). Covers Sample Ratio Mismatch, peeking, multiple comparisons, novelty/primacy effects, OEC selection. | Adapt assumptions from high-N tech (10⁶+ users) to low-N research (N≤24 pairs). Many primitives (OEC, SRM check, randomization unit) survive the adaptation. |
| HELM — Holistic Evaluation of Language Models | Liang et al. (2022) — Stanford CRFM | Multi-metric LM evaluation framework. Directly addresses LLM-judge methodology, prompt sensitivity, scenario coverage. | Lift: multi-axis evaluation, robustness checks. Skip: scale infrastructure (we're not benchmarking 30 models). |
| BIG-bench: collaborative LLM benchmark | Srivastava et al. (2023) | Discusses prompt sensitivity, evaluation cost-vs-value, judge selection. | Lift: prompt-sensitivity rigour, evaluation reproducibility primitives. |
| Bayesian Workflow | Bürkner, Gabry, Kennedy, Vehtari et al. (2023) | Bayesian approach to model evaluation when N is small and decisions are sequential. Better-suited to our regime than frequentist NHST. | Posterior intervals over metric distributions; weakly-informative priors anchored on prior wave outcomes. |
| Replication Crisis literature | OSF (2015) Many Labs; Ioannidis (2005) "Why Most Published Research Findings Are False" | Concrete failure modes of small-N research: file-drawer, p-hacking, garden of forking paths, conditioning on the future. Directly relevant — we are explicitly small-N. | Adopt: pre-registration of thresholds, explicit garden-of-forking-paths defense. |
| Troubling Trends in ML Scholarship | Lipton & Steinhardt (2018) | Specific ML methodology pitfalls (conflating hypotheses, suggestive language, wrongly chosen baselines, mathiness). | Use as a checklist against the audit's own claims and against past wave writeups. |
| NLG evaluation literature | Reiter (2018); Celikyilmaz et al. (2020); LLM-judge papers (Zheng et al. 2023, Chiang & Lee 2023) | LLM-as-judge calibration, correlation with human ratings, biases (verbosity, ordering, self-preference). | Direct relevance — every PoC verdict comes from an LLM judge. Lift: known judge biases, calibration practices. |
| FinFlow-internal | `docs/uniqueness-poc-analysis/` writeups; existing feedback/project memories | Real-world case studies of what's worked and what's regressed in practice. | Use as the empirical anchor — methodology has to fit what we've actually been doing, not an abstract ideal. |

The audit will not exhaustively survey each — it will cite the load-bearing one or two ideas from each into the audit's own argument.

---

## 6. Methodology dimensions the audit will examine

Each dimension below becomes a section of the audit doc. For each, the audit will: (a) describe current state, (b) cite reference-framework expectations, (c) list gaps with risk level (high / medium / low), (d) recommend baseline.

| # | Dimension | Foundations? | Why it matters |
|---|---|---|---|
| 1 | Reproducibility primitives — seed, prompt hash, model version, fixture hash, package versions | Yes | Without these, no test is reproducible; verdicts become unrepeatable claims. |
| 2 | Sample adequacy — what N=6 pairs/event can detect; minimum-detectable-effect under bootstrap | No (PoC-specific) | Defines what claims the data can support and which are over-claims. |
| 3 | Judge reliability — single-LLM-judge, inter-rater spot-checks, judge drift over time, judge biases (verbosity, ordering) | Yes | Single judge is single point of failure. Without inter-rater data we can't bound judge variance. |
| 4 | Baseline integrity — what makes a baseline valid for re-comparison; baseline drift as code/prompts evolve | Yes | Wave 4 already burned us once: comparing to a baseline whose code drift was an unmeasured confounder. |
| 5 | Verdict-shape soundness — SHIP/ITERATE/ABANDON thresholds; pre-registration vs post-hoc decision | No (PoC-specific) | Currently qualitative ("strictly improved", "non-regressive"). Should they be quantitative thresholds? Pre-registered? |
| 6 | Multiple-comparisons surface — correlation between distinct_products / reskinned_same_article / fabrication_risk; correction strategy | No (PoC-specific) | Three correlated metrics measured per pair; naive analysis inflates false-positive rate. |
| 7 | Confounders — model drift (Anthropic ships new versions), judge drift, fixture drift, prompt drift across waves | Yes | Long-term comparability question. If today's variant beats Wave 3's baseline by 5%, is that variant or model-drift? |
| 8 | Selection bias — event picking, persona/identity rotation, fixture choice | Yes | Cherry-picked events inflate apparent effects. |
| 9 | Statistical procedures — bootstrap method, Bayesian effect-size estimates, prior selection, posterior reporting | Partial | The math we apply to the data we have. Concrete recipes. |
| 10 | Pre-registration & garden-of-forking-paths defense — declaring thresholds and analysis before running, not after | Yes | Replication-crisis literature's strongest single recommendation. Currently informal. |
| 11 | Operating procedures — how to run a compliant test step-by-step | Partial | Without procedures, the methodology is aspirational. |
| 12 | What this can and can't tell us — explicit list of valid claims and forbidden claims | No (PoC-specific) | Honest framing for future readers and customers. |

This list itself is a deliverable of the plan — the audit's section structure mirrors it. Albert can push back on any dimension here before audit work starts.

---

## 7. Process

### 7.1 Drafting and review loop

Per the `planning-loop` skill (`Drive a spec through Codex's adversarial-review loop to an approve verdict in ≤3 rounds`):

1. **Round 1 — Opus drafts.** Claude (Opus 4.7) writes the full audit doc against §6's section structure, citing references from §5, anchored at the bar set in §4.
2. **Round 1 review — Codex adversarial.** Codex (GPT-5.4) reviews under prompt: *"Find statistical methodology errors, missing or weak citations, over-claims, garden-of-forking-paths risks, and gaps in the foundations sections that would make a 13-metric audit reuse harder."*
3. **Round 2 — Opus revises.** Address every Codex finding with either a fix, a documented disagreement, or a "deferred to follow-up" tag with rationale.
4. **Round 2 review — Codex adversarial.** Same prompt; check that revisions are substantive.
5. **Round 3 (only if needed)** — same shape.
6. **Loop ends** when Codex returns `approve` or 3 rounds elapse, whichever first.

If 3 rounds elapse without `approve`, the unresolved findings ship as an explicit "Open methodology questions" section in the audit doc — the doc still ships, with limitations called out.

### 7.2 Codex review log preserved

Per Albert's earlier preference for "both perspectives preserved verbatim": every Codex review round (prompt + response) is appended to an appendix `Appendix A — Codex review log` inside the audit doc, with timestamps. Reader can see how the doc was hardened.

### 7.3 Foundations tagging during drafting

While drafting, Opus marks each section that's a candidate foundation (per §3.3) with a `<foundations>` HTML-style comment. Codex's review explicitly verifies these tags are accurate and that foundations sections are written generically enough to be reused (no PoC-specific shortcuts).

---

## 8. Deliverable

`docs/specs/2026-05-XX-uniqueness-poc-test-methodology.md`. Target length: **20–30 pages** (rough — sections will be sized as needed; cap not strict).

Section structure (mirrors §6 dimensions):

```
Front matter (Status, Date, Authors, Related)
0. TL;DR — one paragraph
1. Scope and bar (§3, §4 of plan)
2. Reference frameworks — what we anchor to (§5 of plan)
3. Current methodology — describe PoC harness as-is
4. Audit findings — per §6, twelve dimensions
   4.1 Reproducibility primitives <foundations>
   4.2 Sample adequacy
   4.3 Judge reliability <foundations>
   4.4 Baseline integrity <foundations>
   4.5 Verdict-shape soundness
   4.6 Multiple-comparisons surface
   4.7 Confounders <foundations>
   4.8 Selection bias <foundations>
   4.9 Statistical procedures
   4.10 Pre-registration <foundations>
   4.11 Operating procedures
   4.12 What this can and can't tell us
5. Recommended methodology baseline
6. Operating procedures — ready-to-follow checklist
7. Open methodology questions
8. References
Appendix A: Codex review log
Appendix B: Pointers for downstream audits (13-metric, contradiction detector)
```

---

## 9. Success criteria

The audit doc is **complete** when all of these hold:

a. Every dimension in §6 has its own audit section with current-state + gaps + recommendation.
b. Codex returns `approve`, OR the loop ran 3 rounds and unresolved findings are documented in §7 of the audit doc.
c. All `<foundations>` sections are tagged and pass Codex's reuse-readiness check.
d. The "what this can and can't tell us" section is explicit enough that a future reader cannot accidentally over-claim.
e. The doc cites at least one specific finding/gap recommendation that, if implemented, would have changed the verdict on a prior wave (calibration check — if the audit produces zero such findings, it's probably too soft).
f. The bar in §4 is restated in TL;DR, in §1, and in the conclusions — three independent reminders.
g. Operating procedures (§4.11) are concrete enough that someone unfamiliar with the harness could run a compliant test from them.

The audit is **shipped** when the resulting doc passes a human read-through by Albert and lands on master via standard commit protocol.

---

## 10. Timeline / sequence

| Step | Owner | Effort | Cost |
|---|---|---|---|
| Approve this plan | Albert | ~30 min | $0 |
| Round 1 draft of audit | Claude (Opus 4.7) | ~3-4 hours | LLM cost varies; ≤$10 |
| Round 1 Codex review | Codex via planning-loop | ~30 min wall, hands-off | ~$5 |
| Round 1 revision | Claude (Opus 4.7) | ~1-2 hours | ≤$5 |
| Round 2 Codex review | Codex | ~30 min | ~$5 |
| Round 2 revision (if needed) | Claude | ~1 hour | ≤$3 |
| Round 3 (rare) | Both | ~1 hour | ~$5 |
| Albert read-through + ship | Albert | ~1 hour | $0 |

**Total:** roughly 1-2 working sessions across 1-2 days, ≤$30 LLM spend, no infra changes.

---

## 11. Risks and assumptions

### 11.1 Risks

| Risk | Mitigation |
|---|---|
| Audit becomes ivory-tower theory disconnected from project's real constraints | §4's decision-grade bar restated three times in audit; success criterion §9.e (must cite at least one verdict-changing recommendation) |
| Audit recommends procedures so heavy that no test ever satisfies them | §6.11 operating procedures must be runnable with current LLM budgets and harness; Codex review checks this |
| Codex review surfaces deep gaps that require new harness code (not just doc updates) | These get parked as their own follow-up specs, not blocking audit ship; §7 of audit lists them as "open methodology questions" |
| Foundations sections leak PoC-specific assumptions, breaking 13-metric reuse later | Codex review's explicit foundations-reuse check (§7.3) |
| Drafted in isolation from active code; methodology recommendations don't match what `runner.ts` actually does | Audit work re-reads `runner.ts`, `index.ts`, `judge` and `analyze.ts` source files during §6.3 (Current methodology) section drafting |
| Plan-bloat — this plan doc itself becomes longer than the audit it plans | Caught at this commit; this plan is ~200 lines, audit target is order of magnitude larger |

### 11.2 Assumptions

- The PoC harness will not be substantially restructured during the audit window. If it is, the audit pauses until restructure stabilizes.
- Codex (GPT-5.4) is available via the planning-loop skill / codex:rescue. If not, fall back to Claude code-reviewer agent — strictly worse, less independent, but the audit can still ship.
- Albert's review on completion will catch any mis-framings the Opus + Codex loop missed.

---

## 12. What this plan does NOT do

- Does not produce the audit. (That's the work this plan gates.)
- Does not write the methodology baseline. (That's a section IN the audit.)
- Does not pre-judge audit findings. (§6 lists dimensions, not verdicts on them.)
- Does not commit to running the FA prompt iteration test. (FA spec stays parked until audit ships; audit may change the test design.)
- Does not address 13-metric or contradiction-detector audits. (Out of scope per §3.2; their plans get drafted when triggered.)
- Does not address measurement systems beyond LLM-judge research/eval — production observability is a different concern entirely.

---

## 13. Approval

This plan is approved if Albert agrees to:

1. The scope as drawn in §3 (PoC only; 13-metric and contradiction-detector deferred).
2. The bar as set in §4 (decision-grade, not publication-grade).
3. The reference frameworks in §5 (cite from these; not exhaustive surveys).
4. The twelve audit dimensions in §6 (push back on any to add, remove, or merge).
5. The Opus-drafts → Codex-adversarial-reviews process in §7.
6. The deliverable shape in §8 and success criteria in §9.

Push back on any of these now, before audit work starts. After approval, the audit drafts and the FA prompt iteration test stays parked until audit ships.
