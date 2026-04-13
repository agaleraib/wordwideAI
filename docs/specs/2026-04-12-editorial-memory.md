# Editorial Memory System — Native Temporal Knowledge Graph for FinFlow Content Pipeline

**Date:** 2026-04-12
**Status:** Phase 3 Near-Complete (Tasks 10-11 done, Task 12 blocked on workstream C pipeline)
**Branch:** TBD (new branch from `master`)
**Owners:** Albert Galera (decisions), Claude (drafting + implementation)
**Supersedes:** `2026-04-10-mempalace-integration.md` (philosophy adopted, Python dependency rejected)
**Depends on:**
- `2026-04-08-narrative-state-persistence.md` — existing `NarrativeStateStore` (filesystem, PoC-only)
- `2026-04-07-content-pipeline.md` — production content pipeline (stages 7a/7b injection points)
- `2026-04-07-deployment-stack.md` — Postgres + pgvector production stack

---

## 1. Goal

Build a native TypeScript editorial memory system that gives every FinFlow persona persistent, evolving, contradiction-aware memory of what it has previously written. The system takes the philosophy from MemPalace (temporal knowledge graph, contradiction detection, semantic retrieval) but implements it purely in TypeScript against Postgres + pgvector — no Python, no ChromaDB, no SQLite sidecar.

**What this solves:**

Today's `NarrativeStateStore` is a shallow filesystem JSON store. It persists directional view, thesis statements, and price levels, but it cannot:

1. **Verify predictions against reality.** The system cannot tell whether "1.09 support holds" was right or wrong because it has no price data feed. The next news event might not explicitly resolve prior calls — it just talks about NFP numbers. Without verification, the persona's "track record" is aspirational, not real.
2. **Accumulate context beyond what the news provides.** A real analyst knows "I called 1.09 support last week and the market has been trading at 1.075 since." The FA Agent today gets only the new event. Editorial memory bridges this gap by injecting the persona's accumulated analytical thread.
3. **Detect contradictions.** When a persona said "bullish EUR" last Tuesday and today's data is bearish, the current system has no mechanism to surface the tension. The identity agent either silently flips or ignores the shift.
4. **Drive natural divergence through retrieval.** Vector search returns slightly different context for different queries. Different personas asking different questions get different retrieved memories, which introduces authentic variation in outputs. The non-determinism of semantic retrieval becomes a divergence mechanism, not a bug.

**Who it's for:** The FinFlow content pipeline (workstream C). First consumer is the PoC harness; production consumer is the pipeline's identity adaptation layer (stage 7b).

---

## 2. Architecture Overview

```
                                 ┌─────────────────────────┐
                                 │   Embedding Service      │
                                 │   (text-embedding-3-small│
                                 │    via OpenAI API, 1536d)│
                                 └──────────┬──────────────┘
                                            │
 News Event ──► FA Agent ──► Core Analysis ─┤
                                            │
         ┌──────────────────────────────────┼────────────────────────────┐
         │           Editorial Memory System                             │
         │                                                               │
         │  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
         │  │ Fact Store    │  │ Knowledge Graph   │  │ Contradiction  │  │
         │  │ (pgvector)   │  │ (temporal triples) │  │ Detector       │  │
         │  │              │  │                    │  │                │  │
         │  │ embedded     │  │ (persona, pred,    │  │ position vs    │  │
         │  │ editorial    │  │  object,           │  │ new evidence   │  │
         │  │ facts from   │  │  valid_from,       │  │ → surfaces     │  │
         │  │ prior pieces │  │  valid_to,         │  │   tension for  │  │
         │  └──────┬───────┘  │  confidence,       │  │   the identity │  │
         │         │          │  source_piece)      │  │   agent        │  │
         │         │          └──────────┬─────────┘  └───────┬────────┘  │
         │         └──────────┬──────────┘                    │           │
         │                    ▼                               │           │
         │            ┌───────────────┐                       │           │
         │            │ Context       │◄──────────────────────┘           │
         │            │ Assembler     │                                   │
         │            │               │                                   │
         │            │ builds the    │                                   │
         │            │ "editorial    │                                   │
         │            │ memory" block │                                   │
         │            │ injected into │                                   │
         │            │ identity call │                                   │
         │            └───────┬───────┘                                   │
         │                    │                                           │
         └────────────────────┼───────────────────────────────────────────┘
                              ▼
              Identity Agent (stage 7b) receives:
              - Core analysis (shared)
              - Persona config (static)
              - Editorial memory block (unique per persona × topic)
```

---

## 3. Key Design Decisions

### 3.1 Embedding model: OpenAI `text-embedding-3-small` (1536d)

**Rationale:**
- 1536 dimensions, good quality for financial text
- ~$0.02 per 1M tokens (~$0.000002 per embedding) — negligible cost
- Works on any host with internet access, including LXC 101 (which has no local LLM access)
- The user wants embeddings as a **divergence mechanism**: different personas querying with different framings get different retrieved context
- `text-embedding-3-small` handles financial text well (8191 token context, trained on diverse domains)

**Deployment:** LXC 101 needs `OPENAI_API_KEY` added to its environment. The FinFlow repo maintains its own `.env` (copied from `gobot/.env` initially, may diverge later). Add the key to the LXC during the next deploy.

**Fallback:** If the OpenAI API is unreachable, the system degrades to recency-only retrieval (no vector search). The `EditorialMemoryStore` interface abstracts this — callers never know whether results came from vector or temporal retrieval.

### 3.2 Prediction verification: implicit via FA Agent analysis

The user's core question: "How can you actually know EUR/USD didn't hit 1.09?"

**Answer: the FA Agent's analysis of the NEW event implicitly resolves prior predictions.** When the FA Agent analyzes "NFP miss, USD weakens," the editorial memory system doesn't need a separate price feed to know that the prior "1.09 support holds" call was wrong. The contradiction detector compares:
- Prior triple: `(premium, stated_position, "1.09 support holds", 2026-04-03, null, high)`
- New FA analysis mentions: "EUR/USD broke above 1.0950 on NFP weakness"

The FA analysis IS the market data, reprocessed through the analytical lens. The contradiction detector runs a lightweight Haiku call that compares prior position triples against the new core analysis and flags tensions. This is cheaper and more reliable than maintaining a real-time price feed, because:
1. Raw price data doesn't tell you if a position was "wrong" — only analysis does
2. The FA Agent already processes the same data sources that would inform a price feed
3. It naturally handles the "the news doesn't explicitly say 1.09 broke" problem — the FA Agent synthesizes across data points

