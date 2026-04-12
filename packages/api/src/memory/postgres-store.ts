/**
 * Postgres + pgvector implementation of EditorialMemoryStore.
 *
 * Port of InMemoryEditorialMemoryStore to Drizzle ORM with pgvector
 * for vector similarity search. Behavior is identical to the in-memory
 * version for all methods on the EditorialMemoryStore interface.
 *
 * Spec: docs/specs/2026-04-12-editorial-memory.md §Phase 3, Task 11
 */

import { and, eq, isNull, inArray, desc, sql, asc } from "drizzle-orm";
import type {
  EditorialContradiction,
  EditorialFact,
  EditorialMemoryContext,
  EditorialPieceLog,
  FactType,
  TensionType,
  ContradictionResolution,
} from "./types.js";
import type { EditorialMemoryStore } from "./store.js";
import type { EmbeddingService } from "./embeddings.js";
import type { Db } from "../db/connection.js";
import {
  editorialFacts,
  editorialContradictions,
  editorialPieceLogs,
} from "../db/schema/editorial-memory.js";
import { extractEditorialFacts } from "./fact-extractor.js";
import { assembleEditorialContext } from "./context-assembler.js";
import {
  detectContradictions as detectContradictionsLLM,
  containsAcknowledgmentLanguage,
} from "./contradiction-detector.js";

/** Map a Drizzle row from editorial_facts to an EditorialFact. */
function rowToFact(row: typeof editorialFacts.$inferSelect): EditorialFact {
  return {
    id: row.id,
    tenantId: row.tenantId,
    topicId: row.topicId,
    pieceId: row.pieceId,
    factType: row.factType as FactType,
    content: row.content,
    embedding: row.embedding,
    confidence: row.confidence as "low" | "moderate" | "high",
    validFrom: row.validFrom,
    validTo: row.validTo,
    supersededBy: row.supersededBy,
    sourceEventId: row.sourceEventId,
    extractionModel: row.extractionModel,
    extractionCostUsd: Number(row.extractionCostUsd),
  };
}

/** Map a Drizzle row from editorial_contradictions to an EditorialContradiction. */
function rowToContradiction(
  row: typeof editorialContradictions.$inferSelect,
): EditorialContradiction {
  return {
    id: row.id,
    tenantId: row.tenantId,
    topicId: row.topicId,
    priorFactId: row.priorFactId,
    newEvidence: row.newEvidence,
    tensionType: row.tensionType as TensionType,
    explanation: row.explanation,
    resolution: row.resolution as ContradictionResolution,
    resolvedInPieceId: row.resolvedInPieceId,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
  };
}

/** Map a Drizzle row from editorial_piece_logs to an EditorialPieceLog. */
function rowToPieceLog(
  row: typeof editorialPieceLogs.$inferSelect,
): EditorialPieceLog {
  return {
    id: row.id,
    tenantId: row.tenantId,
    topicId: row.topicId,
    pieceId: row.pieceId,
    eventId: row.eventId,
    directionalView: row.directionalView as
      | "bullish"
      | "bearish"
      | "neutral"
      | "mixed",
    viewConfidence: row.viewConfidence as "low" | "moderate" | "high",
    oneSentenceSummary: row.oneSentenceSummary,
    wordCount: row.wordCount,
    memoryContextTokens: row.memoryContextTokens,
    contradictionsSurfaced: row.contradictionsSurfaced,
    publishedAt: row.publishedAt,
  };
}

/** Key for the (tenant, topic) pair — used for dedup set. */
function ttKey(tenantId: string, topicId: string): string {
  return `${tenantId}::${topicId}`;
}

export class PostgresEditorialMemoryStore implements EditorialMemoryStore {
  private readonly db: Db;
  private readonly embeddings: EmbeddingService | null;
  /** Tracks which (tenant::topic) pairs have already had contradiction
   *  detection run in this session, to avoid duplicate Haiku calls. */
  private contradictionDetectionRan: Set<string> = new Set();

