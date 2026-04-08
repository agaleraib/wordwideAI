/**
 * AppShell — sidebar + topbar + main content.
 * Mirrors the FinFlow mockup `.app-shell` grid (Screen 2 Dashboard).
 */

import type { ReactNode } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";

interface Props {
  children: ReactNode;
  costUsd: number | null;
  runStatus: "idle" | "running" | "complete" | "error";
}

export default function AppShell({ children, costUsd, runStatus }: Props) {
  return (
    <div
      className="min-h-screen"
      style={{
        display: "grid",
        gridTemplateColumns: "var(--sidebar-width) 1fr",
        gridTemplateRows: "52px 1fr",
        background: "var(--bg-app)",
      }}
    >
      <div style={{ gridColumn: "1 / -1" }}>
        <Topbar costUsd={costUsd} runStatus={runStatus} />
      </div>
      <Sidebar />
      <main
        style={{
          padding: "var(--sp-6)",
          background: "var(--bg-app)",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Subtle ambient glow */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: "var(--sidebar-width)",
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage:
              "radial-gradient(ellipse at top, black 20%, transparent 70%)",
            zIndex: 0,
          }}
        />
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: "20%",
            left: "60%",
            width: 600,
            height: 400,
            transform: "translate(-50%, -50%)",
            background:
              "radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </main>
    </div>
  );
}
