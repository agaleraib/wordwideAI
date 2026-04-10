# Advisor Pipeline Loop — Replace TypeScript-Orchestrated Specialist Loop with Sonnet Agentic Loop

## Overview

The current translation pipeline orchestrates corrections via TypeScript: the quality arbiter (Haiku) picks which of 4 specialists to run, each specialist (Sonnet) runs sequentially, a glossary guard re-applies terms after each specialist, then Opus re-scores all 7 LLM-judge metrics. This works, but it is structurally expensive: each specialist receives the full context (source + translation + profile) independently, and re-scoring uses Opus for what is essentially a progress check.

This spec replaces the inner correction loop with a **single Sonnet agentic session** that has tools for scoring and glossary enforcement. Sonnet acts as a unified specialist executor — fixing terminology, style, structural, and linguistic issues holistically — and calls tools to check its own progress. Haiku handles in-loop re-scores (progress checks), while Opus is reserved for the initial score and a mandatory final score after the loop exits.

**Who:** FinFlow engineering team (internal architecture change, no user-facing API changes).

**Problem:** The current loop duplicates context across 4 specialist calls and uses Opus for in-loop re-scoring. This spec cuts specialist calls from 4 to 1 and re-scoring from Opus to Haiku, while preserving (or improving) final output quality as validated by a mandatory final Opus score.

**Baseline:** The current pipeline on `master` with Sonnet specialists (already downgraded from Opus via the advisor-tool PoC).

## Architecture

### Current Pipeline (correction loop only)

```
gate fails
  for round in 1..maxRounds:
    arbiter (Haiku) → decides which specialists to run
    for specialist in [terminology, style, structural, linguistic]:
      specialist (Sonnet) — receives full context, returns corrected text
      glossary guard — re-applies cached replacements
    re-score (Opus, 7 LLM-judge calls)
    gate check
  exhausted → HITL
```

**Cost per correction round (current):**
- 1 Haiku call (arbiter)
- 1-4 Sonnet calls (specialists, each receiving ~full context)
- 7 Opus calls (LLM-judge re-scoring)
- Deterministic glossary guard (free)

### Proposed Pipeline (advisor loop)

```
gate fails
  advisor session starts (Sonnet, multi-turn with tools)
    system prompt: unified specialist rules + tool descriptions
    user message: source, translation, profile, scorecard, failed metrics
    
    for turn in 1..N:
      Sonnet analyzes failures, produces corrected text
      Sonnet calls score_translation tool → TypeScript runs Haiku re-score
      Sonnet calls enforce_glossary tool → TypeScript runs deterministic patcher
      Sonnet evaluates progress, decides: continue fixing or submit
      
    Sonnet calls submit_result tool → returns corrected text + reasoning
  
  final re-score (Opus, 7 LLM-judge calls) — authoritative quality gate
  gate check
  if still failing and rounds remain → new advisor session
  exhausted → HITL
```

**Cost per correction round (proposed):**
- 1 Sonnet session (multi-turn, but context sent once, not 4x)
- 1-3 Haiku scoring calls (in-loop progress checks, ~7 metrics each)
- 1 deterministic glossary enforcement per tool call (free)
- 7 Opus calls (final re-score only, same as current but runs once per loop exit, not once per round)

### Key Architectural Decisions

1. **TypeScript stays in control.** The Sonnet session uses standard Anthropic tool_use. TypeScript executes every tool call (scoring, glossary). Sonnet never has direct access to external systems.

2. **Sonnet decides iteration count.** Within a single advisor session, Sonnet can call score and glossary tools multiple times. The `maxToolRounds` parameter caps total tool calls to prevent runaway sessions.

3. **Outer loop is preserved.** The engine's `for round in 1..maxRounds` loop wraps the advisor session. If the final Opus re-score still fails, a new advisor session can start (with the updated scorecard as input). This preserves the existing HITL escalation logic.

4. **Glossary guard is a tool, not post-processing.** Instead of running the glossary guard silently after each specialist, Sonnet explicitly calls `enforce_glossary` and sees the results. This lets Sonnet learn from glossary corrections and avoid re-introducing violations.

## Data Model

