/**
 * Filesystem-backed persistence for per-(fixture, tenant, topic) narrative state.
 *
 * Unlocks multi-event continuity experiments in the uniqueness PoC: a run can
 * write Stage 6 outputs into the store, and a later run (on a follow-up event
 * in the same fixture namespace) reads them back and injects them into the
 * identity agent as accumulated "writer memory".
 *
 * Spec: docs/specs/2026-04-08-narrative-state-persistence.md
 *
 * Design choices (all locked in the spec):
 *   - Count-based GC only (default maxEntries = 5). No time-based expiry in v1.
 *   - One JSON file per (fixtureId, tenantId, topicId). No indices, no logs.
 *   - Atomic writes via tmpfile + rename.
 *   - Forgetful house view: currentHouseView always equals the newest entry.
 *   - No concurrent-run locking. Documented non-goal.
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type {
  ContentPersona,
  EventSequence,
  NarrativeStateEntry,
  NewsEvent,
  TenantTopicNarrativeState,
} from "./types.js";

// ───────────────────────────────────────────────────────────────────
// Zod schema — the on-disk format
// ───────────────────────────────────────────────────────────────────

const NarrativeStateEntrySchema = z.object({
  pieceId: z.string().min(1),
  publishedAt: z.string().min(1),
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
  recentEntries: z.array(NarrativeStateEntrySchema),
});

export type TenantTopicNarrativeStateFile = z.infer<
  typeof TenantTopicNarrativeStateFileSchema
>;

// ───────────────────────────────────────────────────────────────────
// Interface
// ───────────────────────────────────────────────────────────────────

export interface NarrativeStateStore {
  /** Read the accumulated state for a triple. Returns null if no file exists. */
  get(
    fixtureId: string,
    tenantId: string,
    topicId: string,
  ): Promise<TenantTopicNarrativeState | null>;

  /**
   * Append a new entry, apply count-based GC (oldest dropped first), and
   * return the resulting state. `currentHouseView` / `lastUpdatedAt` are
   * derived from the newest entry.
   */
  append(
    fixtureId: string,
    tenantId: string,
    topicId: string,
    entry: NarrativeStateEntry,
  ): Promise<TenantTopicNarrativeState>;

  /** List all (topic) states for one (fixture, tenant). Order unspecified. */
  list(
    fixtureId: string,
    tenantId: string,
  ): Promise<TenantTopicNarrativeState[]>;

  /** Recursively delete a fixture namespace. Idempotent. */
  clearFixture(fixtureId: string): Promise<void>;
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Derive the topic id used as the store filename for a given news event.
 *
 * For the PoC every `NewsEvent` already carries a required `topicId` field,
 * so this is just a pass-through. Centralising it here gives us a single
 * place to evolve the rule if fixtures ever stop carrying it.
 */
export function deriveTopicId(event: NewsEvent): string {
  return event.topicId;
}

/**
 * Derive the topic id for an `EventSequence`. The spec requires sequences to
 * carry their own `topicId`; this wrapper exists so call sites don't have to
 * know which shape they hold.
 */
export function deriveTopicIdForSequence(sequence: EventSequence): string {
  return sequence.topicId;
}

/**
 * Replace anything that could escape a directory or make a filename awkward
 * with `_`. Defensive — `fixtureId`/`tenantId`/`topicId` are config-derived in
 * practice but the store is on a write path and we'd rather be strict.
 */
function sanitizeComponent(component: string): string {
  const cleaned = component.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (cleaned.length === 0) {
    throw new Error(`sanitizeComponent: empty result for input ${JSON.stringify(component)}`);
  }
  return cleaned;
}

function toInMemory(file: TenantTopicNarrativeStateFile): TenantTopicNarrativeState {
  return {
    tenantId: file.tenantId,
    topicId: file.topicId,
    recentEntries: file.recentEntries,
    currentHouseView: file.currentHouseView,
    currentHouseViewConfidence: file.currentHouseViewConfidence,
    lastUpdatedAt: file.lastUpdatedAt,
  };
}

// ───────────────────────────────────────────────────────────────────
// Default root resolution
// ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * Default root: `packages/api/uniqueness-poc-state/`. Resolved relative to
 * this file so the store works regardless of which directory the CLI was
 * invoked from.
 */
export const DEFAULT_STATE_ROOT = resolve(__dirname, "..", "..", "..", "uniqueness-poc-state");

// ───────────────────────────────────────────────────────────────────
// Filesystem implementation
// ───────────────────────────────────────────────────────────────────

export interface FileSystemNarrativeStateStoreOptions {
  /** Absolute path to the root directory. Defaults to `DEFAULT_STATE_ROOT`. */
  rootDir?: string;
  /** Count-based GC cap applied inside `append`. Default 5. */
  maxEntries?: number;
}

