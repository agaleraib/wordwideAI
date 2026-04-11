/**
 * TenantCard — one card per tenant in the playground grid.
 *
 * v1.1 surface area:
 *   - Persona dropdown
 *   - Identity dropdown
 *   - Word-count slider with cost estimate
 *   - Angle / personality TagPickers
 *   - Output area with status pill
 *   - Per-pair fidelity / presentation / verdict mini-table
 */

import * as Slider from "@radix-ui/react-slider";
import TagPicker from "./TagPicker";
import type {
  ContentPersona,
  IdentityDefinition,
  SimilarityResult,
  TagsCatalog,
  TrinaryVerdict,
} from "../lib/types";

export type TenantStatus = "pending" | "generating" | "complete" | "error";

export interface TenantState {
  personaId: string;
  identityId: string;
  angleTagsOverride: string[];
  personalityTagsOverride: string[];
  targetWordCount: number;
  status: TenantStatus;
  body: string | null;
  wordCount: number | null;
}

interface Props {
  index: number;
  tenant: TenantState;
  personas: ContentPersona[] | null;
  identities: IdentityDefinition[] | null;
  tagsCatalog: TagsCatalog | null;
  pairs: SimilarityResult[];
  allTenants: TenantState[];
  disabled: boolean;
  onChange: (patch: Partial<TenantState>) => void;
}

const VERDICT_COLOR: Record<TrinaryVerdict, string> = {
  distinct_products: "var(--success)",
  reskinned_same_article: "var(--warning)",
  fabrication_risk: "var(--danger)",
};

const VERDICT_GLYPH: Record<TrinaryVerdict, string> = {
  distinct_products: "✓",
  reskinned_same_article: "≈",
  fabrication_risk: "!",
};

/**
 * Locate the SimilarityResult for the pair formed by two pipelines at the
 * given indices, using the index-prefixed pairId the runner now emits
 * (`${i}_${personaIdA}__${j}_${personaIdB}`, where i < j). Searching by
 * persona id alone would collide when two pipelines share the same persona.
 */
function findPair(
  pairs: SimilarityResult[],
  indexA: number,
  indexB: number,
  personaIdA: string,
  personaIdB: string,
): SimilarityResult | undefined {
  const [lo, hi, pLo, pHi] =
    indexA < indexB
      ? [indexA, indexB, personaIdA, personaIdB]
      : [indexB, indexA, personaIdB, personaIdA];
  const expected = `${lo}_${pLo}__${hi}_${pHi}`;
  return pairs.find((p) => p.pairId === expected);
}

/**
 * Pair classification — cross-tenant vs intra-tenant. Two pipelines with
 * different personas are cross-tenant (the uniqueness question); two pipelines
 * with the same persona are intra-tenant (the voice-consistency question).
 */
export type PairClassification = "cross-tenant" | "intra-tenant";

export function classifyPair(
  pipelineA: { personaId: string },
  pipelineB: { personaId: string },
): PairClassification {
  return pipelineA.personaId === pipelineB.personaId
    ? "intra-tenant"
    : "cross-tenant";
}

function estimateCostUsd(targetWordCount: number): number {
  // Rough Sonnet identity-call estimate, normalized to ~$0.032 per 800 words.
  return (targetWordCount / 800) * 0.032;
}