No new entities. Changes to existing structures:

### `AdvisorLoopResult` (new internal type)

```ts
interface AdvisorLoopResult {
  correctedText: string;
  reasoning: string;
  toolCallLog: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
  }>;
  haikuScores: Array<{
    roundNumber: number;
    scorecard: Scorecard;
  }>;
  usage: {
    sonnetInputTokens: number;
    sonnetOutputTokens: number;
    haikuInputTokens: number;
    haikuOutputTokens: number;
  };
  turnCount: number;
}
```

### `EngineResult` (unchanged)

The engine result type does not change. The advisor loop is an implementation detail of the correction phase. `revisionCount` maps to the number of outer-loop rounds that completed a final Opus re-score.

### `AuditEntry` (unchanged schema)

Advisor sessions emit audit entries with `agent: "AdvisorLoop (Sonnet)"` and the `reasoning` field contains a summary of all tool calls made during the session. Individual tool calls are not separate audit entries — they are nested in the `toolCallLog` within the advisor session's audit entry.

## Requirements

### Phase 1: Advisor Loop Core

#### 1.1 — Multi-turn tool-use conversation runner

A new function in `anthropic.ts` that manages a multi-turn Sonnet conversation with multiple tools. Unlike `runAgentStructured` (single turn, forced tool choice), this function:

- Starts a conversation with system prompt + user message.
- When the model emits `tool_use` blocks, TypeScript executes the tool and appends a `tool_result` message.
- The conversation continues until the model calls the terminal tool (`submit_result`) or a `maxToolRounds` limit is reached.
- Returns the final result from `submit_result` plus accumulated usage and tool call log.

**Signature:**
```ts
export async function runAgentLoop<T>(
  config: AgentConfig,
  userMessage: string,
  tools: LoopTool[],
  terminalToolName: string,
  parseTerminalResult: (input: Record<string, unknown>) => T,
  options?: { maxToolRounds?: number },
): Promise<{
  result: T;
  toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: Record<string, unknown>; durationMs: number }>;
  usage: { inputTokens: number; outputTokens: number };
  turnCount: number;
}>
```

Where `LoopTool` wraps tool schema + an executor function:
```ts
interface LoopTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
```

- When `maxToolRounds` is reached without `submit_result`, the function returns the last corrected text from the most recent `submit_result`-like output, or throws if no correction was produced.
- Error case: if a tool execution fails, the error message is returned as the `tool_result` content so Sonnet can adapt. The loop does not abort on tool errors.
- Error case: if the Anthropic API call fails mid-conversation, throw immediately. The outer engine catches this and falls back to the current specialist pipeline.

**File:** `packages/api/src/lib/anthropic.ts` (modify)

#### 1.2 — Tool definitions for the Sonnet advisor session

Three tools available to the Sonnet session:

**`score_translation`** — Triggers a Haiku re-score of the current text.

```ts
{
  name: "score_translation",
  description: "Score the current translation against all 13 quality metrics. Returns the full scorecard with pass/fail per metric and aggregate score. Use this after making corrections to check your progress.",
  input_schema: {
    type: "object",
    properties: {
      corrected_text: {
        type: "string",
        description: "The current corrected translation text to score."
      }
    },
    required: ["corrected_text"]
  }
}
```

Executor: calls `scoreTranslationWithUsage(sourceText, correctedText, profile, language, "haiku")`. Returns the scorecard as a serialized object. The 6 deterministic metrics run in code; the 7 LLM-judge metrics run on Haiku.

- The `scoreLlmMetrics` function already accepts a `modelTier` parameter. Passing `"haiku"` is the only change needed.
- Deterministic metrics (glossary compliance, term consistency, untranslated terms, numerical accuracy, formatting preservation, paragraph alignment) are unaffected — they run in code regardless of model tier.

**`enforce_glossary`** — Runs the deterministic glossary patcher on the current text.

```ts
{
  name: "enforce_glossary",
  description: "Run deterministic glossary enforcement on the current translation. Returns the corrected text with glossary terms fixed, plus a list of replacements made. Call this after making corrections to ensure glossary compliance.",
  input_schema: {
    type: "object",
    properties: {
      corrected_text: {
        type: "string",
        description: "The current corrected translation text to enforce glossary on."
      }
    },
    required: ["corrected_text"]
  }
}
```