  constructor(opts: { db: Db; embeddings?: EmbeddingService }) {
    this.db = opts.db;
    this.embeddings = opts.embeddings ?? null;
  }

  async getContext(args: {
    tenantId: string;
    topicId: string;
    coreAnalysis: string;
    queryHints?: string[];
    maxTokens?: number;
  }): Promise<EditorialMemoryContext> {
    let activeFacts = await this.listActiveFacts(args.tenantId, args.topicId);
    let usedVectorSearch = false;

    // Vector search: if we have embeddings and query hints, use pgvector <=>
    if (
      this.embeddings &&
      args.queryHints &&
      args.queryHints.length > 0 &&
      activeFacts.length > 0
    ) {
      const queryEmbedding = await this.embeddings.embed(
        args.queryHints.join(" "),
      );
      if (queryEmbedding) {
        const vectorStr = `[${queryEmbedding.join(",")}]`;
        // Query facts with embeddings, ranked by cosine similarity
        const vectorRows = await this.db
          .select()
          .from(editorialFacts)
          .where(
            and(
              eq(editorialFacts.tenantId, args.tenantId),
              eq(editorialFacts.topicId, args.topicId),
              isNull(editorialFacts.validTo),
              sql`${editorialFacts.embedding} IS NOT NULL`,
            ),
          )
          .orderBy(sql`${editorialFacts.embedding} <=> ${vectorStr}::vector`);

        if (vectorRows.length > 0) {
          usedVectorSearch = true;
          const vectorFacts = vectorRows.map(rowToFact);
          // Merge: vector-ranked first, then any without embeddings by recency
          const vectorIds = new Set(vectorFacts.map((f) => f.id));
          const withoutEmbeddings = activeFacts
            .filter((f) => !vectorIds.has(f.id) && f.embedding === null)
            .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
          activeFacts = [...vectorFacts, ...withoutEmbeddings];
        }
      }
    }

    // Get recent piece logs
    const recentPieceRows = await this.db
      .select()
      .from(editorialPieceLogs)
      .where(
        and(
          eq(editorialPieceLogs.tenantId, args.tenantId),
          eq(editorialPieceLogs.topicId, args.topicId),
        ),
      )
      .orderBy(desc(editorialPieceLogs.publishedAt))
      .limit(5);
    // Reverse to oldest-first (matching in-memory store's sort asc → slice(-5))
    const recentPieces = recentPieceRows.map(rowToPieceLog).reverse();

    // Run contradiction detection (once per tenant+topic per session)
    const detectionKey = ttKey(args.tenantId, args.topicId);
    if (!this.contradictionDetectionRan.has(detectionKey)) {
      await this.detectContradictions({
        tenantId: args.tenantId,
        topicId: args.topicId,
        coreAnalysis: args.coreAnalysis,
      });
      this.contradictionDetectionRan.add(detectionKey);
    }

    // Get all pending contradictions
    const pendingContradictions = await this.getPendingContradictions(
      args.tenantId,
      args.topicId,
    );

    return assembleEditorialContext({
      tenantId: args.tenantId,
      topicId: args.topicId,
      activeFacts,
      recentPieces,
      contradictions: pendingContradictions,
      maxTokens: args.maxTokens,
      usedVectorSearch,
      contradictionDetectionRan:
        this.contradictionDetectionRan.has(detectionKey),
    });
  }

