/**
 * App-level top bar — brand on the left, cost + run-status on the right.
 * Mirrors the FinFlow mockup `.topbar` block (mockup §Screen 2).
 */

type RunStatus = "idle" | "running" | "complete" | "error";

interface Props {
  costUsd: number | null;
  runStatus: RunStatus;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "idle",
  running: "running…",
  complete: "complete",
  error: "error",
};

export default function Topbar({ costUsd, runStatus }: Props) {
  return (
    <header
      className="flex items-center justify-between px-6 border-b"
      style={{
        height: 52,
        background: "var(--bg-app)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: "-0.3px",
            color: "var(--text-primary)",
          }}
        >
          FinFlow <span style={{ color: "var(--accent)" }}>Playground</span>
        </h1>
        <div
          className="pl-3"
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            borderLeft: "1px solid var(--border)",
            letterSpacing: "0.5px",
            fontWeight: 500,
          }}
        >
          UNIQUENESS POC
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {costUsd != null ? `$${costUsd.toFixed(4)}` : "$0.0000"}
        </div>
        <div className={`status-pill ${runStatus}`}>
          <span className="dot" />
          {STATUS_LABEL[runStatus]}
        </div>
      </div>
    </header>
  );
}
