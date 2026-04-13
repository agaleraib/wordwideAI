# Run Analysis Report — CLI tool for deep-dive run analysis and A/B comparison

## Overview

A CLI tool that reads `raw-data.json` from one or two PoC run directories and produces a structured markdown report. This is the ONE artifact you read to understand what happened in a run — or what changed between two runs.

```bash
bun run poc:analyze <runDir>                    # single run deep-dive
bun run poc:analyze <runDirA> --vs <runDirB>    # A/B delta report
```

**Who is it for:** The person reviewing PoC runs — Alex, a partner, or a future team member. They run the command and get a structured markdown file they can read in terminal, editor, or render to HTML.

**What problem it solves:** Today a run produces `report.md` (70+ pages of linear markdown with no navigation), `comparison.html` (Stage 6 pairs only), and `raw-data.json` (280KB of structured data). There is no single artifact that explains WHY something failed, shows the Stage 7 A/B comparison clearly, or lets you compare two runs. The analysis tool fills that gap.

## Prior Work

Builds on:
- [Content Uniqueness Spec](2026-04-07-content-uniqueness.md) — thresholds, two-axis judge rubric, trinary verdicts
- [Narrative State Persistence](2026-04-08-narrative-state-persistence.md) — Stage 7 control/treatment methodology
- [Editorial Memory](2026-04-12-editorial-memory.md) — vector-DB memory layer tested in treatment group
- [Run Manifest](2026-04-13-run-manifest.md) — setup metadata in raw-data.json
- [Cross-Run Comparator](2026-04-13-cross-run-comparator.md) — multi-run aggregation (uses this tool as building block)

Assumes:
- `RunResult` type from `types.ts` is the single data source
- `raw-data.json` contains the complete `RunResult`
- Run directories under `uniqueness-poc-runs/<runId>/`

Changes: New file `analyze.ts` in `packages/api/src/benchmark/uniqueness-poc/`. New package.json scripts.

## Two Modes

### Mode 1: Single Run Deep-Dive

Reads one `raw-data.json`, outputs `analysis.md` to the run directory (and stdout).

Sections:
1. **Executive Summary** — setup (manifest), verdicts, headline numbers, cost
2. **Stage 6 Cross-Tenant** — per-pair breakdown with metrics, judge reasoning, fabrication details
3. **Stage 7 A/B** — control vs treatment differential, per-persona comparison, injected context
4. **Fabrication Deep-Dive** — every fabrication-flagged pair across all stages, with exact divergences
5. **Metrics** — similarity distributions, judge verdict counts, cost/timing breakdown

### Mode 2: A/B Delta Report

Reads two `raw-data.json` files, outputs `comparison.md` showing what changed between runs.

Sections:
1. **Setup Comparison** — manifest diff (memory backend, stages, flags, runtime, git hash)
2. **Verdict Delta** — per-stage verdict changes (e.g., Stage 6: FAIL→FAIL, Stage 7: N/A→FAIL)
3. **Metric Deltas** — per-pair cosine/ROUGE-L with delta and direction arrows
4. **Fabrication Changes** — which pairs gained/lost fabrication flags between runs
5. **Stage 7 A/B Delta** — if both runs have Stage 7: control delta, treatment delta, improvement delta

## Requirements

### R-1: Single Run — Executive Summary

**Acceptance criteria:**
- [ ] Shows run ID, event title, timestamps, duration, cost
- [ ] Shows manifest data: git hash, runtime, memory backend, stages enabled, CLI flags, personas
- [ ] Shows per-stage verdict with cosine mean, ROUGE-L mean, and threshold
- [ ] Shows Stage 7 headline differential (control vs treatment cosine, improvement delta) when present
- [ ] Shows fabrication count across all stages
- [ ] Cost breakdown per stage (core analysis, identity adaptation, cross-tenant, Stage 7, judges)

### R-2: Single Run — Stage 6 Cross-Tenant Breakdown

