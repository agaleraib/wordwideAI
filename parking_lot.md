# Parking Lot

Drop side-quests and unplanned issues here during micro-sessions instead of derailing.

Format: `- [YYYY-MM-DD] <one-line description> (source: micro-session goal X)`

## Open
- [2026-04-15] Decide collaborator alias scheme for `.harness-profile.team.members` + parking-lot `@alias:` prefix convention. Open sub-questions: (1) Albert's own alias (albert / ag / klorian / other); (2) whether to commit partner alias as placeholder now or add at onboarding time. Proposal: Option A (pure convention, zero code) — add `team.members` block, require `@<alias>:` prefix on every park entry, integrator-transcribe preserves tag. (source: co-vibe onboarding, 2026-04-15)
- [2026-04-15] Confirm partner parking design: personal `docs/parking-workstream-b.md` on their branch for scratch, copied into PR body at submit, no `/park` skill (writes to master's parking_lot.md → merge conflict). Needs sign-off; docs not yet updated. (source: co-vibe onboarding, 2026-04-15)
- [2026-04-15] Fill `<!-- FILL: @albert-telegram-handle -->` placeholder in committed `docs/partner-quickstart.md` before sending to partner. (source: co-vibe onboarding, 2026-04-15)
- [2026-04-15] Decide cleanup for stale B-related branches: `workstream-b-sources-spec` (local + origin, where spec was drafted) and `workstream-b-playground` (origin only, muddled with C content). Partner's branch `workstream-b-sources-rss-mvp` doesn't collide but these lingering names invite confusion. (source: co-vibe onboarding, 2026-04-15)
- [2026-04-15] Push wordwideAI commit `75a0c71` (partner quickstart + profile team edits) to `origin/master` — not pushed this session. (source: co-vibe onboarding, 2026-04-15)
- [2026-04-12] Refactor `runCrossTenantMatrix()` from ~13 positional params to a named options object (source: commit review, Task 6)
- [2026-04-13] PoC process hangs after run completes when using `--editorial-memory` with Postgres — postgres.js connection not closed. Requires manual kill. Need `closeDb()` call or `process.exit()` after run finishes in index.ts. (source: A/B validation run)

## Resolved
- [2026-04-15] ~~`contradiction-detector` Haiku schema bug~~ — Haiku omits `contradictions` field when empty (despite `required` in tool schema). Fixed: `.default([])` in Zod + removed `required` from tool schema so both agree the field is optional. No more silent Zod failures.
- [2026-04-13] ~~Bun 100% CPU spin~~ — bypassed by running PoC under Node.js/tsx. Lazy Bun.spawn import in claude-cli.ts, `poc:node*` scripts added. Full --editorial-memory run completed successfully under Node.
- [2026-04-15] ~~"Maximum call stack size exceeded" in `getContext`~~ — infinite recursion in `context-assembler.ts` truncation loop (`slice(-2)` stabilised at length 2, recursed forever). Fixed in 028bdd8 by using `slice(1)` so the array strictly shrinks each call. Validated: 4/4 personas now get memory injected in Stage 6. Affected 3/4 personas, not just northbridge-wealth.