**For v2:** When `@wfx/sources` (workstream B) ships with market data adapters, the system can optionally ingest spot prices as supplementary verification. But the FA-analysis-as-resolver approach works today with zero new dependencies.

### 3.3 Storage: Postgres + pgvector from day one, in-memory fallback for PoC

No filesystem JSON for the production system. The locked deployment stack specifies Postgres + pgvector. The editorial memory tables live alongside the future FinFlow application tables in the same database, managed by Drizzle ORM.

For the PoC harness (which runs without Postgres today), an `InMemoryEditorialMemoryStore` implementation provides the same interface using a `Map` + brute-force cosine search over an in-memory vector array. This is accurate for small datasets (< 1000 facts) and avoids requiring Postgres for local experiments.

### 3.4 Contradiction handling: the EUR/USD walkthrough

**Scenario:** Premium Capital Markets said "bullish EUR, 1.09 support holds" on Tuesday. On Thursday, NFP misses expectations (weaker USD), and EUR/USD surges to 1.0950 — vindicating the bullish call but making the 1.09 level stale.

**Step 1 — Prior state in the knowledge graph:**
```
(premium, stated_position, "bullish EUR/USD — 1.09 support holds", valid_from=Tue, confidence=high)
(premium, cited_level, "1.0900 support", valid_from=Tue)
(premium, cited_level, "1.0920 resistance", valid_from=Tue)
```

**Step 2 — New event arrives (Thursday NFP miss). FA Agent produces core analysis:**
```
"NFP came in at +138K vs +180K expected... EUR/USD surged to 1.0950...
 the 1.09 level that had been acting as resistance flipped to support
 earlier this week but is now in the rear-view mirror as the pair
 trades well above it..."
```

**Step 3 — Contradiction detector runs (Haiku call):**

Input: prior position triples for (premium, eurusd) + new core analysis.
Output (via tool_use):
```json
{
  "contradictions": [
    {
      "priorTriple": "stated_position: bullish EUR/USD — 1.09 support holds",
      "newEvidence": "EUR/USD surged to 1.0950, well above 1.09",
      "tensionType": "reinforced_but_reframed",
      "explanation": "The prior bullish view was correct — EUR did strengthen. But the framing around 1.09 as 'support that holds' is stale: 1.09 is no longer the relevant level. The view was directionally right but the level call needs updating."
    }
  ],
  "resolutions": [
    {
      "action": "supersede",
      "oldTriple": "cited_level: 1.0900 support",
      "newFact": "1.09 is now below the current range; new support likely at 1.0920-1.0930",
      "confidence": "moderate"
    }
  ]
}
```

**Step 4 — Context assembler builds the editorial memory block:**
```markdown
## Editorial Memory — Premium Capital Markets on EUR/USD

### Your active position
You are BULLISH on EUR/USD (high confidence, established Tuesday).

### What happened since your last piece
Your call was directionally correct: EUR/USD has strengthened as you
predicted. However, the specific level you cited (1.09 support) is now
stale — the pair is trading well above it at 1.0950. Your readers who
followed your 1.09 support thesis are sitting in profit.

### Contradiction alert
- You cited 1.0900 as support. It held and is now below the range.
  Consider updating your level framework to reflect the new range.

### Prior coverage (most recent first)
- Tuesday: "Bullish EUR on ECB-Fed divergence, 1.09 support holds."
  Key thesis: ECB rate path vs Fed hawkish hold creates structural
  EUR support. Levels: 1.0820 support, 1.0920 resistance.

### Guidelines
- Your bullish thesis was vindicated — lean in and say so explicitly
- Update your level calls: 1.09 is no longer the active level
- Reference your Tuesday analysis: "As we noted on Tuesday..."
- Your readers expect you to own the call: "our support thesis played
  out as expected, with EUR/USD pushing through to 1.0950"
```

**Step 5 — Identity agent receives this block and writes:**
> "As we highlighted in Tuesday's note, our bullish EUR/USD thesis centered
> on the ECB-Fed policy divergence has played out emphatically. The 1.09
> level we identified as support not only held but has been left behind
> entirely, with the pair surging to 1.0950 on today's softer-than-expected
> NFP print..."

This is what the user meant by "clearing questions" — the system doesn't need someone to manually say "you were wrong about 1.09." The FA Agent's analysis of the new event provides the ground truth, and the contradiction detector maps it against prior positions.

---

## 4. Data Model

### Entity: `editorial_fact`
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| tenant_id | VARCHAR(64) | NOT NULL, INDEX | Broker/client id (e.g., `premium-capital-markets`, `fasttrade-pro`). In production, this maps to the **tenant (broker)**, not the identity (journalist, newsletter, trading desk). All identities within the same broker share editorial memory — the memory represents the broker's accumulated editorial positions, not any single writer's voice. In the PoC, persona = tenant because each broker runs one identity. |
| topic_id | VARCHAR(64) | NOT NULL, INDEX | Market topic (e.g., `eurusd`, `gold`, `sp500`) |
| piece_id | VARCHAR(128) | NOT NULL | Id of the article that produced this fact |
| fact_type | VARCHAR(32) | NOT NULL | One of: `position`, `level`, `thesis`, `analogy`, `structure`, `cta`, `data_point` |
| content | TEXT | NOT NULL | The fact itself (e.g., "bullish EUR/USD on ECB-Fed divergence") |
| embedding | VECTOR(1536) | NULLABLE | text-embedding-3-small embedding. NULL when OpenAI API unavailable |
| confidence | VARCHAR(16) | NOT NULL, DEFAULT 'moderate' | `low`, `moderate`, `high` |
| valid_from | TIMESTAMPTZ | NOT NULL | When this fact was established |
| valid_to | TIMESTAMPTZ | NULLABLE | NULL = still active. Set when superseded or invalidated |
| superseded_by | UUID | NULLABLE, FK -> editorial_fact.id | Points to the fact that replaced this one |
| source_event_id | VARCHAR(128) | NOT NULL | The news event that triggered the piece |
| extraction_model | VARCHAR(64) | NOT NULL | Model used for extraction (e.g., `claude-haiku-4-5`) |
| extraction_cost_usd | DECIMAL(10,6) | NOT NULL | Cost of the extraction call |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Row creation time |

**Indexes:**
- `(tenant_id, topic_id, valid_from DESC)` — primary query path: "what has this persona said about this topic recently?"
- `(tenant_id, topic_id) WHERE valid_to IS NULL` — partial index for active facts only
- `USING hnsw (embedding vector_cosine_ops)` — pgvector similarity search (HNSW for better recall than IVFFlat on small-to-medium datasets)

