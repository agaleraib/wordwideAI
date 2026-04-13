# Parking Lot

Drop side-quests and unplanned issues here during micro-sessions instead of derailing.

Format: `- [YYYY-MM-DD] <one-line description> (source: micro-session goal X)`

## Open
- [2026-04-12] Refactor `runCrossTenantMatrix()` from ~13 positional params to a named options object (source: commit review, Task 6)
- [2026-04-12] Bun 100% CPU spin when postgres.js + Anthropic SDK HTTP calls are concurrently active in `getContext`. Sequential loops don't fix it, return-value reuse (0984a57) doesn't fix it — bug is in Bun's event loop. Two paths: (1) run PoC with `node` instead of `bun`, (2) clear editorial memory DB before Run B so contradiction detection short-circuits. Blocks Phase 1 validation step C. (source: no active micro)

## Resolved
