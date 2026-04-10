# Advisor Tool PoC — Downgrade Specialists from Opus to Sonnet+Opus Advisor

## Overview

Specialists currently run on Opus, which is the most expensive model tier. The Anthropic **Advisor Tool** (beta: `advisor-tool-2026-03-01`) lets a cheaper **executor** model (Sonnet) consult a more capable **advisor** model (Opus) mid-generation within a single API call. The advisor sees the full transcript, produces a short plan (~400-700 tokens), and the executor continues — all server-side, no extra round-trips.

This PoC proves the concept on the **style specialist only**, with an env-var toggle so the same translation can run both ways for side-by-side cost/quality comparison.

**Who:** FinFlow engineering team (internal tooling change, no user-facing impact).
**Problem:** Opus specialist calls dominate pipeline cost. If Sonnet+Advisor matches quality, we cut specialist cost significantly — the bulk of output tokens shift from Opus rates ($75/MTok) to Sonnet rates ($15/MTok), with only a short advisory (~400-700 tok) billed at Opus rates.

## How the Advisor Tool Works

```
Single API call:
  executor (Sonnet) starts generating
    → decides to consult advisor
    → emits server_tool_use { name: "advisor", input: {} }
    → Anthropic runs Opus sub-inference server-side (sees full transcript)
    → advisor_tool_result returns to executor
  executor continues generating, informed by advice
```

Key properties:
- **One API call, one round-trip.** The advisor sub-inference is server-side.
- **Executor decides when to call.** We guide timing via system prompt.
- **Advisor output is short** (~400-700 text tokens, ~1400-1800 total with thinking).
- **Billing is split:** executor tokens at Sonnet rates, advisor tokens at Opus rates, reported in `usage.iterations[]`.
- **Beta header required:** `anthropic-beta: advisor-tool-2026-03-01`.
- **SDK method:** `client.beta.messages.create()` with `betas: ["advisor-tool-2026-03-01"]`.

## Data Model

No new entities. Changes to existing structures only:

### `SpecialistResult.usage` (extended)

```ts
// Current
usage?: { inputTokens: number; outputTokens: number };

// New — backward-compatible (advisor fields optional)
usage?: {
  inputTokens: number;
  outputTokens: number;
  advisorInputTokens?: number;
  advisorOutputTokens?: number;
};
```

The advisor's token counts are tracked separately because they're billed at Opus rates while the executor tokens are billed at Sonnet rates. Counts are extracted from `usage.iterations[]` in the API response.

### `AuditEntry` (no schema change)

When the advisor path is active, the specialist's `AuditEntry.reasoning` is prefixed with `[advisor-assisted]` so comparison tooling can filter by mode.

## Requirements

### Phase 1: Advisor Infrastructure

#### 1.1 — Env-var toggle: `FINFLOW_ADVISOR_MODE`

- When `FINFLOW_ADVISOR_MODE` is unset or `"off"`, the pipeline behaves exactly as today (Opus specialists). This is the default.
- When set to `"advisor"`, the style specialist uses the Sonnet+Advisor path.
- When set to `"compare"`, both paths run in sequence on the same input; results are logged side-by-side but only the Opus result is used in the pipeline. This mode is for benchmarking only.
- The toggle is read at specialist dispatch time (not cached at startup), so it can be changed between runs without restarting the server.
- Error case: if the env var contains an unrecognized value, log a warning and fall back to `"off"`.

**File:** `packages/api/src/lib/advisor-config.ts` (new)

```ts
export type AdvisorMode = "off" | "advisor" | "compare";

export function getAdvisorMode(): AdvisorMode {
  const raw = process.env.FINFLOW_ADVISOR_MODE;
  if (raw === "advisor" || raw === "compare") return raw;
  if (raw && raw !== "off") {
    console.warn(`[advisor] Unknown FINFLOW_ADVISOR_MODE="${raw}", falling back to "off"`);
  }
  return "off";
}
```

#### 1.2 — `runAgentStructuredWithAdvisor` wrapper

