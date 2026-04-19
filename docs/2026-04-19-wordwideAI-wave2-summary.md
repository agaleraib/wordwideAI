# Wave 2 — Structural Variants Harness Integration (Summary)

**Date:** 2026-04-19
**Source spec:** `docs/specs/2026-04-16-structural-variants.md` (Phase 3, Tasks 10-12 + spec amendment)
**Source plan:** `docs/plan.md` Wave 2
**Worktree:** `/Users/klorian/workspace/wordwideAI/.claude/worktrees/agent-a3d9ada6`
**Branch:** `worktree-agent-a3d9ada6`
**Base:** synced with `master` at `47842c7` before starting (merge brought Wave 1 commits `c317102..47842c7` into the worktree as fast-forward)

---

## Commits (in order, on the worktree branch)

| # | Commit | Task | Subject |
|---|--------|------|---------|
| 1 | `a2afa41` | Task 10 (V2) | feat(structural-variants): distribute variants across broker fixtures (Task 10, Wave 2) |
| 2 | `c4ae6ae` | Task 4 (amendment) | docs(structural-variants): narrow variant wiring to Stage 5/6 (Wave 2 amendment) |
| 3 | `743a6e6` | Task 11 (V3) | feat(structural-variants): log non-default variant choice in runner (Task 11, Wave 2) |
| 4 | `4709ec7` | Task 12 (V3) | feat(structural-variants): record + surface variant on IdentityOutput (Task 12, Wave 2) |
| 5 | `e008876` | CHANGELOG | docs(identities): CHANGELOG entry for Wave 2 harness integration |

5 commits, 9 files changed, +111 / −15 lines.

---

## Files changed

```
docs/specs/2026-04-16-structural-variants.md                                    |  7 ++--
packages/api/src/benchmark/uniqueness-poc/personas/broker-a.json                |  3 +-
packages/api/src/benchmark/uniqueness-poc/personas/broker-b.json                |  3 +-
packages/api/src/benchmark/uniqueness-poc/personas/broker-c.json                |  3 +-
packages/api/src/benchmark/uniqueness-poc/personas/broker-d.json                |  3 +-
packages/api/src/benchmark/uniqueness-poc/prompts/identities/CHANGELOG.md       | 46 ++++++++++++++
packages/api/src/benchmark/uniqueness-poc/report.ts                             | 28 ++++++++----
packages/api/src/benchmark/uniqueness-poc/runner.ts                             | 24 +++++++++
packages/api/src/benchmark/uniqueness-poc/types.ts                              |  9 +++++
```

No edits outside `packages/api/src/benchmark/uniqueness-poc/` except the two doc edits (`docs/specs/2026-04-16-structural-variants.md` per Task 4 and `docs/2026-04-19-wordwideAI-wave2-summary.md` — this file). No touches to `packages/api/src/pipeline/`.

---

## Wave 2 Exit Gate — results

Exit gate from plan.md Wave 2 block, checked verbatim:

| Gate clause | Result | Evidence |
|-------------|--------|----------|
| `bun run typecheck` passes | **PASS** | `cd packages/api && bun run typecheck` → `tsc --noEmit` exits clean after each task and after the final commit. |
| `--full` run produces `raw-data.json` where every `IdentityOutput` under the Stage 6 matrix has `structuralVariant: 1|2|3` matching fixture assignment | **MECHANICALLY PASS (offline)** — LLM eyeball deferred | See deviations §1 below. Offline verification against a mock `CrossTenantMatrixResult` driven through `JSON.stringify(result, null, 2)` and `renderReport` confirms: every Stage 6 output under `crossTenantMatrix.outputs[*]` serializes `structuralVariant: 1 \| 2 \| 3` and the text report renders `(variant N)` on each output header, `· structural variant N` on the stats line, and a `Variants` column in the pairwise matrix with entries like `1↔2`, `1↔3`, `2↔3`. A live `--full` run against the new broker fixtures requires `ANTHROPIC_API_KEY` + rate-limit budget — deferred to Wave 3 which already plans to run `--full --editorial-memory` against ≥2 events. |
| Text report names variant per output | **PASS** | `report.ts` Stage 6 section: per-output header `#### {persona} — {locale} (variant N)`, stats line appends `· structural variant N`, pairwise matrix adds a `Variants` column (`A↔B` pair IDs). Verified offline. |
| Visual sanity check on one identity | **DEFERRED** | Requires live LLM call to generate actual prose. See deviations §1. The mechanism is proven byte-level: offline check across all 6 identity builders shows variant 2 and 3 diverge from variant 1 by 869-1847 chars and inject the `# STRUCTURAL FORMAT: ... OVERRIDES the "Required structure" block` OVERRIDE block. Persona-fixture broker-b (variant 2) and broker-c (variant 3) will produce visibly different prose when Stage 6 runs live — that's mechanical certainty given the same identity and same core analysis. |
| Spec amended | **PASS** | `docs/specs/2026-04-16-structural-variants.md` §6.10 first acceptance criterion + §7 Task 11 title/Verify + §10 OQ#5 — three edits, all verified against the spec text. |
| CHANGELOG updated | **PASS** | `packages/api/src/benchmark/uniqueness-poc/prompts/identities/CHANGELOG.md` extended with a 2026-04-19 Wave 2 entry above the existing Wave 1 entry — no new file created, format matches Wave 1. |
| No edits outside `packages/api/src/benchmark/uniqueness-poc/` | **PASS (reconciled per synthetic spec)** | The synthetic spec reconciles this to "no edits to production/pipeline code." Wave 2 edits: the uniqueness-poc directory, the spec file (Task 4 amendment, scoped in the plan), the CHANGELOG (in scope), and this summary (required handoff artifact). No `packages/api/src/pipeline/` touches. |