### Entity: `editorial_contradiction`
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| tenant_id | VARCHAR(64) | NOT NULL | The persona whose position is contradicted |
| topic_id | VARCHAR(64) | NOT NULL | The topic |
| prior_fact_id | UUID | NOT NULL, FK -> editorial_fact.id | The fact being contradicted |
| new_evidence | TEXT | NOT NULL | What the new core analysis says |
| tension_type | VARCHAR(32) | NOT NULL | `reversed`, `reinforced_but_reframed`, `partially_invalidated`, `level_stale` |
| explanation | TEXT | NOT NULL | Human-readable explanation of the tension |
| resolution | VARCHAR(32) | NOT NULL, DEFAULT 'pending' | `superseded`, `acknowledged`, `dismissed`, `pending` |
| resolved_in_piece_id | VARCHAR(128) | NULLABLE | The piece that addressed this contradiction |
| detected_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When the contradiction was detected |
| resolved_at | TIMESTAMPTZ | NULLABLE | When/if it was resolved |

**Indexes:**
- `(tenant_id, topic_id, resolution) WHERE resolution = 'pending'` — find unresolved contradictions for injection

### Entity: `editorial_piece_log`
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| tenant_id | VARCHAR(64) | NOT NULL | |
| topic_id | VARCHAR(64) | NOT NULL | |
| piece_id | VARCHAR(128) | NOT NULL, UNIQUE | |
| event_id | VARCHAR(128) | NOT NULL | The triggering news event |
| directional_view | VARCHAR(16) | NOT NULL | `bullish`, `bearish`, `neutral`, `mixed` |
| view_confidence | VARCHAR(16) | NOT NULL | `low`, `moderate`, `high` |
| one_sentence_summary | TEXT | NOT NULL | |
| word_count | INTEGER | NOT NULL | |
| memory_context_tokens | INTEGER | NOT NULL, DEFAULT 0 | How many tokens of editorial memory were injected |
| contradictions_surfaced | INTEGER | NOT NULL, DEFAULT 0 | How many contradictions were in the context |
| published_at | TIMESTAMPTZ | NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:**
- `(tenant_id, topic_id, published_at DESC)` — chronological piece history

**Relationships:**
- `editorial_fact` belongs to one `editorial_piece_log` via `piece_id` (no FK constraint for flexibility; join on `piece_id`)
- `editorial_contradiction.prior_fact_id` FK -> `editorial_fact.id` (cascade delete: no — contradictions survive fact expiry for audit)
- `editorial_contradiction.resolved_in_piece_id` -> `editorial_piece_log.piece_id` (no FK constraint)
- `editorial_fact.superseded_by` self-FK -> `editorial_fact.id` (cascade delete: no)

---

## 5. Core Interfaces

```ts
// packages/api/src/memory/types.ts

export type FactType =
  | "position"      // directional market view
  | "level"         // specific price level cited
  | "thesis"        // analytical thesis statement
  | "analogy"       // metaphor or analogy used
  | "structure"     // structural pattern (e.g., "3-section Event → Analysis → Action")
  | "cta"           // call to action given
  | "data_point";   // specific data point cited (e.g., "NFP +138K")

export type TensionType =
  | "reversed"                // position completely flipped
  | "reinforced_but_reframed" // direction right, framing stale
  | "partially_invalidated"   // some parts wrong, some right
  | "level_stale";            // level no longer relevant

export type ContradictionResolution =
  | "superseded"    // old fact replaced by new one
  | "acknowledged"  // identity agent explicitly addressed the shift
  | "dismissed"     // tension was a false positive
  | "pending";      // not yet addressed

export interface EditorialFact {
  id: string;
  tenantId: string;
  topicId: string;
  pieceId: string;
  factType: FactType;
  content: string;
  embedding: number[] | null;
  confidence: "low" | "moderate" | "high";
  validFrom: Date;
  validTo: Date | null;
  supersededBy: string | null;
  sourceEventId: string;
  extractionModel: string;
  extractionCostUsd: number;
}

export interface EditorialContradiction {
  id: string;
  tenantId: string;
  topicId: string;
  priorFactId: string;
  newEvidence: string;
  tensionType: TensionType;
  explanation: string;
  resolution: ContradictionResolution;
  resolvedInPieceId: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export interface EditorialPieceLog {
  id: string;
  tenantId: string;
  topicId: string;
  pieceId: string;
  eventId: string;
  directionalView: "bullish" | "bearish" | "neutral" | "mixed";
  viewConfidence: "low" | "moderate" | "high";
  oneSentenceSummary: string;
  wordCount: number;
  memoryContextTokens: number;
  contradictionsSurfaced: number;
  publishedAt: Date;
}

/**
 * The assembled editorial memory context that gets injected into the
 * identity agent's user message. This is the system's primary output.
 */
export interface EditorialMemoryContext {
  /** The rendered markdown block for prompt injection. */
  renderedBlock: string;
  /** Token count of the rendered block (for budget tracking). */
  tokenCount: number;
  /** Active facts that were included in the context. */
  includedFacts: EditorialFact[];
  /** Pending contradictions that were surfaced. */
  contradictions: EditorialContradiction[];
  /** Whether vector search was used (vs recency-only fallback). */
  usedVectorSearch: boolean;
}
```

