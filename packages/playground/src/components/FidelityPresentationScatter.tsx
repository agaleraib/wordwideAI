import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import type { SimilarityResult, TrinaryVerdict } from "../lib/types";
import { useThemeColors } from "../hooks/useThemeColors";

interface Props {
  pairs: SimilarityResult[];
  /**
   * Optional map from pairId → classification. When provided, the tooltip
   * renders a muted sub-line labelling the pair as cross-tenant or
   * intra-tenant. Computed by the page from the pipeline configuration.
   */
  classifications?: Record<string, "cross-tenant" | "intra-tenant">;
}

interface ScatterDot {
  pairId: string;
  classification?: "cross-tenant" | "intra-tenant";
  x: number; // presentation
  y: number; // fidelity
}

const VERDICT_LABEL: Record<TrinaryVerdict, string> = {
  distinct_products: "Distinct",
  reskinned_same_article: "Reskinned",
  fabrication_risk: "Fabrication risk",
};

function partition(
  pairs: SimilarityResult[],
  classifications: Record<string, "cross-tenant" | "intra-tenant"> | undefined,
): Record<TrinaryVerdict, ScatterDot[]> {
  const out: Record<TrinaryVerdict, ScatterDot[]> = {
    distinct_products: [],
    reskinned_same_article: [],
    fabrication_risk: [],
  };
  for (const p of pairs) {
    const v = p.judgeTrinaryVerdict;
    const x = p.judgePresentationSimilarity;
    const y = p.judgeFactualFidelity;
    if (!v || x == null || y == null) continue;
    const classification = classifications?.[p.pairId];
    out[v].push({
      pairId: p.pairId,
      x,
      y,
      ...(classification ? { classification } : {}),
    });
  }
  return out;
}

export default function FidelityPresentationScatter({
  pairs,
  classifications,
}: Props) {
  const c = useThemeColors();
  const partitioned = partition(pairs, classifications);
  const total = pairs.filter((p) => p.judgeTrinaryVerdict).length;

  const verdictColor: Record<TrinaryVerdict, string> = {
    distinct_products: c.distinct,
    reskinned_same_article: c.reskinned,
    fabrication_risk: c.fabrication,
  };

  if (total === 0) {
    return (
      <div
        className="flex h-[320px] items-center justify-center text-sm"
        style={{ color: c.textMuted }}
      >
        Scatter populates after the judge runs.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
        <CartesianGrid stroke={c.border} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="Presentation"
          domain={[0, 1]}
          tick={{ fill: c.textMuted, fontSize: 11 }}
          stroke={c.borderFocus}
          label={{
            value: "Presentation similarity",
            position: "insideBottom",
            offset: -16,
            fill: c.textMuted,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Fidelity"
          domain={[0, 1]}
          tick={{ fill: c.textMuted, fontSize: 11 }}
          stroke={c.borderFocus}
          label={{
            value: "Factual fidelity",
            angle: -90,
            position: "insideLeft",
            fill: c.textMuted,
            fontSize: 12,
          }}
        />
        <ReferenceLine x={0.5} stroke={c.borderFocus} strokeDasharray="4 4" />
        <ReferenceLine y={0.9} stroke={c.borderFocus} strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: c.accent, strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const dot = payload[0]?.payload as ScatterDot | undefined;
            if (!dot) return null;
            return (
              <div
                style={{
                  background: c.bgRaised,
                  border: `1px solid ${c.borderFocus}`,
                  borderRadius: 6,
                  color: c.textPrimary,
                  fontSize: 12,
                  padding: "8px 10px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div style={{ marginBottom: 4, wordBreak: "break-all" }}>
                  {dot.pairId}
                </div>
                <div style={{ color: c.textMuted }}>
                  fid {dot.y.toFixed(2)} · pres {dot.x.toFixed(2)}
                </div>
                {dot.classification && (
                  <div
                    style={{
                      marginTop: 4,
                      color: c.textMuted,
                      fontSize: 11,
                      fontStyle: "italic",
                    }}
                  >
                    {dot.classification === "cross-tenant"
                      ? "cross-tenant comparison"
                      : "intra-tenant comparison"}
                  </div>
                )}
              </div>
            );
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: c.textMuted }}
          formatter={(value) => <span style={{ color: c.textMuted }}>{value}</span>}
        />
        {(Object.keys(partitioned) as TrinaryVerdict[]).map((verdict) => (
          <Scatter
            key={verdict}
            name={VERDICT_LABEL[verdict]}
            data={partitioned[verdict]}
            fill={verdictColor[verdict]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
