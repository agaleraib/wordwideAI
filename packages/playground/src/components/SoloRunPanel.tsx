/**
 * SoloRunPanel — full-width split layout used when run mode is "solo".
 *
 * Left: the core FA analysis body (Stage 1 Opus output) in mono font,
 * scrollable. Populates after `core_analysis_completed` fires.
 *
 * Right: a single PipelineCard (the existing TenantCard component,
 * relabelled) for the one pipeline the user is demoing. No mini-matrix,
 * no charts — Solo mode skips the cross-tenant matrix entirely.
 */

import TenantCard, { type TenantState } from "./TenantCard";
import type {
  ContentPersona,
  IdentityDefinition,
  TagsCatalog,
} from "../lib/types";

interface Props {
  pipeline: TenantState;
  coreAnalysisBody: string | null;
  personas: ContentPersona[] | null;
  identities: IdentityDefinition[] | null;
  tagsCatalog: TagsCatalog | null;
  disabled: boolean;
  onChange: (patch: Partial<TenantState>) => void;
}

export default function SoloRunPanel({
  pipeline,
  coreAnalysisBody,
  personas,
  identities,
  tagsCatalog,
  disabled,
  onChange,
}: Props) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div className="card-raised flex flex-col gap-3 fade-up">
        <div className="flex items-center justify-between">
          <span className="label-uppercase">Core FA analysis (Stage 1 · Opus)</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {coreAnalysisBody ? `${coreAnalysisBody.split(/\s+/).length} words` : "—"}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 320,
            maxHeight: 640,
            overflowY: "auto",
            background: "var(--bg-app)",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "var(--sp-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.7,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
          }}
        >
          {coreAnalysisBody ?? (
            <span style={{ color: "var(--text-muted)" }}>
              Waiting for Stage 1 (core FA analysis)…
            </span>
          )}
        </div>
      </div>

      <TenantCard
        index={0}
        tenant={pipeline}
        personas={personas}
        identities={identities}
        tagsCatalog={tagsCatalog}
        pairs={[]}
        allTenants={[pipeline]}
        disabled={disabled}
        onChange={onChange}
      />
    </section>
  );
}
