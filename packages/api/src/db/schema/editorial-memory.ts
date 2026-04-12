/**
 * Drizzle schema for editorial memory tables.
 *
 * Spec: docs/specs/2026-04-12-editorial-memory.md §4 "Data Model"
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---- Custom pgvector column ----

import { customType } from "drizzle-orm/pg-core";

const vector = customType<{
  data: number[];
  driverParam: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === "string") {
      return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map(Number);
    }
    if (Array.isArray(value)) {
      return value as number[];
    }
    throw new Error(`Unexpected pgvector value type: ${typeof value}`);
  },
});

// ---- Tables ----

export const editorialFacts = pgTable(
  "editorial_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    topicId: varchar("topic_id", { length: 64 }).notNull(),
    pieceId: varchar("piece_id", { length: 128 }).notNull(),
    factType: varchar("fact_type", { length: 32 }).notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    confidence: varchar("confidence", { length: 16 }).notNull().default("moderate"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => editorialFacts.id,
    ),
    sourceEventId: varchar("source_event_id", { length: 128 }).notNull(),
    extractionModel: varchar("extraction_model", { length: 64 }).notNull(),
    // Drizzle returns decimal as string at runtime — parse with Number() before arithmetic
    extractionCostUsd: decimal("extraction_cost_usd", {
      precision: 10,
      scale: 6,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_facts_tenant_topic_valid_from").on(
      table.tenantId,
      table.topicId,
      table.validFrom,
    ),
    index("idx_facts_active").on(table.tenantId, table.topicId).where(
      sql`${table.validTo} IS NULL`,
    ),
  ],
);

export const editorialContradictions = pgTable(
  "editorial_contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    topicId: varchar("topic_id", { length: 64 }).notNull(),
    priorFactId: uuid("prior_fact_id")
      .notNull()
      .references(() => editorialFacts.id),
    newEvidence: text("new_evidence").notNull(),
    tensionType: varchar("tension_type", { length: 32 }).notNull(),
    explanation: text("explanation").notNull(),
    resolution: varchar("resolution", { length: 32 }).notNull().default("pending"),
    resolvedInPieceId: varchar("resolved_in_piece_id", { length: 128 }),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_contradictions_pending")
      .on(table.tenantId, table.topicId, table.resolution)
      .where(sql`${table.resolution} = 'pending'`),
  ],
);

export const editorialPieceLogs = pgTable(
  "editorial_piece_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    topicId: varchar("topic_id", { length: 64 }).notNull(),
    pieceId: varchar("piece_id", { length: 128 }).notNull(),
    eventId: varchar("event_id", { length: 128 }).notNull(),
    directionalView: varchar("directional_view", { length: 16 }).notNull(),
    viewConfidence: varchar("view_confidence", { length: 16 }).notNull(),
    oneSentenceSummary: text("one_sentence_summary").notNull(),
    wordCount: integer("word_count").notNull(),
    memoryContextTokens: integer("memory_context_tokens").notNull().default(0),
    contradictionsSurfaced: integer("contradictions_surfaced")
      .notNull()
      .default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_piece_logs_piece_id").on(table.pieceId),
    index("idx_piece_logs_tenant_topic_published").on(
      table.tenantId,
      table.topicId,
      table.publishedAt,
    ),
  ],
);
