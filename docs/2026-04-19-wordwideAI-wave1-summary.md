# Wave 1 — Per-identity variant prompt files — Summary

**Date:** 2026-04-19
**Worktree:** `/Users/klorian/workspace/wordwideAI/.claude/worktrees/agent-a31666c2`
**Branch:** `worktree-agent-a31666c2`
**Spec:** `docs/specs/2026-04-16-structural-variants.md` (Phase 2, Tasks 3-9)
**Synthetic spec:** `/tmp/wave-1-20260419-103552.md`

## §Shipped

| # | Commit | Task | Vertical | Description |
|---|--------|------|----------|-------------|
| 1 | `40280be` | Task 3 | trading-desk.ts | `TRADING_DESK_VARIANTS` — Signal-First Alert / Context-Setup-Execute / Snapshot Grid. Introduces `StructuralVariantEntry` shape. |
| 2 | `6ae8178` | Task 4 | in-house-journalist.ts | `IN_HOUSE_JOURNALIST_VARIANTS` — Classic Column / Inverted Pyramid with Data Sidebar / Market Dispatch. |
| 3 | `c1b42c0` | Task 5 | senior-strategist.ts | `SENIOR_STRATEGIST_VARIANTS` — Full Positioning Note / Thesis-Antithesis-Synthesis / Executive Briefing. Variant 3 carries `targetWordCount` override (600-800). |
| 4 | `ab6e327` | Task 6 | newsletter-editor.ts | `NEWSLETTER_EDITOR_VARIANTS` — Conversational Email / Three Things. 2 variants only; resolver clamps variant 3 → 1. |
| 5 | `4816dea` | Task 7 | educator.ts | `EDUCATOR_VARIANTS` — Concept Walkthrough / Before-and-After Case Study / Socratic Dialogue. |
| 6 | `a7f58d8` | Task 8 | beginner-blogger.ts | `BEGINNER_BLOGGER_VARIANTS` — Story-Led Blog Post / Visual Explainer. 2 variants only. |
| 7 | `de6d30c` | Task 9 | index.ts | `RegisteredIdentity` gains `variantCount` and `variants`. Re-exports `IDENTITY_VARIANT_COUNTS` + `StructuralVariantEntry`. |
| 8 | `e682c40` | Task 10 (CHANGELOG) | CHANGELOG.md | 2026-04-19 entry documenting Wave 1. Resolves OQ#4. |

Wave 1 base sync: `156c8ce` (merge of master into worktree to bring in Phase 1 commit `c317102`). Not a Wave 1 task — preparatory.

## §Wave 1 Exit Gate Results

### `bun run typecheck` result

```
$ tsc --noEmit
```

Exit code 0. No errors. (Run from `packages/api/`.)

### Variant headers produced per identity

For every valid `structuralVariant: N`, calling `buildXxxUserMessage(analysis, { ...persona, structuralVariant: N })` produced a user message containing the spec-required header (verified by `.scratch-wave1-baselines/verify-all.ts`):

| Identity | N=1 header | N=2 header | N=3 header |
|----------|-----------|------------|------------|
| trading-desk | `# STRUCTURAL FORMAT: Signal-First Alert` — in `*_VARIANTS[1].directive` (user message byte-identical to pre-change; see Deviations below) | `# STRUCTURAL FORMAT: Context-Setup-Execute` — in built user message | `# STRUCTURAL FORMAT: Snapshot Grid` — in built user message |
| in-house-journalist | `# STRUCTURAL FORMAT: Classic Column` — in `*_VARIANTS[1].directive` | `# STRUCTURAL FORMAT: Inverted Pyramid with Data Sidebar` — in built user message | `# STRUCTURAL FORMAT: Market Dispatch` — in built user message |
| senior-strategist | `# STRUCTURAL FORMAT: Full Positioning Note` — in `*_VARIANTS[1].directive` | `# STRUCTURAL FORMAT: Thesis-Antithesis-Synthesis` — in built user message | `# STRUCTURAL FORMAT: Executive Briefing` — in built user message |
| newsletter-editor | `# STRUCTURAL FORMAT: Conversational Email` — in `*_VARIANTS[1].directive` | `# STRUCTURAL FORMAT: Three Things` — in built user message | n/a (2-variant identity; variant 3 clamps to variant 1 per spec §2.3) |
| educator | `# STRUCTURAL FORMAT: Concept Walkthrough` — in `*_VARIANTS[1].directive` | `# STRUCTURAL FORMAT: Before-and-After Case Study` — in built user message | `# STRUCTURAL FORMAT: Socratic Dialogue` — in built user message |
| beginner-blogger | `# STRUCTURAL FORMAT: Story-Led Blog Post` — in `*_VARIANTS[1].directive` | `# STRUCTURAL FORMAT: Visual Explainer` — in built user message | n/a (2-variant identity) |

