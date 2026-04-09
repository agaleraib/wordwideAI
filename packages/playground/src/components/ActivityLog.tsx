import { useEffect, useRef } from "react";
import type { PocSseEvent } from "../lib/types";

export interface ActivityEntry {
  timestampMs: number;
  elapsedMs: number;
  kind: "run" | "stage" | "tenant" | "judge" | "cost" | "error";
  label: string;
  detail?: string;
}

/**
 * Format an SSE event into a single activity-log line. Exported so the
 * PlaygroundUniqueness reducer can append to the log as events arrive.
 */
export function formatEventForLog(
  event: PocSseEvent,
  runStartedAtMs: number | null,
): ActivityEntry {
  const now = Date.now();
  const elapsedMs = runStartedAtMs ? now - runStartedAtMs : 0;

  switch (event.type) {
    case "run_started":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "run",
        label: `Run started (${event.runMode})`,
        detail: `estimated $${event.estimatedCostUsd.toFixed(2)}`,
      };
    case "stage_started": {
      const labels: Record<typeof event.stage, string> = {
        core: "Stage 1 — Opus FA core analysis",
        identity: "Stage 2 — Identity adaptation (Sonnet ×6, parallel)",
        "cross-tenant": "Stage 6 — Cross-pipeline matrix (Sonnet ×N)",
        judge: "Judge pass (Haiku)",
      };
      return {
        timestampMs: now,
        elapsedMs,
        kind: "stage",
        label: labels[event.stage] ?? `Stage: ${event.stage}`,
      };
    }
    case "core_analysis_completed":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "stage",
        label: "Core FA analysis completed",
        detail: `${event.tokens} tokens · $${event.costUsd.toFixed(4)}`,
      };
    case "tenant_started":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "tenant",
        label: `Pipeline ${event.tenantIndex + 1} started`,
        detail: event.personaId,
      };
    case "tenant_completed":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "tenant",
        label: `Pipeline ${event.tenantIndex + 1} completed`,
        detail: `${event.output.wordCount}w · ${(event.output.durationMs / 1000).toFixed(1)}s · $${event.output.costUsd.toFixed(4)}`,
      };
    case "solo_identity_started":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "tenant",
        label: "Solo identity started",
        detail: `${event.personaId} · ${event.identityId}`,
      };
    case "solo_identity_completed":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "tenant",
        label: "Solo identity completed",
        detail: `${event.output.wordCount}w · $${event.output.costUsd.toFixed(4)}`,
      };
    case "judge_completed": {
      const sim = event.similarity;
      const fid = sim.judgeFactualFidelity?.toFixed(2) ?? "—";
      const pres = sim.judgePresentationSimilarity?.toFixed(2) ?? "—";
      const verdict = sim.judgeTrinaryVerdict ?? "—";
      return {
        timestampMs: now,
        elapsedMs,
        kind: "judge",
        label: `Judge: ${sim.identityA} ↔ ${sim.identityB}`,
        detail: `fid ${fid} · pres ${pres} · ${verdict}`,
      };
    }
    case "cost_updated":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "cost",
        label: "Cost updated",
        detail: `$${event.totalCostUsd.toFixed(4)}`,
      };
    case "run_completed":
    case "solo_run_completed":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "run",
        label: "Run completed",
        detail: `$${event.result.totalCostUsd.toFixed(4)} · ${(event.result.totalDurationMs / 1000).toFixed(1)}s`,
      };
    case "run_errored":
      return {
        timestampMs: now,
        elapsedMs,
        kind: "error",
        label: "Run errored",
        detail: event.error,
      };
    default: {
      const unknown = event as { type: string };
      return {
        timestampMs: now,
        elapsedMs,
        kind: "run",
        label: unknown.type ?? "unknown event",
      };
    }
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `+${mm}:${ss}`;
}

function kindColor(kind: ActivityEntry["kind"]): string {
  switch (kind) {
    case "run":
      return "var(--accent)";
    case "stage":
      return "var(--info)";
    case "tenant":
      return "var(--text-primary)";
    case "judge":
      return "var(--purple)";
    case "cost":
      return "var(--text-secondary)";
    case "error":
      return "var(--danger)";
  }
}

interface Props {
  entries: ActivityEntry[];
  running: boolean;
  currentStage: string | null;
}

export default function ActivityLog({ entries, running, currentStage }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track whether the user is pinned to the bottom of the log. Updated
  // by an onScroll handler so manual scroll-up flips it to false and
  // scroll-back-down flips it back to true. We only auto-scroll when
  // it's true, so manual reading positions aren't yanked around.
  const pinnedToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 50; // px of slack for fractional scroll positions
    pinnedToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };

  useEffect(() => {
    if (scrollRef.current && pinnedToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0 && !running) return null;

  return (
    <div
      className="card-raised"
      style={{
        marginBottom: 16,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="label-uppercase">Activity</span>
          {running && (
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--accent)",
                background: "var(--accent-subtle)",
                border: "1px solid var(--accent-muted)",
                padding: "1px 6px",
                borderRadius: 4,
                letterSpacing: "0.5px",
              }}
            >
              ● LIVE
            </span>
          )}
          {currentStage && running && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              {currentStage}
            </span>
          )}
        </div>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          {entries.length} event{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          maxHeight: 220,
          overflowY: "auto",
          padding: "10px 16px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.7,
        }}
      >
        {entries.map((entry, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: "var(--text-muted)",
                width: 56,
                flexShrink: 0,
              }}
            >
              {formatElapsed(entry.elapsedMs)}
            </span>
            <span
              style={{
                color: kindColor(entry.kind),
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={entry.label}
            >
              {entry.label}
            </span>
            {entry.detail && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 10,
                  flexShrink: 0,
                }}
                title={entry.detail}
              >
                {entry.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