```ts
// packages/api/src/memory/store.ts

export interface EditorialMemoryStore {
  /**
   * Retrieve editorial memory context for a persona about to write on a topic.
   * Combines temporal recency, vector similarity (if available), and
   * contradiction detection to build a rich context block.
   *
   * @param tenantId - The broker/client whose editorial memory to retrieve (shared across all identities within that tenant)
   * @param topicId - The topic being covered
   * @param coreAnalysis - The new core analysis (used for contradiction detection)
   * @param queryHints - Optional semantic queries for vector retrieval
   *                     (e.g., the persona's angle, key phrases from the event)
   * @param maxTokens - Budget for the rendered context block (default 600)
   */
  getContext(args: {
    tenantId: string;
    topicId: string;
    coreAnalysis: string;
    queryHints?: string[];
    maxTokens?: number;
  }): Promise<EditorialMemoryContext>;

  /**
   * Extract and store facts from a completed article. One Haiku call
   * per article (~$0.002). Produces N editorial_fact rows + 1 piece_log row.
   */
  recordArticle(args: {
    tenantId: string;
    topicId: string;
    pieceId: string;
    eventId: string;
    articleBody: string;
    publishedAt: Date;
  }): Promise<{
    facts: EditorialFact[];
    pieceLog: EditorialPieceLog;
    extractionCostUsd: number;
  }>;

  /**
   * Run contradiction detection between active facts for a (tenant, topic)
   * and a new core analysis. Returns detected contradictions, writing them
   * to the store with resolution='pending'.
   */
  detectContradictions(args: {
    tenantId: string;
    topicId: string;
    coreAnalysis: string;
  }): Promise<EditorialContradiction[]>;

  /**
   * Mark a contradiction as resolved by a specific piece. Called after
   * the identity agent has produced a piece that addresses the tension.
   */
  resolveContradiction(
    contradictionId: string,
    resolvedInPieceId: string,
  ): Promise<void>;

  /**
   * Invalidate a fact (set valid_to = now). Used when the system detects
   * that a position is superseded.
   */
  invalidateFact(
    factId: string,
    supersededById?: string,
  ): Promise<void>;

  /**
   * Get the current "house view" for a (tenant, topic) — the most recent
   * active position fact. Returns null if no position exists.
   */
  getHouseView(
    tenantId: string,
    topicId: string,
  ): Promise<{ position: EditorialFact; confidence: string } | null>;

  /**
   * List all active facts for a (tenant, topic). Used for diagnostics.
   */
  listActiveFacts(
    tenantId: string,
    topicId: string,
  ): Promise<EditorialFact[]>;

  /**
   * Clear all memory for a (tenant, topic). Used for resets.
   */
  clearMemory(tenantId: string, topicId: string): Promise<void>;
}
```

---

## 6. Embedding Strategy

### 6.1 Model choice

**OpenAI `text-embedding-3-small`** (1536 dimensions, 8191 token context).

- ~$0.02 per 1M tokens — at ~10 facts per article, each ~50 tokens, that's ~$0.00001 per article extraction batch. Negligible
- Works on any host with internet + `OPENAI_API_KEY` (Mac Studio, LXC 101, CI)
- Good financial-text performance (trained on diverse domains including financial)
- 1536d provides strong retrieval quality for pgvector HNSW indexing

### 6.2 Deployment note

LXC 101 does not have access to local LLMs. The `OPENAI_API_KEY` must be added to the LXC environment on the next deploy. The FinFlow repo has its own `.env` with the key (initially copied from `gobot/.env`, may diverge).

### 6.3 Embedding service interface

```ts
// packages/api/src/memory/embeddings.ts

export interface EmbeddingService {
  /**
   * Embed a single text. Returns null if the service is unavailable
   * (graceful degradation to recency-only retrieval).
   */
  embed(text: string): Promise<number[] | null>;

  /**
   * Embed multiple texts in a single batch.
   */
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;

  /** Embedding dimensionality. */
  readonly dimensions: number;
}
```

### 6.4 OpenAI implementation

```ts
// packages/api/src/memory/openai-embeddings.ts

import OpenAI from "openai";

export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions = 1536;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.client = new OpenAI({ apiKey: opts?.apiKey ?? process.env.OPENAI_API_KEY });
    this.model = opts?.model ?? "text-embedding-3-small";
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });
      return res.data[0]?.embedding ?? null;
    } catch {
      return null; // API unavailable — degrade gracefully
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    try {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });
      return res.data.map((d) => d.embedding);
    } catch {
      return texts.map(() => null);
    }
  }
}
```

### 6.5 Divergence-as-feature

The user's insight: vector search introduces natural variation because different personas ask different semantic queries. Implementation:

- Each persona's `getContext` call includes `queryHints` derived from the persona's `preferredAngles`, `personalityTags`, and `brandVoice`
- Premium (macro, cautious) queries: "central bank policy divergence impact on EUR/USD"
- FastTrade (momentum, aggressive) queries: "EUR/USD breakout levels intraday momentum"
- Same topic, same facts in the store, but different semantic queries surface different subsets and rankings
- The identity agent then builds on slightly different retrieved context, producing naturally divergent articles

This means the editorial memory system contributes to cross-tenant uniqueness as a side effect of its primary function (giving each persona coherent memory). No explicit "randomization" needed.

---

## 7. Fact Extraction Pipeline

When a piece is completed, the system extracts structured facts via a Haiku `tool_use` call.

### 7.1 Extraction tool schema

```ts
const FACT_EXTRACTION_TOOL = {
  name: "submit_editorial_facts",
  description: "Extract structured editorial facts from a completed article for the writer's memory.",
  input_schema: {
    type: "object" as const,
    properties: {
      directionalView: {
        type: "string",
        enum: ["bullish", "bearish", "neutral", "mixed"],
      },
      viewConfidence: {
        type: "string",
        enum: ["low", "moderate", "high"],
      },
      oneSentenceSummary: {
        type: "string",
        description: "One sentence (max 30 words) capturing the main argument.",
      },
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            factType: {
              type: "string",
              enum: ["position", "level", "thesis", "analogy", "structure", "cta", "data_point"],
            },
            content: {
              type: "string",
              description: "The fact itself. Be specific and faithful to the text.",
            },
            confidence: {
              type: "string",
              enum: ["low", "moderate", "high"],
            },
          },
          required: ["factType", "content", "confidence"],
        },
        description: "3-10 facts extracted from the article.",
      },
    },
    required: ["directionalView", "viewConfidence", "oneSentenceSummary", "facts"],
  },
};
```

### 7.2 Backward compatibility with NarrativeStateEntry

The extracted facts are a strict superset of the existing `NarrativeStateEntry` fields. The `recordArticle` method internally maps extracted data to produce both:
1. The new `editorial_fact` rows (production path)
2. A `NarrativeStateEntry` (for backward-compat with the existing PoC harness)

This means the existing `renderNarrativeStateDirective` function continues to work during the transition period. New code uses the richer `EditorialMemoryContext`.

---

## 8. Contradiction Detection

### 8.1 When it runs

Contradiction detection runs **before** the identity agent call, as part of `getContext`. It is a lightweight Haiku call (~$0.003) that:

1. Fetches all active `position` and `level` facts for `(tenantId, topicId)`
2. Passes them + the new core analysis to Haiku via `tool_use`
3. Gets back a list of tensions (if any)
4. Stores detected contradictions with `resolution = 'pending'`
5. Includes them in the `EditorialMemoryContext` for the identity agent

### 8.2 Contradiction detector tool schema