Executor: calls `enforceGlossary(sourceText, correctedText, glossary, language, { skipGrammarFix: true })`. Returns `{ correctedText, replacements, complianceBefore, complianceAfter }`. Grammar micro-fix is skipped (Sonnet can handle grammar in-context).

**`submit_result`** — Terminal tool. Ends the advisor session.

```ts
{
  name: "submit_result",
  description: "Submit the final corrected translation. Call this when you believe all fixable issues have been addressed, or when further iterations are unlikely to improve the score.",
  input_schema: {
    type: "object",
    properties: {
      corrected_text: {
        type: "string",
        description: "The COMPLETE final corrected translation."
      },
      reasoning: {
        type: "string",
        description: "Summary of all corrections made and remaining issues that could not be resolved."
      },
      remaining_issues: {
        type: "array",
        items: { type: "string" },
        description: "List of metric failures that could not be fixed, if any."
      }
    },
    required: ["corrected_text", "reasoning", "remaining_issues"]
  }
}
```

Executor: no side effects. Returns the parsed result to `runAgentLoop` which exits the conversation.

- `tool_choice` must be `{ type: "auto" }` for the entire conversation — Sonnet must freely choose which tool to call at each turn.
- `maxToolRounds` default: 6 (allows ~2 cycles of correct-score-glossary before forcing submission).

**File:** `packages/api/src/pipeline/advisor-loop.ts` (new)

#### 1.3 — Unified specialist system prompt

The system prompt for the Sonnet advisor session must encode the rules currently split across 4 specialist system prompts, while emphasizing holistic correction:

```
You are a financial translation quality specialist. You fix translation issues across all domains: terminology, style, structure, and linguistics — in a single unified pass.

CORRECTION DOMAINS:
1. TERMINOLOGY: Glossary compliance, term consistency, untranslated terms.
2. STYLE: Formality level, sentence length, brand voice adherence.
3. STRUCTURAL: Formatting preservation, numerical accuracy, paragraph alignment.
4. LINGUISTIC: Fluency, meaning preservation, regional variant consistency.

RULES:
- Fix ALL domains holistically. Do not fix style at the expense of terminology.
- NEVER change glossary terms. If a specific financial term appears in the glossary, use the glossary form exactly.
- NEVER change numbers, percentages, prices, dates, or any numerical data.
- NEVER add or remove paragraph breaks, bullet points, or headers.
- When fixing fluency, preserve the meaning exactly. Rephrase for naturalness, do not alter semantics.
- When fixing formality, adjust tone without changing technical terminology.
- Regional variant must be consistent throughout (e.g., all vosotros OR all ustedes, never mixed).

WORKFLOW:
1. Analyze the scorecard to understand which metrics failed and why.
2. Make corrections addressing ALL failed metrics in a single pass.
3. Call enforce_glossary to ensure your corrections did not break glossary compliance.
4. Call score_translation to check your progress.
5. If metrics still fail and you can identify further improvements, iterate.
6. When satisfied or when further changes risk regressions, call submit_result.

IMPORTANT: Each score_translation call costs tokens. Do not score after trivial changes. Make substantive corrections, then check.
```

The user message includes: source text, current translation (post-initial-glossary-patcher), full client profile (tone, glossary, brand rules, regional variant), the current scorecard with all 13 metrics, and detailed evidence for failed metrics.

**File:** `packages/api/src/pipeline/advisor-loop.ts` (new, same file as 1.2)

#### 1.4 — Engine integration

Replace the inner specialist loop in `translation-engine.ts` with the advisor session:

**Current flow (lines 220-425):**
```
for roundNum in 1..maxRounds:
  arbiter → specialists in sequence → glossary guard → Opus re-score → gate
```

