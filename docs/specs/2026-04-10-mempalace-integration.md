# MemPalace × FinFlow Integration Plan

**Date:** 2026-04-10
**Status:** Draft — not yet started
**Branch:** `workstream-b-mempalace` (worktree, branched from `workstream-b-playground`)
**Owners:** Albert Galera (decisions), Claude (drafting + implementation)
**Dependency:** [MemPalace](https://github.com/milla-jovovich/mempalace) — local memory system with ChromaDB + temporal knowledge graph + MCP tools

---

## 1. Goal

Give the FinFlow content pipeline **institutional memory** — the ability to
remember what each persona has previously written, what experiments have
revealed, and what testers have observed. Today every run starts from
scratch; with MemPalace, the pipeline builds on prior work like a real
editorial team would.

This is a **separate initiative from the FinFlow product roadmap**. It
lives in its own worktree and its own branch until validated with real
data. If any phase doesn't prove its value, it gets parked without
polluting the main dev branch or the live tester environment.

---

## 2. Why a worktree

The integration changes how the pipeline *generates content* (Phase 1
replaces the narrative state backend) and what context the FA Agent
receives (Phase 2 adds prior-analysis injection). Both can degrade output
quality if done wrong. The live LXC environment must stay stable for
testers while we experiment.

**Workflow:**
- `workstream-b-mempalace` branches from `workstream-b-playground` at the
  current tip
- All MemPalace integration work happens in the worktree on the Mac Studio
- Test runs execute locally (not on the LXC) using the dev API
- Compare outputs against baseline runs from the same fixtures
- Only merge to `workstream-b-playground` after validation pass
- Then promote to live via `live-promote` as usual

**Validation criteria per phase** (must pass before merging):
1. Typecheck clean, all tests pass
2. Run the same fixture 3 times with and without the integration → compare
   outputs qualitatively (do articles reference prior work? do they avoid
   repeated analogies? do scores regress?)
3. No latency regression > 10% on total run time (MemPalace queries should
   add < 500ms per run)
4. No increase in Anthropic API cost per run (MemPalace context injection
   should not significantly inflate prompt token counts)

---

## 3. Phases

### Phase 0 — Foundation (30 min)

**Goal:** Configure MemPalace to know about FinFlow's domain so subsequent
phases have a place to store and query data.

**What to do:**
1. Update `/Users/klorian/workspace/wordwideAI/mempalace.yaml` to include
   FinFlow-specific rooms under the existing `wordwideai` wing:

   ```yaml
   rooms:
     # ... existing rooms ...
     - name: narrative_state
       description: Per-persona temporal memory of what was written, positions taken, analogies used
       keywords: [narrative, persona, position, analogy, continuity]
     - name: run_findings
       description: Observations and conclusions from uniqueness PoC experiments
       keywords: [run, experiment, finding, observation, pattern]
     - name: market_context
       description: Core analyses and market interpretations from FA Agent runs
       keywords: [market, analysis, fa, eurusd, fed, ecb, oil, gold]
     - name: tester_feedback
       description: Tester observations from comparison.html and identities.html reviews
       keywords: [tester, feedback, observation, comparison, quality]
   ```

2. Run `mempalace mine` on the existing runs directory to seed the
   `run_findings` room with historical data:
   ```bash
   mempalace mine ~/workspace/wordwideAI/uniqueness-poc-runs --wing wordwideai
   ```

3. Verify with `mempalace search "structural overlap" --wing wordwideai`
   that past run data is queryable.

**Validation:** `mempalace status` shows drawers in the new rooms.
**No code changes.** This is pure configuration.

---

### Phase 1 — Narrative State via Knowledge Graph (2-3 hours)

**Goal:** Replace the in-memory narrative state with MemPalace's temporal
knowledge graph so personas remember what they've previously written
about a topic — across runs, across server restarts, across sessions.

**The problem today:**
- `narrative-state-store.ts` is an in-memory `Map<string, NarrativeState>`
- Dies on server restart
- No temporal awareness (can't answer "what did we say last month?")
- Can't detect contradictions (persona said "bullish" last week, data now
  says "bearish" — the pipeline doesn't know)

**What MemPalace replaces it with:**
- Knowledge graph triples: `(persona, predicate, object, valid_from, valid_to)`
- Predicates: `stated_position`, `covered_event`, `used_analogy`,
  `cited_data_point`, `recommended_action`, `used_structure`
- Queryable by time window: "what has Premium said about EUR/USD in the
  last 30 days?"
- Contradiction-aware: if a new event contradicts a prior position, the
  identity agent receives both the old position and the new data

**Architecture:**

```
runner.ts (before identity call)
    │
    ├─ mempalace_kg_query(persona, as_of=now)
    │   → returns: prior positions, analogies used, events covered
    │
    ├─ format as "editorial memory" context block
    │   → injected into identity agent's user message
    │
    └─ identity agent generates article with awareness of prior work
         │
         ├─ "As we noted in our April 3rd analysis..."
         ├─ (avoids football analogy because it was used last time)
         └─ "Our view has shifted since last week because..."

runner.ts (after identity call, in persist step)
    │
    ├─ extract key facts from the generated article
    │   → positions taken, analogies used, data points cited
    │
    └─ mempalace_kg_add(persona, "stated_position", "bearish EUR on ECB cut",
    │                    valid_from=now)
    └─ mempalace_kg_add(persona, "used_analogy", "savings account rate comparison",
                         valid_from=now)
```

**Implementation plan:**

1. Create `packages/api/src/benchmark/uniqueness-poc/mempalace-client.ts`
   — thin TypeScript client that calls MemPalace MCP tools via the CLI
   (`mempalace` command) or directly imports the Python module via Bun's
   FFI. Decision: **CLI subprocess** (same pattern as `claude-cli.ts`,
   proven, no FFI complexity). Commands:
   - `mempalace search --wing wordwideai --room narrative_state ...`
   - Knowledge graph: use the MCP server's HTTP endpoint or shell out
     to a small Python script that wraps `knowledge_graph.py`

2. Create `packages/api/src/benchmark/uniqueness-poc/narrative-memory.ts`
   — replaces `narrative-state-store.ts` with MemPalace-backed retrieval:
   ```typescript
   interface NarrativeMemory {
     getEditorialContext(personaId: string, topicId: string): Promise<string>;
     recordArticleFacts(personaId: string, topicId: string, article: string): Promise<void>;
   }
   ```
   `getEditorialContext` queries the knowledge graph for prior positions,
   analogies, and events. Returns a formatted context block that gets
   injected into the identity agent's prompt.

   `recordArticleFacts` extracts key facts from a generated article
   (position, analogies, data points, structure) and stores them as
   triples. Extraction is done via a small Haiku call with tool_use to
   produce structured output — cheap (~$0.001) and accurate.

3. Wire into `runner.ts` at the `runIdentity` call site:
   - Before: call `getEditorialContext`, append to user message
   - After: call `recordArticleFacts` in the persist step

4. Feature-gated via env var `FINFLOW_USE_MEMPALACE=1` (same pattern as
   `FINFLOW_USE_CLAUDE_CLI`). When unset, the pipeline behaves exactly
   as today. When set, narrative memory is active.

**What the identity agent sees (injected context):**

```
## Editorial Memory — Premium Capital Markets on EUR/USD

Your prior coverage of this topic (most recent first):

- 2026-04-03: Positioned BULLISH on USD vs EUR, citing Fed hawkish hold
  vs ECB June cut. Used football match analogy for "nothing happened but
  everything changed." Referenced dollar index five-month high.
  Structure: Event → Explanation → What It Means For You.

- 2026-03-22: Covered OPEC+ cut, noted second-order EUR/USD impact via
  energy import channel. Used "terms of trade" framing. Referenced
  ECB's impossible position.

GUIDELINES:
- Do NOT repeat analogies from prior coverage (football match already used)
- If your position has changed, acknowledge the shift explicitly
- Reference prior coverage where relevant ("As we noted on April 3rd...")
- Vary your structural approach — prior articles used the same 3-section
  structure, try a different framing
```

**Validation:**
- Run fed-rate-pause fixture twice with MemPalace enabled
- First run: no prior context (clean slate)
- Second run: should reference the first run's positions, avoid repeated
  analogies, vary structure
- Compare second-run output against a second run *without* MemPalace
  (current behavior) — the MemPalace version should show temporal
  coherence; the baseline should show identical structure and repeated
  analogies

**Risks:**
- **Prompt inflation:** the editorial memory context adds tokens to every
  identity call. Budget: max 500 tokens of context per call (truncate
  older entries if the history is long). At Sonnet pricing this is ~$0.002
  per article — negligible.
- **Stale data:** if the knowledge graph has wrong facts from a buggy
  extraction, the identity agent will reference them. Mitigation:
  `recordArticleFacts` uses a structured Haiku call with strict schema
  validation, and each fact has a `confidence` score. Low-confidence
  facts are excluded from the editorial context.
- **Latency:** MemPalace queries are local (ChromaDB + SQLite on the Mac
  Studio). Expected: < 100ms per query. The subprocess spawn for the CLI
  adds ~200ms. Total: < 300ms per identity call, which is noise against
  the 20-60s LLM generation time.

---

### Phase 2 — Market Context Memory for FA Agent (1-2 hours)

**Goal:** Give the FA Agent dynamic context from prior analyses of similar
events, replacing the static `topicContext` field in fixture files.

**Depends on:** Phase 0 (rooms configured), Phase 1 (mempalace-client.ts
exists and is tested).

**What to do:**

1. After each run, store the core analysis in MemPalace:
   ```typescript
   mempalaceAddDrawer({
     wing: "wordwideai",
     room: "market_context",
     content: coreAnalysis.body,
     sourceFile: runId,
   });
   ```

2. Before calling the FA Agent, search for prior analyses of the same
   topic:
   ```typescript
   const priorAnalyses = await mempalaceSearch({
     query: event.title,
     wing: "wordwideai",
     room: "market_context",
     limit: 3,
   });
   ```

3. Inject the top 1-2 prior analyses (truncated to ~300 tokens each) into
   the FA Agent's system prompt as "prior institutional analysis":
   ```
   ## Prior Analysis (for context, not repetition)

   On 2026-04-03, our analysis of a similar Fed decision concluded:
   [truncated prior core analysis]

   Use this as background context. Do NOT repeat the same conclusions
   verbatim — analyze the NEW event on its own merits, referencing
   prior analysis only where the comparison is genuinely informative.
   ```

**Validation:**
- Run fed-rate-pause, then run us-cpi-surprise (related topic, different
  event type). The second run's FA Agent should reference the Fed context
  from the first run when relevant.
- Verify the FA Agent doesn't just parrot the prior analysis — it should
  build on it, not copy it.

**Risks:**
- **Context contamination:** prior analysis could bias the FA Agent toward
  repeating old conclusions instead of analyzing new data fresh. Mitigation:
  explicit instruction in the prompt ("analyze on its own merits") + limit
  to 1-2 prior analyses + truncation.
- **Cross-topic bleeding:** searching by event title might return analyses
  from unrelated events that happen to use similar words. Mitigation:
  filter by `topicId` (not just semantic search), and set a minimum
  similarity threshold (e.g., 0.7).

---

### Phase 3 — Automated Run Findings (1 hour)

**Goal:** After every run, automatically extract and store the key findings
in MemPalace so the experiment log builds itself.

**Depends on:** Phase 0 (rooms configured).

**What to do:**

1. In `persist.ts`, after writing `raw-data.json`, call a new
   `recordRunFindings(result)` function that:
   - Extracts structural patterns (section heading overlap across outputs)
   - Extracts similarity anomalies (any pair with presentation > 0.5 or
     cosine > 0.9)
   - Extracts conformance results (what changed, what didn't)
   - Stores each finding as a MemPalace drawer in
     `wing: wordwideai, room: run_findings`

2. Also store knowledge graph triples for causal relationships:
   ```
   kg.add_triple(runId, "produced_verdict", "DISTINCT", valid_from=now)
   kg.add_triple(runId, "used_fixture", event.id, valid_from=now)
   kg.add_triple(runId, "mean_presentation", "0.32", valid_from=now)
   ```

3. Before starting a new run in `runner.ts`, query MemPalace for prior
   findings about the same fixture/persona combination and log them to
   the console (informational, not injected into prompts yet).

**Validation:**
- Run 3 different fixtures, then `mempalace search "structural overlap"
  --wing wordwideai --room run_findings` → should return findings from
  all 3 runs.
- `mempalace_kg_timeline` for a fixture ID → should show all runs that
  used it, with their verdicts.

---

### Phase 4 — Tester Feedback Intake (1 hour)

**Goal:** Give testers a way to record observations that persist across
sessions and are queryable before the next iteration.

**Depends on:** Phase 0 (rooms configured).

**What to do:**

1. Add a feedback form to `comparison.html` and `identities.html`:
   - Small text input at the bottom of each pair comparison
   - "What do you notice about this pair?" placeholder
   - Submit button → POST to `/poc/feedback`

2. New endpoint `POST /poc/feedback` in `poc.ts`:
   ```typescript
   app.post("/feedback", async (c) => {
     const { runId, pairId, observation, tester } = await c.req.json();
     // Write to MemPalace
     await mempalaceAddDrawer({
       wing: "wordwideai",
       room: "tester_feedback",
       content: `[${tester}, ${new Date().toISOString()}, ${runId}, ${pairId}] ${observation}`,
       sourceFile: runId,
       addedBy: `tester:${tester}`,
     });
     // Also write to a local feedback.json in the run directory for offline access
     // ...
     return c.json({ success: true });
   });
   ```

3. Before starting an iteration session (human-driven, not automated),
   query: `mempalace search "savings account analogy" --wing wordwideai
   --room tester_feedback` → surfaces every tester observation about
   that pattern.

**Validation:**
- Submit feedback from comparison.html on the live LXC
- Query MemPalace from the Mac Studio → feedback appears
- Feedback persists across sessions

---

## 4. What is NOT in scope

- **Replacing raw-data.json with MemPalace.** Run output files are the
  source of truth. MemPalace indexes and enriches them, doesn't replace.
- **Using MemPalace for the pipeline inspector page.** The history API +
  raw JSON approach is simpler and more appropriate.
- **AAAK compression for financial data.** Lossy compression is for
  personal memories, not market data where every number matters. Financial
  content stored as verbatim drawers.
- **Persona evolution tracking.** Nice-to-have but low priority — the
  knowledge graph could track tag/config changes, but `git log` on the
  persona JSON files already does this. Parked.
- **Cross-wing intelligence.** Speculative. MemPalace's tunnel detection
  is interesting but not solving a current problem. Parked.

---

## 5. Infrastructure considerations

### MemPalace on the LXC

Phases 1 and 2 change how the pipeline generates content. If we eventually
want this on the live LXC (not just the Mac Studio), we need:

- Python + MemPalace installed on the LXC
- ChromaDB + SQLite data directory on the ZFS volume (persistent)
- The `mempalace-client.ts` subprocess calls work identically on Linux

**Decision: defer LXC deployment until Phase 1 is validated on the Mac.**
The worktree runs on the Mac Studio where MemPalace is already installed.
Only after the validation criteria pass (see §2) do we install MemPalace
on the LXC and merge to `workstream-b-playground`.

### Token budget

| Phase | Additional tokens per run | Additional cost per run |
|-------|--------------------------|------------------------|
| Phase 1 (narrative context) | ~500 tokens × N personas | ~$0.002 × N |
| Phase 1 (fact extraction) | ~200 tokens × N Haiku calls | ~$0.001 × N |
| Phase 2 (prior FA context) | ~600 tokens × 1 Opus call | ~$0.01 |
| Phase 3 (run findings) | 0 (post-run, no LLM) | $0 |
| Phase 4 (feedback) | 0 (human input, no LLM) | $0 |

Total: ~$0.03 per run with 4 personas. Negligible against the current
~$0.50 per run.

### Latency budget

| Phase | Additional time per run | Notes |
|-------|------------------------|-------|
| Phase 1 (query) | ~300ms × N personas | CLI subprocess + ChromaDB |
| Phase 1 (store) | ~200ms × N personas | Post-generation, non-blocking |
| Phase 2 (query) | ~300ms × 1 | Before FA Agent |
| Phase 2 (store) | ~200ms × 1 | Post-generation, non-blocking |
| Phase 3 | ~500ms | Post-run, non-blocking |
| Phase 4 | 0 | Human-initiated |

Total query-path latency: ~1.5s for a 4-persona run. Against a ~200s
total run time, this is < 1%. Negligible.

---

## 6. Success metrics

After Phase 1 + Phase 2 are validated and merged:

1. **Temporal coherence:** second-run articles reference first-run
   positions when the same topic recurs. Current behavior: no reference.
2. **Analogy diversity:** repeated runs on the same fixture produce
   different analogies/metaphors. Current behavior: same analogies.
3. **Structural diversity:** repeated runs vary their section structure.
   Current behavior: identical 3-section backbone.
4. **No quality regression:** judge scores (fidelity, presentation) do
   not worsen compared to baseline runs without MemPalace.
5. **Experiment velocity:** findings from past runs are queryable in
   < 1 second. Current behavior: grep through session journals.
6. **Tester feedback loop:** observations persist and surface in the next
   iteration session without manual relay.

---

## 7. Timeline

| Phase | Effort | Depends on | Merge condition |
|-------|--------|------------|-----------------|
| 0 — Foundation | 30 min | Nothing | Immediate (config only) |
| 1 — Narrative State | 2-3 hours | Phase 0 | 3-run validation pass |
| 2 — Market Context | 1-2 hours | Phase 1 | 3-run validation pass |
| 3 — Run Findings | 1 hour | Phase 0 | `mempalace search` returns findings |
| 4 — Tester Feedback | 1 hour | Phase 0 | Feedback round-trips Mac↔LXC |

Phases 0 and 3 can happen on `workstream-b-playground` directly (no
content generation changes). Phases 1 and 2 must stay in the worktree
until validated. Phase 4 can go either way — the `/poc/feedback` endpoint
is harmless even without MemPalace backing it.