export class FileSystemNarrativeStateStore implements NarrativeStateStore {
  private readonly rootDir: string;
  private readonly maxEntries: number;

  constructor(opts: FileSystemNarrativeStateStoreOptions = {}) {
    this.rootDir = opts.rootDir ?? DEFAULT_STATE_ROOT;
    this.maxEntries = opts.maxEntries ?? 5;
    if (this.maxEntries < 1) {
      throw new Error(`FileSystemNarrativeStateStore: maxEntries must be >= 1, got ${this.maxEntries}`);
    }
  }

  private filePath(fixtureId: string, tenantId: string, topicId: string): string {
    return join(
      this.rootDir,
      sanitizeComponent(fixtureId),
      sanitizeComponent(tenantId),
      `${sanitizeComponent(topicId)}.json`,
    );
  }

  private fixtureDir(fixtureId: string): string {
    return join(this.rootDir, sanitizeComponent(fixtureId));
  }

  private tenantDir(fixtureId: string, tenantId: string): string {
    return join(this.rootDir, sanitizeComponent(fixtureId), sanitizeComponent(tenantId));
  }

  async get(
    fixtureId: string,
    tenantId: string,
    topicId: string,
  ): Promise<TenantTopicNarrativeState | null> {
    const path = this.filePath(fixtureId, tenantId, topicId);
    let raw: string;
    try {
      raw = await fs.readFile(path, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `NarrativeStateStore: corrupt JSON at ${path}: ${(err as Error).message}. Delete the file or wipe the fixture namespace.`,
      );
    }

    const validated = TenantTopicNarrativeStateFileSchema.parse(parsed);
    return toInMemory(validated);
  }

  async append(
    fixtureId: string,
    tenantId: string,
    topicId: string,
    entry: NarrativeStateEntry,
  ): Promise<TenantTopicNarrativeState> {
    const existing = await this.get(fixtureId, tenantId, topicId);
    const prevEntries = existing?.recentEntries ?? [];
    const nextEntries = [...prevEntries, entry].slice(-this.maxEntries);
    const newest = nextEntries[nextEntries.length - 1]!;

    const file: TenantTopicNarrativeStateFile = {
      schemaVersion: 1,
      fixtureId,
      tenantId,
      topicId,
      lastUpdatedAt: newest.publishedAt,
      currentHouseView: newest.directionalView,
      currentHouseViewConfidence: newest.directionalViewConfidence,
      recentEntries: nextEntries,
    };

    // Validate before write so we never persist a shape the loader can't read.
    TenantTopicNarrativeStateFileSchema.parse(file);

    await this.atomicWrite(fixtureId, tenantId, topicId, file);

    return toInMemory(file);
  }

  async list(
    fixtureId: string,
    tenantId: string,
  ): Promise<TenantTopicNarrativeState[]> {
    const dir = this.tenantDir(fixtureId, tenantId);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const jsonFiles = names.filter((n) => n.endsWith(".json"));
    const states = await Promise.all(
      jsonFiles.map(async (name) => {
        const topicId = name.replace(/\.json$/, "");
        return this.get(fixtureId, tenantId, topicId);
      }),
    );

    return states.filter((s): s is TenantTopicNarrativeState => s !== null);
  }

  async clearFixture(fixtureId: string): Promise<void> {
    const dir = this.fixtureDir(fixtureId);
    await fs.rm(dir, { recursive: true, force: true });
  }

  private async atomicWrite(
    fixtureId: string,
    tenantId: string,
    topicId: string,
    payload: TenantTopicNarrativeStateFile,
  ): Promise<void> {
    const finalPath = this.filePath(fixtureId, tenantId, topicId);
    await fs.mkdir(dirname(finalPath), { recursive: true });

    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpPath = `${finalPath}.tmp-${nonce}`;
    const body = `${JSON.stringify(payload, null, 2)}\n`;

    try {
      await fs.writeFile(tmpPath, body, "utf-8");
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      try {
        await fs.rm(tmpPath, { force: true });
      } catch {
        // best-effort cleanup
      }
      throw err;
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Convenience: per-persona store key resolution
// ───────────────────────────────────────────────────────────────────

/**
 * Helper used by both Stage 6 (sequence mode) and Stage 7 to look up the
 * accumulated state for a persona/topic triple. Returns null if the store is
 * not provided or the file does not exist — callers fall back to their
 * default single-prior behaviour in that case.
 */
export async function lookupPersonaState(args: {
  store: NarrativeStateStore | undefined;
  fixtureId: string | undefined;
  persona: ContentPersona;
  topicId: string;
}): Promise<TenantTopicNarrativeState | null> {
  if (!args.store || !args.fixtureId) return null;
  const state = await args.store.get(args.fixtureId, args.persona.id, args.topicId);
  if (!state || state.recentEntries.length === 0) return null;
  return state;
}
