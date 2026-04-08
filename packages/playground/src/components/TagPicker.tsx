/**
 * TagPicker — multi-select with chip group + popover.
 *
 * Used twice per tenant card: once for angle tags, once for personality tags.
 * Backed by Radix Popover + Tooltip for accessibility.
 *
 * The selected list lives in the parent — this component is fully controlled.
 */

import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { AngleTagInfo, PersonalityTagInfo } from "../lib/types";

type TagInfo = AngleTagInfo | PersonalityTagInfo;

interface Props {
  label: string;
  tags: TagInfo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function groupByCategory(tags: TagInfo[]): Map<string, TagInfo[]> {
  const groups = new Map<string, TagInfo[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return groups;
}

export default function TagPicker({
  label,
  tags,
  selectedIds,
  onChange,
  disabled,
}: Props) {
  const selected = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is TagInfo => t != null);
  const groups = groupByCategory(tags);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="label-uppercase">{label}</div>
      <div className="flex flex-wrap items-center gap-1">
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1"
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              padding: "2px 6px",
              borderRadius: 10,
              background: tag.risk === "caution" ? "var(--warning-subtle)" : "var(--accent-subtle)",
              color: tag.risk === "caution" ? "var(--warning)" : "var(--accent)",
              border: "1px solid",
              borderColor: tag.risk === "caution" ? "var(--warning)" : "var(--accent-muted)",
            }}
          >
            {tag.risk === "caution" && <span title="caution">⚠</span>}
            {tag.id}
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(tag.id)}
              style={{
                background: "transparent",
                border: "none",
                color: "currentColor",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 10,
                padding: 0,
                marginLeft: 2,
              }}
              aria-label={`Remove ${tag.id}`}
            >
              ×
            </button>
          </span>
        ))}

        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="btn-outline"
              style={{ padding: "2px 8px", fontSize: 10 }}
            >
              + add
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="radix-popover-content"
              sideOffset={4}
              align="start"
            >
              <Tooltip.Provider delayDuration={150}>
                {Array.from(groups.entries()).map(([category, items]) => (
                  <div key={category} style={{ marginBottom: 12 }}>
                    <div className="label-uppercase" style={{ padding: 0, marginBottom: 6 }}>
                      {category}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.map((tag) => {
                        const isSelected = selectedIds.includes(tag.id);
                        return (
                          <Tooltip.Root key={tag.id}>
                            <Tooltip.Trigger asChild>
                              <button
                                type="button"
                                onClick={() => toggle(tag.id)}
                                className="text-left"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "4px 6px",
                                  borderRadius: 4,
                                  background: isSelected
                                    ? "var(--accent-subtle)"
                                    : "transparent",
                                  border: "1px solid",
                                  borderColor: isSelected
                                    ? "var(--accent-muted)"
                                    : "transparent",
                                  color: "var(--text-primary)",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  width: "100%",
                                }}
                              >
                                {tag.risk === "caution" && (
                                  <span style={{ color: "var(--warning)" }}>⚠</span>
                                )}
                                <span
                                  className="mono"
                                  style={{ color: "var(--accent)" }}
                                >
                                  {tag.id}
                                </span>
                                <span
                                  style={{
                                    color: "var(--text-muted)",
                                    fontSize: 10,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    flex: 1,
                                  }}
                                >
                                  {tag.description.slice(0, 60)}
                                </span>
                              </button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                className="radix-tooltip-content"
                                side="right"
                                sideOffset={6}
                              >
                                {tag.description}
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Tooltip.Provider>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