**Acceptance criteria:**
- [ ] Per-pair table: pair name, cosine, ROUGE-L, fidelity, presentation, verdict
- [ ] For each fabrication-risk pair: full judge fidelity reasoning + factual divergences list (kind, docA quote, docB quote)
- [ ] Distribution stats: mean, min, max for cosine and ROUGE-L
- [ ] Overall Stage 6 verdict with reasoning
- [ ] If judge failures occurred, note which pairs were skipped

### R-3: Single Run — Stage 7 A/B Comparison

This is the most critical section.

**Acceptance criteria:**
- [ ] Headline table: control cosine mean, treatment cosine mean, delta, direction indicator
- [ ] Per-persona section (4 personas): shows what was injected as context — extracted narrative state summary for control, editorial memory rendered block for treatment
- [ ] Per-persona word count comparison (control vs treatment)
- [ ] Control matrix: per-pair cosine, ROUGE-L, verdict
- [ ] Treatment matrix: per-pair cosine, ROUGE-L, verdict
- [ ] Per-pair delta table: pair name, control cosine, treatment cosine, delta, improved? (yes/no)
- [ ] Treatment fabrication details: for any fabrication-flagged treatment pair, show judge reasoning + divergences
- [ ] If `narrativeStateTest` is null, this section is omitted entirely

### R-4: Single Run — Fabrication Deep-Dive

**Acceptance criteria:**
- [ ] Collects all pairs with `judgeTrinaryVerdict === "fabrication_risk"` from: `similarities`, `crossTenantMatrix.similarities`, `narrativeStateTest.controlSimilarities`, `narrativeStateTest.treatmentSimilarities`
- [ ] Each fabrication pair shows: stage label, pair names, fidelity score, presentation score, full fidelity reasoning, all factual divergences with `kind`, `docA`, `docB`
- [ ] If zero fabrication pairs, section shows "No fabrication flags in this run."

### R-5: Single Run — Metrics

**Acceptance criteria:**
- [ ] Similarity distributions per stage: mean, min, max, stddev for cosine and ROUGE-L
- [ ] Judge verdict summary: count of distinct / reskinned / fabrication per stage
- [ ] Timing breakdown per stage with duration and % of total
- [ ] Threshold reference: cross-tenant and intra-tenant thresholds from `UNIQUENESS_THRESHOLDS`

### R-6: A/B Delta — Setup Comparison

**Acceptance criteria:**
- [ ] Side-by-side manifest diff: only show fields that differ between Run A and Run B
- [ ] Always show: memory backend, stages enabled, git hash, runtime, CLI flags
- [ ] Label runs as "Run A" and "Run B" with their run IDs

### R-7: A/B Delta — Metric Deltas

**Acceptance criteria:**
- [ ] Per-stage verdict comparison: Run A verdict vs Run B verdict, changed? flag
- [ ] Per-pair cosine delta table (for stages present in both runs): pair name, Run A cosine, Run B cosine, delta, direction (↑ more similar / ↓ more unique)
- [ ] Aggregate delta: mean cosine change, mean ROUGE-L change
- [ ] Fabrication count delta: Run A count vs Run B count

### R-8: A/B Delta — Stage 7 Delta (when both runs have Stage 7)

**Acceptance criteria:**
- [ ] Control-vs-control comparison: Run A control cosine mean vs Run B control cosine mean
- [ ] Treatment-vs-treatment comparison: Run A treatment cosine mean vs Run B treatment cosine mean
- [ ] Improvement delta comparison: Run A improvement vs Run B improvement
- [ ] If only one run has Stage 7, note which run has it and skip the comparison

## Implementation Plan

### Phase 1: Single Run Analysis

