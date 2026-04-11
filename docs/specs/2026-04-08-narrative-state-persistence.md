# Narrative State Persistence — Between-Runs Memory for the Uniqueness PoC

**Date:** 2026-04-08
**Status:** Draft (decision spec — no code yet)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (decisions), Claude (drafting)

**Companion specs and prior art:**
- `2026-04-07-content-uniqueness.md` — the uniqueness gate this persistence layer feeds
- `2026-04-08-uniqueness-poc-playground.md` — the interactive harness that will eventually surface multi-event experiments on top of this persistence layer
- `2026-04-07-content-pipeline.md` — the production content pipeline; its own persistence story lives there, not here
- `docs/poc-uniqueness-session-2026-04-07.md` — the session journal tracking the four-iteration PoC, the 2026-04-08 measurement revision, and the parked experiments this spec unblocks
- `packages/api/src/benchmark/uniqueness-poc/` — the harness this spec modifies
- `packages/api/src/benchmark/uniqueness-poc/narrative-state.ts` — the existing in-memory, single-entry narrative-state module

---

## 1. Goal

Stage 7 of the uniqueness PoC can only test **one-shot** continuity today: the harness generates a prior piece in memory, extracts state from it, and injects that state into a second run on a hand-picked "follow-up" event, all within a single CLI invocation. There is no way to test whether continuity compounds across three, four, or five events, and there is no way to feed a realistic multi-week prior history into a new persona or tag configuration.

