---
name: analyze-uniqueness-run
description: Deep analysis of a uniqueness PoC run directory — extracts metrics, finds patterns across pairs, surfaces non-obvious findings, and frames actionable next steps
allowed-tools:
  - Bash(python3:*)
  - Bash(ls:*)
  - Bash(wc:*)
  - Read
  - Glob
  - Grep
when_to_use: |
  Use when the user wants to understand what a uniqueness PoC run shows beyond
  the headline cosine number. Trigger phrases: "analyze the latest run",
  "deep-dive on this run", "what does run X show", "tell me about the last
  test run", "compare these two runs". The skill operates on directories
  under `uniqueness-poc-runs/` produced by
  `packages/api/src/benchmark/uniqueness-poc/`.
argument-hint: "[run-id-or-path] [--compare <prior-run-id-or-path>]"
arguments:
  - run
  - compare
---

# Analyze Uniqueness PoC Run

Deep structured analysis of a single PoC run from `uniqueness-poc-runs/`.
The goal is not to recite numbers — it's to read the prose and the judge's
own reasoning, find patterns across pairs, surface non-obvious findings
(especially judge-vs-arithmetic inconsistencies), and end with prioritized
actionable next steps. When `--compare <prior>` is supplied, append a delta
section comparing both runs on the load-bearing axes.

## Inputs

- `$run` — the run directory to analyze. May be:
  - omitted (use the most recently modified directory under `uniqueness-poc-runs/`)
  - a bare run id (e.g. `2026-04-08T15-12-59-996Z_iran-strike-2026-04-07`), resolved against `uniqueness-poc-runs/`
  - an absolute path
- `$compare` — optional second run for delta comparison. Same resolution rules.

## Goal

Produce a single structured analytical report with these sections, in order:

1. **Run metadata** — event, fixture, duration, total cost, core FA cost
2. **Headline finding** — one-paragraph distillation of where the architecture sits
3. **Stage 6 cross-tenant** — the load-bearing test, per-pair breakdown
4. **Any `fabrication_risk` pair** — specific divergence diagnosis
5. **Cross-pair patterns** — convergence centers, shared structural backbones
6. **Judge inconsistencies** (when present) — pairs where the trinary verdict doesn't match the arithmetic boundary in the rubric
7. **Stage 7 narrative-state A/B** — control vs treatment under the two-axis judge
8. **Stage 3.5 intra-tenant** — judged pairs and any reskin patterns
9. **Cost breakdown** — by stage, with the dominant bucket called out
10. **What this tells us — prioritized next steps**, grouped now-urgent / now-medium / parked
11. **Single-paragraph summary** — to close

When `$compare` is supplied, insert section 10b — **Delta vs `<compare>`** — between cost breakdown and next steps.

## Steps

### 1. Resolve the run directory
Resolve `$run` against `uniqueness-poc-runs/`. If `$run` is omitted, list the directory and pick the most recently modified entry. Confirm the resolved path back to the user before proceeding (one short line, not a question).

**Success criteria**: `raw-data.json` exists at `<resolved>/raw-data.json`.

### 2. Extract structured data from `raw-data.json`
Use a single `python3 -c` invocation (or a heredoc) to load the JSON and dump the fields the analysis needs in one pass. Pull at minimum:

- Top-level: `runId`, `startedAt`, `finishedAt`, `event.title`, `totalCostUsd`, `totalDurationMs`, `coreAnalysis.{outputTokens, costUsd}`, top-level `verdict` and `verdictReasoning`.
- `identityOutputs[]` — for each: `identityName`, `wordCount`, `costUsd`.
- `similarities[]` — every pair the intra-tenant matrix produced. For each pair flagged by the judge, pull `judgeFactualFidelity`, `judgeFactualFidelityReasoning`, `judgePresentationSimilarity`, `judgePresentationSimilarityReasoning`, `judgeFactualDivergences[]`, `judgeTrinaryVerdict`.
- `crossTenantMatrix.{meanCosine, minCosine, maxCosine, meanRougeL, verdict, verdictReasoning}` and the same per-pair judge fields above.
- `narrativeStateTest.{controlSimilarities, treatmentSimilarities, controlMeanCosine, treatmentMeanCosine, treatmentVerdict, treatmentVerdictReasoning}` — judge fields per pair on both groups.
- `narrativeStateTest.narrativeStates[]` — extracted state per persona (one-sentence summary, directional view, key levels).

