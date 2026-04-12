# Uniqueness PoC Playground — Interactive GUI for Tag/Persona Iteration

**Date:** 2026-04-08
**Status:** Stabilizing (architecture in target zone after 2026-04-08 revision)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (decisions), Claude (drafting)

**Companion specs and prior art:**
- `2026-04-07-content-pipeline.md` — the production content pipeline that this playground experiments with in miniature
- `2026-04-07-content-uniqueness.md` — the uniqueness gate the playground is calibrating
- `docs/poc-uniqueness-session-2026-04-07.md` — the session journal documenting the four-iteration PoC and the 2026-04-08 measurement revision that produced the new two-axis judge
- `packages/api/src/benchmark/uniqueness-poc/` — the harness this playground wraps
- `.claude/skills/analyze-uniqueness-run/SKILL.md` — the analytical workflow the playground embeds

---

## 1. Goal

Compress the uniqueness PoC iteration loop from **15 minutes per experiment** (edit `tags.ts` → run CLI → wait 11 minutes → grep `raw-data.json` → read 4 markdown files → ask Claude to synthesize → tweak) to **30 seconds per experiment** (tweak dropdown → click run → watch streaming progress → see all N tenants side-by-side → click "Analyze" → read structured findings inline). The same architectural questions get asked an order of magnitude faster, which means we converge on tag rewrites, persona designs, and FA prompt fixes in a fraction of the time.

This is a **lab playground**, not a production tool. It exists to help us iterate on the architecture by surfacing the results of each tweak immediately and visually. The production content pipeline lives elsewhere (`packages/api/src/routes/translate.ts` and the future content-pipeline spec implementation).

---

## 2. Why this exists *now*

The PoC has reached a point where the next architectural improvements all involve fast iteration on small variations:

- **Tag rewrites** — the 2026-04-08 Helix discovery showed the Helix tags were licensing counter-claims and producing fabrication_risk verdicts. The fix was a 6-tag rewrite + a governing rule. The next iteration round will probably need to rewrite the `skeptical` and `contrarian` tags one more time to close the probability-redistribution failure mode the latest run revealed.
- **Structural-backbone problem** — every cross-tenant pair shares the same opening order and section structure inherited from the source FA agent. The fix is somewhere in the identity-agent prompt; we need to test 5–10 variations to find one that breaks the backbone without sacrificing fidelity.
- **FA prompt invalidation-level fix** (note C) — the source FA needs a single explicit `invalidation_level` field. We need to test what happens to the persistent FastTrade ↔ Helix fabrication_risk pair when the source no longer leaves it ambiguous.
- **Persona reshuffles** — exploring "what does it look like if Premium uses the educator format?" or "what if FastTrade gets Helix's tags?" These are valuable thought experiments today and require editing JSON files + recompiling + rerunning the CLI.

Each of these iterations is a 10–15 minute round trip in the current CLI workflow. With a playground GUI it becomes a 30–60 second round trip. The playground earns its keep on the second day of use.

---

## 3. Non-goals