  async recordArticle(args: {
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
  }> {
    const extraction = await extractEditorialFacts(args.articleBody);

    // Embed all fact contents in a batch
    let embeddings: (number[] | null)[] = [];
    if (this.embeddings) {
      embeddings = await this.embeddings.embedBatch(
        extraction.result.facts.map((f) => f.content),
      );
    }

    const wordCount = args.articleBody.split(/\s+/).length;

    // Insert facts and piece log in a transaction
    const insertedFacts: EditorialFact[] = [];
    let pieceLogResult: EditorialPieceLog | undefined;

    await this.db.transaction(async (tx) => {
      // Insert facts
      for (let i = 0; i < extraction.result.facts.length; i++) {
        const f = extraction.result.facts[i]!;
        const emb = embeddings[i] ?? null;
        const costPerFact =
          extraction.costUsd / extraction.result.facts.length;

        const [row] = await tx
          .insert(editorialFacts)
          .values({
            tenantId: args.tenantId,
            topicId: args.topicId,
            pieceId: args.pieceId,
            factType: f.factType,
            content: f.content,
            embedding: emb,
            confidence: f.confidence,
            validFrom: args.publishedAt,
            sourceEventId: args.eventId,
            extractionModel: "claude-haiku-4-5-20251001",
            extractionCostUsd: costPerFact.toFixed(6),
          })
          .returning();

        if (row) {
          insertedFacts.push(rowToFact(row));
        }
      }

      // Insert piece log
      const [logRow] = await tx
        .insert(editorialPieceLogs)
        .values({
          tenantId: args.tenantId,
          topicId: args.topicId,
          pieceId: args.pieceId,
          eventId: args.eventId,
          directionalView: extraction.result.directionalView,
          viewConfidence: extraction.result.viewConfidence,
          oneSentenceSummary: extraction.result.oneSentenceSummary,
          wordCount,
          memoryContextTokens: 0,
          contradictionsSurfaced: 0,
          publishedAt: args.publishedAt,
        })
        .returning();

      if (logRow) {
        pieceLogResult = rowToPieceLog(logRow);
      }
    });

    if (!pieceLogResult) {
      throw new Error("Failed to insert piece log — RETURNING yielded no rows");
    }
    const pieceLog: EditorialPieceLog = pieceLogResult;

    // Auto-resolve pending contradictions in a second transaction (#4 fix)
    const pendingContradictions = await this.getPendingContradictions(
      args.tenantId,
      args.topicId,
    );
    if (
      pendingContradictions.length > 0 &&
      containsAcknowledgmentLanguage(args.articleBody)
    ) {
      // Batch-fetch all prior facts for pending contradictions (#6 fix: avoid N+1)
      const priorFactIds = pendingContradictions.map((c) => c.priorFactId);
      const priorFactRows = await this.db
        .select()
        .from(editorialFacts)
        .where(inArray(editorialFacts.id, priorFactIds));
      const priorFactMap = new Map(priorFactRows.map((r) => [r.id, r]));

      const bodyLower = args.articleBody.toLowerCase();
      let resolved = 0;

      await this.db.transaction(async (tx) => {
        for (const c of pendingContradictions) {
          const priorFactRow = priorFactMap.get(c.priorFactId);
          const priorKeyTerms = priorFactRow
            ? priorFactRow.content
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 4)
            : [];
          const explanationTerms = c.explanation
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 4);
          const allTerms = [...priorKeyTerms, ...explanationTerms];

          // Require at least 2 key terms to consider it addressed
          const termHits = allTerms.filter((t) =>
            bodyLower.includes(t),
          ).length;
          if (termHits >= 2) {
            await tx
              .update(editorialContradictions)
              .set({
                resolution: "acknowledged",
                resolvedInPieceId: args.pieceId,
                resolvedAt: new Date(),
              })
              .where(eq(editorialContradictions.id, c.id));
            resolved++;
          }
        }

        if (resolved > 0) {
          await tx
            .update(editorialPieceLogs)
            .set({ contradictionsSurfaced: resolved })
            .where(eq(editorialPieceLogs.id, pieceLog.id));
        }
      });

      if (resolved > 0) {
        pieceLog.contradictionsSurfaced = resolved;
      }
    }