```ts
const CONTRADICTION_DETECTOR_TOOL = {
  name: "detect_contradictions",
  description: "Compare prior editorial positions against new market evidence and identify tensions.",
  input_schema: {
    type: "object" as const,
    properties: {
      contradictions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            priorFactContent: { type: "string" },
            newEvidence: { type: "string" },
            tensionType: {
              type: "string",
              enum: ["reversed", "reinforced_but_reframed", "partially_invalidated", "level_stale"],
            },
            explanation: { type: "string" },
            suggestedResolution: {
              type: "string",
              enum: ["superseded", "acknowledged", "dismissed", "pending"],
              description: "Maps directly to ContradictionResolution type: superseded (old fact replaced), acknowledged (shift addressed in next piece), dismissed (false positive), pending (not yet resolved)",
            },
          },
          required: ["priorFactContent", "newEvidence", "tensionType", "explanation", "suggestedResolution"],
        },
      },
    },
    required: ["contradictions"],
  },
};
```

### 8.3 Resolution tracking

After the identity agent produces a piece, the fact extraction step checks whether the generated text addresses any pending contradictions. If the piece contains language that acknowledges a prior position shift (detected via simple heuristics: "as we noted", "our prior view", "we previously", "we've revised"), the corresponding contradictions are marked `resolution = 'acknowledged'`. Unaddressed contradictions remain `pending` and are surfaced again on the next piece.

---

## 9. Context Assembly and Injection

### 9.1 Token budget

The editorial memory context block is capped at **600 tokens** by default. This is:
- ~1.5% of a typical Sonnet identity call (40K+ tokens total)
- Negligible cost impact (~$0.002 per identity call at Sonnet pricing)
- Enough for: 1 active position + 2-3 prior pieces + 1 contradiction alert + guidelines

### 9.2 Rendered format

The context assembler produces a markdown block in this structure:

```markdown
## Editorial Memory — {PersonaName} on {TopicName}

### Your active position
{Directional view} on {topic} ({confidence} confidence, established {date}).
{One-sentence thesis}

### What happened since your last piece
{If contradictions exist: summary of how the market has moved relative to prior calls}
{If reinforced: "Your thesis has been validated by..."}
{If contradicted: "New evidence challenges your prior view because..."}

### Contradiction alerts
{Only if pending contradictions exist}
- {Contradiction 1: prior position vs new evidence, tension type}

### Prior coverage (most recent first, max 3)
- {Date}: "{Summary}." Key levels: {levels}. Structure: {structure pattern}.
  {If analogy used: "Used analogy: {analogy}" — DO NOT reuse}

### Guidelines
- {Dynamic guidelines based on context: reference prior work, own your calls, etc.}
- {If position reinforced: "Lean in and say so explicitly"}
- {If position contradicted: "Acknowledge the shift — do not silently change positions"}
- {If analogies exist in prior: "Do NOT repeat: {list}. Find a fresh metaphor."}
- {If same structure used last time: "Vary your structural approach."}
```

### 9.3 Injection point

The context block is injected into the identity agent's **user message**, after the core analysis and before the persona-specific instructions. This matches the existing `renderNarrativeStateDirective` injection point in `runner.ts`. In the PoC harness, this applies to both Stage 6 (cross-tenant matrix identity calls) and Stage 7 (narrative state test identity calls).

In production (content pipeline stage 7b), the injection happens in the identity adaptation layer, between receiving the cached core analysis and calling the identity agent. The `tenantId` passed to `getContext` is the **broker/client ID**, not the identity ID. Multiple identities within the same tenant (journalist, newsletter, trading desk) all call `getContext` with the same `tenantId` and receive the same editorial memory. Similarly, `recordArticle` uses the broker's `tenantId` so that facts extracted from any identity's output feed back into the shared tenant memory pool.

---

## 10. Anti-patterns

These are explicit constraints to prevent common failure modes:

1. **Never inject memory into the FA Agent (stage 7a).** The FA Agent reasons about markets from first principles using the raw news event. Injecting prior persona-specific memory would bias the shared analytical layer toward one persona's framing. Memory is for identity agents only.

2. **Never let memory override the core analysis.** The editorial memory provides context and framing guidance, but the identity agent must still follow the core analysis for all factual claims. Memory says "you were bullish before"; the core analysis says what is true now. If they conflict, the core analysis wins and the memory surfaces the tension.

3. **Never store the full article body.** Only extracted facts go into the knowledge graph. Storing full articles would bloat the database, inflate retrieval tokens, and leak cross-tenant content if the isolation boundary is ever breached.

4. **Never share memory across tenants. Always share memory within a tenant.** Editorial memory is strictly isolated to `(tenant_id, topic_id)` — no cross-tenant access. But within a tenant, all identities (journalist, newsletter editor, trading desk) share the same editorial memory. The memory represents the broker's institutional positions and editorial history, not any single identity's voice. Each identity reads from the same memory but presents it through its own lens. This is by design: the journalist and the newsletter editor at Premium Capital Markets should reference the same prior positions because they represent the same broker.

5. **Never silently drop contradictions.** If the contradiction detector finds tension, it MUST appear in the editorial memory block. The identity agent can choose how to address it, but the system cannot suppress it. Silent position flips are the specific failure mode this system prevents.

6. **Never embed the full core analysis.** Only extracted facts from completed articles are embedded. The core analysis is used as input to the contradiction detector but is not stored in the memory system (it belongs to the analytical layer, not the editorial layer).

7. **Degrade gracefully when the OpenAI API is unavailable.** The system MUST work without embeddings. Recency-based retrieval (most recent N facts, sorted by `valid_from DESC`) is the fallback. Vector search is an enhancement, not a requirement.

---

## 11. Requirements

### Phase 1: Foundation — Store, Extract, Retrieve

Build the core `EditorialMemoryStore` with extraction and retrieval, without contradiction detection. Wire it into the PoC harness as a drop-in enhancement for the existing `NarrativeStateStore`.

#### Editorial Memory Store (in-memory implementation)