| Out of scope | Why / where it lives instead |
|---|---|
| Production content generation for real tenants | The production pipeline lives in `packages/api/src/routes/translate.ts` and the eventual content-pipeline implementation. The playground only generates lab outputs that are never published. |
| Multi-event temporal continuity scaffolding | Stage 7 narrative-state A/B is supported (it's part of "all stages"), but the playground does not maintain a long-running per-tenant narrative thread across many events. Full temporal scaffolding lives in the production pipeline. |
| Authentication / multi-user collaboration | Single-developer tool, behind whatever the existing FinFlow web app's auth is. No team workspaces, no shared edit sessions. |
| Real-time character-level streaming of LLM tokens | Deferred to v1.x or v2 (see §16). v1 streams stage-level events only — each persona's prose appears as a block once its identity call completes. |
| Postgres-backed run storage | Filesystem-only in v1 behind a `RunRepository` interface (see §6). Postgres-backed implementation deferred to when `2026-04-07-deployment-stack.md` actually runs. |
| Tag prompt rewrites *from inside the UI* | Tag prompts live in `packages/api/src/benchmark/uniqueness-poc/tags.ts`. To rewrite a tag prompt you edit the TS file and re-bundle (the existing dev workflow). The UI lets you pick which tags a persona uses, hover to see the current prompt, but does not let you mutate the tag prompt strings themselves. |
| External LLM provider switching | The PoC is locked to Anthropic Claude (Opus FA + Sonnet identities + Haiku judge). Multi-provider experimentation is not in scope. |

---

## 4. High-level layout

The playground is one route at `/playground/uniqueness` inside `packages/web/`. The page has four major regions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TOP BAR                                                                │
│  ┌─────────────┐ ┌──────────────────────────────────────────┐ ┌──────┐ │
│  │ Fixture ▼   │ │ Free-text event body (multiline input)   │ │ Run  │ │
│  │ iran-strike │ │ ...                                      │ │ all  │ │
│  └─────────────┘ └──────────────────────────────────────────┘ └──────┘ │
│                                                                         │
│  Stages:  ☑ 1 FA  ☑ 2 6-id  ☐ 4 repro  ☐ 5 A/B  ☑ 6 X-tenant  ☐ 7 narr │
│  Quick mode: [Off ▼]   Cost cap: $20  ·  Spent: $4.27 / $20             │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────┬─────────────────────────────────────────────────┬─────────────┐
│ HISTORY │  TENANT GRID (configurable N, default 4 in 2×2) │  ANALYSIS   │
│ SIDEBAR │                                                 │  PANEL      │
│         │  ┌──────────────────┐ ┌──────────────────┐      │             │
│ ┌─────┐ │  │ Tenant 1         │ │ Tenant 2         │      │ (renders    │
│ │Run A│ │  │ Premium ▼        │ │ FastTrade ▼      │      │  after a    │
│ │Run B│ │  │ Identity: jrn ▼  │ │ Identity: jrn ▼  │      │  run)       │
│ │Run C│ │  │ Tags: [chips...] │ │ Tags: [chips...] │      │             │
│ │Run D│ │  │ Words: [200—800] │ │ Words: [200—800] │      │ - Charts    │
│ └─────┘ │  │ ────────────     │ │ ────────────     │      │ - Per-pair  │
│         │  │ (output renders) │ │ (output renders) │      │ - Verdict   │
│ Filter: │  │                  │ │                  │      │ - Findings  │
│ [_____] │  └──────────────────┘ └──────────────────┘      │ - Next      │
│         │  ┌──────────────────┐ ┌──────────────────┐      │   steps     │
│ Sort:   │  │ Tenant 3         │ │ Tenant 4         │      │             │
│ Date ▼  │  │ Helix ▼          │ │ Northbridge ▼    │      │ ┌─────────┐ │
│         │  │ ...              │ │ ...              │      │ │ Export  │ │
│ Diff vs:│  │                  │ │                  │      │ │ CSV/JSON│ │
│ Run B   │  │ ...              │ │ ...              │      │ └─────────┘ │
│         │  └──────────────────┘ └──────────────────┘      │             │
│         │                                                 │             │
│         │  [+ Add tenant]   [- Remove last]                │             │
└─────────┴─────────────────────────────────────────────────┴─────────────┘
```

**Three regions, all dark, all premium, all framer-motion-animated:**

- **Top bar** — fixture picker, free-text event body, stage checkboxes, quick-mode toggle, cost ticker, master "Run all" button.
- **Main grid** — N tenant cards laid out in a responsive grid (1 tenant = full width, 2 = side-by-side, 3 = 1+2 or 3-across, 4 = 2×2, 5–6 = 3×2). Each card holds the per-tenant config (persona, identity, tags, word count) and the output prose for that tenant once a run completes.
- **Left rail** — collapsible run history sidebar with click-to-load and diff-baseline selection.
- **Right rail / panel** — analysis output that appears after a run completes (charts + structured findings + export buttons). On narrow screens this collapses to a tab below the grid.

The grid layout switches breakpoint behavior based on N — 1 tenant uses full width, 2 splits 50/50, 3 lays out as 2-on-top + 1-below or 3-across depending on viewport, 4 is 2×2, 5–6 is 3×2. framer-motion handles the grid reflow animation when tenants are added/removed.

---

## 5. Component breakdown

### 5.1 Top-level page component

`packages/web/src/pages/PlaygroundUniqueness.tsx` — orchestrates the three regions, holds the run-in-progress state, manages the SSE connection, and dispatches events from the run stream into the right tenant cards.

### 5.2 React component tree

```
<PlaygroundUniqueness>
  <PlaygroundTopBar>
    <FixturePicker />              ← dropdown of available fixtures + "blank"
    <EventBodyTextarea />          ← free-text event body, prefilled by fixture or empty
    <StagesPicker />               ← 6 checkboxes with dependency rules
    <QuickModeToggle />            ← global word-count override (off / 200 / 700 / 1500)
    <CostTicker />                 ← live "$X.XX / $Y.YY" with cap-edit dropdown
    <RunAllButton />               ← disabled if cost cap would be exceeded
  </PlaygroundTopBar>

  <PlaygroundLayout>
    <RunHistorySidebar>            ← collapsible left rail
      <RunHistoryFilter />
      <RunHistoryList>
        <RunHistoryItem run={...} />  ← click to load, right-click → "Set as diff baseline"
      </RunHistoryList>
      <DiffBaselineIndicator />    ← shows which run is currently the diff baseline
    </RunHistorySidebar>

    <TenantGrid>
      <TenantCard tenant={0}>
        <PersonaPicker />          ← preset dropdown + "Edit" → opens PersonaEditor inline
        <IdentityPicker />         ← all 6, default InHouseJournalist
        <TagPicker family="angle" /> ← multi-select dropdown grouped by category
        <TagPicker family="personality" />
        <WordCountSlider />        ← 100—2000 range, default = identity preset
        <PerTenantRunButton />     ← runs only this tenant
        <TenantOutputPane>         ← prose appears here after run
          <OutputBody />
          <OutputMetadata />       ← word count, cost, model, duration
          <FactualDivergenceList /> ← if part of a fabrication_risk pair
          <DeltaBadges />          ← if a diff baseline is set
        </TenantOutputPane>
      </TenantCard>
      <!-- ... up to 6 ... -->
      <AddTenantButton />
      <RemoveTenantButton />
    </TenantGrid>

    <AnalysisPanel>                ← appears after a run completes
      <AnalysisHeadline />         ← "5/6 distinct, 1 fabrication_risk on FastTrade↔Helix"
      <AnalysisCharts>
        <FidelityPresentationScatter />
        <TrinaryVerdictDonut />
        <CostStackedBar />
        <WordCountBar />
      </AnalysisCharts>
      <AnalysisFindings>           ← structured output of the skill's analytical logic
        <CrossPairPatterns />
        <JudgeInconsistencies />
        <StagePanels />            ← Stage 6 / 7 / 3.5 separate sub-sections
        <PrioritizedNextSteps />
      </AnalysisFindings>
      <ExportButtons>
        <ExportCsvButton />
        <ExportJsonButton />
      </ExportButtons>
    </AnalysisPanel>
  </PlaygroundLayout>
</PlaygroundUniqueness>
```

### 5.3 State model

Top-level page state shape (in a single Zustand store, no Redux):

```ts
interface PlaygroundState {
  // Top bar
  selectedFixtureId: string | null;     // null = free-text mode
  eventBody: string;                     // editable; preset from fixture or blank
  enabledStages: Set<StageId>;          // {1, 2, 4, 5, 6, 7}
  quickMode: 'off' | '200' | '700' | '1500';
  costCap: number;                       // dollars, default 20
  costSpent: number;                     // accumulator across the session

  // Tenant grid
  tenants: TenantConfig[];               // length 1—6

  // Run state
  runInProgress: boolean;
  currentRunId: string | null;           // set when SSE stream starts
  sseConnection: EventSource | null;

  // History
  runHistory: RunSummary[];              // sorted by startedAt desc
  loadedRunId: string | null;            // a past run loaded into the playground state
  diffBaselineRunId: string | null;      // for inline delta badges

  // Analysis
  analysisResult: AnalysisResult | null; // populated after run completes + analysis route returns
}

interface TenantConfig {
  index: number;
  personaId: string | null;              // preset id (broker-a..d) or custom id
  personaOverride: Partial<ContentPersona> | null; // inline edits not yet saved as a preset
  identityId: string;                    // default 'in-house-journalist'
  angleTagsOverride: AngleTag[] | null;  // null = use the persona's preferredAngles
  personalityTagsOverride: PersonalityTag[] | null;
  targetWordCount: number;               // 100—2000, default = identity's preset target

  // Output state — populated by SSE events as the run progresses
  output: TenantRunOutput | null;
}

interface TenantRunOutput {
  status: 'pending' | 'generating' | 'judging' | 'complete' | 'error';
  body: string | null;
  wordCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
  judgeFidelity: number | null;          // populated after Stage 6 completes
  judgePresentation: number | null;
  judgeVerdict: TrinaryUniquenessVerdict | null;
  factualDivergences: FactualDivergenceRecord[] | null;
}
```

### 5.4 Stages picker dependency rules

The 6 stage checkboxes enforce dependencies:

| Stage | Always on? | Requires |
|---|---|---|
| 1 (FA core) | **mandatory, locked on** | — |
| 2 (intra-tenant 6 identities) | optional | Stage 1 |
| 4 (reproducibility 3× journalist) | optional | Stage 1 |
| 5 (persona A/B differentiation) | optional | Stage 1, ≥ 2 tenants |
| 6 (cross-tenant matrix — load-bearing) | optional, **default on** | Stage 1, ≥ 2 tenants |
| 7 (narrative state A/B) | optional | Stage 6, fixture has a continuation event |

Dependency violations grey out the offending checkbox with a tooltip explaining why. Stage 1 is always rendered checked and disabled.

---

## 6. Data model

### 6.1 RunRepository interface

Persistence is abstracted behind an interface so the v1 filesystem implementation can be swapped for Postgres in v2 without touching the routes or the UI:

```ts
// packages/api/src/benchmark/uniqueness-poc/run-repository.ts

export interface RunRepository {
  /** Persist a finished run to storage. Returns the run id. */
  save(result: RunResult, metadata: RunMetadata): Promise<string>;

  /** List runs ordered by startedAt desc, with optional filters. */
  list(filters?: RunListFilters): Promise<RunSummary[]>;

  /** Load a single run by id. */
  load(runId: string): Promise<RunResult & RunMetadata>;

  /** Set / update / remove user-provided label or pin state. */
  annotate(runId: string, annotation: { label?: string; pinned?: boolean }): Promise<void>;
}

export interface RunMetadata {
  label: string | null;
  pinned: boolean;
  /** The configurations the user picked, so a loaded run can restore the playground state exactly. */
  playgroundConfig: {
    eventBody: string;
    fixtureId: string | null;
    enabledStages: StageId[];
    tenants: TenantConfig[];
  };
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  label: string | null;
  pinned: boolean;
  eventTitle: string;       // first 60 chars of eventBody
  tenantCount: number;
  totalCostUsd: number;
  // Headline verdict, computed from the run's Stage 6 result
  verdictSummary: {
    distinctCount: number;
    reskinnedCount: number;
    fabricationRiskCount: number;
  };
}
```

### 6.2 Filesystem layout (v1)

```
uniqueness-poc-runs/
├── runs.index.json                    ← queryable index, one entry per run
└── <runId>/
    ├── raw-data.json                  ← full RunResult (existing)
    ├── playground-config.json         ← NEW: the playground state to restore on load
    ├── metadata.json                  ← NEW: { label, pinned }
    ├── report.md                      ← existing
    ├── core-analysis.md               ← existing
    ├── outputs/                       ← existing, fixed in commit 72c9a82
    └── analysis-cache.json            ← NEW: cached output of the analysis route, computed lazily on first request
```

`runs.index.json` is a single JSON file containing an array of `RunSummary` objects. Updated atomically (write-temp-then-rename) on every `save()` and `annotate()`. The history sidebar reads it on page load and on every refresh.

### 6.3 v2 Postgres migration path

`RunRepository` will get a Postgres implementation when the deployment stack lands. Schema sketch:

```sql
CREATE TABLE poc_runs (
  run_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  label TEXT,
  pinned BOOLEAN DEFAULT FALSE,
  raw_data JSONB NOT NULL,
  playground_config JSONB NOT NULL,
  analysis_cache JSONB,
  total_cost_usd NUMERIC(10, 4) NOT NULL,
  tenant_count INT NOT NULL,
  distinct_count INT,
  reskinned_count INT,
  fabrication_risk_count INT
);
CREATE INDEX poc_runs_started_at_idx ON poc_runs (started_at DESC);
CREATE INDEX poc_runs_pinned_idx ON poc_runs (pinned) WHERE pinned = TRUE;
```

Filesystem and Postgres implementations satisfy the same interface; the route layer doesn't change.

---

## 7. API design

All routes live under `packages/api/src/routes/poc.ts` and are mounted at `/poc/*` on the existing Hono app. Auth uses whatever the existing FinFlow API uses (currently none in dev; add the existing middleware when one is enabled).

### 7.1 Catalog routes (read-only metadata for the dropdowns)

```
GET  /poc/personas                  → ContentPersona[] (the 4 broker presets + any saved customs)
GET  /poc/personas/:id              → ContentPersona
POST /poc/personas                  → save a new custom persona; returns its id
PUT  /poc/personas/:id              → update an existing custom persona
GET  /poc/identities                → IdentityDefinition[] (the 6 from prompts/identities/)
GET  /poc/tags                      → { angle: AngleTagInfo[], personality: PersonalityTagInfo[] }
                                      where AngleTagInfo = { id, category, description }
GET  /poc/fixtures                  → NewsEvent[] (the 4 fixtures + any user-provided)
GET  /poc/fixtures/:id              → NewsEvent
```

### 7.2 Run routes

```
POST /poc/runs                      → start a new run
  body: PlaygroundRunRequest
  response: { runId: string, streamUrl: string }

GET  /poc/runs/:id/stream           → SSE stream of stage events for an in-flight run
                                      Closes when the run completes or errors

GET  /poc/runs                      → RunSummary[] (the run history index)
  query: ?filter=<text>&pinned=true&sortBy=date|cost|verdict

GET  /poc/runs/:id                  → full RunResult + RunMetadata
GET  /poc/runs/:id/raw-data.json    → the unprocessed RunResult, for export
GET  /poc/runs/:id/export.csv       → flattened pairwise CSV
PUT  /poc/runs/:id/annotate         → { label?: string, pinned?: boolean }
DELETE /poc/runs/:id                → permanently delete a run from disk
```

### 7.3 Analysis route

```
POST /poc/runs/:id/analyze          → trigger / re-trigger analysis
GET  /poc/runs/:id/analyze          → return cached AnalysisResult (computed if missing)
GET  /poc/runs/:id/analyze/diff?baseline=<otherRunId>
                                    → AnalysisResult with delta fields populated against baseline
```

The analysis route reads `raw-data.json` and runs the analytical logic the SKILL.md describes (metadata extraction → Stage 6 per-pair table → fabrication-risk diagnosis → cross-pair pattern detection → judge-vs-arithmetic check → Stage 7 interpretation → cost breakdown → prioritized next steps). Output is structured JSON the UI renders natively. The skill itself becomes documentation of the analytical workflow this route implements.

### 7.4 PlaygroundRunRequest shape

```ts
interface PlaygroundRunRequest {
  // From the top bar
  fixtureId: string | null;          // if set, eventBody overrides the fixture's body
  eventBody: string;
  eventTitle: string | null;         // optional override; falls back to fixture title or first line of body
  enabledStages: StageId[];          // [1, 6, ...]

  // From the tenant grid
  tenants: Array<{
    personaId: string | null;        // null = use personaOverride only
    personaOverride: Partial<ContentPersona> | null;
    identityId: string;
    angleTagsOverride: AngleTag[] | null;
    personalityTagsOverride: PersonalityTag[] | null;
    targetWordCount: number;
  }>;

  // From the global controls
  quickMode: 'off' | '200' | '700' | '1500';

  // Persistence
  label: string | null;
  costCapUsd: number;                // server-side enforces this — refuses if estimate exceeds
}
```

### 7.5 SSE event protocol

The SSE stream emits typed events. The UI subscribes and dispatches each event into the corresponding tenant card or top-bar component.

```ts
type PocSseEvent =
  | { type: 'run_started';            runId: string; estimatedCostUsd: number }
  | { type: 'stage_started';          stage: StageId; label: string }
  | { type: 'stage_completed';        stage: StageId; durationMs: number; costUsd: number }
  | { type: 'core_analysis_completed'; body: string; tokens: number; costUsd: number }
  | { type: 'tenant_started';         tenantIndex: number }
  | { type: 'tenant_completed';       tenantIndex: number; output: IdentityOutput }
  | { type: 'embeddings_computed';    pairCount: number }
  | { type: 'judge_started';          pairId: string }
  | { type: 'judge_completed';        pairId: string; verdict: JudgeVerdict }
  | { type: 'cost_updated';           totalCostUsd: number }
  | { type: 'run_completed';          runId: string; totalCostUsd: number; verdict: 'PASS' | 'FAIL' }
  | { type: 'run_errored';            runId: string; error: string }
```

The runner gets a small `EventEmitter`-style argument that the routes pipe into the SSE stream. Conceptually:

```ts
// runner.ts — additive change
export interface RunCallbacks {
  onStageStarted?: (stage: StageId) => void;
  onStageCompleted?: (stage: StageId, durationMs: number, costUsd: number) => void;
  onTenantStarted?: (tenantIndex: number) => void;
  onTenantCompleted?: (tenantIndex: number, output: IdentityOutput) => void;
  onJudgeCompleted?: (pairId: string, verdict: JudgeVerdict) => void;
  onCostUpdated?: (totalCostUsd: number) => void;
}

export async function runUniquenessPoc(
  opts: RunOptions,
  callbacks?: RunCallbacks
): Promise<RunResult> { ... }
```

The CLI continues to work unchanged (callbacks default to no-op). The route wires callbacks to SSE writes.

---

## 8. Persona + tag editing model

### 8.1 Persona editing

The persona dropdown shows the 4 broker presets (Premium, FastTrade, Helix, Northbridge) plus any custom personas the user has saved. Selecting a preset populates the rest of the tenant card with that persona's defaults (brand voice, audience profile, regional variant, preferred angle tags, personality tags, identity).

Every field on the persona is editable inline:
- **Brand voice** — multi-line text input
- **Audience profile** — multi-line text input
- **Regional variant** — short text input
- **Brand positioning** — multi-line text input
- **Jurisdictions** — chip-style multi-input
- **CTA library** — table editor (text + id per row)
- **Forbidden claims** — chip-style multi-input
- **CTA policy** — segmented control (always / when-relevant / never)

Edits are kept in `tenant.personaOverride` and merged on top of the preset at run time. Edits do not modify the underlying preset JSON file unless the user explicitly clicks **"Save as new preset"**, which prompts for a new persona id and writes a new JSON file under `personas/<id>.json` (via `POST /poc/personas`). The original 4 broker presets are never overwritten — modified versions become new files.

### 8.2 Tag editing

Tags are picked from the existing `tags.ts` taxonomy via two multi-select dropdowns per tenant card:

- **Angle tags** dropdown — grouped by category (macro framing / technical framing / action-oriented / risk framing / educational / cross-asset / positioning), with the prompt-ready description visible on hover.
- **Personality tags** dropdown — grouped by category (editorial stance / risk temperament / communication style / information density / confidence posture / tone qualities), same hover behavior.

Selected tags appear as chips above the dropdowns; click an X on a chip to deselect. The tenant's selection lives in `tenant.angleTagsOverride` and `tenant.personalityTagsOverride`. If the user selects no tags, the persona's defaults from `preferredAngles` and `personalityTags` are used at run time.

**Tag prompt rewrites are out of scope for the UI** (see §3). To rewrite a tag's prompt text, the user edits `packages/api/src/benchmark/uniqueness-poc/tags.ts` directly and the dev server reloads. The UI's `GET /poc/tags` route picks up the new text on its next call.

### 8.3 Identity dropdown

Per-tenant identity dropdown lists all 6 identities (BeginnerBlogger, InHouseJournalist, TradingDesk, NewsletterEditor, Educator, SeniorStrategist) with default `in-house-journalist` (the load-bearing cross-tenant identity). The dropdown lets the user explore non-canonical configurations like "what if Helix uses Educator format?"

Each identity in the dropdown shows its target word count range as secondary text (`InHouseJournalist (700–950 words)`).

---

## 9. Governing-rule guardrails

The 2026-04-08 Helix discovery established the rule: **tags must license emphasis, not counter-claims.** The UI surfaces this rule actively:

### 9.1 Per-tag warning hover

Each tag in the dropdown is annotated server-side (in the `/poc/tags` response) with a `risk` field:

```ts
interface AngleTagInfo {
  id: AngleTag;
  category: string;
  description: string;          // the prompt text from tags.ts
  risk: 'safe' | 'caution';     // 'caution' if the prompt licenses counter-claims
  riskReason?: string;          // human-readable explanation
}
```

The risk classification is computed from a static keyword scan over the tag's prompt text: phrases like "challenge the consensus", "underpricing", "the consensus is", "be willing to be wrong", "what if the data is misleading" mark a tag as `caution`. The list lives in `tags-risk-rules.ts` next to `tags.ts`.

A `caution` tag in a multi-select dropdown shows a small ⚠️ icon next to its chip and a tooltip explaining the rule. The current Helix tags after the 2026-04-08 rewrite should all classify as `safe` — if they don't, the rewrite is incomplete and the warning is the signal to iterate.

### 9.2 Persona-level warning banner

When a tenant has both an `angleTag` and a `personalityTag` that are both `caution`, the tenant card shows a non-blocking yellow banner: *"This combination historically produced fabrication_risk verdicts. See the governing rule in tags.ts."* The banner has a "?" link that opens a modal explaining the 2026-04-08 Helix discovery in two paragraphs. The banner does not block the run.

### 9.3 Post-run feedback

If a run produces a `fabrication_risk` verdict on a pair, the analysis panel highlights which tenant(s) had `caution` tags selected. This closes the loop: the user sees that the warning correlated with the actual failure and learns to trust the warning next time.

---

## 10. Charts & visualization design

Library: **Recharts** (mature, declarative, dark-theme-friendly, ~50KB gzipped, has all four chart types we need).

Four charts in the analysis panel, rendered after a run completes:

### 10.1 Per-pair fidelity vs presentation scatter

- **X axis:** presentation similarity (0 → 1)
- **Y axis:** factual fidelity (0 → 1)
- **Each dot:** one cross-tenant pair from Stage 6
- **Color:** trinary verdict (`distinct_products` = green, `reskinned_same_article` = orange, `fabrication_risk` = red)
- **Reference lines:** vertical at x=0.5 (presentation ceiling), horizontal at y=0.9 (fidelity floor)
- **Hover tooltip:** the pair name + both reasoning fields + any factual divergences
- **Diff baseline overlay:** if a baseline run is set, baseline pairs render as ghost (50% opacity) dots in the same color, with arrows from baseline to current

This is the single most informative chart in the playground. It tells you at a glance whether the architecture is in the target zone (cluster of green dots in the upper-left quadrant) and which pairs are dragging the aggregate.

### 10.2 Trinary verdict donut

A small (~120px) donut chart showing the count of distinct / reskinned / fabrication_risk verdicts across the Stage 6 pairs. Same color scheme as the scatter. Numeric label in the center: e.g., "5/6". For diff mode, show the delta as a badge ("+1 distinct" / "+2 fabrication ⚠").

### 10.3 Cost-per-stage stacked bar

Horizontal stacked bar showing where the run's cost went, broken down by Opus FA (purple) / Sonnet identities (blue) / Haiku judges (teal) / OpenAI embeddings (grey). Total label on the right ("$1.39"). Useful for understanding which iteration dimensions are expensive — when the user toggles Stage 7 on, they should see the cost bar grow visibly because Stage 7 dominates the cost (43% in the latest run).

### 10.4 Word count per tenant

Vertical bar chart, one bar per tenant, showing actual word count vs target word count. The target is rendered as a grey reference line at the top of the column; the actual is the colored bar. If actual exceeds target, the bar colors red and an overflow indicator appears (the existing Educator length-cap problem visualized — cite §10.3 of the journal). Useful for catching word-count drift while iterating.

### 10.5 Animation choices

framer-motion handles all chart entrance animations: dots in the scatter stagger-fade in over ~600ms after the run completes; the donut animates from 0° to its final angle; bars draw left-to-right. No spinning, no bouncing — premium, intentional motion.

---

## 11. Skill integration — analysis panel implementation

The `analyze-uniqueness-run` skill describes an analytical workflow that's been validated end-to-end on the 2026-04-08 run. The playground reimplements that workflow as a backend route (`POST /poc/runs/:id/analyze`) so the analysis renders natively in the UI without invoking Claude Code.

### 11.1 What the route does

The analyze route is a pure function over `raw-data.json`. It does NOT call any LLM — all the LLM work happened during the run itself when the judge ran on every pair. The analysis route is structured extraction + pattern detection + diagnosis, all in TypeScript.

```ts
// packages/api/src/benchmark/uniqueness-poc/analysis.ts

export async function analyzeRun(runId: string): Promise<AnalysisResult> {
  const raw = await loadRawData(runId);
  return {
    headline: synthesizeHeadline(raw),
    stage6: analyzeStage6(raw),
    fabricationRiskDiagnoses: diagnoseFabricationRisk(raw),
    crossPairPatterns: findCrossPairPatterns(raw),
    judgeInconsistencies: findJudgeInconsistencies(raw),
    stage7: raw.narrativeStateTest ? analyzeStage7(raw) : null,
    intraTenant: analyzeIntraTenant(raw),
    costBreakdown: computeCostBreakdown(raw),
    nextSteps: prioritizeNextSteps(raw),
  };
}
```

### 11.2 Each analytical sub-function

**`synthesizeHeadline(raw)`** — Returns the one-paragraph distillation. Categorizes as "tight pass" / "comfortable pass" / "tight fail" / "fabrication alarm" based on the trinary verdict counts and the fidelity/presentation margins.

**`analyzeStage6(raw)`** — Per-pair table sorted by presentation similarity ascending. Returns `Array<{pair, cosine, rouge, fidelity, presentation, verdict, fidelityReasoning, presentationReasoning}>`.

**`diagnoseFabricationRisk(raw)`** — For each pair flagged as `fabrication_risk`, parses the divergence list and classifies each as:
  - `invention` — writer A makes a claim that conflicts with the source
  - `omission` — writer A doesn't mention something writer B does (judge over-fires)
  - `framing_disagreement` — both writers agree on facts but emphasize different conclusions

This is the heuristic from the SKILL.md rules and the 2026-04-08 analysis. Returns a structured diagnosis per pair with a recommended fix (tag tightening / source FA fix / judge calibration).

**`findCrossPairPatterns(raw)`** — Looks across all judged pairs for:
  - **Convergence centers**: identities or personas that appear in disproportionately many high-presentation-similarity pairs (the "Senior Strategist" finding from the latest run)
  - **Shared structural backbones**: scans the judge's reasoning fields for repeated phrases like "structural backbone", "same structural shape", "shared section order" — when ≥2 pairs surface the same phrase, it's flagged as a pattern

Returns named findings with quoted evidence.

**`findJudgeInconsistencies(raw)`** — For every pair, checks whether the trinary verdict matches the numeric arithmetic in the rubric (`distinct_products` requires presentation < 0.5, `reskinned_same_article` requires presentation ≥ 0.5). Pairs that violate this are flagged as inconsistencies. If none exist, the section is omitted from the analysis output (no boilerplate).

**`analyzeStage7(raw)`** — Computes both the numeric means (control/treatment) AND the verdict counts. When they disagree, surfaces it explicitly with the "verdict count is the load-bearing signal" framing.

**`analyzeIntraTenant(raw)`** — For Stage 2's intra-tenant matrix, lists pairs that fired the judge and identifies any reskin patterns (same identity-design problem the latest run surfaced with Senior Strategist).

**`computeCostBreakdown(raw)`** — Returns a structured cost breakdown by stage with the dominant bucket called out.

**`prioritizeNextSteps(raw)`** — Returns next-step recommendations grouped as `now-urgent` / `now-medium` / `parked`. Each item has a title, a what-to-change description, a file path, an expected impact estimate, and an effort estimate. Currently the heuristics for this are baked into the SKILL.md rules; the route translates them into structured suggestions.

### 11.3 Caching

`POST /poc/runs/:id/analyze` is idempotent. The first call runs the analysis and writes the result to `<runId>/analysis-cache.json`. Subsequent calls return the cache. The cache invalidates only if `raw-data.json` changes, which never happens for finished runs (the file is written once at run completion).

### 11.4 Diff mode

`GET /poc/runs/:id/analyze/diff?baseline=<otherRunId>` returns a `DiffAnalysisResult`:

```ts
interface DiffAnalysisResult {
  current: AnalysisResult;
  baseline: AnalysisResult;
  delta: {
    distinctCountDelta: number;
    reskinnedCountDelta: number;
    fabricationRiskCountDelta: number;
    fidelityMeanDelta: number;
    presentationMeanDelta: number;
    costDelta: number;
    failureKindShift: string | null;  // describes if the *kinds* of failures changed
  };
}
```

The UI uses the delta fields to render inline badges on the verdict cells, ghost dots on the scatter, and a delta indicator on the cost ticker.

---

## 12. Cost guards

### 12.1 Live ticker

The top bar shows a live cost ticker: **`$X.XX / $Y.YY`** where X is the running session total (across all runs since the page loaded) and Y is the user-set cap. The X side updates after every `cost_updated` SSE event during a run, and after every run completion.

### 12.2 Soft cap

The cap is a numeric input next to the ticker, default $20, persisted in `localStorage`. When the projected cost of the next run (estimated server-side from the request before generation begins) plus the running session total would exceed the cap, the **Run all** button and the per-tenant run buttons are disabled. A small warning text appears: *"Next run would exceed cap. Raise cap to continue."*

### 12.3 Hard server-side enforcement

The cap is sent in `PlaygroundRunRequest.costCapUsd`. Before starting a run, the server estimates the cost from the configured stages + tenant count + word counts (approximate based on token-rate × Sonnet/Opus/Haiku pricing). If the estimate exceeds the cap, the route returns 402 with a message; the UI surfaces it as the disabled-button reason. This prevents runaway client-side bugs from spending money.

### 12.4 Cost estimation

Approximate per-stage costs at default settings (from observed 2026-04-08 runs):

| Stage | Approx cost per tenant |
|---|---|
| 1 (FA Opus) | $0.22 (one-time, shared) |
| 2 (intra-tenant 6 identities) | ~$0.18 total (one-time) |
| 4 (reproducibility) | ~$0.09 (one-time) |
| 5 (persona A/B) | ~$0.06 (one-time) |
| 6 (cross-tenant) | ~$0.03 per tenant |
| 7 (narrative state) | ~$0.60 total + ~$0.07 per tenant |
| Judge calls | ~$0.005 per pair = ~$0.005 × C(N,2) |
| Embeddings | negligible |

The estimator scales each stage's cost by `targetWordCount / identity.targetWordCount.target` for tenant-specific output costs. Quick mode (200 words) cuts cross-tenant cost by ~70%.

### 12.5 Cost ticker delta

When a diff baseline is set, the cost ticker also shows the delta: `$1.39 / $20 (+$0.05 vs Run B)`.

---

## 13. Word count override

Per-tenant word count is the most-requested iteration knob (mentioned during round 3 of discovery). It lets the user run cheap experiments by reducing output length when the prose-level differences aren't the variable being tested.

### 13.1 Per-tenant slider

Each tenant card has a **word count slider** with:
- Range: **100 → 2000 words**
- Step: 50
- Default: the identity's preset target (e.g., 800 for InHouseJournalist)
- Numeric input next to the slider for keyboard precision
- Live cost preview to the right of the slider that updates as the user drags ("est. $0.12 → $0.04")

The override gets injected into the identity agent's user message at run time as a directive: *"Target word count: $N words. This is a hard limit, not a guideline."* The runner already supports a `targetWordCountOverride` field on `IdentityOutput`; the route reads `tenant.targetWordCount` and threads it through.

### 13.2 Quick mode global toggle

The top bar has a **Quick mode** segmented control: `[Off | 200 | 700 | 1500]`. Selecting a non-Off mode sets all tenant word count overrides to that value at once and marks the per-tenant sliders as "overridden by quick mode" (visual indicator). Unselecting returns each tenant to its previous individual override (which may be different per tenant).

Quick mode at 200 words cuts a 4-tenant Stage 6 run from ~$0.65 to ~$0.18. A warning tooltip on the toggle reminds the user: *"Output prose at 200 words may not be representative of production output. Use for tag/persona iteration only."*

### 13.3 Word count vs identity target

The Educator length-cap problem (journal §10.3 — Educator consistently produces 1300+ words against an 850 target) becomes visible in the word-count chart (§10.4). Users can confirm fixes to identity prompts by watching the chart go from "red overflow" to "green within target" without re-reading prose.

---

## 14. Run history sidebar + diff view

### 14.1 Sidebar layout

Left rail, ~280px wide, collapsible. Always visible by default. Contents:

```
┌── RUNS ───────────────┐
│ ┌───────────────────┐ │
│ │ Filter: [______]  │ │
│ │ Sort: [Date ▼]    │ │
│ └───────────────────┘ │
│                       │
│ ⭐ Pinned             │
│ ┌───────────────────┐ │
│ │ ⭐ Helix v3 base  │ │
│ │ 6/6 ✅ · $1.39    │ │
│ │ 2026-04-08 14:32  │ │
│ └───────────────────┘ │
│                       │
│ Recent                │
│ ┌───────────────────┐ │
│ │ Iran strike       │ │
│ │ 5/6 ✅ 1/6 🚨     │ │
│ │ $1.39 · 4 tenants │ │
│ │ 2026-04-08 15:12  │ │
│ └───────────────────┘ │
│ ┌───────────────────┐ │
│ │ FA invalid level  │ │
│ │ 6/6 ✅ · $0.42    │ │
│ │ 2026-04-08 14:48  │ │
│ │ 4 tenants · 200w  │ │
│ └───────────────────┘ │
│ ...                   │
│                       │
│ Diff baseline:        │
│ ┌───────────────────┐ │
│ │ "Helix v3 base"   │ │
│ │ [Clear baseline]  │ │
│ └───────────────────┘ │
└───────────────────────┘
```

Each row shows:
- ⭐ pinned indicator (if pinned)
- User label (if set) or first 30 chars of event title
- Verdict summary chips: `5/6 ✅ 1/6 🚨` (distinct / reskinned / fabrication counts)
- Cost
- Started timestamp
- Tenant count, quick-mode indicator if applicable

### 14.2 Interactions

- **Click a row** — loads that run into the playground state. The full configuration is restored (event body, stages, all tenant configs, all outputs, analysis panel). The playground is now in "viewing past run" mode; a new "Make this current" button at the top bar lets the user resume editing.
- **Right-click a row → "Set as diff baseline"** — marks that run as the baseline. All subsequent rendered analysis shows delta indicators against this baseline. The diff baseline indicator at the bottom of the sidebar shows which run is currently baselined.
- **Click the star icon on hover** — pins or unpins. Pinned runs sort to the top of the list.
- **Filter input** — substring match against label and event title.
- **Sort dropdown** — Date desc (default), Date asc, Cost asc, Cost desc, Verdict (passing first).

### 14.3 Diff view in the analysis panel

When a baseline is set:
- **Verdict cells in the per-pair table** get a small delta badge (`↑+1` / `↓−2` / `=`) showing the change since baseline
- **Scatter plot** renders baseline pairs as 50%-opacity ghost dots in their original colors, with arrows from baseline to current
- **Donut chart** shows delta numbers on each segment (`distinct: 5 (+1)`)
- **Cost ticker** shows `$1.39 / $20 (+$0.05 vs baseline)`
- **A "Delta vs <baseline label>" subsection** appears at the top of the analysis panel summarizing what changed

The diff view does not block the user from running new experiments — it's an overlay, not a mode.

### 14.4 Compare two runs deliberately

For a more deliberate side-by-side, the user can right-click a second run → "Open in compare view" which opens `/playground/uniqueness/compare?a=<runId>&b=<runId>` — a separate route that renders both runs' full analysis panels in two columns. This is for archival comparison; the inline diff view is for active iteration.

---

## 15. Export — CSV + JSON

### 15.1 CSV (the main thing)

The analysis panel has an **Export CSV** button. Clicking it downloads a flattened pairwise CSV of the current run:

```csv
run_id,run_label,started_at,event,persona_a,persona_b,identity,cosine,rouge_l,fidelity,presentation,verdict,divergence_count,divergence_kinds,fidelity_reasoning,presentation_reasoning
2026-04-08T15-12-59-996Z_iran-strike-2026-04-07,"",2026-04-08T15:12:59Z,"U.S. forces strike Iranian Revolutionary Guard positions in Syria",premium-capital-markets,fasttrade-pro,in-house-journalist,0.8743,0.1918,0.92,0.58,distinct_products,0,,"Both documents agree on all critical facts...","Both documents share a recognizable structural backbone..."
2026-04-08T15-12-59-996Z_iran-strike-2026-04-07,"",2026-04-08T15:12:59Z,"U.S. forces strike Iranian Revolutionary Guard positions in Syria",premium-capital-markets,helix-markets,in-house-journalist,0.9061,0.2398,0.92,0.38,distinct_products,0,,"Both documents agree on all material facts...","The two documents differ markedly in voice..."
...
```

One row per cross-tenant pair. Columns include both the numeric metrics and the structured verdict outputs from the judge. Reasoning fields are included so the user can search and sort in Excel/Sheets.

A second CSV button — **Export sessions CSV** — exports a flattened view of *all runs* in the history matching the current filter. One row per pair × per run, useful for time-series analysis of how iteration on tags affects the metrics.

### 15.2 JSON (the fidelity export)

A second button — **Download raw JSON** — directly downloads the run's `raw-data.json`. Same structured format the rest of the harness uses. Lets the user load it into pandas or feed it back to the rescore script.

### 15.3 No XLSX in v1

XLSX (real Excel multi-sheet workbook) is deferred. CSV opens cleanly in Excel and Sheets, and the implementation is trivial (no library needed). XLSX would require `exceljs` and additional formatting work; it's a v2 candidate if the user finds CSV ergonomics insufficient.

---

## 16. Implementation phasing inside v1

The user expanded v1 scope significantly during discovery (configurable N tenants, all stages, history + diffs + export). To avoid a 4-week "everything at once" build, v1 is sub-phased into three increments. Each ships independently.

### v1.0 — Minimal working playground (~3-5 days)

**Goal:** End-to-end playground that runs a Stage 6 cross-tenant matrix with the existing four broker presets and renders the prose for each tenant.

**Includes:**
- `packages/web/src/pages/PlaygroundUniqueness.tsx` skeleton
- Top bar: fixture picker + free-text body + "Run all" button
- Tenant grid: fixed 4-tenant 2×2 with persona dropdown only (no inline editing)
- Stage 6 only (no other stages)
- `POST /poc/runs` + `GET /poc/runs/:id/stream` SSE wired to a stripped-down `runUniquenessPoc` callback emitter
- 2 charts: scatter + verdict donut
- No history, no diff, no export, no quick mode, no cost guards beyond a static display

**Doesn't include:** anything in v1.1 or v1.2.

**Done when:** loading the page, picking iran-strike from the fixture dropdown, hitting "Run all", and seeing 4 tenant prose blocks + the scatter + the donut populate within ~90 seconds.

### v1.1 — The iteration loop (~3-4 days)

**Goal:** The playground becomes actually useful for tag iteration. All stages run, word counts are tunable, the cost loop is closed, and the analysis panel shows the structured findings the SKILL.md describes.

**Includes:**
- Stage checkboxes with dependency rules (§5.4)
- Per-tenant word count slider + global quick-mode toggle
- Cost ticker + soft cap + server-side hard enforcement
- Per-tenant identity dropdown (all 6 identities)
- Per-tenant tag pickers (multi-select with hover descriptions)
- Persona inline editing (in-session only, no saving)
- Configurable N tenants (1–6) via add/remove buttons
- All four charts in the analysis panel
- The full `analyzeRun` route + structured findings rendering
- Governing-rule warnings (per-tag risk classification + persona-level banner)

**Doesn't include:** persistence beyond the current session, history sidebar, diff view, export.

**Done when:** the user can tweak Helix's tags, hit run, and see the fabrication_risk verdict + the divergence diagnoses + the prioritized next steps in the analysis panel within 30 seconds of run completion.

### v1.2 — Persistence + export (~3-4 days)

**Goal:** Runs persist across sessions, history is browseable, diffs are inline, data can be exported for offline analysis.

**Includes:**
- `RunRepository` filesystem implementation
- `runs.index.json` + the rest of the persistence layer
- `Save as new preset` button on persona editor (writes new persona JSON files)
- Run history sidebar with filter/sort/pin/click-to-load
- Diff baseline selection + inline delta badges + scatter ghost dots
- `/playground/uniqueness/compare` separate compare route
- CSV + JSON export buttons
- Sessions CSV export (multi-run rollup)

**Doesn't include:** Postgres backend, XLSX, multi-event temporal scaffolding, real-time token-level streaming.

**Done when:** the user can run 5 experiments in a row, pin the best one, set it as the diff baseline, and export the results to CSV — all without losing state when they refresh the page.

### v2 candidates (deferred)

- Real-time token-level streaming (the dramatic letter-by-letter UX)
- Postgres-backed `RunRepository`
- XLSX export with multi-sheet formatting
- Multi-event temporal continuity (run iran-strike then iran-retaliation as a sequence)
- Persona save-as-preset that writes to a Postgres table instead of filesystem
- Tag prompt rewrites from inside the UI
- Team workspaces / multi-user
- Heatmap chart for the cross-tenant similarity matrix

---

## 17. Dependencies

### New packages to add to `packages/web/`

| Package | Purpose | Approximate weight |
|---|---|---|
| `recharts` | charts (§10) | ~50KB gzipped |
| `zustand` | top-level page state (§5.3) — lightweight alternative to Redux | ~3KB gzipped |
| `@radix-ui/react-dropdown-menu` | accessible dropdowns for the multi-select tag pickers | ~10KB gzipped |
| `@radix-ui/react-slider` | the word count slider | ~8KB gzipped |
| `@radix-ui/react-tooltip` | tag prompt hover tooltips, governing-rule warning | ~6KB gzipped |
| `@radix-ui/react-dialog` | persona save-as-preset modal, governing-rule explainer modal | ~12KB gzipped |
| `clsx` or `tailwind-merge` | conditional class composition | trivial |

framer-motion is already in the stack. React 19 + Vite 8 + Tailwind v4 are already in the stack.

### Backend (no new packages)

The Hono routes use only `@anthropic-ai/sdk` (already there), Zod (already there), Bun's built-in `node:fs`, and the runner module. SSE is implemented with native Hono stream helpers (no library). CSV generation is a 30-line utility (no library).

### Files to modify in `packages/api/`

| File | Change |
|---|---|
| `src/routes/poc.ts` | NEW — all the routes |
| `src/benchmark/uniqueness-poc/runner.ts` | additive — accept optional `RunCallbacks` argument |
| `src/benchmark/uniqueness-poc/run-repository.ts` | NEW — repository interface + filesystem impl |
| `src/benchmark/uniqueness-poc/analysis.ts` | NEW — the structured analytical sub-functions |
| `src/benchmark/uniqueness-poc/tags-risk-rules.ts` | NEW — the keyword scan for governing-rule warnings |
| `src/benchmark/uniqueness-poc/csv-export.ts` | NEW — CSV serialization utility |
| `src/index.ts` | mount the new routes |

---

## 18. Risks & open questions

### Risks

| Risk | Mitigation |
|---|---|
| The `analyzeRun` TypeScript reimplementation drifts from the SKILL.md as the skill evolves | Treat the SKILL.md as the source of truth; the route's behavior is a TypeScript translation that should be re-verified whenever the skill changes. The skill rules become unit-test cases for the route. |
| Backend SSE keepalive across long-running runs (10+ minute Stage 7) | Send a heartbeat event every 15s; the UI's EventSource auto-reconnects if it drops, and the runner can be made resumable via the run id (the routes already track in-progress runs by id). |
| Cost cap evasion via client-side tampering | Server enforces the cap, not the client. The client display is informational. |
| `runs.index.json` corruption from concurrent writes | Atomic write-temp-then-rename. Single-developer tool, very low concurrency in practice. |
| Tag risk classification has false positives (warns on safe tags) | The risk-rules file is editable and version-controlled; false positives get fixed by tweaking the keyword list. The warning is non-blocking so false positives don't actually prevent anything. |
| Word count override doesn't actually constrain the model (Sonnet ignores soft directives) | Empirically, Sonnet respects target word count directives within ~20%. Tag this as a thing to verify in v1.0 — if it fails, the override becomes "approximate target" rather than "hard cap." The Educator length-cap problem (1300 vs 850 target) is the existing data point. |
| Loading a past run's playground config doesn't restore exactly because tag definitions in `tags.ts` have changed since the run | Persisted `playground-config.json` snapshots only the tag *ids* selected, not the prompt text. If a tag was renamed or deleted, the loader shows a warning "this run used tag `foo` which no longer exists; closest match: `bar`." |

### Open questions

1. **Persona save-as-preset destination** — when the user saves a modified persona, should it go to `personas/<id>.json` (mutable filesystem dir, in the repo) or to a separate `playground-personas/<id>.json` directory (segregated from the canonical 4 brokers)? The spec assumes the latter to keep the canonical brokers untouched, but the user should confirm.
2. **Tag risk classification keyword list** — who maintains it? Initially Claude can populate it from the 2026-04-08 governing rule analysis, but the rules will need refinement as Helix iterates. The keyword list lives in `tags-risk-rules.ts` next to `tags.ts`; PRs touching either should touch both.
3. **Multi-run statistical aggregation** — once the user has 50+ runs in history, would it be useful to show a "tag effectiveness over time" chart at the playground level (not per-run)? This is v2 territory but worth flagging.
4. **What happens when a tenant's persona has *no* configured tags?** Currently the runner falls back to the persona's `preferredAngles`/`personalityTags` defaults from the JSON file. If the user explicitly clears all tags in the UI, the spec's intent is "use the persona defaults" — but maybe the user wants to test the no-tags baseline. Should the UI distinguish "no override" from "explicit empty"? Current spec says no — empty selection = use persona defaults.
5. **The free-text event body needs a topic id** — the current `NewsEvent` shape requires a `topicId` (e.g., `eurusd`) so the FA agent knows what market to analyze. When the user types a custom event body, the playground needs a topic picker. Add a topic dropdown to the top bar next to the fixture picker, sourced from the existing fixtures' topic ids. v1.0 can hard-code `eurusd`; v1.1 makes it a dropdown.

---

## 19. Success criteria for v1

v1 ships when, in a single session:

1. Albert can paste in a new news event body, configure 4 tenants with different personas + tag selections, hit Run, and see all 4 prose outputs appear within ~90 seconds at default word counts (or ~30 seconds in quick mode).
2. The analysis panel renders the per-pair scatter, the verdict donut, the cost stacked bar, and the word-count bar within 2 seconds of run completion.
3. The structured findings panel shows: the headline verdict, any fabrication_risk diagnoses with the divergence type triage (invention/omission/framing), the cross-pair patterns (convergence centers, structural backbones), any judge-vs-arithmetic inconsistencies, the cost breakdown, and 3–8 prioritized next steps with file paths and effort estimates.
4. Albert can pin a "good baseline" run, set it as the diff baseline, and watch subsequent experiments show inline delta badges showing what changed.
5. Albert can export the current run to CSV and open it in Excel without manual cleanup.
6. Albert can rerun the same configuration later by clicking the run in the history sidebar — full state restored.
7. The cost cap prevents accidental $50 sessions.
8. Across a typical 1-hour iteration session, the playground reduces 4 experiments × 15 minutes (60 min total in the CLI workflow) to 4 experiments × 90 seconds (6 min) — a 10× iteration speedup.

If those eight criteria are met, v1 is done.

---

## 20. Known issues from implementation (2026-04-09)

Gaps discovered **after** the spec was written and v1.0 / v1.1 / v1.2 shipped. These are not "risks" (pre-implementation concerns) or "open questions" (unresolved design decisions from discovery) — they are real behaviors that don't match the spec and need fixing in a future commit.

### 20.1 The stages selector lies about Stage 2

**Observed behavior.** The config card in Compare mode shows 6 stage checkboxes (`1 FA` locked / `2 6-id` / `4 repro` / `5 A/B` / `6 X-tenant` / `7 narr`). **Stage 2's checkbox has no effect.** The runner's top-level `runUniquenessPoc` function unconditionally runs Stages 1 → 2 → 3 before it even considers the optional `withCrossTenantMatrix` / `withReproducibility` / `withPersonaDifferentiation` / `withNarrativeStateTest` flags. Unchecking Stage 2 in the UI just tells the route not to render the Stage 2 outputs — the Stage 2 identity calls and Sonnet cost still happen invisibly.

**Why it matters.** The UI is dishonest to anyone reading it literally. A user who unchecks Stage 2 expecting cheaper runs will see the same cost. A new developer looking at the code will be confused about what the checkbox actually gates. More subtly, the "run N things, see what happens" mental model doesn't work when one of the Ns is a lie.

**Two options for the fix** — ordered from smallest to largest scope. The user's preference is **Option B** (long-term), with **Option A** as an optional short-term patch if it becomes annoying in the meantime.

#### Option A — honest independent toggles (short-term, ~20 minutes)

Relabel the UI to match actual behavior without changing any runner code:

- **Remove Stages 1 and 2 from the UI entirely.** They're always on; don't expose them. Replace them with a small muted info line at the top of the stages group: *"Stages 1–3 (FA core + identity adaptation + embeddings) always run. Diagnostics below are optional."*
- **Rename Stages 4/5/6/7 to descriptive labels,** dropping the stage numbers. Current → proposed:
  - `Stage 4 repro` → `Reproducibility diagnostic` (with tooltip: "Runs the journalist 3× on the same source to measure sampling noise. ~$0.09 added.")
  - `Stage 5 A/B` → `Persona A/B probe` (with tooltip: "Runs one identity with two different personas to measure the persona overlay's differentiation budget. ~$0.06 added.")
  - `Stage 6 X-tenant` → `Cross-pipeline matrix` (with tooltip: "The load-bearing cross-pipeline uniqueness test. ~$0.30–0.60 added. **Required** for the scatter/donut charts.")
  - `Stage 7 narr` → `Narrative-state A/B` (with tooltip: "Second-event A/B measuring whether injected narrative state changes cross-pipeline divergence. Requires the cross-pipeline matrix AND a fixture with a continuation event. ~$0.60 added.")
- Update `enabledStages` state to use semantic keys (`reproducibility` / `personaAB` / `crossTenant` / `narrativeState`) instead of stage numbers.
- **Scope:** `packages/playground/src/components/TopBar.tsx` only. No backend changes. No runner changes. Dependency rules (narrative-state requires cross-pipeline) stay the same.
- **Value:** honest UI with zero runner refactor.
- **Downsides:** still doesn't make the "skipped" stages actually cheap — Stage 2's ~$0.18 of identity calls still runs on every Compare run. The cost ticker is still honest-but-bloated.

#### Option B — true pipeline selector (long-term, ~1–2 hours)

Refactor the runner so stages are genuinely independently invokable, then expose a "stop-after-stage" pipeline selector in the UI.

**Backend refactor** (the real work):
- Split `runUniquenessPoc` into independently-invokable stage functions: `runCore` → `runIntraTenantIdentities` → `runEmbeddings` → `runCrossTenantMatrix` → `runNarrativeStateTest`. Each takes the prior stage's outputs as input.
- Expose a new higher-level entry point `runPipelineUpTo(opts, terminalStage)` that invokes stages sequentially and stops after `terminalStage` completes. The existing `runUniquenessPoc(opts)` becomes a thin wrapper that calls `runPipelineUpTo(opts, lastEnabledStage)`.
- The CLI keeps working identically (it currently calls `runUniquenessPoc` with everything enabled — still valid).
- `POST /poc/runs` threads the terminal stage from the request into the runner.
- `RunOptions` loses the `with*` boolean flags in favor of a single `terminalStage: "core" | "intra-tenant" | "cross-tenant" | "narrative-state"` field. The `with*` flags can stay as optional backwards-compat aliases during a deprecation period if needed.

**UI changes:**
- Replace the 6 checkboxes with a **single dropdown or segmented control**: `Run up to:` `[ Core FA ] [ Intra-tenant (6 identities) ] [ Cross-pipeline matrix ] [ Narrative state A/B ]`.
- Each option shows the incremental cost on hover: `+ $0.22` for core, `+ $0.18` for intra-tenant, `+ $0.30` for cross-pipeline, `+ $0.60` for narrative state.
- The dropdown enforces a linear pipeline — you can't skip stages, only stop earlier or later.
- The reproducibility diagnostic and persona A/B diagnostic don't fit the linear model — they're orthogonal probes, not pipeline stages. Promote them to a separate "Diagnostics" section with their own independent checkboxes alongside the pipeline selector.

**Scope:**
- `packages/api/src/benchmark/uniqueness-poc/runner.ts` — split into stage functions, add `runPipelineUpTo`, keep CLI-facing shim working
- `packages/api/src/routes/poc.ts` — request schema updated, route threads `terminalStage` into runner
- `packages/playground/src/components/TopBar.tsx` — replace stages checkboxes with pipeline selector + orthogonal diagnostics checkboxes
- `packages/playground/src/lib/types.ts` — mirror backend schema change
- `packages/playground/src/pages/PlaygroundUniqueness.tsx` — reducer state updated

**Value:**
- The mental model actually matches the code
- "Run up to core" costs ~$0.22 (Stage 1 only) — true Solo-mode-cheap runs available in Compare mode for cheap iteration
- "Run up to cross-pipeline" is the common case (the current default behavior)
- "Run up to narrative state" is the full-fat run
- Cost estimator becomes honest per selection
- The spec's §16 "Stage 2 cannot truly be skipped" limitation is resolved

**Downsides:**
- Runner refactor carries some risk — the CLI must keep producing byte-identical output, so the shim needs careful testing
- The spec's `enabledStages: Set<StageId>` state shape changes, which ripples through saved run configs (if the user loads an old run from history, the stages field needs backwards compat)
- 1–2 hours of focused work, single agent run

### 20.2 Plan going forward

**Decision 2026-04-09:** The user is continuing to play with the v1.2 playground as-is. They prefer **Option B** as the eventual fix because it matches the cleaner "where to stop" mental model, and they're fine with Option A being skipped entirely if we go straight to B. No urgency — the lie is documented now and the next time anyone touches the stages picker code, this is the shape of the fix.

**Priority:** Not blocking. Park this as a `v1.3` or `v1.4` item after the user has finished iterating on tags/personas via the current v1.2 playground and hits the point where the cost friction of the always-on Stage 2 actually annoys them.

**Implementation trigger:** Either the user explicitly requests it, or the next time someone touches `runUniquenessPoc` or `runner.ts` for an unrelated reason and the refactor is a natural extension of that work.

### 20.3 Missing "Stop run" / cancel button

**Observed gap.** Once the user clicks Run all (Compare) or Run solo, they're locked in for the full duration of the run — ~90s for Solo, ~270s for Compare, up to ~10+ minutes if Stage 7 narrative state is enabled. There is no way to cancel a run mid-flight. If the user notices a mistake (wrong fixture, wrong persona selection, typo in a tag, realized they wanted to flip to Solo first), their only options are (a) wait it out and pay for a run they don't want, or (b) kill the dev server, losing all other in-flight state.

**Why it matters.** Iteration is the whole point of the playground. The whole §19 success criterion is *"compress the CLI iteration loop from ~15 minutes to ~30 seconds."* A cancellable run is worth a lot in that loop — spotting a mistake 20s into a run and being able to stop immediately saves both API cost (~$0.40 per aborted mid-run) and ~4 minutes of wall clock per mistake. Over a typical 1-hour tag-iteration session with 6-10 runs, saving even 2 mistakes pays for the feature.

**Design**

**UI:**
- The Run button (in `TopBar.tsx`) becomes a toggle based on `runStatus`:
  - `idle` / `complete` / `error` → label `Run all` (or `Run solo`), primary accent style, click starts a run
  - `running` → label `Stop run`, danger/destructive style (red border + red text, not filled — subtle but unmistakable), click cancels
- While the run is cancelling, show a transient `Stopping…` state for ~300ms before transitioning back to `idle`
- Toast or inline banner on successful cancel: *"Run cancelled. Partial outputs preserved below."* — dismissable
- Tenant cards that were mid-generation render their status pill as `cancelled` with a muted grey color (new status alongside pending/generating/complete/error)
- The scatter + donut charts do NOT render for a cancelled run — there's nothing meaningful to show

**Backend (the real work):**

Cancellation through `AbortSignal` threading — this is how Node, Bun, and the Anthropic SDK all handle cancellation.

- `POST /poc/runs` creates an `AbortController` per run and stores `controller` alongside the run entry in the in-memory `runs` map
- New route `DELETE /poc/runs/:id` — looks up the run, calls `controller.abort()`, emits a final `run_cancelled` SSE event on the stream, closes the stream
- `RunCallbacks` gains an optional `signal: AbortSignal` parameter threaded through `runUniquenessPoc` → `runCrossTenantMatrix` → `runIdentity` → `client.messages.create({ ..., signal })` — the Anthropic SDK respects it and cancels in-flight HTTP requests
- Between stages, the runner checks `signal.aborted` and throws a `CancelledError` if set, so cancellation happens at stage boundaries even if no LLM call was currently in flight
- The `runSoloForPipeline` helper gets the same signal-threading treatment
- Costs for already-completed stages are still counted; in-flight Sonnet calls that abort mid-stream charge for input tokens only (Anthropic's billing behavior on aborted streams — verify empirically, but at worst it's a ~$0.02 savings floor)

**New SSE event:**
```ts
type PocSseEvent =
  | ...existing events...
  | { type: 'run_cancelled'; runId: string; reason: 'user_cancelled'; partialCostUsd: number }
```

**Frontend:**
- `DELETE /poc/runs/:id` wrapper in `packages/playground/src/lib/api.ts`
- New action `CANCEL_RUN` in the reducer: closes the EventSource, sets `runStatus: "cancelled"`, leaves tenant card outputs in whatever partial state they were in
- `TopBar.tsx` Run button click handler branches on `runStatus` — idle → `POST /poc/runs`, running → `DELETE /poc/runs/:id`
- New `cancelled` status on `TenantState.status` rendered with the muted grey color
- Partial-state preservation: a tenant that had already `complete`d before the cancel keeps its body visible; a tenant that was mid-`generating` clears to `cancelled` with no body

**Edge cases:**
- **Double-click on Stop** — idempotent, the second DELETE is a no-op
- **Cancel after natural completion** — the button naturally transitions to `Run all` when `run_completed` fires, so by the time the user could cancel, there's nothing to cancel. Frontend guards with `if (runStatus !== "running") return`
- **Cancel during SSE reconnect** — unlikely but possible. The client's EventSource auto-reconnects; if it does and the run is already marked cancelled, the reconnect picks up the `run_cancelled` event from the buffered queue
- **Cancelled runs and run history** — cancelled runs are NOT saved to the in-memory `runs` map's "completed" slot, and would NOT be persisted to `runs.index.json` when v1.2's persistence layer is implemented. They disappear on refresh
- **Kill the dev server during a cancel** — the abort signal can't propagate to a dead process. Restart leaves the run orphaned in the map. Acceptable for v1.

**Scope:**
- `packages/api/src/routes/poc.ts` — new DELETE route, AbortController per run, signal propagation
- `packages/api/src/benchmark/uniqueness-poc/runner.ts` — `RunCallbacks.signal?: AbortSignal` threading, `CancelledError` throws at stage boundaries, `client.messages.create({ ..., signal })` on every LLM call site
- `packages/playground/src/lib/types.ts` — new `run_cancelled` event, `cancelled` status on `TenantState.status`
- `packages/playground/src/lib/api.ts` — `cancelRun(runId)` fetch wrapper
- `packages/playground/src/pages/PlaygroundUniqueness.tsx` — `CANCEL_RUN` reducer action, SSE handler for `run_cancelled`, `runStatus === "cancelled"` rendering
- `packages/playground/src/components/TopBar.tsx` — Run button toggle on `runStatus`, danger styling for Stop
- `packages/playground/src/components/TenantCard.tsx` — new `cancelled` status pill color

**Effort:** ~1.5 hours for an agent run, single commit. Independent of §20.1/20.2 — can land before or after the stages-selector fix without conflict.

**Priority:** **Higher than §20.1 and §20.2.** Stop-run is immediately useful every session the user iterates. The stages selector is only annoying when cost or mental-model clarity become issues. If only one of §20.1/20.2/20.3 ships, it should be 20.3.

**Implementation trigger:** Next agent run on the playground branch, or inline if Claude and the user have the time. No prerequisites — can land on top of `005d85a` directly.

### 20.4 Live run visibility — activity log panel (SHIPPED 2026-04-09)

**Observation.** During a run the only UI signal was the `running` status pill in the topbar. The user had no sense of what stage the backend was in, which identities were mid-generation, or how far along the run was. Stage 1 (Opus FA core) takes ~60s of silence; Stage 2 (6 parallel Sonnet identity calls, invisible per §20.1) adds another ~90s of silence; only at ~3 minutes into a run did the tenant cards start transitioning to `generating`. The user was staring at a mostly-static screen wondering whether anything was happening.

**Shipped fix (inline commit, not via agent).** A new `ActivityLog` component in `packages/playground/src/components/ActivityLog.tsx` renders every incoming SSE event as a single mono-spaced row with `(+MM:SS)` elapsed time, color-coded by event kind (run / stage / tenant / judge / cost / error), and a live `● LIVE` pill + current-stage label in its header. The reducer in `PlaygroundUniqueness.tsx` was extended with `activityLog: ActivityEntry[]`, `runStartedAtMs: number | null`, and `currentStage: string | null` fields; the SSE case appends to the log on every event and tracks the latest `stage_started` label as the current stage. HMR-tolerance guards (`?? []`, `?? null`) in the reducer handle hot-reload state carry-over when the fields are added.

**What's visible during a live run now:**

```
Activity ● LIVE · Stage 1 — Opus FA core analysis                 23 events
+00:00  Run started (compare)                                    estimated $0.00
+00:00  Stage 1 — Opus FA core analysis
+01:07  Core FA analysis completed                                2593 tokens · $0.2189
+01:07  Cost updated                                              $0.2189
+01:07  Stage 2 — Identity adaptation (Sonnet ×6, parallel)
+03:12  Stage 6 — Cross-pipeline matrix (Sonnet ×N)
+03:12  Pipeline 1 started                                        premium-capital-markets
+03:12  Pipeline 2 started                                        fasttrade-pro
+03:48  Pipeline 2 completed                                      941w · 36.2s · $0.0304
+03:52  Pipeline 1 completed                                      912w · 40.1s · $0.0298
+03:58  Judge: Premium Capital Markets ↔ FastTrade Pro           fid 0.95 · pres 0.48 · distinct_products
+03:58  Run completed                                             $0.4128 · 238.1s
```

**Resolved but not perfect — follow-up polish items:**

1. **Stage 2 silence gap.** The ~2-minute silent window during Stage 2's 6 parallel identity calls is still visible because `runUniquenessPoc` doesn't emit per-Stage-2-call events to `RunCallbacks`. Fixable by threading the callback into Stage 2's `Promise.all` loop — same pattern used for Stage 6 tenant calls. ~30 minutes.
2. **No current-stage pill in the topbar proper.** The activity log header shows the current stage, but if the user scrolls the log out of view during a long run, they lose the stage awareness. Adding a small current-stage chip next to the cost ticker in the `AppShell` topbar would solve this. Requires threading `currentStage` through `AppShell` props. ~20 minutes.
3. **Persona-defaults indicator on tenant cards.** Surfaced by the user on 2026-04-09: when no angle/personality tags are selected, the pipeline runs with the persona's canonical defaults (from the JSON file). The tenant card should show a small muted chip like `📌 persona defaults` below the tag pickers when both override arrays are empty, so the user knows at a glance whether they're testing canonical or custom configs. ~15 minutes.
4. **Event grouping / collapse.** When a run fires 20+ events, the log scrolls. Grouping consecutive events of the same kind (e.g., all 6 Stage 2 completions into a collapsible "Stage 2 ×6") would keep the log scannable. Not urgent. ~45 minutes.

None of the four are blocking. They're small polish items that can land in one batch `chore(playground): activity log polish` commit when convenient. The biggest lift is #1 (Stage 2 callback threading) because it requires runner changes; the other three are pure frontend.

### 20.5 Format labels + terminology belong to the persona, not the identity (observed 2026-04-09)

**Observation.** The user ran a side-by-side comparison of two brokers both using the `Trading Desk` identity. The judge correctly scored the outputs as `distinct_products` on fidelity + presentation because the **prose** differed. But side-by-side, the outputs looked like the same template: both had `WHAT:`, `TRADE IDEA:`, `LEVELS:`, `STOP:` section headers; both used the same trading jargon (`bias`, `entry`, `stop`, `TP/SL`); both had the same structural rhythm (section header → one-line body → section header → one-line body). A human reader scanning both outputs would immediately perceive them as reskinned versions of the same piece, even though the judge says otherwise.

**Architectural diagnosis.** The identity system prompts in `packages/api/src/benchmark/uniqueness-poc/prompts/identities/*.ts` hardcode three things that should live at different layers:

1. **Format shape** (legitimately identity-owned): terse vs long-form, bullet vs prose, imperative vs pedagogical, word count range, output intent
2. **Section labels** (should be persona-owned): `WHAT` vs `THE SETUP` vs `POSITIONING` vs `CONTEXT`
3. **Domain terminology** (should be persona-owned): `bias` vs `directional stance` vs `view` vs `conviction`; `stop` vs `invalidation` vs `cut line` vs `risk floor`

Today the identity prompt owns all three, so every broker that picks Trading Desk inherits the same labels and the same jargon. The `ContentPersona` overlay controls voice/tone/tags/audience but has no mechanism to override section labels or terminology.

**The architectural principle this violates.** From `feedback_two_layer_generation.md` in memory: *"Content pipeline must split market reasoning from editorial shaping, never collapse them."* The two-layer principle needs to be extended one step further: **within editorial shaping, split *format* (identity) from *brand lexicon* (persona).** A `Trading Desk` is a format shape. What you call the sections and which words you use for "bias" is brand language.

Also violates the companion principle from `feedback_translation_architecture.md`: *"Reason naturally, adapt deterministically at every layer."* The identity agent should reason about market content naturally, using its own default lexicon. Brand-specific substitution should happen deterministically after the LLM writes, via the existing `glossary-patcher.ts` infrastructure — **which is already production code in `packages/api/src/pipeline/`, just not wired into the playground.**

**Connection to existing architecture.**

- `packages/api/src/pipeline/glossary-patcher.ts` — production glossary substitution layer, deterministic, already exists. The content-pipeline spec calls for it to run as part of the conformance stage (stage 9 per `2026-04-07-content-uniqueness.md` §5.2). The playground bypasses it entirely.
- `2026-04-07-content-uniqueness.md` §6 predicts *"the conformance engine adds ~0.05–0.10 cosine of deterministic differentiation via glossary substitution + regional variant rewrites + brand voice corrections"* — exactly the missing layer.
- `project_uniqueness_poc_2026_04_07.md` memory's roadmap item 7: *"Integrate the conformance engine as the downstream deterministic layer. Expected to push presentation similarity further without any fidelity cost."* — same item, different name.

**This observation is the empirical signal that conformance-engine integration should move up the priority order.** The user ran into the gap organically while iterating, not via a theoretical analysis. That's the best kind of priority signal.

#### Part A — section labels + termMap in `ContentPersona` (short-term, high-visible leverage)

Move section labels and domain terminology out of the identity system prompts and into the `ContentPersona` schema. Cheap, immediately visible, no conformance-engine integration required.

**Data model:**

```ts
interface ContentPersona {
  // ...existing fields
  /**
   * Per-identity section label and terminology overrides. Keyed by
   * identityId (e.g. "trading-desk", "in-house-journalist"). Identity
   * agents substitute {{section.foo}} / {{term.bar}} placeholders in
   * their system prompts against the merged map.
   *
   * Missing keys fall back to the identity's default labels/terms.
   */
  identityOverrides?: Record<string, {
    sections?: Record<string, string>;   // e.g. { "what": "POSITIONING", "trade_idea": "THE OPPORTUNITY" }
    terms?: Record<string, string>;      // e.g. { "bias": "directional stance", "stop": "invalidation" }
  }>;
}
```

**Identity system prompt changes:** each identity's prompt uses `{{section.X}}` / `{{term.Y}}` placeholders instead of hardcoded labels. Default values live in the identity definition (`IdentityDefinition.defaultSections` / `defaultTerms`). The runner merges the persona's overrides on top of the defaults before substituting into the prompt.

**Per-broker JSON file edits** — each of the 4 broker presets gets `identityOverrides` for at least Trading Desk, with distinctive section labels and terminology matching the broker's voice:

```json
// broker-a.json (Premium Capital Markets) — institutional register
"identityOverrides": {
  "trading-desk": {
    "sections": {
      "what": "POSITIONING",
      "trade_idea": "THE OPPORTUNITY",
      "levels": "EXECUTION RANGE",
      "stop": "INVALIDATION",
      "target": "PROFIT OBJECTIVES"
    },
    "terms": {
      "bias": "directional view",
      "entry": "initiation",
      "stop": "invalidation level",
      "TP": "profit target"
    }
  }
}