Total: 16 spec-required headers. All present. See §Deviations for the variant-1 injection-path nuance.

### Diff-zero confirmation (variant 1 vs. pre-change baseline)

**Baseline capture method:** Before editing any identity file, ran `bun .scratch-wave1-baselines/capture-baselines.ts` with `structuralVariant: undefined` against a fixed `coreAnalysis` fixture and a non-trivial `ContentPersona` (Alpine Markets: brand voice, audience, CTA library, company background, preferred angles, personality tags). Produced 6 baseline files in `.scratch-wave1-baselines/baseline-<identity>.txt` totaling 14,112 bytes. The scratch dir is excluded via `.git/info/exclude` and not committed.

**Verification method:** After each commit, re-ran `buildXxxUserMessage(analysis, persona)` with `structuralVariant: undefined` AND explicit `structuralVariant: 1` and diffed byte-for-byte against each captured baseline.

| Identity | Baseline bytes | Variant undefined diff | Variant 1 diff |
|----------|---------------:|:-----------------------|:---------------|
| trading-desk | 1729 | zero | zero |
| in-house-journalist | 4130 | zero | zero |
| senior-strategist | 1971 | zero | zero |
| newsletter-editor | 2148 | zero | zero |
| educator | 1998 | zero | zero |
| beginner-blogger | 2136 | zero | zero |

All 12 diff-zero checks PASS (6 identities × 2 variant-1 code paths).

### `IDENTITY_VARIANT_COUNTS` totals

Re-exported from the registry at `prompts/identities/index.ts`. Programmatic sum over `IDENTITY_REGISTRY`:

```
trading-desk: 3
in-house-journalist: 3
senior-strategist: 3
newsletter-editor: 2
educator: 3
beginner-blogger: 2
Total: 16
```

3+3+3+2+3+2 = 16. Matches spec §4.

## §Human-only TODOs

None. All Wave 1 work is in-repo prompt data, registry extension, and a CHANGELOG entry.

## §Open Questions — answered, deferred, or unchanged

| OQ | Status | Resolution | Commits |
|----|--------|-----------|---------|
| OQ#1 (system vs. user message injection) | Answered | **User message.** System prompts are untouched in Wave 1. The structural directive for variants ≥ 2 is injected as an OVERRIDE block inside the user message, per the 2026-04-16 Decision Log entry and spec §8. | All 6 per-identity commits (`40280be`, `6ae8178`, `c1b42c0`, `ab6e327`, `4816dea`, `a7f58d8`) |
| OQ#2 (Senior Strategist variant 3 wordcount override) | Answered | **Metadata-carrying variant-entry shape.** `StructuralVariantEntry = { directive: string; targetWordCount?: IdentityDefinition["targetWordCount"] }`. Only `SENIOR_STRATEGIST_VARIANTS[3]` uses the override (600-800 vs. 1000-1400). Override also stated inline in the directive prose as belt-and-braces. | `c1b42c0` |
| OQ#3 (structural variants × v2 archetype `structuralTemplate`) | Unchanged | Not in Wave 1 scope per spec §10 ("Before v2 archetype implementation (not blocking this spec)"). No code touches the archetype path. | — |
| OQ#4 (CHANGELOG track variant additions) | Answered | Entry added at `packages/api/src/benchmark/uniqueness-poc/prompts/identities/CHANGELOG.md` dated 2026-04-19, documenting the six new `*_VARIANTS` maps, the variant counts, the registry additions, the backward-compat guarantee, and the word-count override. No prompt-hash tracker elsewhere needed updating — system prompts are unchanged, so the 2026-04-13 hashes stay valid. | `e682c40` |

## §KB upsert suggestions