This spec adds a minimal, filesystem-backed persistence layer for the per-tenant narrative state the PoC already extracts. Stage 6 outputs can be **opted in** to the store via a flag, and Stage 7 reads from the store as its first choice (falling back to today's in-memory synthesis when the store is empty). A new `poc:sequence` CLI mode walks an ordered `EventSequence` fixture step-by-step, appending state between steps, so a single command produces realistic accumulated history. The store is a dumb JSON directory tree with count-based GC, wrapped behind a `NarrativeStateStore` interface in the same repository-pattern style as `ProfileStore` and `TranslationStore`.

In short: **unblock multi-event continuity experiments without touching production code, without introducing a database, and without changing the behaviour of existing `--full` runs.**

---

## 2. Why now

Three parked experiments from the 2026-04-07 and 2026-04-08 sessions all hit the same wall — there is no accumulated state to test against:

- **Structural-backbone breaking via continuity pressure.** The hypothesis is that a persona carrying four pieces of prior directional view, level calls, and framing language will diverge from a green-field run of the same persona on the same event far more than a persona carrying a single prior piece does. We cannot test this today because Stage 7 is single-prior by construction.
- **Multi-event Stage 7 A/B.** The real-world case isn't "one prior piece" — it's "you wrote about EUR/USD on Monday, Tuesday, Wednesday, and now a Thursday NFP miss lands." We need to reproduce that shape end-to-end and measure the cross-tenant uniqueness of the Thursday pieces.
- **Helix re-test against accumulated history.** The 2026-04-08 Helix tag rewrite fixed the fabrication_risk verdict on single-prior runs. The next question is whether the rewrite survives when Helix is handed a three-step backlog that already committed to a view it might now want to flip.

None of these need a database. They need a file per `(fixture, tenant, topic)` that the harness can read before a run and append to after a run. That's the entire scope of this spec.

---

## 3. Non-goals

| Out of scope | Why / where it lives instead |
|---|---|
| Postgres-backed persistence | v1 is filesystem-only behind an interface. When `2026-04-07-deployment-stack.md` stands up Postgres, a `PostgresNarrativeStateStore` implementation can slot in without changing any call sites. |
| Vector search / semantic retrieval of prior entries | The PoC only needs "N most recent entries for this (tenant, topic)". No embedding index, no similarity lookup, no RAG. |
| Cross-tenant shared memory | Entries are strictly scoped to `(fixtureId, tenantId, topicId)`. Tenants never read each other's state. |
| Multi-topic linking (e.g. "EUR/USD view influences DXY view") | One `(tenant, topic)` is one file. Topic relations are not modelled. |
| Time-based GC | v1 is count-based only (`maxEntries`, default 5). Age-based expiry is a v2 concern. |
| Importer from existing `uniqueness-poc-runs/` | Old runs have unstable `topicId`s and persona IDs; retrofitting them is more work than running fresh. Start from an empty store. |
| Production content-pipeline persistence | Workstream C's content pipeline will have its own persistence story (real DB, per-tenant schemas, audit trail, retention policy). This spec is a lab tool for the PoC harness only. |
| Concurrent-run locking | The PoC harness is run by one developer at a time. We use atomic rename to avoid half-written files, but we do not guard against two parallel runs on the same `(fixture, tenant, topic)`. |
| Tag-prompt versioning inside entries | If a tag prompt is rewritten and invalidates old entries, the user wipes the fixture namespace and starts over. Version stamping is deferred. |

---

## 4. On-disk layout

All state lives under a single repo-relative root:

```
packages/api/uniqueness-poc-state/
  <fixtureId>/
    <tenantId>/
      <topicId>.json
```

- **`fixtureId`** — the fixture the run was driven from. For single-event runs this is the existing fixture filename stem (e.g. `iran-strike`). For multi-event sequences it is the `EventSequence` id (e.g. `eur-usd-q2-2026`).
- **`tenantId`** — the persona id (e.g. `broker-a`, `premium`, `fasttrade`, `helix`). Matches `ContentPersona.id`.
- **`topicId`** — the topic key the run stamps onto each Stage 6 output. Today this is synthesised inside `runner.ts`; see §7 for the exact rule.
- **`<topicId>.json`** — the full `TenantTopicNarrativeStateFile` for that triple, containing the capped `recentEntries[]` array and the derived house-view fields.

One file per triple. No sharding, no index file, no sidecars. `clearFixture(fixtureId)` is a recursive delete of `packages/api/uniqueness-poc-state/<fixtureId>/`.

The root is gitignored. Runs never commit state.

### 4.1 File format

Each file is pretty-printed JSON, UTF-8, trailing newline. Example (abridged):

```json
{
  "schemaVersion": 1,
  "fixtureId": "eur-usd-q2-2026",
  "tenantId": "helix",
  "topicId": "eurusd",
  "lastUpdatedAt": "2026-04-08T14:22:11.000Z",
  "currentHouseView": "bearish",
  "currentHouseViewConfidence": "moderate",
  "recentEntries": [
    {
      "pieceId": "helix-step-1",
      "publishedAt": "2026-04-06T09:00:00.000Z",
      "oneSentenceSummary": "...",
      "directionalView": "bearish",
      "directionalViewConfidence": "high",
      "keyThesisStatements": ["..."],
      "keyLevelsMentioned": ["1.0820 support", "1.0920 resistance"],
      "callsToActionUsed": [],
      "extractionInputTokens": 812,
      "extractionOutputTokens": 214,
      "extractionCostUsd": 0.00342
    },
    { "pieceId": "helix-step-2", "...": "..." },
    { "pieceId": "helix-step-3", "...": "..." }
  ]
}
```

`recentEntries` is **newest-last** (append order). `currentHouseView` / `currentHouseViewConfidence` always mirror the newest entry — the store owns this derivation, callers never compute it.

---

## 5. `NarrativeStateStore` interface

The interface mirrors the repository-pattern contracts already used by `ProfileStore` and `TranslationStore`: narrow, async, no hidden state, easy to substitute for a different backend later.

```ts
// packages/api/src/benchmark/uniqueness-poc/narrative-state-store.ts

import type {
  NarrativeStateEntry,
  TenantTopicNarrativeState,
} from "./types.js";

export interface NarrativeStateStore {
  /**
   * Read the accumulated state for a (fixture, tenant, topic) triple.
   * Returns null if no file exists.
   */
  get(
    fixtureId: string,
    tenantId: string,
    topicId: string,
  ): Promise<TenantTopicNarrativeState | null>;

  /**
   * Append a new entry to the (fixture, tenant, topic) state, applying
   * count-based GC (oldest dropped first). Creates the file if it does
   * not exist. Returns the resulting state after append + GC.
   *
   * Derives `currentHouseView` / `currentHouseViewConfidence` from the
   * newest entry. Derives `lastUpdatedAt` from `entry.publishedAt`.
   */
  append(
    fixtureId: string,
    tenantId: string,
    topicId: string,
    entry: NarrativeStateEntry,
  ): Promise<TenantTopicNarrativeState>;

  /**
   * List all (topic) states for one (fixture, tenant). Used by the
   * sequence runner to diagnose what was accumulated. Order is
   * unspecified — callers sort if they care.
   */
  list(
    fixtureId: string,
    tenantId: string,
  ): Promise<TenantTopicNarrativeState[]>;

  /**
   * Recursively delete every file under `<root>/<fixtureId>/`. Used as
   * the manual reset hook. Idempotent: no error if the fixture namespace
   * doesn't exist.
   */
  clearFixture(fixtureId: string): Promise<void>;
}
```

### 5.1 `FileSystemNarrativeStateStore` (v1 implementation)

Concrete implementation notes for the one backend v1 ships with:

- **Constructor:** `new FileSystemNarrativeStateStore({ rootDir, maxEntries = 5 })`. `rootDir` defaults to `packages/api/uniqueness-poc-state` resolved against the package root. `maxEntries` is the count-based GC cap applied inside `append`.
- **`get`:** `readFile` → `JSON.parse` → `TenantTopicNarrativeStateFileSchema.parse` → map to `TenantTopicNarrativeState`. Return `null` on `ENOENT`. All other errors propagate.
- **`append`:** `get` → push new entry onto `recentEntries` → slice to last `maxEntries` → recompute `currentHouseView`, `currentHouseViewConfidence`, `lastUpdatedAt` from the newest entry → validate with Zod → atomic write (§5.2) → return the new `TenantTopicNarrativeState`.
- **`list`:** `readdir(<root>/<fixtureId>/<tenantId>)` filtered to `*.json`, `Promise.all` of `get` calls keyed by the filename stem as `topicId`. `ENOENT` on the directory returns `[]`.
- **`clearFixture`:** `fs.rm(<root>/<fixtureId>, { recursive: true, force: true })`. No-op if missing.
- **Strict TS, no `any`.** Every deserialised payload is run through the Zod schema; the interface never exposes `unknown`.

### 5.2 Atomic write

`append` must never leave a half-written file on disk, because the next run will `JSON.parse` it and crash. The implementation:

1. `mkdir -p <root>/<fixtureId>/<tenantId>` (idempotent).
2. Write the full JSON payload to `<topicId>.json.tmp-<pid>-<nonce>` in the same directory.
3. `fs.rename` the tmpfile over `<topicId>.json`. On POSIX this is atomic.
4. On any error during write, delete the tmpfile in a `finally`.

This guards against process crash mid-write but does not guard against two concurrent appends racing each other — see §12 Risks.

---

## 6. Zod schema

All disk parsing goes through a single Zod schema. The schema includes a `schemaVersion: 1` literal for forward-compatibility; future versions can union against `z.discriminatedUnion("schemaVersion", ...)`.

```ts
// packages/api/src/benchmark/uniqueness-poc/narrative-state-store.ts (same file)

import { z } from "zod";

const NarrativeStateEntrySchema = z.object({
  pieceId: z.string().min(1),
  publishedAt: z.string().min(1), // ISO-8601, not enforced at Zod level
  oneSentenceSummary: z.string().min(1),
  directionalView: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  directionalViewConfidence: z.enum(["low", "moderate", "high"]),
  keyThesisStatements: z.array(z.string()),
  keyLevelsMentioned: z.array(z.string()),
  callsToActionUsed: z.array(z.string()),
  extractionInputTokens: z.number().int().nonnegative(),
  extractionOutputTokens: z.number().int().nonnegative(),
  extractionCostUsd: z.number().nonnegative(),
});

export const TenantTopicNarrativeStateFileSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureId: z.string().min(1),
  tenantId: z.string().min(1),
  topicId: z.string().min(1),
  lastUpdatedAt: z.string().min(1),
  currentHouseView: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  currentHouseViewConfidence: z.enum(["low", "moderate", "high"]),
  recentEntries: z.array(NarrativeStateEntrySchema).min(0),
});

export type TenantTopicNarrativeStateFile = z.infer<
  typeof TenantTopicNarrativeStateFileSchema
>;
```

Conversion to the in-memory `TenantTopicNarrativeState` defined in `types.ts` is a one-to-one field copy — the on-disk shape is a strict superset with an extra `schemaVersion` + `fixtureId` tag. We deliberately keep the two types separate so `types.ts` does not pick up a disk-format dependency.

---

## 7. Wire-in points in `runner.ts`

Two precise places get touched. Everywhere else in `runner.ts` stays exactly as it is.

### 7.1 Writes — after Stage 6 completes

Inside the current `runCrossTenantMatrix` callsite (around `runner.ts:847` in the present tree, `runFull` function), immediately after `crossTenantMatrix` is assigned and before `narrativeStateTest` is invoked:

```ts
if (opts.persistNarrativeState && opts.store) {
  for (const output of crossTenantMatrix.outputs) {
    const entry = await extractNarrativeState({
      pieceId: `${output.personaId}-${runId}`,
      publishedAt: opts.publishedAt ?? new Date().toISOString(),
      body: output.body,
    });
    await opts.store.append(
      opts.fixtureId,
      output.personaId,
      deriveTopicId(opts.fixture),
      entry,
    );
  }
}
```

Rules for this block:

- **Guarded by flag.** If `persistNarrativeState !== true`, the block is skipped entirely and Stage 6 runs exactly as today. Default is `false`.
- **One extraction call per persona per run.** Uses the existing `extractNarrativeState` Haiku call. Cost: ~$0.005 × N personas.
- **`deriveTopicId(fixture)`** is a pure helper, new in this spec, defined alongside the store. For single-event fixtures it is `fixture.topicId ?? slugify(fixture.event.instrument ?? fixture.id)`. For `EventSequence` fixtures it is `sequence.topicId` (a required field — see §8). The rule is documented in one place so both write and read sites stay in sync.
- **Stage 7 outputs never persist.** Only Stage 6 cross-tenant pieces go into the store. This keeps Stage 7 as a pure A/B harness whose inputs are fully controlled.
- **Stage 2 outputs never persist.** Per-identity non-cross-tenant runs are not "tenant-shaped" and have no stable `tenantId`.

### 7.2 Reads — at the start of Stage 7

Inside `runNarrativeStateTest` (around `runner.ts:528`), the existing call to `buildNarrativeStateFromPriorOutput` is replaced with a store-first lookup that falls back to the current in-memory synthesis:

```ts
async function resolveNarrativeStateForPersona(args: {
  persona: ContentPersona;
  topicId: string;
  priorOutput: IdentityOutput;
  priorPublishedAt: string;
  fixtureId: string;
  store: NarrativeStateStore | undefined;
}): Promise<TenantTopicNarrativeState> {
  if (args.store) {
    const existing = await args.store.get(
      args.fixtureId,
      args.persona.id,
      args.topicId,
    );
    if (existing && existing.recentEntries.length > 0) {
      return existing;
    }
  }
  // Fallback: today's in-memory, single-entry synthesis from the Stage 6 output.
  return buildNarrativeStateFromPriorOutput(
    args.persona,
    args.topicId,
    args.priorOutput,
    args.priorPublishedAt,
  );
}
```

Rules:

- **Store-first, synthesis-fallback.** Empty store → current behaviour. Non-empty store → injected state comes entirely from disk, and `priorOutput` is ignored for that persona.
- **No silent merging.** We do not layer disk state on top of synthesised state. Either the store answers or it doesn't.
- **Per-persona resolution.** The resolve helper is called once per persona inside the existing loop. A persona with no file falls back even if its siblings hit the store.

---

## 8. `EventSequence` fixture type

Today `fixtures/*.json` each describe a single event. Multi-event sequences get a new parallel type and a new directory:

```
packages/api/src/benchmark/uniqueness-poc/fixtures/
  iran-strike.json            # existing, untouched
  iran-retaliation.json
  fed-rate-decision.json
  china-tariffs.json
  sequences/
    eur-usd-q2-2026.json      # new
```

### 8.1 Type

```ts
// packages/api/src/benchmark/uniqueness-poc/types.ts (addition)

export interface EventSequence {
  /** Stable id, also used as the fixtureId in the store path. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** The topic key persisted into the store for every step. Required. */
  topicId: string;
  /** Ordered list of events. Length ≥ 2. */
  steps: NewsEvent[];
}
```

### 8.2 File format

Same JSON as single-event fixtures but wrapped in the sequence envelope. Example:

```json
{
  "id": "eur-usd-q2-2026",
  "title": "EUR/USD Q2 2026 — Iran strike → Fed hold → ECB dovish → NFP miss",
  "topicId": "eurusd",
  "steps": [
    { "headline": "...", "body": "...", "instrument": "EUR/USD", "...": "..." },
    { "headline": "...", "body": "...", "instrument": "EUR/USD", "...": "..." },
    { "headline": "...", "body": "...", "instrument": "EUR/USD", "...": "..." },
    { "headline": "...", "body": "...", "instrument": "EUR/USD", "...": "..." }
  ]
}
```

### 8.3 Relation to single-event fixtures

- Single-event fixtures are untouched. `poc:uniqueness --full --fixture iran-strike` still works exactly as today. Adding `--persist-narrative-state` causes Stage 6 outputs from that one run to be appended.
- `EventSequence`s are a strict superset: "a sequence of one" is equivalent to the single-event case, but we do not collapse the two — the single-event loader stays separate to avoid churning existing code paths.
- Both loaders go through the same `deriveTopicId` helper so the store is written consistently regardless of entry point.

---

## 9. CLI surface

Three surface changes, all additive:

### 9.1 New `--persist-narrative-state` flag on existing runs

```
bun run poc:uniqueness:full --fixture iran-strike --persist-narrative-state
```

- Turns on the §7.1 write block.
- Default: `false`. Existing runs are byte-identical to today.
- Accepted on any CLI entry point that reaches Stage 6 (`--full`, `--all --full`).

### 9.2 New `poc:sequence` command

New script in `packages/api/package.json`:

```json
"poc:uniqueness:sequence": "bun run src/benchmark/uniqueness-poc/index.ts --sequence"
```

Invocation:

```
bun run poc:uniqueness:sequence --fixture eur-usd-q2-2026
```

Behaviour:

1. Load the `EventSequence` from `fixtures/sequences/<id>.json`.
2. For **steps 1..N-1**: run the core pipeline through Stage 6 with `persistNarrativeState = true`. Stage 7 is **skipped** for these steps — they exist only to accumulate history. Each step appends one entry per persona to the store, applying the GC cap.
3. For **step N (final)**: run the full pipeline through Stage 6 **and** Stage 7, with the store reads in §7.2 pulling the accumulated state from steps 1..N-1.
4. Emit a single aggregated report covering the whole sequence, plus the existing per-step artifacts under `uniqueness-poc-runs/<runId>/step-<k>/`.

Side-effect contract: the sequence command is deterministic as a single shell call. It does not require the user to manually re-invoke anything between steps.

### 9.3 Manual reset

There is no `--reset` flag in v1. To wipe state for a fixture, the user runs:

```
rm -rf packages/api/uniqueness-poc-state/<fixtureId>/
```

or programmatically calls `store.clearFixture(fixtureId)` from a scratch script. The store constructor does **not** auto-wipe on start; this is deliberate — accidentally clobbering three steps of accumulated history because of a CLI typo is worse than making reset a conscious act.

---

## 10. Walk-through: canonical multi-event test

Scenario: **EUR/USD Q2 2026, four-step sequence**. We want to see whether continuity pressure breaks the structural backbone by step 4.

### 10.1 Fixture

`packages/api/src/benchmark/uniqueness-poc/fixtures/sequences/eur-usd-q2-2026.json`:

| Step | Event | Role |
|---|---|---|
| 1 | Iran strike on Israeli target | Establishes risk-off prior |
| 2 | Fed hawkish hold | Reinforces USD strength bias |
| 3 | ECB dovish surprise | Creates EUR-side pressure, possible continuity tension for personas that called neutral in step 1 |
| 4 | NFP miss | The payoff event — full Stage 6 + Stage 7 A/B runs here |

Four personas: `premium`, `fasttrade`, `helix`, `broker-a` (the four in `personas/`).

### 10.2 Command

```
bun run poc:uniqueness:sequence --fixture eur-usd-q2-2026
```

### 10.3 What happens, step by step

**Step 1 (Iran strike):**
1. Stage 1 FA runs on event 1.
2. Stage 6 cross-tenant runs four identity/persona outputs.
3. Because `persistNarrativeState` is on by default inside the sequence runner, each of the four outputs is extracted and appended to `uniqueness-poc-state/eur-usd-q2-2026/<persona>/eurusd.json`.
4. Stage 7 is **skipped**.
5. Store state after step 1: four files, each with `recentEntries.length === 1`.

**Step 2 (Fed hawkish hold):**
1. Stage 1 FA runs on event 2.
2. **Inside Stage 6**, before each identity call, the harness calls `store.get(...)` to pull the step-1 entry and injects it via the existing `renderNarrativeStateDirective` path — i.e. the personas generating step-2 pieces already feel the step-1 history.
3. Stage 6 emits four new outputs; each is extracted and appended. Store state now has `recentEntries.length === 2` per file.
4. Stage 7 skipped.

Note: §7.2's read path lives today in `runNarrativeStateTest` only. The sequence runner requires the read path to **also** fire inside Stage 6 for steps 2..N. This is a small generalisation: move the `resolveNarrativeStateForPersona` helper up to the shared call site and have both Stage 6 (when in sequence mode) and Stage 7 use it. In single-event `--full` runs, Stage 6 still does **not** read from the store, preserving back-compat.

**Step 3 (ECB dovish surprise):**
Same as step 2, now with `recentEntries.length === 3` after append.

**Step 4 (NFP miss):**
1. Stage 1 FA runs on event 4.
2. Stage 6 runs with each persona's full three-entry history injected. Four pieces emitted. These are the **treatment-equivalent** pieces — they carry the accumulated thread.
3. Stage 6 pieces are extracted and appended (state now has length 4, still under the default `maxEntries = 5` cap — no GC triggered yet).
4. Stage 7 A/B test runs:
   - **Control:** four green-field pieces with no state injected (store deliberately bypassed for the control group).
   - **Treatment:** four pieces pulled from the just-written step-4 state OR recomputed by the existing treatment path against the accumulated state. Concretely: Stage 7 runs `resolveNarrativeStateForPersona` and gets the full four-entry history, which is injected into the treatment calls.
5. Cosine and ROUGE-L deltas are computed against the cross-tenant thresholds exactly as today.

### 10.4 Expected state file after step 3

`packages/api/uniqueness-poc-state/eur-usd-q2-2026/helix/eurusd.json`:

```json
{
  "schemaVersion": 1,
  "fixtureId": "eur-usd-q2-2026",
  "tenantId": "helix",
  "topicId": "eurusd",
  "lastUpdatedAt": "2026-04-07T18:30:00.000Z",
  "currentHouseView": "bearish",
  "currentHouseViewConfidence": "high",
  "recentEntries": [
    { "pieceId": "helix-step-1-<runId>", "directionalView": "bearish", "...": "..." },
    { "pieceId": "helix-step-2-<runId>", "directionalView": "bearish", "...": "..." },
    { "pieceId": "helix-step-3-<runId>", "directionalView": "bearish", "...": "..." }
  ]
}
```

### 10.5 Hypothesis under test

- **Control group** (no state): pairwise cross-tenant cosine lands where vanilla Stage 6 lands — the same ~0.87-ish structural-backbone cluster.
- **Treatment group** (three prior entries): pairwise cosine drops meaningfully because each persona is anchoring on its own thesis language, its own level calls, its own prior framings.
- If the drop is real, continuity pressure is a valid structural-backbone breaker and the idea graduates from "nice-to-have" to "architecture".
- If the drop is marginal, we learn that a structural backbone laid down by the source FA is too strong to shift downstream, and the fix has to live in the identity-agent prompt instead.

Either outcome is useful. Today we cannot cleanly run the test because there is no way to build up three steps of prior state in a reproducible way.

---

## 11. Back-compat

Hard rules:

- **Existing `poc:uniqueness:full` runs without `--persist-narrative-state` are byte-identical to today.** No reads from the store. No writes. Stage 7 goes through the existing `buildNarrativeStateFromPriorOutput` synthesis path because the store is empty or not provided.
- **Stage 7 in-memory synthesis path is preserved.** `buildNarrativeStateFromPriorOutput` is not deleted. `resolveNarrativeStateForPersona` wraps it as a fallback. Any code path that today calls the synthesis function directly keeps working.
- **No migration required.** Old runs in `uniqueness-poc-runs/` are unaffected. The new `uniqueness-poc-state/` root is gitignored and does not exist until the first `--persist-narrative-state` run.
- **Single-event fixtures continue to load through the existing loader.** Sequences go through a new loader. The two do not share a file format.
- **All new flags default to off.** `--persist-narrative-state` defaults to `false`. `poc:uniqueness:sequence` is a distinct command that the user has to invoke explicitly.

---

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Half-written state file crashes the next run's `JSON.parse`.** A crash or SIGINT mid-write leaves a corrupt `<topicId>.json`. | Low-medium | Atomic write via tmpfile + rename (§5.2). The corrupt state would have to exist in the tmpfile, which we clean up in a `finally`. Worst case: a leftover `*.tmp-*` file, which the loader ignores. |
| **Concurrent runs race on the same `(fixture, tenant, topic)` file.** Two parallel PoC sessions could lose appends. | Low | Documented constraint: one developer, one run at a time. Not prevented. If it bites, add a `.lock` file on `append`. |
| **Stale persona IDs.** A user rewrites `personas/helix.json` (changes `id`) and the old state files become orphaned. | Medium | Fixture namespacing contains the blast radius — old entries live under the old id but are never read. The user wipes the fixture namespace when they notice. A lint step could warn on unknown persona ids in `list`, deferred. |
| **GC dropping the entry that established the original house view.** With `maxEntries = 5`, after six steps the step-1 thesis is gone. `currentHouseView` follows the newest entry, so the house view silently shifts as GC bites. | By design | Accepted per decision #3. The store is explicitly forgetful. If a test needs the full history, the user raises `maxEntries`. |
| **Fixture pollution between experiments.** A user runs a sequence, tweaks a persona prompt, reruns — the first run's entries still sit in the store and skew the second run. | Medium | `store.clearFixture(fixtureId)` exists as the explicit reset. The `poc:uniqueness:sequence` runner does **not** auto-clear; we'd rather make reset a conscious act than risk losing accumulated state. |
| **`uniqueness-poc-state/` drifts out of sync with `uniqueness-poc-runs/`.** The two directories are independent; the state root contains no pointer back to the run that produced each entry. | Low | Documented, not prevented. `pieceId` embeds the `runId` so forensic tracing is possible. A future iteration could cross-link. |
| **Topic-id collision across fixtures.** Two fixtures both use `topicId: "eurusd"` but mean different time ranges. | Low | Cannot happen across fixtures because the store path is `<fixtureId>/<tenantId>/<topicId>`. Fixture namespace isolates them. |
| **Schema drift.** A v2 schema lands and old v1 files fail to parse. | Low | `schemaVersion: z.literal(1)` explicitly. Future versions use `z.discriminatedUnion("schemaVersion", ...)`. Until then, the user wipes and re-runs. |

---

## 13. Testing strategy

Light touch — this is a lab tool, not production infrastructure. The goal is "does not silently break the harness" plus "the one new feature actually does what it says".

### 13.1 Unit: `FileSystemNarrativeStateStore`

Against a per-test `os.tmpdir()` root:

- `get` on a missing file returns `null`.
- `append` creates the file, returns state with `recentEntries.length === 1`, and persists correctly round-trip.
- `append` with `maxEntries = 3` capped: after 5 appends, `recentEntries.length === 3` and the first two entries are gone.
- `currentHouseView` always equals the newest entry's `directionalView` across a 4-append sequence with alternating values.
- `list` returns every topic file for a `(fixture, tenant)` pair and `[]` for an unknown pair.
- `clearFixture` deletes the fixture namespace and is idempotent.
- Corruption case: write invalid JSON to a file, `get` throws a helpful error (or returns `null` with a warning — pick one, document it, stick to it).

### 13.2 Integration: short `EventSequence` end-to-end

- A two-step fixture with one persona, one topic, against a tmpdir-backed store.
- Step 1: Stage 6 runs, one entry lands in the store, Stage 7 skipped.
- Step 2: Stage 6 reads the step-1 entry, runs identity call with injected directive, appends step-2 entry. Stage 7 runs and its treatment group sees both entries.
- Assert: two entries in the store after the run, Stage 7's treatment `narrativeStates[0].state.recentEntries.length === 2`.
- This test may stub the Anthropic client to avoid API spend; the point is wiring, not LLM output.

### 13.3 Back-compat test

- Snapshot the JSON output of `poc:uniqueness:full --fixture iran-strike` before this spec lands.
- After the spec lands, re-run without `--persist-narrative-state` and assert the output matches the snapshot (modulo timestamps/run ids).
- The `uniqueness-poc-state/` root must not exist after the run (no writes happened).

### 13.4 What we deliberately do **not** test

- Concurrent-run race conditions (documented non-goal).
- LLM output quality under accumulated history (that's what the experiments this spec unblocks are *for* — not what we gate merge on).
- Multi-process lock acquisition.
- Cross-platform path handling beyond POSIX (the PoC runs on macOS/Linux only).

---

## 14. Open questions for future iteration

Each is explicitly deferred from v1 and tracked here as a single line:

- **Time-based GC.** Drop entries older than N days in addition to the count cap.
- **Cross-topic linking.** Allow an entry on `eurusd` to partially inform `dxy` state.
- **Multi-tenant shared memory.** A "house view" that sits above individual tenants (probably a different abstraction, not an extension of this).
- **Postgres backend.** `PostgresNarrativeStateStore` implementing the same interface, plugged in once deployment lands.
- **Importer from `uniqueness-poc-runs/`.** Retrofit historical runs into store entries.
- **Tag-prompt version stamping.** Each entry records which version of the tag prompt generated it; entries generated by stale prompts auto-expire.
- **In-UI reset.** A button in the playground (spec `2026-04-08-uniqueness-poc-playground.md`) that calls `clearFixture` without shelling out.
- **`--reset` CLI flag.** Opt-in wipe before a run. Skipped in v1 to keep accidental clobbering impossible.
- **Concurrent-run safety.** File locking or a single-writer daemon.
- **Cross-run forensics.** A back-pointer from each entry to the `runId` / directory under `uniqueness-poc-runs/` that produced it, for post-hoc debugging.

---
