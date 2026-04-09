/**
 * Uniqueness PoC Playground routes (v1.0).
 *
 * Backend for `packages/playground/`. v1.0 surface is intentionally minimal:
 *
 *   GET  /poc/personas         → ContentPersona[]  (the 4 broker presets)
 *   GET  /poc/fixtures         → NewsEvent[]       (the JSON fixtures on disk)
 *   POST /poc/runs             → start a run; returns { runId, streamUrl }
 *   GET  /poc/runs/:id/stream  → SSE stream of stage events for the run
 *
 * Out of scope for v1.0 (deferred to v1.1+ per
 * docs/specs/2026-04-08-uniqueness-poc-playground.md §16):
 *   - persona/tag editing, identity dropdown, stage checkboxes
 *   - cost guards / cap enforcement
 *   - run history, diff view, analyze panel, export
 *
 * v1.0 only enables Stage 6 (cross-tenant matrix). The runner unconditionally
 * also runs Stages 1–3 (FA core, intra-tenant identities, similarity matrix);
 * the playground UI ignores those — only the cross-tenant outputs are surfaced
 * in the tenant grid.
 */

import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runUniquenessPoc,
  runCoreAnalysis,
  runIdentity,
  type RunCallbacks,
} from "../benchmark/uniqueness-poc/runner.js";
import type {
  ContentPersona,
  IdentityDefinition,
  NewsEvent,
  RunResult,
  IdentityOutput,
  SimilarityResult,
} from "../benchmark/uniqueness-poc/types.js";
import {
  ANGLE_TAG_DESCRIPTIONS,
  PERSONALITY_TAG_DESCRIPTIONS,
  type AngleTag,
  type PersonalityTag,
} from "../benchmark/uniqueness-poc/tags.js";
import { classifyTagRisk } from "../benchmark/uniqueness-poc/tags-risk-rules.js";
import { IDENTITY_REGISTRY } from "../benchmark/uniqueness-poc/prompts/identities/index.js";
import {
  persistRun,
  persistSoloRun,
} from "../benchmark/uniqueness-poc/persist.js";

// ───────────────────────────────────────────────────────────────────
// Disk loaders for personas + fixtures
// ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const POC_ROOT = join(__dirname, "..", "benchmark", "uniqueness-poc");
const PERSONAS_DIR = join(POC_ROOT, "personas");
const FIXTURES_DIR = join(POC_ROOT, "fixtures");

function loadPersonas(): ContentPersona[] {
  if (!existsSync(PERSONAS_DIR)) return [];
  return readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(PERSONAS_DIR, f), "utf-8")) as ContentPersona);
}

function loadFixtures(): NewsEvent[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as NewsEvent);
}

// ───────────────────────────────────────────────────────────────────
// SSE event protocol — mirrors the spec §7.5 union (v1.0 subset)
// ───────────────────────────────────────────────────────────────────

/**
 * Solo-mode run result shape (v1.2). A trimmed-down result produced by the
 * Solo branch below — it only carries the single Stage 1 analysis + the one
 * identity output, with no cross-tenant matrix, judge, or verdict.
 */
export interface SoloRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  event: NewsEvent;
  coreAnalysisBody: string;
  personaId: string;
  output: IdentityOutput;
  totalCostUsd: number;
  totalDurationMs: number;
}

export type PocSseEvent =
  | { type: "run_started"; runId: string; estimatedCostUsd: number; runMode: "compare" | "solo" }
  | { type: "stage_started"; stage: "core" | "identity" | "cross-tenant" | "judge" }
  | { type: "core_analysis_completed"; body: string; tokens: number; costUsd: number }
  | { type: "tenant_started"; tenantIndex: number; personaId: string }
  | { type: "tenant_completed"; tenantIndex: number; output: IdentityOutput }
  | { type: "solo_identity_started"; personaId: string; identityId: string }
  | { type: "solo_identity_completed"; output: IdentityOutput }
  | { type: "judge_completed"; pairId: string; similarity: SimilarityResult }
  | { type: "cost_updated"; totalCostUsd: number }
  | { type: "run_completed"; runId: string; result: RunResult | SoloRunResult }
  | { type: "solo_run_completed"; runId: string; result: SoloRunResult }
  | { type: "run_errored"; runId: string; error: string };