Do this in **one or two python invocations**, not many separate Reads. The data is structured; treat it as data.

**Success criteria**: every numeric and reasoning field needed for sections 1–9 is in your context, in one pass.

### 3. Section-by-section synthesis

For each section in the Goal list, do the analysis — don't just transcribe the data.

#### 3a. Stage 6 per-pair table
Render the 6 cross-tenant pairs as a markdown table with columns: Pair, Cosine, ROUGE-L, Fidelity, Presentation, Verdict. Sort by presentation similarity ascending so the best (most distinct) pairs are at the top.

#### 3b. Fabrication-risk diagnosis
For each `fabrication_risk` pair, list every divergence the judge cited as a sub-table with columns: kind, doc-A claim, doc-B claim. Then write 2–4 sentences of plain-English diagnosis: which writer is doing what, whether it's invention or omission or framing-disagreement-mislabeled, and what fix the divergence pattern points at (a tag tightening, a source FA fix, a judge calibration issue).

#### 3c. Cross-pair patterns — the most important step
This is where the skill earns its keep. Look across all pairs (intra- and cross-tenant) and surface patterns the per-pair view doesn't show:
- **Convergence centers**: is one identity or persona involved in disproportionately many high-presentation-similarity pairs? (e.g. senior-strategist showed up in 4 of 4 highest pres-similarity intra-tenant pairs in the 2026-04-08 run.) Name it.
- **Shared structural backbones**: does the judge's reasoning on multiple pairs volunteer phrases like "structural backbone", "same structural shape", "shared section order"? If so, the convergence is upstream of the persona layer (probably the FA agent's ordering or the identity-agent prompt). Quote one of the judge's lines verbatim and call out the pattern.
- **Tag failure modes**: if a fabrication_risk pair appears, is the divergence pattern the same as in prior runs? Has the failure mode shifted (e.g., level-invention → probability-redistribution)?

Write these as named findings, not bullet points of numbers.

#### 3d. Judge-vs-arithmetic check
The rubric in `llm-judge.ts` says `distinct_products` requires presentation < 0.5 and `reskinned_same_article` requires presentation ≥ 0.5. **The judge does not strictly enforce this.** For every pair, check whether the trinary verdict matches the numeric arithmetic. If any pair has presentation ≥ 0.5 with verdict `distinct_products`, OR presentation < 0.5 with verdict `reskinned_same_article`, list those pairs explicitly in a "Judge inconsistency" subsection and note the implication: the numeric scores are decoration alongside a holistic verdict, and "margins" against the rubric thresholds are not load-bearing.

If no inconsistencies exist in this run, omit the section entirely. Don't add it as boilerplate.

#### 3e. Stage 7 narrative-state interpretation
Always check **both** the numeric means AND the verdict counts. The numbers and verdicts can disagree (e.g., presentation mean got *worse* but distinct_products count went *up*). When they disagree, the verdict count is the load-bearing signal — say so explicitly. This is where the original PoC was wrong about narrative state and where most casual readings will be wrong too.

Compute and report:
- Control: distinct/reskinned/fabrication counts, fidelity mean, presentation mean
- Treatment: same
- Delta: change in distinct count (load-bearing) and change in presentation mean (diagnostic only)
- The narrative-state extracted summaries from `narrativeStates[]` — one line per persona — to ground the reader in what was injected.

