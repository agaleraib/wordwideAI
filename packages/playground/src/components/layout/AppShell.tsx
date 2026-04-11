/**
 * AppShell — sidebar + topbar + main content.
 * Mirrors the FinFlow mockup `.app-shell` grid (Screen 2 Dashboard).
 */

import type { ReactNode } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import type { PageId } from "../../App";

interface Props {
  children: ReactNode;
  costUsd: number | null;
  runStatus: "idle" | "running" | "complete" | "error";
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

export default function AppShell({ children, costUsd, runStatus, activePage, onNavigate }: Props) {
  return (
    <div className="app-shell min-h-screen">
      <div style={{ gridColumn: "1 / -1" }}>
        <Topbar costUsd={costUsd} runStatus={runStatus} />
      </div>
      <Sidebar activePage={activePage} onNavigate={onNavigate} />
      <main
        style={{
          padding: "var(--sp-6)",
          background: "var(--bg-app)",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Subtle ambient glow — only in dark mode */}
        <div
          aria-hidden
          className="ambient-grid"
        />
        <div
          aria-hidden
          className="ambient-glow"
        />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </main>
    </div>
  );
}
