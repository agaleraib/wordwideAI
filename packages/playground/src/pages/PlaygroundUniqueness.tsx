import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import AppShell from "../components/layout/AppShell";
import TopBar, { type StageId } from "../components/TopBar";
import TenantCard, { type TenantState } from "../components/TenantCard";
import FidelityPresentationScatter from "../components/FidelityPresentationScatter";
import TrinaryVerdictDonut from "../components/TrinaryVerdictDonut";
import {
  fetchFixtures,
  fetchPersonas,
  fetchIdentities,
  fetchTags,
  startRun,
} from "../lib/api";
import { useSSE } from "../lib/useSSE";
import type {
  ContentPersona,
  IdentityDefinition,
  NewsEvent,
  PocSseEvent,
  QuickMode,
  SimilarityResult,
  TagsCatalog,
} from "../lib/types";

type RunStatus = "idle" | "running" | "complete" | "error";

interface PageState {
  tenants: TenantState[];
  enabledStages: Set<StageId>;
  quickMode: QuickMode;
  /** Snapshot of per-tenant word counts before quick mode was enabled. */
  preQuickWordCounts: number[] | null;
  runStatus: RunStatus;
  costUsd: number | null;
  pairs: SimilarityResult[];
  errorMessage: string | null;
}

type Action =
  | { type: "set_tenant"; index: number; patch: Partial<TenantState> }
  | { type: "add_tenant"; tenant: TenantState }
  | { type: "remove_tenant" }
  | { type: "toggle_stage"; stage: StageId }
  | { type: "set_quick_mode"; mode: QuickMode }
  | { type: "reset_for_run" }
  | { type: "sse"; event: PocSseEvent }
  | { type: "set_status"; status: RunStatus; errorMessage?: string };

const DEFAULT_PERSONA_ROTATION = [
  "premium-capital-markets",
  "fasttrade-pro",
  "helix-markets",
  "northbridge-wealth",
  "premium-capital-markets",
  "fasttrade-pro",
];

function makeTenant(personaId: string): TenantState {
  return {
    personaId,
    identityId: "in-house-journalist",
    angleTagsOverride: [],
    personalityTagsOverride: [],
    targetWordCount: 800,
    status: "pending",
    body: null,
    wordCount: null,
  };
}

function makeInitialTenants(): TenantState[] {
  return DEFAULT_PERSONA_ROTATION.slice(0, 4).map(makeTenant);
}

function applyQuickMode(
  tenants: TenantState[],
  mode: QuickMode,
  preQuick: number[] | null,
): { tenants: TenantState[]; preQuick: number[] | null } {
  if (mode === "off") {
    if (!preQuick) return { tenants, preQuick: null };
    return {
      tenants: tenants.map((t, i) => ({
        ...t,
        targetWordCount: preQuick[i] ?? t.targetWordCount,
      })),
      preQuick: null,
    };
  }
  const target = parseInt(mode, 10);
  const snapshot =
    preQuick ?? tenants.map((t) => t.targetWordCount);
  return {
    tenants: tenants.map((t) => ({ ...t, targetWordCount: target })),
    preQuick: snapshot,
  };
}