### 4. Map findings to next steps
Group recommendations as:
- **Now-urgent** (changes the picture in small but real ways — e.g., one more clause in a tag prompt, a 5-min edit)
- **Now-medium** (real architectural questions raised by this run — e.g., a structural backbone fix at the identity-agent layer)
- **Parked** (still important, unchanged from prior roadmap)

Each item names: what to change, where (file path), expected impact on the run's measurable axes, effort estimate. Don't write items that just observe — every item must be actionable.

### 5. Close with a single-paragraph summary
4–8 sentences. Restate the headline finding, the most important non-obvious finding from §3c or §3d, and the recommended single next move.

### 6. (When `$compare` is supplied) emit a delta section
Resolve `$compare` the same way as `$run`. Pull the same metadata + Stage 6 + Stage 7 fields from its `raw-data.json`. Compute deltas for: distinct/reskinned/fabrication counts (Stage 6 + Stage 7 separately), fidelity mean, presentation mean, total cost. **Important**: also delta the *kinds* of failures, not just counts — a run with 1 fabrication_risk on a different pair than the comparison run is materially different even at the same count. Render as a small table + 2–4 sentences of plain-English interpretation.

**Success criteria**: report contains a `## Delta vs <compare-run-id>` section with at least the table and the interpretation paragraphs.

## Rules

### Read the prose, not just the numbers
The PoC's session journal §11 is explicit: *"Reading the prose is much higher signal than reading the cosine numbers."* The judge's reasoning fields (`judgeFactualFidelityReasoning`, `judgePresentationSimilarityReasoning`) are the most valuable single asset in the run. Quote from them. Compare them across pairs. Look for repeated phrases the judge volunteers — those are pattern signals.

### Distinguish "tight pass" from "comfortable pass"
When fidelity mean is 0.913 and the bar is 0.9, that is **not** the same as fidelity mean 0.94. Always state the margin in absolute terms ("+0.013 — about one judge tick") and call out which individual pairs are dragging the mean. A run that passes on aggregate but is held up by one or two pairs is not safe.

### Trinary verdict is the load-bearing signal, cosine is diagnostic
The cosine mean is now a diagnostic only. Never report a cosine mean without immediately framing it as diagnostic and shifting the reader's attention to the trinary verdict counts. This was the central correction the 2026-04-08 measurement revision made; do not regress.

### Surface judge inconsistencies when present
Always check whether the trinary verdict matches the numeric arithmetic. If they disagree on any pair, name it explicitly. This is one of the most useful non-obvious findings the skill produces and it's invisible if you only look at verdicts or only look at numbers.

### Distinguish invention from omission from framing-disagreement
When the judge flags a `fabrication_risk` divergence, parse what kind of divergence it actually is:
- **Invention**: writer A states a number that conflicts with the source. (Original Helix.)
- **Omission**: writer A doesn't mention something writer B does. (Not really fabrication — judge over-fires.)
- **Framing disagreement**: both writers agree on facts but emphasize different conclusions. (Also not fabrication.)
The judge's hard rule fires on all three indistinguishably right now. Calling out which one a divergence actually is informs whether the fix is at the tag layer, the judge layer, or the FA layer.

### Findings, not transcripts
Never dump the raw judge reasoning verbatim except as quoted evidence for a specific finding. The skill's output should be 60% synthesis and 40% data; if it's 90% data, the synthesis step was skipped.

### No speculation about external context
Stay grounded in the data on disk. Don't speculate about what the production system would do, what other fixtures might show, or what would happen "in the wild" — unless the analysis already establishes it concretely from this run.

### Always end with prioritized actionable next steps
Every analysis ends with a next-steps section that tells the user what to do, where, and what it would change. "Things to think about" is not actionable. Effort estimates and expected impact are required, file paths are strongly preferred.

### Compare only what was measured
When `$compare` is supplied, only delta the axes both runs measured. If the prior run used the single-axis judge and the current run uses the two-axis judge, do not pretend you can compare presentation similarity directly — the rubrics differ. Cross-rubric comparisons should be flagged as caveated.