- [ ] **Task 1:** Create `analyze.ts` with CLI arg parsing and raw-data.json loader
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/analyze.ts` (new)
  - **Depends on:** Nothing
  - **Verify:** `bun run packages/api/src/benchmark/uniqueness-poc/analyze.ts <runDir>` loads raw-data.json and prints the run ID. Handles missing directory gracefully.

- [ ] **Task 2:** Implement executive summary renderer (R-1)
  - **Files:** `analyze.ts`
  - **Depends on:** Task 1
  - **Verify:** Output contains setup block, verdict cards, Stage 7 headline, cost breakdown. All values match raw-data.json.

- [ ] **Task 3:** Implement Stage 6 cross-tenant breakdown (R-2)
  - **Files:** `analyze.ts`
  - **Depends on:** Task 1
  - **Verify:** Per-pair table with all metrics. Fabrication pairs show judge reasoning and divergences.

- [ ] **Task 4:** Implement Stage 7 A/B comparison (R-3)
  - **Files:** `analyze.ts`
  - **Depends on:** Task 1
  - **Verify:** Headline differential, per-persona context blocks, control + treatment matrices with per-pair deltas.

- [ ] **Task 5:** Implement fabrication deep-dive (R-4) and metrics (R-5)
  - **Files:** `analyze.ts`
  - **Depends on:** Task 1
  - **Verify:** All fabrication pairs aggregated from all stages. Metrics tables with stddev.

- [ ] **Task 6:** Add `poc:analyze` script to package.json, write analysis.md to run directory
  - **Files:** `packages/api/package.json`, `analyze.ts`
  - **Depends on:** Task 5
  - **Verify:** `bun run poc:analyze <runDir>` writes `analysis.md` and prints to stdout. `bun run typecheck` passes.

### Phase 2: A/B Delta Report

- [ ] **Task 7:** Add `--vs` flag parsing and dual raw-data.json loading
  - **Files:** `analyze.ts`
  - **Depends on:** Task 6
  - **Verify:** `bun run poc:analyze <runDirA> --vs <runDirB>` loads both files.

- [ ] **Task 8:** Implement setup comparison (R-6) and metric deltas (R-7)
  - **Files:** `analyze.ts`
  - **Depends on:** Task 7
  - **Verify:** Manifest diff shows only changed fields. Per-pair delta table with direction indicators.

- [ ] **Task 9:** Implement Stage 7 delta (R-8) and write comparison.md
  - **Files:** `analyze.ts`
  - **Depends on:** Task 8
  - **Verify:** Stage 7 delta compares control-vs-control and treatment-vs-treatment across runs. Output written to `comparison.md` in working directory.

### Phase 3: Integration

- [ ] **Task 10:** Auto-generate analysis.md in `persistRun` for every compare-mode run
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/persist.ts`
  - **Depends on:** Task 6
  - **Verify:** Every new run automatically gets `analysis.md` alongside `report.md` and `comparison.html`.

## Constraints

- **No LLM calls.** Pure computation over raw-data.json.
- **No new npm dependencies.** String concatenation, same pattern as report.ts.
- **TypeScript strict mode, no `any`.** Must pass `bun run typecheck`.
- **Markdown output.** No HTML generation. The markdown should be readable in terminal, editor, or rendered to HTML.
- **Works under both bun and node/tsx** since PoC runs may use either runtime.
- **Backward compatible.** Old runs without manifest data should still produce a report (manifest section shows "No manifest — run predates manifest feature").

## Out of Scope

- **HTML interactive viewer.** This is markdown. comparison.html and identities.html stay as the interactive artifacts.
- **Automated provenance tracing.** (fact lineage from Stage 1 → Stage 6 → Stage 7). Deferred.
- **Multi-run aggregation.** That's the cross-run comparator spec. This tool handles 1 or 2 runs only.
- **Auto-running after every PoC run.** Task 10 adds it to persistRun, but the CLI tool remains independently runnable for old runs.

## Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Should analysis.md include the full output bodies (like report.md does) or just metrics + judge reasoning? Full bodies make it huge but self-contained. | File size vs completeness. Could offer a `--full` flag. | Phase 1, Task 2 |
| 2 | For the A/B delta report, should it auto-detect which setup changed (by diffing manifests) and frame the narrative around that change? | UX quality of the delta report. | Phase 2, Task 8 |