// ───────────────────────────────────────────────────────────────────
// In-memory run registry — keyed by runId
// ───────────────────────────────────────────────────────────────────
//
// Each entry buffers events as they fire so a late SSE consumer can replay
// the full stream from the start. When a stream is connected the entry's
// `listener` is set; the runner writes through both the buffer and the
// listener.

interface RunEntry {
  runId: string;
  events: PocSseEvent[];
  listener: ((event: PocSseEvent) => void) | null;
  done: boolean;
}

const runs = new Map<string, RunEntry>();

function emit(entry: RunEntry, event: PocSseEvent): void {
  entry.events.push(event);
  if (event.type === "run_completed" || event.type === "run_errored") {
    entry.done = true;
  }
  entry.listener?.(event);
}

// ───────────────────────────────────────────────────────────────────
// Request schema (v1.0 minimal)
// ───────────────────────────────────────────────────────────────────

const TenantConfigSchema = z.object({
  personaId: z.string().min(1),
  identityId: z.string().min(1).optional(),
  angleTagsOverride: z.array(z.string()).nullable().optional(),
  personalityTagsOverride: z.array(z.string()).nullable().optional(),
  targetWordCount: z.number().int().min(50).max(4000).optional(),
});

const CompareRunRequestSchema = z.object({
  runMode: z.literal("compare"),
  eventBody: z.string().min(1),
  eventTitle: z.string().optional(),
  fixtureId: z.string().nullable().optional(),
  enabledStages: z.array(z.number().int()).optional(),
  quickMode: z.enum(["off", "200", "700", "1500"]).optional(),
  tenants: z.array(TenantConfigSchema).min(2).max(6),
});

const SoloRunRequestSchema = z.object({
  runMode: z.literal("solo"),
  eventBody: z.string().min(1),
  eventTitle: z.string().optional(),
  fixtureId: z.string().nullable().optional(),
  pipeline: TenantConfigSchema,
});

const PlaygroundRunRequestSchema = z.discriminatedUnion("runMode", [
  CompareRunRequestSchema,
  SoloRunRequestSchema,
]);

export type PlaygroundRunRequest = z.infer<typeof PlaygroundRunRequestSchema>;
export type CompareRunRequest = z.infer<typeof CompareRunRequestSchema>;
export type SoloRunRequest = z.infer<typeof SoloRunRequestSchema>;

// ───────────────────────────────────────────────────────────────────
// Run launcher
// ───────────────────────────────────────────────────────────────────

interface EventInputs {
  eventBody: string;
  eventTitle?: string;
  fixtureId?: string | null;
}

