import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import type { SimilarityResult, TrinaryVerdict } from "../lib/types";
import { useThemeColors } from "../hooks/useThemeColors";

interface Props {
  pairs: SimilarityResult[];
}

const LABEL: Record<TrinaryVerdict, string> = {
  distinct_products: "Distinct",
  reskinned_same_article: "Reskinned",
  fabrication_risk: "Fabrication",
};

export default function TrinaryVerdictDonut({ pairs }: Props) {
  const c = useThemeColors();

  const verdictColor: Record<TrinaryVerdict, string> = {
    distinct_products: c.distinct,
    reskinned_same_article: c.reskinned,
    fabrication_risk: c.fabrication,
  };

  const counts: Record<TrinaryVerdict, number> = {
    distinct_products: 0,
    reskinned_same_article: 0,
    fabrication_risk: 0,
  };
  for (const p of pairs) {
    if (p.judgeTrinaryVerdict) counts[p.judgeTrinaryVerdict] += 1;
  }
  const total =
    counts.distinct_products +
    counts.reskinned_same_article +
    counts.fabrication_risk;

  if (total === 0) {
    return (
      <div
        className="flex h-[260px] items-center justify-center text-sm"
        style={{ color: c.textMuted }}
      >
        Donut populates after the judge runs.
      </div>
    );
  }

  const data = (Object.keys(counts) as TrinaryVerdict[])
    .map((k) => ({ name: LABEL[k], value: counts[k], verdict: k }))
    .filter((d) => d.value > 0);

  return (
    <div className="relative h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={95}
            stroke={c.bgApp}
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
            animationDuration={800}
          >
            {data.map((entry) => (
              <Cell key={entry.verdict} fill={verdictColor[entry.verdict]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: c.bgRaised,
              border: `1px solid ${c.borderFocus}`,
              borderRadius: 6,
              color: c.textPrimary,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: c.textPrimary,
            fontFamily: "var(--font-mono)",
          }}
        >
          {counts.distinct_products}/{total}
        </div>
        <div
          style={{
            fontSize: 11,
            color: c.textMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginTop: 4,
          }}
        >
          distinct
        </div>
      </div>
    </div>
  );
}