**Acceptance criteria:**
- [x] `InMemoryEditorialMemoryStore` implements the `EditorialMemoryStore` interface (5797f96)
- [x] `recordArticle({ tenantId: "premium", topicId: "eurusd", ... })` extracts 3-10 facts via Haiku `tool_use` and returns them with correct `factType`, `content`, `confidence` fields (5797f96)
- [x] `getContext({ tenantId: "premium", topicId: "eurusd", coreAnalysis: "..." })` returns an `EditorialMemoryContext` with `renderedBlock` containing the prior coverage section, and `tokenCount <= 600` (5797f96)
- [x] `getContext` for a tenant with no prior memory returns `{ renderedBlock: "", tokenCount: 0, includedFacts: [], contradictions: [], usedVectorSearch: false }` (5797f96)
- [x] `getHouseView("premium", "eurusd")` returns the most recent active `position` fact, or null if none exists (5797f96)
- [x] `clearMemory("premium", "eurusd")` sets `valid_to = now` on all facts for that pair and deletes pending contradictions (75aaa8b)
- [x] `invalidateFact(factId, supersededById)` sets `valid_to = now` and `superseded_by = supersededById` on the target fact (5797f96)
- [x] Error case: Haiku extraction call fails -> `recordArticle` throws with descriptive error including the piece_id (5797f96)
- [x] Edge case: article with no discernible position (e.g., a pure data dump) -> extraction returns `directionalView: "neutral"` with `confidence: "low"` and minimal facts (0f69454)
- [x] Edge case: article references levels from a prior piece but reverses the position -> extracted `position` fact has the new direction, old position fact's `valid_to` is not set (that's contradiction detection's job, Phase 2) (0f69454)

#### Embedding Service

**Acceptance criteria:**
- [x] `OpenAIEmbeddingService.embed("bullish EUR/USD thesis")` returns a `number[]` of length 1536 when `OPENAI_API_KEY` is set (5797f96)
- [x] `OpenAIEmbeddingService.embed(...)` returns `null` when the API is unreachable (no throw, no hang, timeout < 5000ms) (5797f96)
- [x] `embedBatch(["text1", "text2"])` returns an array of same length as input (5797f96)
- [x] In-memory store: when embeddings are available, `getContext` with `queryHints` returns facts ranked by cosine similarity to the query (1536d vectors). When embeddings are null, facts are returned by `validFrom DESC` (5797f96)
- [x] Two different `queryHints` for the same `(tenantId, topicId)` with 10+ stored facts return at least one different fact in their top-3 results (the divergence mechanism) (5797f96)

#### PoC Harness Integration

**Acceptance criteria:**
- [x] `runner.ts` accepts an optional `editorialMemory: EditorialMemoryStore` in its options (0f69454)
- [x] When `editorialMemory` is provided, Stage 6 and Stage 7 identity calls receive the `EditorialMemoryContext.renderedBlock` in the user message (same injection point as `renderNarrativeStateDirective`) (0f69454)
- [x] When `editorialMemory` is provided, post-processing after identity calls (Stage 6 + Stage 7) calls `recordArticle` for each completed piece (0f69454)
- [x] When `editorialMemory` is not provided, behavior is identical to the current codebase (no regression) (0f69454)
- [x] The existing `NarrativeStateStore` and `renderNarrativeStateDirective` continue to work unchanged (they are not modified or deleted) (0f69454)
- [x] `bun run typecheck` passes with zero errors (0f69454)

### Phase 2: Contradiction Detection

Add the contradiction detector and wire it into `getContext`.

#### Contradiction Detector

**Acceptance criteria:**
- [x] `detectContradictions({ tenantId, topicId, coreAnalysis })` calls Haiku with prior active position/level facts and returns 0+ `EditorialContradiction` objects (75aaa8b)
- [x] Detected contradictions are stored with `resolution = 'pending'` (75aaa8b)
- [x] Each contradiction has a valid `tensionType` from the enum and a non-empty `explanation` (75aaa8b)
- [x] `resolveContradiction(id, pieceId)` sets `resolution = 'acknowledged'` and `resolved_at = now` (75aaa8b)
- [x] `getContext` includes pending contradictions in the rendered block under "Contradiction alerts" (75aaa8b)
- [x] The rendered block includes explicit guidelines when contradictions exist: "Acknowledge the shift — do not silently change positions" (75aaa8b)
- [x] Error case: Haiku contradiction call fails -> `detectContradictions` returns empty array (no crash), logs warning (75aaa8b)
- [x] Edge case: no active position facts exist -> `detectContradictions` returns empty array without calling Haiku (saves cost) (75aaa8b)
- [x] Edge case: prior position is reinforced (not contradicted) -> returns empty contradictions array, and `getContext` includes "Your thesis has been validated" language in the rendered block (75aaa8b)
- [x] After `recordArticle` runs, any pending contradictions for that `(tenantId, topicId)` are checked against the new article text for resolution signals (heuristic: presence of phrases like "our prior view", "we previously", "as we noted") (75aaa8b)
- [x] Cost per contradiction detection call: < $0.005 (Haiku, ~200 input tokens of facts + ~300 tokens of core analysis) (75aaa8b)

### Phase 3: Postgres Implementation + Production Wiring

Replace the in-memory store with Postgres + pgvector. Wire into the content pipeline (not just the PoC harness).

#### Drizzle Schema + Postgres Store

**Acceptance criteria:**
- [ ] Drizzle schema file at `packages/api/src/db/schema/editorial-memory.ts` defines `editorialFacts`, `editorialContradictions`, and `editorialPieceLogs` tables matching the data model in section 4
- [ ] `PostgresEditorialMemoryStore` implements `EditorialMemoryStore` with all the same behavior as the in-memory version
- [ ] pgvector HNSW index on `editorial_facts.embedding` column with `vector_cosine_ops`
- [ ] `getContext` vector search query: `SELECT * FROM editorial_facts WHERE tenant_id = $1 AND topic_id = $2 AND valid_to IS NULL ORDER BY embedding <=> $3 LIMIT 10`
- [ ] Migration is reversible: `down` migration drops all three tables cleanly
- [ ] `bun run typecheck` passes
- [ ] Integration test: `recordArticle` -> `getContext` round-trips through Postgres correctly

#### Content Pipeline Integration

**Acceptance criteria:**
- [ ] In stage 7b (identity adaptation), `getContext` is called before each identity agent call with `queryHints` derived from the persona's `preferredAngles` and `personalityTags`
- [ ] After each identity agent call, `recordArticle` is called to persist extracted facts
- [ ] `detectContradictions` runs as part of `getContext` (not a separate call site)
- [ ] Feature-gated via env var `FINFLOW_EDITORIAL_MEMORY=1` (same pattern as other feature flags). When unset, the pipeline behaves exactly as today
- [ ] Latency impact: `getContext` adds < 800ms to each identity call (Haiku contradiction + Postgres query + OpenAI embed)
- [ ] Cost impact: < $0.01 per article (extraction + contradiction detection)