function reducer(state: PageState, action: Action): PageState {
  switch (action.type) {
    case "set_tenant": {
      const tenants = state.tenants.map((t, i) =>
        i === action.index ? { ...t, ...action.patch } : t,
      );
      return { ...state, tenants };
    }
    case "add_tenant": {
      return { ...state, tenants: [...state.tenants, action.tenant] };
    }
    case "remove_tenant": {
      return { ...state, tenants: state.tenants.slice(0, -1) };
    }
    case "toggle_stage": {
      const next = new Set(state.enabledStages);
      if (next.has(action.stage)) {
        next.delete(action.stage);
      } else {
        next.add(action.stage);
      }
      return { ...state, enabledStages: next };
    }
    case "set_quick_mode": {
      const { tenants, preQuick } = applyQuickMode(
        state.tenants,
        action.mode,
        state.preQuickWordCounts,
      );
      return {
        ...state,
        tenants,
        quickMode: action.mode,
        preQuickWordCounts: preQuick,
      };
    }
    case "reset_for_run": {
      return {
        ...state,
        tenants: state.tenants.map((t) => ({
          ...t,
          status: "pending",
          body: null,
          wordCount: null,
        })),
        pairs: [],
        costUsd: null,
        errorMessage: null,
      };
    }
    case "sse": {
      const event = action.event;
      switch (event.type) {
        case "tenant_started": {
          const tenants = state.tenants.map((t, i) =>
            i === event.tenantIndex ? { ...t, status: "generating" as const } : t,
          );
          return { ...state, tenants };
        }
        case "tenant_completed": {
          const tenants = state.tenants.map((t, i) =>
            i === event.tenantIndex
              ? {
                  ...t,
                  status: "complete" as const,
                  body: event.output.body,
                  wordCount: event.output.wordCount,
                }
              : t,
          );
          return { ...state, tenants };
        }
        case "judge_completed": {
          const others = state.pairs.filter(
            (p) => p.pairId !== event.similarity.pairId,
          );
          return { ...state, pairs: [...others, event.similarity] };
        }
        case "cost_updated": {
          return { ...state, costUsd: event.totalCostUsd };
        }
        case "run_completed": {
          return {
            ...state,
            runStatus: "complete",
            costUsd: event.result.totalCostUsd,
          };
        }
        case "run_errored": {
          return { ...state, runStatus: "error", errorMessage: event.error };
        }
        default:
          return state;
      }
    }
    case "set_status": {
      return {
        ...state,
        runStatus: action.status,
        errorMessage: action.errorMessage ?? state.errorMessage,
      };
    }
    default:
      return state;
  }
}

const SSE_EVENT_TYPES: ReadonlyArray<PocSseEvent["type"]> = [
  "run_started",
  "stage_started",
  "core_analysis_completed",
  "tenant_started",
  "tenant_completed",
  "judge_completed",
  "cost_updated",
  "run_completed",
  "run_errored",
];

const FIXTURES_WITH_CONTINUATION: ReadonlySet<string> = new Set(["iran-strike"]);