export default function TenantCard({
  index,
  tenant,
  personas,
  identities,
  tagsCatalog,
  pairs,
  allTenants,
  disabled,
  onChange,
}: Props) {
  const persona = personas?.find((p) => p.id === tenant.personaId);
  const identity = identities?.find((i) => i.id === tenant.identityId);
  const others = allTenants
    .map((t, i) => ({ tenant: t, index: i }))
    .filter((x) => x.index !== index);

  return (
    <div
      className="card-raised flex flex-col gap-3 fade-up"
      style={{
        minHeight: 480,
        animationDelay: `${index * 80}ms`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="label-uppercase">Pipeline {index + 1}</span>
        <div className={`status-pill ${tenant.status}`}>
          <span className="dot" />
          {tenant.status}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label className="label-uppercase">Persona</label>
          <select
            className="input"
            value={tenant.personaId}
            onChange={(e) => onChange({ personaId: e.target.value })}
            disabled={disabled || !personas}
          >
            {personas?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="label-uppercase">Identity</label>
          <select
            className="input"
            value={tenant.identityId}
            onChange={(e) => {
              const next = identities?.find((i) => i.id === e.target.value);
              onChange({
                identityId: e.target.value,
                ...(next ? { targetWordCount: next.targetWordCount.target } : {}),
              });
            }}
            disabled={disabled || !identities}
          >
            {identities?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.targetWordCount.min}–{i.targetWordCount.max})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label className="label-uppercase">Word count</label>
            <span className="mono" style={{ color: "var(--text-secondary)" }}>
              {tenant.targetWordCount} words · ≈ ${estimateCostUsd(tenant.targetWordCount).toFixed(3)}
            </span>
          </div>
          <Slider.Root
            className="slider-root"
            value={[tenant.targetWordCount]}
            min={100}
            max={2000}
            step={50}
            disabled={disabled}
            onValueChange={(v) => {
              const next = v[0];
              if (next != null) onChange({ targetWordCount: next });
            }}
          >
            <Slider.Track className="slider-track">
              <Slider.Range className="slider-range" />
            </Slider.Track>
            <Slider.Thumb className="slider-thumb" aria-label="Target word count" />
          </Slider.Root>
        </div>

        {tagsCatalog && (
          <>
            <TagPicker
              label="Angle tags"
              tags={tagsCatalog.angle}
              selectedIds={tenant.angleTagsOverride}
              onChange={(ids) => onChange({ angleTagsOverride: ids })}
              disabled={disabled}
            />
            <TagPicker
              label="Personality tags"
              tags={tagsCatalog.personality}
              selectedIds={tenant.personalityTagsOverride}
              onChange={(ids) => onChange({ personalityTagsOverride: ids })}
              disabled={disabled}
            />
          </>
        )}
      </div>

      <div
        className={tenant.status === "generating" ? "streaming" : ""}
        style={{
          flex: 1,
          minHeight: 120,
          maxHeight: 280,
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
        {tenant.status === "pending" && (
          <span style={{ color: "var(--text-muted)" }}>waiting…</span>
        )}
        {tenant.status === "generating" && (
          <span style={{ color: "var(--accent)" }}>
            {persona?.name ?? "Pipeline"} writing as {identity?.name ?? "identity"}…
          </span>
        )}
        {tenant.status === "error" && (
          <span style={{ color: "var(--danger)" }}>error</span>
        )}
        {tenant.status === "complete" && tenant.body}
      </div>

      <div
        className="flex items-center justify-between mono"
        style={{ color: "var(--text-muted)" }}
      >
        <span>{tenant.wordCount != null ? `${tenant.wordCount} words` : "—"}</span>
      </div>

      {others.length > 0 && (
        <div
          className="flex flex-col gap-1"
          style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}
        >
          {others.map(({ tenant: otherTenant, index: otherIndex }) => {
            const pair = findPair(
              pairs,
              index,
              otherIndex,
              tenant.personaId,
              otherTenant.personaId,
            );
            const verdict = pair?.judgeTrinaryVerdict;
            const classification = classifyPair(tenant, otherTenant);
            const chipLabel = classification === "cross-tenant" ? "X-T" : "I-T";
            return (
              <div
                key={otherIndex}
                className="flex items-center justify-between mono"
                style={{ fontSize: 10 }}
              >
                <span
                  className="flex items-center gap-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span
                    title={
                      classification === "cross-tenant"
                        ? "Cross-tenant comparison (different persona)"
                        : "Intra-tenant comparison (same persona, different format)"
                    }
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.05em",
                      padding: "1px 4px",
                      borderRadius: 2,
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    {chipLabel}
                  </span>
                  vs P{otherIndex + 1}
                </span>
                {pair ? (
                  <span className="flex items-center gap-2">
                    <span style={{ color: "var(--text-secondary)" }}>
                      fid {pair.judgeFactualFidelity?.toFixed(2) ?? "—"}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      pres {pair.judgePresentationSimilarity?.toFixed(2) ?? "—"}
                    </span>
                    {verdict && (
                      <span style={{ color: VERDICT_COLOR[verdict] }}>
                        {VERDICT_GLYPH[verdict]}
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