**New flow:**
```
for roundNum in 1..maxRounds:
  advisorResult = runAdvisorLoop(sourceText, currentText, profile, language, scorecard, glossaryPatchResult)
  currentText = advisorResult.correctedText
  
  // Final Opus re-score (authoritative)
  scoringResult = scoreTranslationWithUsage(sourceText, currentText, profile, language, "opus")
  scorecard = scoringResult.scorecard
  
  gate check → if passed, return
  
  // If not passed, previousScorecard = scorecard, continue outer loop
```

- The quality arbiter (`planCorrections`) is no longer called. The advisor session itself decides what to fix based on the scorecard. The arbiter's HITL escalation logic moves into the advisor session's `remaining_issues` — if the advisor reports it cannot fix critical metrics, the engine escalates.
- The glossary guard post-specialist logic is removed from the engine. The advisor session handles glossary enforcement via the `enforce_glossary` tool.
- HITL escalation: if the advisor's `remaining_issues` includes metrics that regressed or are critically low (meaning_preservation < 60), the engine can escalate early without waiting for maxRounds.

**File:** `packages/api/src/pipeline/translation-engine.ts` (modify)

#### 1.5 — Feature flag

The advisor loop is gated by `FINFLOW_PIPELINE_LOOP=1`. When unset or `"0"`, the engine uses the current specialist pipeline. This allows safe rollback without code changes.

- Read at engine invocation time, not cached.
- Error case: unrecognized values log a warning and default to `"0"` (current pipeline).

**File:** `packages/api/src/lib/advisor-config.ts` (modify existing file from advisor-tool PoC)

### Phase 2: Haiku Re-Scoring Validation

#### 2.1 — Haiku vs Opus scoring comparison mode

Before trusting Haiku for in-loop scoring, we need data proving Haiku scores correlate with Opus scores. Add a comparison mode to the scoring agent:

- When `FINFLOW_SCORE_COMPARE=1`, `scoreTranslationWithUsage` runs both Haiku and Opus LLM-judge calls and logs the results side-by-side.
- Comparison output: per-metric score delta (Haiku - Opus), aggregate delta, and whether the gate decision (pass/fail) matches.
- Logged to `FINFLOW_SCORE_COMPARE_DIR` (default `./score-comparisons/`), one JSON file per comparison.

This mode is for validation only. In production, only one model tier runs.

- The comparison must use the same prompt for both models (the existing `buildJudgePrompt`).
- Critical validation: gate agreement rate must be > 95% (Haiku and Opus agree on pass/fail for the same translation). If not, Haiku re-scoring is not viable and this spec's cost savings are reduced.

**File:** `packages/api/src/scoring/llm-judge.ts` (modify), `packages/api/src/scoring/score-comparison-logger.ts` (new)

#### 2.2 — Selective Haiku re-scoring with Opus escalation

If validation shows Haiku occasionally disagrees with Opus on borderline cases, implement a safety valve:

- If a Haiku in-loop score puts the aggregate within 3 points of the threshold (either direction), flag it as "borderline."
- Borderline scores trigger an Opus re-score of only the borderline metrics (not all 7), to confirm the Haiku assessment.
- This keeps the common case (clear pass or clear fail) on Haiku while protecting against Haiku misjudgment on edge cases.
- This is optional and only implemented if Phase 2.1 data shows gate disagreement > 5%.

**File:** `packages/api/src/scoring/llm-judge.ts` (modify)

### Phase 3: Quality Validation Harness

#### 3.1 — A/B comparison mode for the full pipeline

Extend the existing benchmark infrastructure to compare the current pipeline vs the advisor loop pipeline:

- Given the same input (source text, client profile, language), run both pipelines and compare:
  - Final Opus scores (both use Opus for final scoring)
  - Output text similarity (character-level diff, semantic similarity)
  - Total cost (using the cost estimator from the advisor-tool PoC spec)
  - Total latency (wall clock time)
  - Number of outer-loop rounds needed
  - HITL escalation rate
- Results written to a structured JSON report.

**Acceptance criteria:**
- Advisory pipeline's mean final Opus aggregate score >= current pipeline's mean final Opus aggregate score (across a corpus of >= 20 translations).
- No metric regresses by more than 5 points on average.
- HITL escalation rate does not increase.

**File:** `packages/api/src/benchmark/pipeline-comparison.ts` (new)

#### 3.2 — Regression test corpus

