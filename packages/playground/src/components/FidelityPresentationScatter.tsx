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

interface Props {
  pairs: SimilarityResult[];
}

interface ScatterDot {
  pairId: string;
  x: number; // presentation
  y: number; // fidelity
}

const VERDICT_COLOR: Record<TrinaryVerdict, string> = {
  distinct_products: "#4a9a6a",
  reskinned_same_article: "#c9a85b",
  fabrication_risk: "#c96b6b",
};

const COLOR_BORDER = "rgba(255,255,255,0.06)";
const COLOR_BORDER_FOCUS = "rgba(255,255,255,0.15)";
const COLOR_TEXT_MUTED = "#8a8a8e";
const COLOR_BG_RAISED = "#14141a";

const VERDICT_LABEL: Record<TrinaryVerdict, string> = {
  distinct_products: "Distinct",
  reskinned_same_article: "Reskinned",
  fabrication_risk: "Fabrication risk",
};

function partition(pairs: SimilarityResult[]): Record<TrinaryVerdict, ScatterDot[]> {
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
    out[v].push({ pairId: p.pairId, x, y });
  }
  return out;
}

export default function FidelityPresentationScatter({ pairs }: Props) {
  const partitioned = partition(pairs);
  const total = pairs.filter((p) => p.judgeTrinaryVerdict).length;

  if (total === 0) {
    return (
      <div
        className="flex h-[320px] items-center justify-center text-sm"
        style={{ color: COLOR_TEXT_MUTED }}
      >
        Scatter populates after the judge runs.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
        <CartesianGrid stroke={COLOR_BORDER} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="Presentation"
          domain={[0, 1]}
          tick={{ fill: COLOR_TEXT_MUTED, fontSize: 11 }}
          stroke={COLOR_BORDER_FOCUS}
          label={{
            value: "Presentation similarity",
            position: "insideBottom",
            offset: -16,
            fill: COLOR_TEXT_MUTED,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Fidelity"
          domain={[0, 1]}
          tick={{ fill: COLOR_TEXT_MUTED, fontSize: 11 }}
          stroke={COLOR_BORDER_FOCUS}
          label={{
            value: "Factual fidelity",
            angle: -90,
            position: "insideLeft",
            fill: COLOR_TEXT_MUTED,
            fontSize: 12,
          }}
        />
        <ReferenceLine x={0.5} stroke={COLOR_BORDER_FOCUS} strokeDasharray="4 4" />
        <ReferenceLine y={0.9} stroke={COLOR_BORDER_FOCUS} strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: "#5ba8a0", strokeWidth: 1 }}
          contentStyle={{
            background: COLOR_BG_RAISED,
            border: `1px solid ${COLOR_BORDER_FOCUS}`,
            borderRadius: 6,
            color: "#e8e6e3",
            fontSize: 12,
          }}
          formatter={(value: number) => value.toFixed(2)}
          labelFormatter={(_, payload) => {
            const first = payload?.[0]?.payload as ScatterDot | undefined;
            return first?.pairId ?? "";
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: COLOR_TEXT_MUTED }}
          formatter={(value) => <span style={{ color: COLOR_TEXT_MUTED }}>{value}</span>}
        />
        {(Object.keys(partitioned) as TrinaryVerdict[]).map((verdict) => (
          <Scatter
            key={verdict}
            name={VERDICT_LABEL[verdict]}
            data={partitioned[verdict]}
            fill={VERDICT_COLOR[verdict]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