function buildEvent(req: EventInputs, fixtures: NewsEvent[]): NewsEvent {
  const fixture = req.fixtureId
    ? fixtures.find((f) => f.id === req.fixtureId)
    : undefined;

  const id =
    fixture?.id ??
    `playground-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  // Default topic = eurusd (spec §18 open question 5; v1.0 hard-codes this)
  const topicId = fixture?.topicId ?? "eurusd";
  const topicName = fixture?.topicName ?? "EUR/USD";
  const topicContext = fixture?.topicContext ?? "";

  const title =
    req.eventTitle ??
    fixture?.title ??
    req.eventBody.slice(0, 80);

  return {
    id,
    title,
    source: fixture?.source ?? "playground",
    publishedAt: fixture?.publishedAt ?? new Date().toISOString(),
    body: req.eventBody,
    topicId,
    topicName,
    topicContext,
  };
}

function resolveTenantPersona(
  t: { personaId: string; angleTagsOverride?: string[] | null; personalityTagsOverride?: string[] | null },
  personas: ContentPersona[],
): ContentPersona {
  const base = personas.find((x) => x.id === t.personaId);
  if (!base) throw new Error(`Unknown personaId: ${t.personaId}`);
  const angleOverride = t.angleTagsOverride;
  const personalityOverride = t.personalityTagsOverride;
  if (
    (angleOverride && angleOverride.length > 0) ||
    (personalityOverride && personalityOverride.length > 0)
  ) {
    return {
      ...base,
      ...(angleOverride && angleOverride.length > 0
        ? { preferredAngles: angleOverride as AngleTag[] }
        : {}),
      ...(personalityOverride && personalityOverride.length > 0
        ? { personalityTags: personalityOverride as PersonalityTag[] }
        : {}),
    };
  }
  return base;
}

function startCompareRun(
  req: CompareRunRequest,
  personas: ContentPersona[],
  fixtures: NewsEvent[],
): { runId: string; entry: RunEntry } {
  // Resolve personas by id, then clone + apply per-tenant tag overrides.
  const tenantPersonas: ContentPersona[] = req.tenants.map((t) =>
    resolveTenantPersona(t, personas),
  );

  const tenantIdentityIds: Array<string | null> = req.tenants.map(
    (t) => t.identityId ?? null,
  );
  const tenantWordCountOverrides: Array<number | null> = req.tenants.map(
    (t) => t.targetWordCount ?? null,
  );

  const event = buildEvent(req, fixtures);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${event.id}`;
  // Stages enabled by default in v1.0: just Stage 6 (cross-tenant matrix).
  // The runner unconditionally also runs Stages 1–3; Stage 2 (intra-tenant
  // identities matrix) cannot be skipped without refactoring.
  // TODO: make Stage 2 truly optional in the runner.
  const enabled = new Set(req.enabledStages ?? [1, 6]);
  const withReproducibility = enabled.has(4)
    ? { identityId: tenantIdentityIds[0] ?? "in-house-journalist", runs: 3 }
    : undefined;
  // Compare mode needs at least 2 pipelines to form a pair. Duplicate
  // personas are allowed — the runner handles that via index-based pair IDs.
  const withCrossTenantMatrix =
    enabled.has(6) && tenantPersonas.length >= 2
      ? {
          identityId: "in-house-journalist",
          personas: tenantPersonas,
          tenantIdentityIds,
          tenantWordCountOverrides,
        }
      : undefined;

  const entry: RunEntry = {
    runId,
    events: [],
    listener: null,
    done: false,
  };
  runs.set(runId, entry);

  // Build callbacks that funnel into the entry buffer.
  const callbacks: RunCallbacks = {
    onRunStarted: (_runId, estimatedCostUsd) =>
      emit(entry, { type: "run_started", runId, estimatedCostUsd, runMode: "compare" }),
    onStageStarted: (stage) =>
      emit(entry, { type: "stage_started", stage }),
    onCoreAnalysisCompleted: (body, costUsd, tokens) =>
      emit(entry, { type: "core_analysis_completed", body, costUsd, tokens }),
    onTenantStarted: (tenantIndex, personaId) =>
      emit(entry, { type: "tenant_started", tenantIndex, personaId }),
    onTenantCompleted: (tenantIndex, output) =>
      emit(entry, { type: "tenant_completed", tenantIndex, output }),
    onJudgeCompleted: (pairId, similarity) =>
      emit(entry, { type: "judge_completed", pairId, similarity }),
    onCostUpdated: (totalCostUsd) =>
      emit(entry, { type: "cost_updated", totalCostUsd }),
    onRunCompleted: (result) =>
      emit(entry, { type: "run_completed", runId, result }),
    onRunErrored: (error) =>
      emit(entry, { type: "run_errored", runId, error: error.message }),
  };

  // Fire and forget — the route returned the runId already; the run continues
  // in the background and the SSE consumer can connect at any time.
  void (async () => {
    try {
      const result = await runUniquenessPoc(
        {
          event,
          ...(withReproducibility ? { withReproducibility } : {}),
          ...(withCrossTenantMatrix ? { withCrossTenantMatrix } : {}),
        },
        callbacks,
      );

      // Persist to disk so the run survives server restarts and can be
      // inspected later with the `analyze-uniqueness-run` skill — same
      // filesystem layout as CLI runs. Errors are swallowed to not mask
      // a successful run.
      try {
        persistRun(result);
      } catch (persistErr) {
        console.error(
          `[poc] failed to persist compare run ${runId}:`,
          persistErr,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      emit(entry, { type: "run_errored", runId, error: error.message });
    }
  })();

  return { runId, entry };
}

// ───────────────────────────────────────────────────────────────────
// Solo run path — one pipeline, Stage 1 + one identity call, no matrix
// ───────────────────────────────────────────────────────────────────

function startSoloRun(
  req: SoloRunRequest,
  personas: ContentPersona[],
  fixtures: NewsEvent[],
): { runId: string; entry: RunEntry } {
  const persona = resolveTenantPersona(req.pipeline, personas);
  const identityId = req.pipeline.identityId ?? "in-house-journalist";
  const targetWordCount = req.pipeline.targetWordCount ?? 800;

  const event = buildEvent(req, fixtures);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${event.id}_solo`;

  const entry: RunEntry = {
    runId,
    events: [],
    listener: null,
    done: false,
  };
  runs.set(runId, entry);

  void (async () => {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();
    try {
      emit(entry, {
        type: "run_started",
        runId,
        estimatedCostUsd: 0,
        runMode: "solo",
      });

      // Stage 1 — core analysis
      emit(entry, { type: "stage_started", stage: "core" });
      const core = await runCoreAnalysis(event);
      emit(entry, {
        type: "core_analysis_completed",
        body: core.body,
        tokens: core.outputTokens,
        costUsd: core.costUsd,
      });
      emit(entry, { type: "cost_updated", totalCostUsd: core.costUsd });

      // Stage 2 — single identity call
      emit(entry, { type: "stage_started", stage: "identity" });
      emit(entry, {
        type: "solo_identity_started",
        personaId: persona.id,
        identityId,
      });
      const output = await runIdentity(identityId, core.body, persona, {
        targetWordCount,
      });
      // Mirror tenant_started/completed so the single PipelineCard surfaces
      // output with the same reducer logic the Compare path uses.
      emit(entry, { type: "tenant_started", tenantIndex: 0, personaId: persona.id });
      emit(entry, { type: "tenant_completed", tenantIndex: 0, output });
      emit(entry, { type: "solo_identity_completed", output });

      const totalCostUsd = core.costUsd + output.costUsd;
      emit(entry, { type: "cost_updated", totalCostUsd });

      const result: SoloRunResult = {
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        event,
        coreAnalysisBody: core.body,
        personaId: persona.id,
        output,
        totalCostUsd,
        totalDurationMs: Date.now() - startTime,
      };
      emit(entry, { type: "solo_run_completed", runId, result });
      emit(entry, { type: "run_completed", runId, result });

      // Persist to disk so the run survives server restarts.
      try {
        persistSoloRun(result);
      } catch (persistErr) {
        console.error(
          `[poc] failed to persist solo run ${runId}:`,
          persistErr,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      emit(entry, { type: "run_errored", runId, error: error.message });
    }
  })();

  return { runId, entry };
}

// ───────────────────────────────────────────────────────────────────
// Hono route factory
// ───────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────
// Tag category groupings — derived from the section headers in tags.ts.
// Kept here so adding a tag in tags.ts is a one-line change in two places.
// ───────────────────────────────────────────────────────────────────

type AngleCategory =
  | "macro"
  | "technical"
  | "action"
  | "risk"
  | "educational"
  | "cross-asset"
  | "positioning";

const ANGLE_TAG_CATEGORIES: Record<AngleCategory, AngleTag[]> = {
  macro: [
    "macro-flow",
    "macro-narrative",
    "geopolitical",
    "central-bank-watch",
    "cycle-positioning",
  ],
  technical: [
    "technical-reaction",
    "levels-and-zones",
    "momentum-driven",
    "pattern-recognition",
  ],
  action: ["trade-idea", "signal-extract", "entry-exit", "risk-managed-trade"],
  risk: [
    "risk-warning",
    "volatility-watch",
    "tail-risk",
    "hedge-suggestion",
    "safe-haven",
  ],
  educational: [
    "educational",
    "concept-walkthrough",
    "historical-parallel",
    "mechanism-explainer",
  ],
  "cross-asset": [
    "correlation-play",
    "cross-asset",
    "sector-rotation",
    "currency-pair-relative",
  ],
  positioning: [
    "positioning",
    "flow-watch",
    "sentiment-extreme",
    "crowded-trade",
  ],
};

type PersonalityCategory =
  | "editorial"
  | "risk-temperament"
  | "communication"
  | "density"
  | "confidence"
  | "tone";

const PERSONALITY_TAG_CATEGORIES: Record<PersonalityCategory, PersonalityTag[]> = {
  editorial: [
    "contrarian",
    "consensus-aligned",
    "independent",
    "skeptical",
    "provocative",
    "balanced",
  ],
  "risk-temperament": [
    "cautious",
    "aggressive",
    "conservative",
    "opportunistic",
    "defensive",
  ],
  communication: [
    "prescriptive",
    "consultative",
    "exploratory",
    "directive",
    "socratic",
  ],
  density: [
    "data-driven",
    "narrative-driven",
    "concise",
    "comprehensive",
    "chart-heavy",
  ],
  confidence: [
    "high-conviction",
    "calibrated",
    "hedged",
    "forecaster",
    "observer",
  ],
  tone: [
    "urgent",
    "measured",
    "formal",
    "conversational",
    "energetic",
    "authoritative",
    "warm",
  ],
};

interface AngleTagInfo {
  id: AngleTag;
  category: AngleCategory;
  description: string;
  risk: "safe" | "caution";
}

interface PersonalityTagInfo {
  id: PersonalityTag;
  category: PersonalityCategory;
  description: string;
  risk: "safe" | "caution";
}

interface TagsCatalog {
  angle: AngleTagInfo[];
  personality: PersonalityTagInfo[];
}

function buildTagsCatalog(): TagsCatalog {
  const angle: AngleTagInfo[] = [];
  for (const [category, ids] of Object.entries(ANGLE_TAG_CATEGORIES) as Array<
    [AngleCategory, AngleTag[]]
  >) {
    for (const id of ids) {
      const description = ANGLE_TAG_DESCRIPTIONS[id];
      angle.push({
        id,
        category,
        description,
        risk: classifyTagRisk(description),
      });
    }
  }
  const personality: PersonalityTagInfo[] = [];
  for (const [category, ids] of Object.entries(
    PERSONALITY_TAG_CATEGORIES,
  ) as Array<[PersonalityCategory, PersonalityTag[]]>) {
    for (const id of ids) {
      const description = PERSONALITY_TAG_DESCRIPTIONS[id];
      personality.push({
        id,
        category,
        description,
        risk: classifyTagRisk(description),
      });
    }
  }
  return { angle, personality };
}

function loadIdentities(): IdentityDefinition[] {
  return IDENTITY_REGISTRY.map((r) => r.definition);
}

export function createPocRoutes() {
  const app = new Hono();

  app.get("/personas", (c) => {
    return c.json(loadPersonas());
  });

  app.get("/fixtures", (c) => {
    return c.json(loadFixtures());
  });

  app.get("/tags", (c) => {
    return c.json(buildTagsCatalog());
  });

  app.get("/identities", (c) => {
    return c.json(loadIdentities());
  });

  app.post("/runs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = PlaygroundRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }

    try {
      const personas = loadPersonas();
      const fixtures = loadFixtures();
      const data = parsed.data;
      const { runId } =
        data.runMode === "solo"
          ? startSoloRun(data, personas, fixtures)
          : startCompareRun(data, personas, fixtures);
      return c.json({ runId, streamUrl: `/poc/runs/${runId}/stream` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/runs/:id/stream", (c) => {
    const id = c.req.param("id");
    const entry = runs.get(id);
    if (!entry) {
      return c.json({ error: `unknown run id: ${id}` }, 404);
    }

    return streamSSE(c, async (stream: SSEStreamingApi) => {
      // Replay buffered events first.
      for (const event of entry.events) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      }

      if (entry.done) {
        return;
      }

      // Subscribe to live events. We bridge through a queue + Promise so the
      // async handler can `await` between writes (Hono's SSE stream is async).
      let resolveNext: (() => void) | null = null;
      const queue: PocSseEvent[] = [];

      entry.listener = (event) => {
        queue.push(event);
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r();
        }
      };

      try {
        while (!entry.done || queue.length > 0) {
          if (queue.length === 0) {
            // Race the next event against a 15s heartbeat timer. If the timer
            // wins and no event arrived in the meantime, emit an SSE heartbeat
            // to keep the connection warm through long LLM calls (Stage 1 Opus
            // can take ~60s, longer than Bun's default idleTimeout).
            type Winner = "event" | "timer";
            const eventWait = new Promise<Winner>((resolve) => {
              resolveNext = () => {
                resolveNext = null;
                resolve("event");
              };
            });
            const timer = new Promise<Winner>((resolve) => {
              setTimeout(() => resolve("timer"), 15000);
            });
            const winner = await Promise.race([eventWait, timer]);
            if (winner === "timer") {
              if (resolveNext) resolveNext = null;
              if (queue.length === 0 && !entry.done) {
                await stream.writeSSE({ event: "heartbeat", data: "{}" });
                continue;
              }
            }
          }
          const next = queue.shift();
          if (!next) continue;
          await stream.writeSSE({
            event: next.type,
            data: JSON.stringify(next),
          });
          if (next.type === "run_completed" || next.type === "run_errored") {
            break;
          }
        }
      } finally {
        entry.listener = null;
      }
    });
  });

  return app;
}