export default function PlaygroundUniqueness() {
  const [fixtures, setFixtures] = useState<NewsEvent[] | null>(null);
  const [personas, setPersonas] = useState<ContentPersona[] | null>(null);
  const [identities, setIdentities] = useState<IdentityDefinition[] | null>(null);
  const [tagsCatalog, setTagsCatalog] = useState<TagsCatalog | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [eventBody, setEventBody] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const [state, dispatch] = useReducer(reducer, {
    tenants: makeInitialTenants(),
    enabledStages: new Set<StageId>([1, 6]),
    quickMode: "off" as QuickMode,
    preQuickWordCounts: null,
    runStatus: "idle" as RunStatus,
    costUsd: null,
    pairs: [],
    errorMessage: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [f, p, i, t] = await Promise.all([
          fetchFixtures(),
          fetchPersonas(),
          fetchIdentities(),
          fetchTags(),
        ]);
        if (cancelled) return;
        setFixtures(f);
        setPersonas(p);
        setIdentities(i);
        setTagsCatalog(t);
      } catch (err) {
        console.error("[playground] failed to load catalogs", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFixtureChange = useCallback(
    (id: string | null) => {
      setSelectedFixtureId(id);
      if (!id) return;
      const fixture = fixtures?.find((f) => f.id === id);
      if (fixture) {
        setEventBody(fixture.body);
      }
    },
    [fixtures],
  );

  const handleAddTenant = useCallback(() => {
    if (state.tenants.length >= 6) return;
    const personaId =
      DEFAULT_PERSONA_ROTATION[state.tenants.length] ??
      DEFAULT_PERSONA_ROTATION[0]!;
    dispatch({ type: "add_tenant", tenant: makeTenant(personaId) });
  }, [state.tenants.length]);

  const handleRemoveTenant = useCallback(() => {
    if (state.tenants.length <= 1) return;
    dispatch({ type: "remove_tenant" });
  }, [state.tenants.length]);

  const handleRunAll = useCallback(async () => {
    dispatch({ type: "reset_for_run" });
    dispatch({ type: "set_status", status: "running" });
    try {
      const res = await startRun({
        eventBody,
        ...(selectedFixtureId ? { fixtureId: selectedFixtureId } : {}),
        enabledStages: Array.from(state.enabledStages),
        quickMode: state.quickMode,
        tenants: state.tenants.map((t) => ({
          personaId: t.personaId,
          identityId: t.identityId,
          angleTagsOverride: t.angleTagsOverride.length > 0 ? t.angleTagsOverride : null,
          personalityTagsOverride:
            t.personalityTagsOverride.length > 0 ? t.personalityTagsOverride : null,
          targetWordCount: t.targetWordCount,
        })),
      });
      setStreamUrl(res.streamUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      dispatch({ type: "set_status", status: "error", errorMessage: message });
    }
  }, [eventBody, selectedFixtureId, state.tenants, state.enabledStages, state.quickMode]);

  const onSseEvent = useCallback((event: PocSseEvent) => {
    dispatch({ type: "sse", event });
  }, []);

  useSSE<PocSseEvent>(streamUrl, SSE_EVENT_TYPES, {
    onEvent: onSseEvent,
    onError: () => {
      console.warn("[playground] SSE error");
    },
  });

  const showCharts = useMemo(
    () => state.runStatus === "complete" && state.pairs.length > 0,
    [state.runStatus, state.pairs],
  );

  const fixtureHasContinuation = selectedFixtureId
    ? FIXTURES_WITH_CONTINUATION.has(selectedFixtureId)
    : false;

  const running = state.runStatus === "running";

  return (
    <AppShell costUsd={state.costUsd} runStatus={state.runStatus}>
      <div className="flex items-end justify-between fade-up" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Uniqueness Playground</h1>
          <p className="page-subtitle">
            Iterate on tags, personas, and events. Measure what ships.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-accent"
            onClick={handleRunAll}
            disabled={running || eventBody.trim().length === 0}
          >
            {running ? "Running…" : "Run all"}
          </button>
        </div>
      </div>

      {state.errorMessage && (
        <div
          className="mono"
          style={{
            border: "1px solid var(--danger)",
            background: "var(--danger-subtle)",
            color: "var(--danger)",
            padding: "var(--sp-3) var(--sp-4)",
            borderRadius: "var(--radius-md)",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          {state.errorMessage}
        </div>
      )}

      <TopBar
        fixtures={fixtures}
        selectedFixtureId={selectedFixtureId}
        eventBody={eventBody}
        enabledStages={state.enabledStages}
        quickMode={state.quickMode}
        tenantCount={state.tenants.length}
        fixtureHasContinuation={fixtureHasContinuation}
        running={running}
        onFixtureChange={handleFixtureChange}
        onEventBodyChange={setEventBody}
        onToggleStage={(stage) => dispatch({ type: "toggle_stage", stage })}
        onQuickMode={(mode) => dispatch({ type: "set_quick_mode", mode })}
      />

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginBottom: 16,
          transition: "all var(--duration-normal) var(--ease-out)",
        }}
      >
        {state.tenants.map((tenant, i) => (
          <TenantCard
            key={i}
            index={i}
            tenant={tenant}
            personas={personas}
            identities={identities}
            tagsCatalog={tagsCatalog}
            pairs={state.pairs}
            allTenants={state.tenants}
            disabled={running}
            onChange={(patch) => dispatch({ type: "set_tenant", index: i, patch })}
          />
        ))}
      </section>

      <div className="flex items-center gap-2" style={{ marginBottom: 24 }}>
        <button
          type="button"
          className="btn-outline"
          onClick={handleAddTenant}
          disabled={running || state.tenants.length >= 6}
        >
          + Add tenant
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={handleRemoveTenant}
          disabled={running || state.tenants.length <= 1}
        >
          − Remove last tenant
        </button>
        <span className="mono" style={{ color: "var(--text-muted)" }}>
          {state.tenants.length}/6 tenants
        </span>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16,
        }}
      >
        <div className="card-raised">
          <div className="label-uppercase" style={{ marginBottom: 12 }}>
            Fidelity vs Presentation
          </div>
          {showCharts ? (
            <FidelityPresentationScatter pairs={state.pairs} />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{ height: 320, color: "var(--text-muted)", fontSize: 13 }}
            >
              Charts populate after the run completes.
            </div>
          )}
        </div>
        <div className="card-raised">
          <div className="label-uppercase" style={{ marginBottom: 12 }}>
            Trinary verdict
          </div>
          {showCharts ? (
            <TrinaryVerdictDonut pairs={state.pairs} />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{ height: 260, color: "var(--text-muted)", fontSize: 13 }}
            >
              —
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