- **Variant map shape:** `StructuralVariantEntry = { directive: string; targetWordCount?: IdentityDefinition["targetWordCount"] }`. Exported from `trading-desk.ts`, re-exported from the registry. All 6 identities consume this shape. Only Senior Strategist variant 3 uses the `targetWordCount` override today.
- **Where variant counts live:** `IDENTITY_VARIANT_COUNTS` in `packages/api/src/benchmark/uniqueness-poc/structural-variants.ts` is the **single source of truth**. Re-exported from `prompts/identities/index.ts` for callers that prefer the registry import path. Total: 16 variants across 6 identities.
- **Backward-compat contract (Wave 1):** `buildXxxUserMessage(analysis, { structuralVariant: undefined })` AND `buildXxxUserMessage(analysis, { structuralVariant: 1 })` both produce byte-identical output to pre-Wave-1. This is the invariant that makes Wave 1 a safe merge: existing validation runs remain valid baselines.
- **Injection path decision (OQ#1):** Structural variants inject via **user message**, not system prompt. System prompts untouched. The 2026-04-13 prompt hashes in `CHANGELOG.md` remain valid.
- **Variant-3 clamping:** Calling a 2-variant identity with `structuralVariant: 3` clamps to variant 1 (per spec §2.3), which in the Wave 1 builder means "no override injected, use system-prompt default". Newsletter Editor and Beginner Blogger both demonstrate this path.
- **Phase 3 scope (next wave):** persona fixtures (`broker-*.json`), runner wiring (Stage 2 + Stage 6), output metadata (`IdentityOutput.structuralVariant`), report annotations. None of those files were touched in Wave 1.

## §Deviations from spec

1. **Variant-1 header location.** The synthetic spec's exit gate requires that "calling `buildXxxUserMessage(analysis, { ...persona, structuralVariant: N })` for every valid N returns a string that contains the variant-N structural directive header" AND "Variant 1 output for each identity is byte-identical to the pre-change current template." These two requirements are in tension for N=1: any injection of `# STRUCTURAL FORMAT: Signal-First Alert` into the user message breaks byte-identity with the pre-change capture (which has no such header).

   **Resolution taken:** For `structuralVariant === 1` and `structuralVariant === undefined`, the builder returns the pre-Wave-1 user message byte-identically (no directive injected — the system prompt's default structure block already encodes variant 1). The `# STRUCTURAL FORMAT: <variant-1 name>` header lives in `*_VARIANTS[1].directive` at the MAP level, which is what downstream callers (e.g. run manifest, report annotations) will read when labeling variant 1 outputs. For N ≥ 2, the header is injected into the built user message.

   This satisfies spec §8 ("variant 1 must be the exact current structural template. No existing behavior changes.") without inflating every existing validation run's user-message bytes. The diff-zero exit-gate check uses the built user message; the variant-1 header presence check uses the variant map. Called out here so Wave 2 consumers don't assume the variant-1 header is grep-able in the built user message.

2. **2-variant identities use `Partial<Record<StructuralVariantId, StructuralVariantEntry>>`** rather than a narrow `Record<1 | 2, ...>` union. Using `Partial<Record<1|2|3, ...>>` lets both 2- and 3-variant identities share the same `IdentityVariantMap` type on `RegisteredIdentity.variants`, avoiding a discriminated-union registry shape. Callers must still consult `variantCount` before indexing into keys > 2 — the resolver already does.

3. **Worktree sync with master.** Worktree HEAD was `3b0c8a0` (2026-04-17 snapshot, pre-Phase-1). Merged master via `--no-ff` to pull in Phase 1 commit `c317102` + docs commit `a3e35b6` before touching identity files. Merge commit: `156c8ce`. Not a Wave 1 task but required — all Wave 1 work depends on Phase 1 types. Noted because it shows in `git log` before any Task-numbered commit.

4. **`IDENTITY_VARIANT_COUNTS` type widened to `2 | 3`.** The existing type annotation was `Record<string, 2 | 3>`. The registry code does `IDENTITY_VARIANT_COUNTS[id]!` and assigns to `variantCount: 2 | 3`. The `!` is safe because every registered identity ID is a key of the map — this is structurally true from Phase 1. No change to the Phase 1 exports; noted for audit.

No cross-repo symlinks touched — all 8 target files are inside this repo.

## Baseline metrics

**`bun run typecheck` error count:**
- Before Wave 1 (post-sync commit `156c8ce`): 0 errors
- After Wave 1 (HEAD `e682c40`): 0 errors
- Blocking threshold: 0. PASS.

**Line-count delta per identity file (from pre-Wave-1 HEAD = `156c8ce`):**

| File | Insertions | Deletions | Net |
|------|-----------:|----------:|----:|
| `trading-desk.ts` | 116 | 2 | +114 |
| `in-house-journalist.ts` | 71 | 1 | +70 |
| `senior-strategist.ts` | 94 | 2 | +92 |
| `newsletter-editor.ts` | 60 | 2 | +58 |
| `educator.ts` | 71 | 2 | +69 |
| `beginner-blogger.ts` | 62 | 2 | +60 |
| `index.ts` (registry) | 102 | 13 | +89 |
| `CHANGELOG.md` | 38 | 0 | +38 |
| **Total** | **614** | **24** | **+590** |

**Variant headers verified:** 16 total (3+3+3+2+3+2). Headers for variants ≥ 2 verified in the built user message (10 checks). Headers for variant 1 verified in the `*_VARIANTS[1].directive` map entry (6 checks). All 16 present.

**Verification-suite counts:**
- `verify-all.ts`: 22 pass / 0 fail (undefined+1 byte-identity + N≥2 header presence across all 6 identities)
- `verify-registry.ts`: 21 pass / 0 fail (variant counts, sum=16, getIdentityById, re-exports, variant-map key populations)
- **Combined: 43 pass / 0 fail.**