---

## 12. Implementation Plan (Sprint Contracts)

### Phase 1

- [x] **Task 1:** Define core types and interfaces (done in 5797f96)
  - **Files:** `packages/api/src/memory/types.ts`, `packages/api/src/memory/store.ts`
  - **Depends on:** Nothing
  - **Verify:** `bun run typecheck` passes. Types are importable from other modules.

- [x] **Task 2:** Implement OpenAI embedding service (done in 5797f96)
  - **Files:** `packages/api/src/memory/embeddings.ts`, `packages/api/src/memory/openai-embeddings.ts`
  - **Depends on:** Task 1
  - **Verify:** With `OPENAI_API_KEY` set: `embed("test")` returns 1536-dim array. Without key: `embed("test")` returns null within 5s. `bun run typecheck` passes.

- [x] **Task 3:** Implement fact extraction agent (done in 5797f96)
  - **Files:** `packages/api/src/memory/fact-extractor.ts`
  - **Depends on:** Task 1
  - **Verify:** Given a sample article body, the extractor returns 3-10 structured facts via Haiku tool_use. Each fact has valid `factType`, non-empty `content`, valid `confidence`. Cost < $0.005 per call. `bun run typecheck` passes.

- [x] **Task 4:** Implement in-memory editorial memory store (done in 5797f96)
  - **Files:** `packages/api/src/memory/in-memory-store.ts`
  - **Depends on:** Tasks 1, 2, 3
  - **Verify:** `recordArticle` -> `getContext` round-trip works. `getHouseView` returns the most recent position. `clearMemory` invalidates all facts. Vector search with `queryHints` returns different results than recency-only. `bun run typecheck` passes.

- [x] **Task 5:** Implement context assembler (done in 5797f96)
  - **Files:** `packages/api/src/memory/context-assembler.ts`
  - **Depends on:** Task 1
  - **Verify:** Given facts + contradictions, produces a markdown block under 600 tokens. Block contains: active position, prior coverage, guidelines. Empty facts produce empty string. `bun run typecheck` passes.

