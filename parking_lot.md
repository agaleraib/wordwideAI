# Parking Lot

Drop side-quests and unplanned issues here during micro-sessions instead of derailing.

Format: `- [YYYY-MM-DD] <one-line description> (source: micro-session goal X)`

## Open
- [2026-04-12] Refactor `runCrossTenantMatrix()` from ~13 positional params to a named options object (source: commit review, Task 6)
- [2026-04-13] "Maximum call stack size exceeded" in `getContext` for northbridge-wealth — hits Stage 6 and Stage 7 under Node/tsx. Other 3 personas succeed. Likely deep recursion in Drizzle query builder or contradiction detector. Fallback to narrative state works. (source: A/B validation run)
- [2026-04-13] PoC process hangs after run completes when using `--editorial-memory` with Postgres — postgres.js connection not closed. Requires manual kill. Need `closeDb()` call or `process.exit()` after run finishes in index.ts. (source: A/B validation run)

## Resolved
- [2026-04-13] ~~Bun 100% CPU spin~~ — bypassed by running PoC under Node.js/tsx. Lazy Bun.spawn import in claude-cli.ts, `poc:node*` scripts added. Full --editorial-memory run completed successfully under Node.