    return {
      facts: insertedFacts,
      pieceLog,
      extractionCostUsd: extraction.costUsd,
    };
  }

  async detectContradictions(args: {
    tenantId: string;
    topicId: string;
    coreAnalysis: string;
  }): Promise<EditorialContradiction[]> {
    const activeFacts = await this.listActiveFacts(args.tenantId, args.topicId);
    const detection = await detectContradictionsLLM(
      activeFacts,
      args.coreAnalysis,
    );

    const factIdSet = new Set(activeFacts.map((f) => f.id));

    const contradictions: EditorialContradiction[] = [];
    for (const c of detection.contradictions) {
      const priorFactId = factIdSet.has(c.priorFactId)
        ? c.priorFactId
        : activeFacts.find((f) =>
            f.content.includes(c.priorFactContent.slice(0, 40)),
          )?.id;

      // Skip if Haiku hallucinated an ID we can't resolve — FK would fail
      if (!priorFactId) continue;

      const [row] = await this.db
        .insert(editorialContradictions)
        .values({
          tenantId: args.tenantId,
          topicId: args.topicId,
          priorFactId,
          newEvidence: c.newEvidence,
          tensionType: c.tensionType,
          explanation: c.explanation,
          resolution: "pending",
        })
        .returning();

      if (row) {
        contradictions.push(rowToContradiction(row));
      }
    }

    return contradictions;
  }

  async resolveContradiction(
    contradictionId: string,
    resolvedInPieceId: string,
  ): Promise<void> {
    await this.db
      .update(editorialContradictions)
      .set({
        resolution: "acknowledged" as ContradictionResolution,
        resolvedInPieceId,
        resolvedAt: new Date(),
      })
      .where(eq(editorialContradictions.id, contradictionId));
  }

  async invalidateFact(
    factId: string,
    supersededById?: string,
  ): Promise<void> {
    await this.db
      .update(editorialFacts)
      .set({
        validTo: new Date(),
        ...(supersededById ? { supersededBy: supersededById } : {}),
      })
      .where(eq(editorialFacts.id, factId));
  }

  async getHouseView(
    tenantId: string,
    topicId: string,
  ): Promise<{ position: EditorialFact; confidence: string } | null> {
    const [row] = await this.db
      .select()
      .from(editorialFacts)
      .where(
        and(
          eq(editorialFacts.tenantId, tenantId),
          eq(editorialFacts.topicId, topicId),
          isNull(editorialFacts.validTo),
          eq(editorialFacts.factType, "position"),
        ),
      )
      .orderBy(desc(editorialFacts.validFrom))
      .limit(1);

    if (!row) return null;
    const fact = rowToFact(row);
    return { position: fact, confidence: fact.confidence };
  }

  async listActiveFacts(
    tenantId: string,
    topicId: string,
  ): Promise<EditorialFact[]> {
    const rows = await this.db
      .select()
      .from(editorialFacts)
      .where(
        and(
          eq(editorialFacts.tenantId, tenantId),
          eq(editorialFacts.topicId, topicId),
          isNull(editorialFacts.validTo),
        ),
      )
      .orderBy(asc(editorialFacts.validFrom));

    return rows.map(rowToFact);
  }

  async clearMemory(tenantId: string, topicId: string): Promise<void> {
    // Invalidate all active facts
    await this.db
      .update(editorialFacts)
      .set({ validTo: new Date() })
      .where(
        and(
          eq(editorialFacts.tenantId, tenantId),
          eq(editorialFacts.topicId, topicId),
          isNull(editorialFacts.validTo),
        ),
      );

    // Delete pending contradictions
    await this.db
      .delete(editorialContradictions)
      .where(
        and(
          eq(editorialContradictions.tenantId, tenantId),
          eq(editorialContradictions.topicId, topicId),
          eq(editorialContradictions.resolution, "pending"),
        ),
      );

    // Reset contradiction detection dedup
    this.contradictionDetectionRan.delete(ttKey(tenantId, topicId));
  }

  // ---- Internal helpers ----

  private async getPendingContradictions(
    tenantId: string,
    topicId: string,
  ): Promise<EditorialContradiction[]> {
    const rows = await this.db
      .select()
      .from(editorialContradictions)
      .where(
        and(
          eq(editorialContradictions.tenantId, tenantId),
          eq(editorialContradictions.topicId, topicId),
          eq(editorialContradictions.resolution, "pending"),
        ),
      );

    return rows.map(rowToContradiction);
  }
}