// broker-b.json (FastTrade Pro) — retail energetic register
"identityOverrides": {
  "trading-desk": {
    "sections": {
      "what": "THE PLAY",
      "trade_idea": "THE SETUP",
      "levels": "THE LINES",
      "stop": "STOP OUT",
      "target": "TARGETS"
    },
    "terms": {
      "bias": "lean",
      "entry": "get in",
      "stop": "cut it",
      "TP": "book it"
    }
  }
}

// broker-c.json (Helix Markets) — skeptical/contrarian register
"identityOverrides": {
  "trading-desk": {
    "sections": {
      "what": "WHERE THE CROWD IS",
      "trade_idea": "THE FADE",
      "levels": "PRESSURE POINTS",
      "stop": "WHERE IT DIES",
      "target": "WHERE IT RUNS"
    },
    "terms": {
      "bias": "view",
      "entry": "fade-in",
      "stop": "invalidation",
      "TP": "objective"
    }
  }
}

// broker-d.json (Northbridge Wealth) — educational/pedagogical register
"identityOverrides": {
  "trading-desk": {
    "sections": {
      "what": "Market Context",
      "trade_idea": "Client Positioning",
      "levels": "Key Price Zones",
      "stop": "Risk Threshold",
      "target": "Return Target"
    },
    "terms": {
      "bias": "directional stance",
      "entry": "position initiation",
      "stop": "risk threshold",
      "TP": "profit objective"
    }
  }
}
```

Similar blocks would be added for every identity each broker uses. In practice for v1 just doing Trading Desk for all 4 brokers proves the concept.

**UI addition** — each tenant card gains a small muted footer under the output area showing the effective section labels + term map for the current persona + identity combo:

```
Sections: POSITIONING / THE OPPORTUNITY / EXECUTION RANGE / INVALIDATION / PROFIT OBJECTIVES
Terms:    bias→directional view · entry→initiation · stop→invalidation level · TP→profit target
```

So the user can eyeball that two different brokers are actually using different templates before they even read the prose. This is cheap to render (just read from the persona JSON and the identity defaults) and makes the architectural split legible.

**Effort:** ~3–4 hours. Single agent run. Touches:
- `packages/playground/src/lib/types.ts` — `identityOverrides` field on `ContentPersona`
- `packages/api/src/benchmark/uniqueness-poc/types.ts` — same field server-side
- `packages/api/src/benchmark/uniqueness-poc/personas/*.json` — 4 broker files, each gets `identityOverrides.trading-desk` at minimum
- `packages/api/src/benchmark/uniqueness-poc/prompts/identities/trading-desk.ts` — convert hardcoded section labels to `{{section.X}}` placeholders, add `defaultSections` / `defaultTerms` to the identity definition
- `packages/api/src/benchmark/uniqueness-poc/runner.ts` — `runIdentity` merges persona overrides + identity defaults, substitutes placeholders in the user message
- `packages/playground/src/components/TenantCard.tsx` — small muted footer showing effective labels + terms

**Impact:**
- Your next two-Trading-Desk comparison produces visibly different section headers and terminology
- Zero extra LLM cost
- Presentation similarity score **may or may not** move meaningfully — section labels are a small fraction of the embedded tokens — but **perceived distinctness** improves dramatically
- If the judge's presentation score doesn't move despite the visible improvement, that's evidence the judge rubric has a blind spot for structural template overlap (worth documenting as a §20.6 judge-calibration item if it happens)

#### Part B — wire `glossary-patcher.ts` into the playground (medium-term, production-correct)

Integrate the existing production glossary-patcher as a post-LLM conformance stage in the playground run path. This is the architecturally correct version of Part A — deterministic, principled, matches production.

**Backend:**
- Extract / author a minimal `Glossary` per broker (`Record<term, preferredTerm>`). Can be seeded from Part A's `termMap` fields, then extended as needed.
- After each `runIdentity` call in `runCrossTenantMatrix` and `runSoloForPipeline`, pipe the output through `glossaryPatcher.patch(output, persona.glossary)`.
- Emit a new SSE event `conformance_applied` with a diff summary (`{replacements: [{from, to, count}]}`) so the activity log can show the substitutions.
- The patcher also supports a light LLM-backed brand-voice correction pass (~$0.002 per pipeline); make that an optional stage-level toggle.

**Frontend:**
- Add a "Conformance pass" toggle in the config card (next to the stages checkboxes) — default off while iterating on Part A, default on once it's stable.
- The activity log shows `+04:15 Conformance: 12 substitutions applied` when the stage runs.
- The tenant card's output area can optionally show a small "view pre-conformance" toggle that swaps between the raw identity output and the post-conformance output, so the user can audit what the patcher did.

**Effort:** ~4–6 hours. Single agent run. Touches the translation-engine side + the playground side.

**Impact:**
- The production architecture flows end-to-end through the playground for the first time
- Deterministic guarantees on brand vocabulary (the LLM can't slip and use "stop" when the broker's term is "invalidation")
- Spec estimate: −0.05 to −0.10 presentation similarity
- The playground becomes a faithful production simulator, not just an identity-agent tester

#### §20.5 Part C — brand voice conformance pass (implemented 2026-04-10)

**Status: IMPLEMENTED** on branch `worktree-poc-conformance-layer`, pending merge to `workstream-b-playground`.

The conformance pass was built and validated as a direct response to the structural-convergence problem observed in the 2026-04-10 test run (two Beginner Blogger outputs for Premium vs FastTrade had presentation similarity 0.52 — same narrative blueprint, same analogies, same section order despite different persona overlays).

**What was built:**
- `conformance-pass.ts` — dedicated brand voice enforcement specialist (Sonnet, not the translation-specific `correctStyle`). Rewrites each cross-tenant output to strictly match the persona's formality level, sentence length, hedging frequency, person preference, company background, and CTAs.
- `companyBackground` field on `ContentPersona` — array of factual company claims injected at both generation time (identity agent user message) and conformance time. Two shots at unique material that can never converge.
- Opt-in via `withConformancePass: true` on the compare run request. Default off.

**PoC results:**
| Metric | Without | With | Delta |
|---|---|---|---|
| Cosine | 0.9003 | 0.7916 | -0.1087 |
| Presentation | 0.52 | 0.32 | -0.20 |
| Fidelity | 0.95 | 0.95 | 0 |

**Relationship to Parts A and B:**
- Part A (section labels + termMap) is still relevant — structural formatting divergence is orthogonal to voice divergence.
- Part B (glossary patcher) is still relevant for per-tenant terminology substitution, which adds deterministic divergence on top of the LLM-driven voice divergence.
- Part C (this) addresses the voice/tone/style layer, which Parts A and B don't touch.
- All three stack: A (structural labels) + B (terminology) + C (brand voice) = three independent divergence layers.

#### Priority ranking across §20 (updated 2026-04-10)

1. ~~**§20.5 Part C — brand voice conformance pass**~~ — **DONE** (2026-04-10, pending merge)
2. **§20.3 — Stop run button** (~1.5h) — saves money + time every session
3. **§20.5 Part A — section labels + termMap in ContentPersona** (~3–4h) — structural formatting divergence
4. **§20.4 polish items** (~1.5h total for all 4) — small UX follow-ups
5. **§20.5 Part B — glossary patcher integration** (~4–6h) — deterministic terminology divergence
6. **§20.1 + §20.2 — stages selector refactor** — lowest urgency

---

**End of spec.**

*Generated 2026-04-08 by Claude (Opus 4.6) at the end of an extended discovery session with Albert. Captures the design decisions for a uniqueness PoC playground GUI, sub-phased v1.0 / v1.1 / v1.2 to ship value continuously. Implementation has landed as commits 540a9b0 (v1.0) / 8058f48 (SSE fix) / 337c0b8 (v1.1) / 14e9b47 (v1.2) / 005d85a (port fix) on `workstream-b-playground`. §20 added 2026-04-09 to track known issues discovered after implementation. §20.4 (activity log) shipped inline 2026-04-09. §20.5 (format labels + glossary) observed 2026-04-09 and queued. §20.5 Part C (brand voice conformance pass) implemented 2026-04-10 on `worktree-poc-conformance-layer` branch, pending merge — PoC validated (presentation 0.52 → 0.32). Updated 2026-04-10.*