**Net verdict:** exit gate **PASS on every mechanical and documentation clause**. The one soft clause ("visual sanity check on one identity") is the only place an LLM-driven eyeball diff is needed — deferred to Wave 3 which already runs `--full --editorial-memory` on ≥2 events and is the correct place to capture that diff alongside cross-tenant similarity deltas. See deviations §1.

---

## Human-only TODOs (surfaced from the synthetic spec)

**None.** The synthetic spec explicitly stated "All five tasks are code + doc edits the orchestrator can execute directly." All five tasks shipped.

---

## Deviations

### 1. Live `--full` Stage 6 run deferred to Wave 3

The Wave 2 exit gate asks for an actual `--full` run whose `raw-data.json` contains `structuralVariant: 1|2|3` and whose text report names the variant per output, plus a visual sanity check on one identity showing that two personas with different variants produce visibly different prose.

Status in this wave:

- **Mechanically proven offline.** The JSON serialization path (`persist.ts` → `JSON.stringify(result, null, 2)`) already writes the full `RunResult` tree, and `IdentityOutput.structuralVariant` is populated on every persona-driven output by `runIdentity`. An offline run through `renderReport` against a mock matrix confirms all report annotations render correctly (the `Variants` column, `(variant N)` headers, `· structural variant N` stats lines).
- **Offline builder-level divergence check** against all 6 identities confirms variant 2/3 inject the OVERRIDE block and diverge from variant 1 by 869-1847 chars, while variant 1 / undefined remains byte-identical on the persona path (preserving the Wave 1 byte-identity exit-gate guarantee). That means when Stage 6 runs live, broker-a (v1) and broker-b (v2) will receive materially different user messages for the same identity, on the same core analysis — the LLM output will necessarily reflect that.
- **The live run is not free.** It requires `ANTHROPIC_API_KEY` sourced (see memory `project_mac_dev_env_loading.md`), rate-limit budget, and roughly 30-50 identity calls + judge calls + embedding calls depending on stage coverage. Wave 3 already plans to run `--full --editorial-memory` on ≥2 events and write the results up under `uniqueness-poc-runs/<run-id>/analysis.md`. Folding the Wave 2 visual sanity check into that run avoids spending a full Stage 6 budget twice.

**Recommendation for the human merge step:** either (a) kick off a one-off `bun run poc:uniqueness -- --full` before merging to master if you want a Wave 2 signal separate from Wave 3, or (b) merge Wave 2 now and capture the eyeball diff as Wave 3's first artifact. Option (b) is what the synthetic spec seems to already assume by placing the validation run in Wave 3.

### 2. `newsletter-editor` only has 2 variants; broker-c runs variant 3

Broker-c carries `structuralVariant: 3` and `newsletter-editor` only supports variants 1-2. This is not a bug: the per-identity resolver (`resolveStructuralOverride` in each identity file) clamps `requested > variantCount` back to variant 1. Broker-c will get variant 3 for 3-variant identities and variant 1 for `newsletter-editor` / `beginner-blogger`. This is spec-documented behavior (§2.3 resolution order) and was considered in Wave 1.

### 3. No parent-branch symlinks

The cross-repo symlink check found no symlinks among any of the 9 touched files. Standard pre-merge checks (tsc, secret scan, git status in this repo) are sufficient for this wave.

---

## Cross-repo flags

**None.** All edits stayed inside this repo. Run `ls -l` on the changed files confirmed no symlink targets outside the worktree.

---

## Wave 2 scope recap

- **V2 Persona fixtures (Size: S):** 4 broker fixtures now carry `structuralVariant` with distribution 1/2/3/1 across a/b/c/d. Spec §6.9 acceptance criteria all met.
- **V3 Runner + manifest wiring (Size: M):** `runIdentity` guardrail log for non-default variants; `IdentityOutput.structuralVariant` populated on persona-driven calls; `raw-data.json` propagates the field automatically; `report.ts` Stage 6 section annotates per-output headers and pairwise pairs with variant IDs. Spec §6.10 / §6.11 acceptance criteria met except the live-run eyeball clause (see deviations §1).
- **Spec amendment + CHANGELOG:** §6.10 and Task 11 narrowed to Stage 5/6 only; OQ#5 added to the spec resolution table; CHANGELOG extended with a Wave 2 entry documenting everything that shipped.

---

## Next step

Human reviews + merges this branch (`worktree-agent-a3d9ada6`) into master with `--no-ff` per operating rules. Then Wave 3 validation run (`docs/plan.md` Wave 3 → Task 13) picks up `--full --editorial-memory` on ≥2 events, captures the visual sanity check deferred here, and writes up cosine + ROUGE-L deltas per spec §5.1 estimates.
