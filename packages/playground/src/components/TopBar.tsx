/**
 * In-page config card. Lives BELOW the app-level Topbar (which is in
 * components/layout/Topbar.tsx). Contains:
 *   - Fixture picker
 *   - Event body textarea
 *   - Stages checkboxes
 *   - Quick-mode segmented control
 */

import * as Checkbox from "@radix-ui/react-checkbox";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { NewsEvent, QuickMode } from "../lib/types";

export type StageId = 1 | 2 | 4 | 5 | 6 | 7;

interface StageMeta {
  id: StageId;
  label: string;
  required?: boolean;
  needsTwoTenants?: boolean;
  needsContinuation?: boolean;
}

const STAGES: StageMeta[] = [
  { id: 1, label: "Stage 1 — FA core", required: true },
  { id: 2, label: "Stage 2 — intra-tenant identities" },
  { id: 4, label: "Stage 4 — reproducibility" },
  { id: 5, label: "Stage 5 — persona A/B" },
  { id: 6, label: "Stage 6 — cross-tenant", needsTwoTenants: true },
  { id: 7, label: "Stage 7 — narrative state A/B", needsContinuation: true },
];

interface Props {
  fixtures: NewsEvent[] | null;
  selectedFixtureId: string | null;
  eventBody: string;
  enabledStages: Set<StageId>;
  quickMode: QuickMode;
  tenantCount: number;
  fixtureHasContinuation: boolean;
  running: boolean;
  onFixtureChange: (id: string | null) => void;
  onEventBodyChange: (body: string) => void;
  onToggleStage: (id: StageId) => void;
  onQuickMode: (mode: QuickMode) => void;
}

const QUICK_MODES: QuickMode[] = ["off", "200", "700", "1500"];

export default function TopBar({
  fixtures,
  selectedFixtureId,
  eventBody,
  enabledStages,
  quickMode,
  tenantCount,
  fixtureHasContinuation,
  running,
  onFixtureChange,
  onEventBodyChange,
  onToggleStage,
  onQuickMode,
}: Props) {
  function isStageDisabled(stage: StageMeta): { disabled: boolean; reason?: string } {
    if (stage.required) return { disabled: true, reason: "Stage 1 is always on." };
    if (stage.needsTwoTenants && tenantCount < 2) {
      return { disabled: true, reason: "Stage 6 needs at least 2 tenants." };
    }
    if (stage.needsContinuation) {
      if (!enabledStages.has(6)) {
        return { disabled: true, reason: "Stage 7 requires Stage 6." };
      }
      if (!fixtureHasContinuation) {
        return {
          disabled: true,
          reason: "Stage 7 requires a fixture with a paired continuation event.",
        };
      }
    }
    return { disabled: false };
  }

  return (
    <div className="card flex flex-col gap-4 fade-up" style={{ marginBottom: 24 }}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1" style={{ minWidth: 220 }}>
          <label className="label-uppercase">Fixture</label>
          <select
            className="input"
            value={selectedFixtureId ?? ""}
            onChange={(e) => onFixtureChange(e.target.value || null)}
            disabled={running || !fixtures}
          >
            <option value="">— select —</option>
            {fixtures?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 320 }}>
          <label className="label-uppercase">Event body</label>
          <textarea
            className="input"
            rows={4}
            value={eventBody}
            onChange={(e) => onEventBodyChange(e.target.value)}
            placeholder="Paste a news event body here, or pick a fixture above to prefill."
            disabled={running}
          />
        </div>

        <div className="flex flex-col gap-2" style={{ minWidth: 240 }}>
          <label className="label-uppercase">Stages</label>
          <Tooltip.Provider delayDuration={150}>
            <div className="flex flex-col gap-1">
              {STAGES.map((stage) => {
                const { disabled, reason } = isStageDisabled(stage);
                const checked = enabledStages.has(stage.id);
                const node = (
                  <label
                    className="flex items-center gap-2"
                    style={{
                      fontSize: 11,
                      color: disabled
                        ? "var(--text-muted)"
                        : "var(--text-secondary)",
                      cursor: disabled || running ? "not-allowed" : "pointer",
                    }}
                  >
                    <Checkbox.Root
                      className="checkbox-root"
                      checked={checked}
                      onCheckedChange={() => onToggleStage(stage.id)}
                      disabled={disabled || running}
                    >
                      <Checkbox.Indicator className="checkbox-indicator">
                        ✓
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    {stage.label}
                  </label>
                );
                return reason ? (
                  <Tooltip.Root key={stage.id}>
                    <Tooltip.Trigger asChild>{node}</Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="radix-tooltip-content" side="left">
                        {reason}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ) : (
                  <div key={stage.id}>{node}</div>
                );
              })}
            </div>
          </Tooltip.Provider>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="label-uppercase">Quick mode</span>
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          {QUICK_MODES.map((mode) => {
            const active = quickMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onQuickMode(mode)}
                disabled={running}
                style={{
                  padding: "4px 12px",
                  background: active ? "var(--accent-subtle)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                  border: "none",
                  borderRight: "1px solid var(--border)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  cursor: running ? "not-allowed" : "pointer",
                  transition: "all var(--duration-fast) var(--ease-out)",
                }}
              >
                {mode === "off" ? "Off" : `${mode}w`}
              </button>
            );
          })}
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          Quick mode forces all tenants to the same word count — useful for tag iteration but output prose may not be representative of production.
        </span>
      </div>
    </div>
  );
}