A new function in `anthropic.ts` that wraps the Anthropic Advisor Tool API. It composes `tool_use` structured output (for the specialist's result schema) with the advisor tool in the same `tools` array.

**Signature:**
```ts
export async function runAgentStructuredWithAdvisor<T>(
  config: AgentConfig,              // executor config (model should be "sonnet")
  advisorModel: ModelTier,          // "opus"
  userMessage: string,
  toolName: string,
  toolDescription: string,
  inputSchema: Record<string, unknown>,
  parseResult: (input: Record<string, unknown>) => T,
  advisorMaxUses?: number,          // default 1
): Promise<{
  result: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
    advisorInputTokens: number;
    advisorOutputTokens: number;
  };
}>
```

**Implementation details:**
- Uses `client.beta.messages.create()` with `betas: ["advisor-tool-2026-03-01"]`.
- The `tools` array contains both the specialist's `tool_use` schema AND the advisor tool:
  ```ts
  tools: [
    { type: "advisor_20260301", name: "advisor", model: resolveModel(advisorModel), max_uses: advisorMaxUses ?? 1 },
    { name: toolName, description: toolDescription, input_schema: inputSchema },
  ]
  ```
- `tool_choice` uses `{ type: "auto" }` (not forced) — the executor must be free to call the advisor before calling the result tool. If we force the result tool, the executor skips the advisor.
- Parse `usage.iterations[]` from the response to extract advisor vs executor token counts. Iterations with `type: "advisor_message"` are advisor tokens; `type: "message"` are executor tokens.
- Extract the `tool_use` block from response content (skip `server_tool_use` and `advisor_tool_result` blocks).
- The system prompt should include advisor timing guidance (see §1.3).
- Error case: if the beta API returns a non-advisor error, throw as usual. If the advisor sub-inference fails (error in `advisor_tool_result`), the executor continues without advice — no special handling needed.

**File:** `packages/api/src/lib/anthropic.ts` (modify)

#### 1.3 — Advisor system prompt guidance

Per Anthropic's best practices, prepend advisor timing instructions to the executor's system prompt when the advisor tool is present. For specialists this is straightforward — the specialist should consult the advisor once before writing its correction:

```text
You have access to an `advisor` tool backed by a stronger reviewer model. Call it BEFORE writing your correction — it will analyze the scoring failures and provide a targeted correction plan. Follow the advisor's guidance closely unless you have direct evidence it's wrong.

The advisor should respond in under 100 words and use enumerated steps, not explanations.
```

This is prepended to the existing specialist system prompt, not a replacement.

**File:** embedded in `style.ts` advisor path (no separate file)

#### 1.4 — Extended usage tracking on `SpecialistResult`

- Add optional `advisorInputTokens` and `advisorOutputTokens` fields to the `usage` type in `SpecialistResult`.
- When the advisor path is used, both the advisor (Opus) and executor (Sonnet) token counts are recorded.
- `inputTokens` and `outputTokens` always reflect the executor (Sonnet or Opus depending on mode).
- The advisor tokens are separate so cost calculations can apply the correct per-token rate.

**File:** `packages/api/src/agents/specialists/shared.ts` (modify)

### Phase 2: Style Specialist Migration

#### 2.1 — Refactor `correctStyle` to use `runAgentStructured`

Before wiring the advisor, first migrate the style specialist from `callAgentWithUsage` + text parsing (`---REASONING---` delimiter) to `runAgentStructured` + `tool_use`. This is a prerequisite because:
- `tool_choice: { type: "auto" }` (needed for advisor) requires the result to come via a tool, not free text.
- Structured output eliminates the fragile `parseSpecialistResponse` text splitting for this specialist.

Changes:
- Define a `style_correction` tool schema with `correctedText: string` and `reasoning: string`.
- Replace `callAgentWithUsage("opus", ...)` with `runAgentStructured(config, ..., "style_correction", ...)`.
- The `AgentConfig` for style uses `model: "opus"` (unchanged in this step).
- Remove the `---REASONING---` instruction from the style prompt.
- Return type remains `SpecialistResult` — no downstream changes.
- The `parseSpecialistResponse` function stays in `shared.ts` (other specialists still use it).

**File:** `packages/api/src/agents/specialists/style.ts` (modify)

#### 2.2 — Wire advisor into the style specialist

Add the advisor-aware code path inside `correctStyle`:

```
1. Read advisor mode from env
2. If mode is "off":
     Run style specialist on Opus via runAgentStructured (same as 2.1)
3. If mode is "advisor":
     a. Build prompt (same content as today, minus the ---REASONING--- instruction)
     b. Prepend advisor timing guidance to system prompt
     c. Call runAgentStructuredWithAdvisor with executor="sonnet", advisor="opus"
     d. Sonnet consults Opus internally, gets correction plan, produces structured result
     e. Return SpecialistResult with split usage (executor + advisor tokens)
4. If mode is "compare":
     a. Run the "advisor" path (step 3)
     b. Run the "off" path (step 2)
     c. Log both results with structured comparison
     d. Return the Opus result (the advisor result is logged but not used)
```

- Error case: if `runAgentStructuredWithAdvisor` throws, log the error and fall back to the Opus path. The pipeline must never fail because the advisor failed.

**File:** `packages/api/src/agents/specialists/style.ts` (modify)

#### 2.3 — Audit trail integration

- When advisor mode is active, the specialist's `AuditEntry.reasoning` is prefixed with `[advisor-assisted]`.
- In compare mode, emit an additional SSE event (`stage: "advisor_comparison"`) with:
  - `opusCost` / `advisorCost` (estimated from token counts and known per-token rates)
  - `textDiffLength` (character-level diff size between the two outputs)
  - Both reasoning strings
- No changes to `AuditEntry` type — comparison data goes into the `data` field of the SSE event.

**File:** `packages/api/src/pipeline/translation-engine.ts` (minor — update audit entry construction for style specialist)

### Phase 3: Comparison Harness

#### 3.1 — Cost estimation utility

A pure function that takes token counts + model tiers and returns estimated cost in USD.

- Hardcoded rates (Anthropic public pricing as of April 2026):
  - Opus: $15/MTok input, $75/MTok output
  - Sonnet: $3/MTok input, $15/MTok output
  - Haiku: $0.80/MTok input, $4/MTok output
- Used by compare mode to log cost deltas.
- Returns `{ opusCostUsd: number; advisorCostUsd: number; savingsPercent: number }`.

**File:** `packages/api/src/lib/cost-estimator.ts` (new)

#### 3.2 — Comparison logging

In compare mode, write a JSON file per comparison to a configurable directory (`FINFLOW_ADVISOR_COMPARE_DIR`, default `./advisor-comparisons/`):

```json
{
  "timestamp": "2026-04-10T...",
  "sourceTextHash": "abc123...",
  "failedMetrics": { "...": "..." },
  "opus": {
    "correctedText": "...",
    "reasoning": "...",
    "tokens": { "inputTokens": 1200, "outputTokens": 3400 },
    "costUsd": 0.042
  },
  "advisor": {
    "correctedText": "...",
    "reasoning": "...",
    "tokens": {
      "inputTokens": 800, "outputTokens": 2100,
      "advisorInputTokens": 1200, "advisorOutputTokens": 600
    },
    "costUsd": 0.012
  },
  "savingsPercent": 71,
  "textDiffLength": 47
}
```

- One file per comparison, named `{timestamp}-{sourceHash}.json`.
- Error case: if the directory is not writable, log a warning but do not fail the pipeline.

**File:** `packages/api/src/agents/specialists/comparison-logger.ts` (new)

## Constraints

- **TypeScript strict mode, no `any`.** All new code must pass `bun run typecheck`.
- **No pipeline contract changes.** `SpecialistResult` shape is backward-compatible (new fields are optional). `EngineResult` and `AuditEntry` types are unchanged.
- **No changes to other specialists.** Only `style.ts` is modified. Terminology, structural, and linguistic stay on Opus with `callAgentWithUsage`.
- **Branch:** `poc/advisor-tool` off current HEAD of `workstream-b-playground`.
- **Advisor failure is never fatal.** Any error in the advisor path falls back to the existing Opus path. The pipeline must not degrade.
- **Model tiers are explicit.** The advisor always uses Opus. The executor always uses Sonnet. The baseline always uses Opus. No configurable model selection in this PoC.
- **Beta API dependency.** Requires `advisor-tool-2026-03-01` beta header. If the beta is unavailable or our account doesn't have access, the entire advisor path is inoperable — the env-var toggle ensures graceful fallback.

## File Change Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/api/src/lib/advisor-config.ts` | **new** | 1.1 | Env-var toggle reader |
| `packages/api/src/lib/anthropic.ts` | **modify** | 1.2 | Add `runAgentStructuredWithAdvisor` wrapper |
| `packages/api/src/lib/cost-estimator.ts` | **new** | 3.1 | Token-to-USD cost calculator |
| `packages/api/src/agents/specialists/shared.ts` | **modify** | 1.4 | Add optional advisor token fields to usage type |
| `packages/api/src/agents/specialists/style.ts` | **modify** | 2.1, 2.2 | Migrate to `runAgentStructured`, wire advisor path |
| `packages/api/src/agents/specialists/comparison-logger.ts` | **new** | 3.2 | JSON file logger for compare mode |
| `packages/api/src/pipeline/translation-engine.ts` | **modify** | 2.3 | Advisor tag in audit reasoning, compare SSE event |

## Implementation Order

```
Phase 1.1  advisor-config.ts (new)
Phase 1.4  shared.ts usage type (modify)
Phase 1.2  anthropic.ts wrapper (modify) — depends on 1.4 for types
Phase 2.1  style.ts → runAgentStructured on Opus (modify) — validate no regression
Phase 3.1  cost-estimator.ts (new)
Phase 3.2  comparison-logger.ts (new)
Phase 2.2  style.ts → wire advisor toggle (modify) — depends on 1.1, 1.2, 3.1, 3.2
Phase 2.3  translation-engine.ts audit integration (modify)
```

## Risks and Rollback

1. **Quality regression.** Sonnet+Advisor may produce worse corrections than Opus alone. Mitigation: compare mode runs both and logs diffs. Never ship advisor-only without data.
2. **Latency change.** The advisor sub-inference pauses the stream while Opus thinks (~1-3s). However, the total wall time may be similar to or faster than Opus-only since Sonnet generates the bulk output faster. Measure in compare mode.
3. **Prompt length.** The advisor sees the full transcript. For long translations + profiles, this could approach context limits. Mitigation: `prompt_too_long` error in `advisor_tool_result` is non-fatal — executor continues without advice.
4. **Beta instability.** The advisor tool is beta. API shape or behavior may change. Mitigation: all advisor logic is behind the env-var toggle; the Opus path is always present.
5. **`tool_choice: auto` risk.** The executor might not call the result tool, or might call it without consulting the advisor. Mitigation: system prompt guidance + `max_uses: 1` on advisor. If the executor skips the result tool, `runAgentStructuredWithAdvisor` throws and falls back to Opus.
6. **Rollback.** Set `FINFLOW_ADVISOR_MODE=off` (or unset it). No code rollback needed. The Opus path is always present and is the default.

## Out of Scope

- Migrating terminology, structural, or linguistic specialists (future work if style PoC succeeds).
- Migrating the translation agent or scoring agent to cheaper models.
- Changing the `AuditEntry` schema or `EngineResult` schema.
- Automated quality comparison (scoring both outputs and comparing scorecards). Valuable but deferred — the PoC focuses on infrastructure + manual review of compare logs.
- UI changes. This is a backend-only change.
- Migrating other specialists to `runAgentStructured` (only style is migrated in this PoC).
- Advisor-side prompt caching (`caching` param) — evaluate after we have baseline data on call frequency.
- Multi-turn advisor conversations. Each specialist call is single-turn.