Curate a set of 20+ translation inputs (source text + client profile + language) that cover:
- Easy translations (gate passes on initial score)
- Hard translations (require 1-2 correction rounds)
- Edge cases (glossary-heavy texts, long documents, mixed formality requirements)

These are stored as fixtures and used by both the A/B comparison and future CI regression testing.

**File:** `packages/api/src/benchmark/fixtures/` (new directory with JSON fixtures)

### Phase 4: Cleanup and Migration

#### 4.1 — Remove feature flag

Once quality validation passes (Phase 3 acceptance criteria met), remove the `FINFLOW_PIPELINE_LOOP` feature flag and make the advisor loop the default path.

#### 4.2 — Remove dead code

- Delete individual specialist files (`terminology.ts`, `style.ts`, `structural.ts`, `linguistic.ts`) if no other code path uses them.
- Delete `quality-arbiter.ts` (the arbiter's routing logic is subsumed by the advisor session).
- Remove the specialist dispatch function from `translation-engine.ts`.
- Keep `shared.ts` (the `FailedMetricData` and `SpecialistResult` types are still used by the advisor loop's internal types, or can be refactored).

#### 4.3 — Audit trail parity

Verify that the advisor loop's audit trail provides at least as much information as the current pipeline:
- Every tool call within the advisor session is logged with duration and token counts.
- The final audit entry includes the full tool call log.
- SSE events are emitted for each phase within the advisor session (scoring, glossary, submission).

## Cost Model

### Per-Translation Cost Comparison (1 correction round, all metrics fail)

**Current pipeline:**

| Component | Model | Calls | Est. Input Tok | Est. Output Tok | Cost |
|-----------|-------|-------|----------------|-----------------|------|
| Translation | Opus | 1 | ~2,000 | ~3,000 | $0.255 |
| Initial scoring (LLM) | Opus | 1 | ~3,000 | ~2,000 | $0.195 |
| Arbiter | Haiku | 1 | ~800 | ~400 | $0.002 |
| Specialists (4x) | Sonnet | 4 | ~12,000 total | ~8,000 total | $0.156 |
| Glossary guard | Deterministic | 4 | 0 | 0 | $0.000 |
| Re-scoring (LLM) | Opus | 1 | ~3,000 | ~2,000 | $0.195 |
| **Total** | | **8** | | | **$0.803** |

**Advisor loop pipeline:**

| Component | Model | Calls | Est. Input Tok | Est. Output Tok | Cost |
|-----------|-------|-------|----------------|-----------------|------|
| Translation | Opus | 1 | ~2,000 | ~3,000 | $0.255 |
| Initial scoring (LLM) | Opus | 1 | ~3,000 | ~2,000 | $0.195 |
| Advisor session | Sonnet | 1 (multi-turn) | ~5,000 | ~4,000 | $0.075 |
| In-loop scoring (LLM) | Haiku | 1 | ~3,000 | ~2,000 | $0.010 |
| In-loop glossary | Deterministic | 1 | 0 | 0 | $0.000 |
| Final re-scoring (LLM) | Opus | 1 | ~3,000 | ~2,000 | $0.195 |
| **Total** | | **5** | | | **$0.730** |

**Savings per translation:** ~$0.073 (9.1%)

The savings are modest because Opus re-scoring dominates cost and stays for the final gate. The real wins come from:
1. **Reduced specialist context duplication.** 4 calls with ~3,000 input tokens each (12,000 total) collapse to 1 session with ~5,000 input tokens (context sent once, cached across turns).
2. **Haiku in-loop scoring.** If 2 correction rounds are needed, the current pipeline runs 2 Opus re-scores ($0.390 total). The advisor loop runs 2-3 Haiku progress checks ($0.020-0.030) + 1 final Opus re-score ($0.195).
3. **Fewer outer-loop rounds.** The advisor session can self-correct within a single session (iterate internally), potentially reducing outer-loop rounds from 2 to 1. This would save the cost of an entire second round.

**Projected savings with 2 correction rounds:**

| Scenario | Current | Advisor Loop | Savings |
|----------|---------|--------------|---------|
| 1 outer round | $0.803 | $0.730 | 9.1% |
| 2 outer rounds | $1.196 | $0.935 | 21.8% |
| 2 outer rounds, advisor self-corrects in 1 | $1.196 | $0.730 | 38.9% |

The biggest cost lever is the advisor session's ability to self-correct without exiting to a full Opus re-score.

## SSE Event Mapping

The advisor loop must emit SSE events that are backward-compatible with the existing UI:

| Current Event | Advisor Loop Equivalent |
|---------------|------------------------|
| `arbiter:routing` | `advisor:starting` — "Advisor session analyzing scorecard..." |
| `arbiter:decided` | `advisor:plan` — Sonnet's initial analysis (first text block before any tool call) |
| `specialist:running` | `advisor:correcting` — "Advisor making corrections (turn N)..." |
| `specialist:complete` | `advisor:tool_call` — "Advisor called {tool_name}, result: {summary}" |
| `glossary_guard:recovered` | `advisor:glossary` — "Glossary enforcement: {before}% -> {after}%" |
| `scoring:re-scoring` | `advisor:scoring` — "In-loop progress check (Haiku)..." |
| `scoring:complete` | `advisor:score_result` — "Progress: {aggregate}/{threshold}" |
| (new) | `advisor:submitting` — "Advisor submitting final correction..." |
| (new) | `scoring:final` — "Final authoritative re-score (Opus)..." |

## Constraints

- **TypeScript strict mode, no `any`.** All new code must pass `bun run typecheck`.
- **No API contract changes.** `POST /translate` and `POST /translate/stream` request/response shapes are unchanged. `EngineResult` type is unchanged.
- **Branch off `master`.** Not `workstream-b-playground`. Create branch `poc/pipeline-loop`.
- **Feature-flagged.** `FINFLOW_PIPELINE_LOOP=1` enables the new path. Default is the current pipeline.
- **Advisor session failure is never fatal.** If `runAgentLoop` throws, fall back to the current specialist pipeline for that round. Log the error.
- **Final Opus score is mandatory.** Even if all Haiku in-loop scores pass, the final Opus re-score runs before the gate check. This is non-negotiable for quality assurance.
- **`maxToolRounds` hard cap.** The advisor session cannot make more than 6 tool calls. This prevents runaway token consumption. If the cap is hit, the session returns whatever correction was last produced.
- **Sonnet model is explicit.** The advisor session always uses Sonnet. In-loop scoring always uses Haiku. Final scoring always uses Opus. No configurable model selection.

## File Change Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/api/src/lib/anthropic.ts` | **modify** | 1.1 | Add `runAgentLoop` multi-turn tool-use runner |
| `packages/api/src/lib/advisor-config.ts` | **modify** | 1.5 | Add `FINFLOW_PIPELINE_LOOP` flag reader |
| `packages/api/src/pipeline/advisor-loop.ts` | **new** | 1.2, 1.3 | Advisor session: tool definitions, system prompt, orchestration |
| `packages/api/src/pipeline/translation-engine.ts` | **modify** | 1.4 | Replace specialist loop with advisor session call |
| `packages/api/src/scoring/llm-judge.ts` | **modify** | 2.1 | Add Haiku vs Opus comparison mode |
| `packages/api/src/scoring/score-comparison-logger.ts` | **new** | 2.1 | JSON logger for scoring comparisons |
| `packages/api/src/benchmark/pipeline-comparison.ts` | **new** | 3.1 | A/B pipeline comparison harness |
| `packages/api/src/benchmark/fixtures/` | **new dir** | 3.2 | Regression test corpus |

## Implementation Order

```
Phase 1.1  anthropic.ts — runAgentLoop (multi-turn tool runner)
Phase 1.5  advisor-config.ts — FINFLOW_PIPELINE_LOOP flag
Phase 1.2  advisor-loop.ts — tool definitions + executors
Phase 1.3  advisor-loop.ts — system prompt + user message builder
Phase 1.4  translation-engine.ts — wire advisor loop behind feature flag
           ↑ checkpoint: advisor loop runs end-to-end with Haiku in-loop scoring
Phase 2.1  llm-judge.ts + score-comparison-logger.ts — Haiku vs Opus validation
           ↑ checkpoint: collect data on 20+ translations, verify gate agreement > 95%
Phase 2.2  llm-judge.ts — borderline escalation (only if needed per 2.1 data)
Phase 3.1  pipeline-comparison.ts — A/B harness
Phase 3.2  fixtures/ — regression corpus
           ↑ checkpoint: acceptance criteria met (quality parity proven)
Phase 4.1  Remove feature flag
Phase 4.2  Delete dead code (specialists, arbiter)
Phase 4.3  Audit trail parity verification
```

## Risks and Trade-offs

1. **Quality regression from unified specialist.** A single Sonnet session fixing all domains may not match the quality of 4 focused specialists. Each specialist currently has a narrow system prompt that prevents cross-domain interference (e.g., "do NOT change glossary terms while fixing style"). The unified prompt must replicate these guardrails. **Mitigation:** The system prompt explicitly encodes all 4 specialists' "MUST NOT" rules. Phase 3 validation proves quality parity before the flag is removed.

2. **Haiku re-scoring divergence.** Haiku may score differently than Opus, leading Sonnet to optimize for the wrong target. **Mitigation:** Phase 2.1 validates gate agreement. The final Opus re-score is always authoritative — Haiku is only used for steering, never for the final gate.

3. **Sonnet loop not converging.** Sonnet might make corrections that trade one failure for another, never reaching the gate threshold. **Mitigation:** `maxToolRounds` hard cap (6 calls) prevents infinite loops. The outer engine round limit (maxRounds from profile) is preserved. The advisor's `remaining_issues` field enables early HITL escalation.

4. **Context window pressure.** Multi-turn conversations accumulate context. With a long source text, profile, scorecard, and multiple tool results, the conversation could approach Sonnet's context limit. **Mitigation:** Tool results are summarized (scorecard as compact JSON, not verbose text). Source text and profile are in the initial user message only (not repeated). For very long documents, truncate source text in the user message to first 6,000 tokens with a note that the full text was used for scoring.

5. **Latency.** Multi-turn conversations have sequential API calls. However, the current pipeline also runs sequentially (arbiter -> specialist 1 -> guard -> specialist 2 -> guard -> specialist 3 -> guard -> specialist 4 -> guard -> rescore). The advisor loop should be faster in wall-clock time because it makes fewer API calls total.

6. **Glossary guard effectiveness.** Currently the glossary guard runs after each specialist, catching regressions immediately. In the advisor loop, Sonnet must explicitly call `enforce_glossary`. If Sonnet forgets, glossary terms may regress. **Mitigation:** The system prompt instructs Sonnet to always call `enforce_glossary` after corrections. Additionally, the engine runs a final deterministic glossary check after the advisor session exits (before the Opus re-score), as a safety net.

7. **Rollback.** Set `FINFLOW_PIPELINE_LOOP=0` (or unset). The current specialist pipeline is always present behind the feature flag. No code rollback needed.

## Out of Scope

- **Changing the translation agent.** Opus translation stays as-is.
- **Changing initial scoring.** Opus initial scoring stays as-is.
- **Streaming the advisor session.** The advisor loop runs internally; SSE events are emitted at tool-call boundaries but the Sonnet text generation itself is not streamed to the client.
- **Prompt caching.** The Anthropic prompt caching feature could reduce input token costs for the multi-turn conversation. Evaluate after baseline data is collected.
- **Parallel tool execution.** Sonnet calls tools sequentially. Parallel scoring + glossary in a single turn is a future optimization.
- **UI changes.** The SSE event names change (see mapping table) but the web client already renders arbitrary event names. No web package changes needed.
- **Advisor tool (Opus sub-inference within Sonnet).** This spec uses standard multi-turn tool_use, not the Anthropic Advisor Tool beta. The advisor-tool PoC (separate spec) is a different approach. They are independent.
- **Changing the outer loop structure.** The `maxRounds` loop and HITL escalation logic are preserved. Only the inner specialist dispatch is replaced.
- **Database schema changes.** The repository pattern interfaces (`TranslationStore`, `ProfileStore`) are unchanged.