- [x] **Task 6:** Wire into PoC harness (done in 0f69454)
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/runner.ts` (modification)
  - **Depends on:** Tasks 4, 5
  - **Verify:** `bun run poc:uniqueness:full --fixture iran-strike` without editorial memory flag behaves identically to baseline. With `--editorial-memory` flag: Stage 6 + Stage 7 identity calls include memory context, facts are extracted and stored, second-run identity calls include prior facts. `bun run typecheck` passes.

### Phase 2

- [x] **Task 7:** Implement contradiction detector (done in 75aaa8b)
  - **Files:** `packages/api/src/memory/contradiction-detector.ts`
  - **Depends on:** Tasks 1, 3
  - **Verify:** Given active position facts and a contradicting core analysis, returns at least one `EditorialContradiction` with valid `tensionType` and non-empty `explanation`. Given a reinforcing core analysis, returns empty array. Cost < $0.005 per call. `bun run typecheck` passes.

- [x] **Task 8:** Integrate contradiction detection into store and context assembler (done in 75aaa8b)
  - **Files:** `packages/api/src/memory/in-memory-store.ts` (modification), `packages/api/src/memory/context-assembler.ts` (modification)
  - **Depends on:** Tasks 4, 5, 7
  - **Verify:** `getContext` with contradicting core analysis includes "Contradiction alerts" section in rendered block. `recordArticle` resolves pending contradictions when article text contains acknowledgment language. `bun run typecheck` passes.

- [ ] **Task 9:** End-to-end contradiction walkthrough test
  - **Files:** `packages/api/src/memory/__tests__/contradiction-walkthrough.test.ts`
  - **Depends on:** Task 8
  - **Verify:** The EUR/USD scenario from section 3.4 works end-to-end: store Tuesday bullish position -> Thursday NFP core analysis triggers contradiction -> context block includes tension alert -> identity agent writes piece acknowledging shift -> contradiction marked resolved. Test passes with `bun test`.

### Phase 3

- [x] **Task 10:** Drizzle schema for editorial memory tables (done in 1141dd8)
  - **Files:** `packages/api/src/db/schema/editorial-memory.ts`, `packages/api/drizzle.config.ts`, migration file
  - **Depends on:** Task 1
  - **Verify:** `bun run drizzle:generate` produces migration. Migration applies cleanly to a fresh Postgres + pgvector database. Down migration drops all tables. `bun run typecheck` passes.

- [x] **Task 11:** Postgres editorial memory store (done in ef147c4)
  - **Files:** `packages/api/src/memory/postgres-store.ts`
  - **Depends on:** Tasks 4, 10
  - **Verify:** All acceptance criteria from the in-memory store also pass against the Postgres implementation. Vector search uses pgvector `<=>` operator. `bun run typecheck` passes.

- [ ] **Task 12:** Content pipeline integration — **BLOCKED** (production identity adaptation layer not yet built; PoC harness integration done in Task 6)
  - **Files:** `packages/api/src/pipeline/` (modifications to identity adaptation layer, when it exists)
  - **Depends on:** Tasks 11, 8, **and** workstream C production content pipeline (stage 7b)
  - **Verify:** With `FINFLOW_EDITORIAL_MEMORY=1`, identity calls include editorial memory context. Without the flag, behavior is unchanged. `bun run typecheck` passes.
  - **Blocked because:** The production content pipeline's identity adaptation layer (stage 7b from `docs/specs/2026-04-07-content-pipeline.md`) has not been implemented. Identity agents are only called from the PoC harness today, which already has editorial memory wired in (Task 6, commit 0f69454). Unblocks when stage 7b ships.

---

## 13. Migration Path from NarrativeStateStore

The existing `NarrativeStateStore` (filesystem JSON) and its types (`NarrativeStateEntry`, `TenantTopicNarrativeState`) are **not deleted or modified**. The editorial memory system is a parallel, richer system that coexists during the transition:

| Aspect | NarrativeStateStore (existing) | EditorialMemoryStore (new) |
|--------|-------------------------------|---------------------------|
| Storage | Filesystem JSON | Postgres + pgvector (in-memory for PoC) |
| Scope | PoC harness only | PoC harness + production pipeline |
| Fact granularity | 1 entry per piece (summary, view, levels, thesis) | N facts per piece (typed: position, level, thesis, analogy, structure, cta, data_point) |
| Retrieval | Recency only (most recent N entries) | Recency + vector similarity |
| Contradiction awareness | None | Built-in detector |
| Embedding | None | text-embedding-3-small 1536d via OpenAI API |
| Context rendering | `renderNarrativeStateDirective` | `EditorialMemoryContext.renderedBlock` |

During Phase 1, both systems can be active simultaneously. The PoC harness uses whichever is configured:
- `--persist-narrative-state`: existing filesystem store
- `--editorial-memory`: new editorial memory store

After Phase 3 ships and the production pipeline uses editorial memory, the `NarrativeStateStore` can be deprecated (but not urgently — it's useful as a lightweight lab tool).

---

## 14. Constraints

- **Strict TypeScript, no `any`.** All Haiku tool_use responses parsed through Zod schemas
- **All structured output via Anthropic `tool_use`.** No JSON-in-text parsing
- **Repository pattern.** `EditorialMemoryStore` interface with in-memory and Postgres implementations
- **No Python.** This is a pure TS implementation. The MemPalace integration spec (2026-04-10) is superseded for the memory system itself. MemPalace philosophy (temporal KG, contradiction awareness) is adopted; the Python dependency is not
- **OpenAI API required for embeddings.** `OPENAI_API_KEY` must be set. Graceful degradation when unavailable. Key available in repo `.env`
- **API dependencies: Anthropic (LLM) + OpenAI (embeddings only).** No Voyage AI, no Cohere, no local model requirement
- **Backward-compatible.** Existing PoC runs without flags produce byte-identical results
- **Per-persona isolation.** No cross-tenant memory access. Ever

---

## 15. Out of Scope

| Item | Why not now |
|------|-----------|
| Real-time market data feed for prediction verification | FA Agent analysis resolves predictions implicitly. Market data feed is a @wfx/sources concern (workstream B) |
| Cross-topic memory (e.g., EUR/USD view influences DXY analysis) | Requires a topic relationship graph. Park for v2 |
| Client-facing thesis editing UI (section 8.7 of content-pipeline spec) | Depends on editorial memory being validated in production first |
| Analogy generation / suggestion | The system tells the identity agent which analogies to AVOID. Suggesting new ones is a creative task better left to the LLM |
| Multi-language memory (e.g., English memory informing Spanish article) | Embeddings would need to be multilingual. Defer until translation + memory intersection is understood |
| Bulk backfill from existing PoC runs | Old runs have unstable persona IDs and no structured fact extraction. Start fresh |
| MemPalace MCP integration | The editorial memory system is self-contained. MemPalace can later index its outputs as drawers, but is not a dependency |
| HITL override of memory (manual fact editing, thesis correction) | Production feature for v1.5 (content-pipeline spec section 8.7) |

---

## 16. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Should the contradiction detector also compare against OTHER personas' positions on the same topic? (e.g., "Premium is bullish but FastTrade is bearish — is this intentional or a consistency bug?") | Would add a cross-tenant coherence check. Currently out of scope per anti-pattern #4, but could be an optional diagnostic mode | Before Phase 3 |
| 2 | What is the retention policy for invalidated facts? Keep forever for audit, or GC after N days? | Affects storage growth. Not urgent for PoC, matters for production | Before Phase 3 |
| 3 | Should the conformance pass (existing Style & Voice specialist) run AFTER editorial memory injection? If so, does it need memory-awareness to avoid stripping temporal references? | Could conflict: conformance might remove "as we noted Tuesday" as non-brand-voice. Needs testing | Before Phase 3 |
| 4 | When @wfx/sources ships with market data adapters, should spot prices be stored as `data_point` facts in the editorial memory? This would give the contradiction detector ground-truth price data instead of relying solely on FA Agent analysis | Would improve prediction verification accuracy but adds a data pipeline dependency | After workstream B ships |
| 5 | Should the editorial memory context include a "track record score" (e.g., "3 of your last 5 directional calls were validated by subsequent events")? The user's Round 2 answer implies this matters for making content feel human | Requires systematic resolution tracking, which depends on contradiction detection being robust. Phase 2 prerequisite | After Phase 2 validation |

---

## 17. Cost and Latency Budget

### Per-article cost

| Operation | Model | Estimated cost |
|-----------|-------|---------------|
| Fact extraction | Haiku | $0.002 |
| Contradiction detection | Haiku | $0.003 |
| Embedding (OpenAI) | text-embedding-3-small | ~$0.00002 |
| **Total per article** | | **$0.005** |

Against the current ~$0.50 per run (4 personas), editorial memory adds ~$0.02 (4 x $0.005) = **4% cost increase**. Negligible.

### Per-article latency

| Operation | Estimated time |
|-----------|---------------|
| `getContext` (Postgres query + OpenAI embed + Haiku contradiction) | 400-800ms |
| `recordArticle` (Haiku extraction + Postgres write + OpenAI embed batch) | 300-600ms |
| **Total per article** | **500-900ms** |

Against identity agent generation time (20-60s), editorial memory adds < 2% latency. The `recordArticle` call runs after the identity call completes, so only `getContext` is on the critical path.

---

## 18. Validation Strategy

### Phase 1 validation (before proceeding to Phase 2)

Run the PoC harness on the same fixture (e.g., `iran-strike`) with 4 personas:
1. **Run A:** baseline, no editorial memory
2. **Run B:** with editorial memory, first run (no prior facts — should behave like baseline)
3. **Run C:** with editorial memory, second run on a follow-up event (should reference Run B's positions)

**Pass criteria:**
- Run B output quality (judge scores) does not regress vs Run A
- Run C articles contain temporal references ("as we noted", "our prior view") for at least 3 of 4 personas
- Run C cross-tenant cosine similarity is at least 0.02 lower than Run A (the divergence mechanism is measurable)
- `bun run typecheck` passes throughout

### Phase 2 validation (before proceeding to Phase 3)

Run a 3-event sequence where event 2 contradicts event 1's direction:
1. Event 1: EUR bearish signal -> personas take bearish positions
2. Event 2: EUR bullish reversal -> contradiction detector fires
3. Event 3: follow-up event -> personas reference their view evolution

**Pass criteria:**
- At least 3 of 4 personas acknowledge the position shift in Event 2 output
- No persona silently flips direction without acknowledgment
- Contradiction resolution is tracked (pending -> acknowledged)
- Judge scores do not regress

### Phase 3 validation (production readiness)

- Postgres store passes all in-memory store acceptance criteria
- Migration applies and rolls back cleanly
- 10-article sequence runs without error against Postgres
- Query latency < 50ms for `getContext` Postgres query (excluding Haiku/OpenAI)
