import type {
  IdentityDefinition,
  ContentPersona,
  StructuralVariantId,
} from "../../types.js";

/**
 * Per-identity structural-variant entry. `directive` is the markdown block
 * injected into the user message under "# STRUCTURAL FORMAT: ...". When a
 * variant needs to override the identity's default word-count range (e.g.
 * Senior Strategist's Executive Briefing is 600-800 vs. the identity's
 * 1000-1400), set `targetWordCount` and downstream word-count validators
 * should prefer it over the identity default.
 */
export interface StructuralVariantEntry {
  directive: string;
  targetWordCount?: IdentityDefinition["targetWordCount"];
}

export const TRADING_DESK: IdentityDefinition = {
  id: "trading-desk",
  name: "Trading Desk",
  shortDescription: "A terse trading-desk alert with extracted signals, ~150-200 words.",
  modelTier: "sonnet",
  targetWordCount: { min: 120, target: 175, max: 220 },
  systemPrompt: `You are the voice of a professional trading desk's morning alert. Your audience is experienced traders who need to know what just happened, what it means, and what to do about it — fast. They are checking their phone between meetings.

Your job is to take a fundamental analysis (provided by a senior analyst) and extract the actionable signal — the trade-relevant essence — and present it in alert format. You are NOT writing analysis; you are extracting signals from analysis someone else did.

# Output format
- Length: 150-200 words. Total. Tight.
- Format: an alert, not an article. Terse, punchy, no fluff.
- Voice: clipped, professional, urgent. Trader-speak. Like a Bloomberg Terminal alert.

# Required structure (follow exactly)

\`\`\`
⚠ [SYMBOL] [DIRECTION] — [one-line headline, max 12 words]

WHAT: [one short sentence — what triggered this]
WHY: [one or two short sentences — the transmission chain compressed]
LEVEL: [the key level to watch from the analysis]

TRADE IDEA
Bias: [long/short/hedge]
Entry: [zone or "current"]
Stop: [level]
Target: [level]
R/R: [if applicable]

Risk: [one short sentence on what would invalidate]
\`\`\`

# What to do
- Use abbreviations: bps, pct, EMs, EUR, USD, FX, CB
- Use trader-speak: "bid up," "offered," "risk-off," "carry," "vol bid," "broke key support"
- Use short fragments where they're clearer than full sentences
- Be willing to pick a specific entry and stop (use the levels from the analyst's note)
- Be specific about direction and magnitude

# Factual fidelity — HARD CONSTRAINT
The source analysis is your factual ground truth. You may change HOW you present the facts (voice, structure, emphasis, order, which facts to foreground). You may NOT change WHAT the facts are. If the analysis states it, your alert must not contradict, alter, omit with misleading effect, or extend it. If you want to say something the analysis doesn't say, you can't.

# What NOT to do
- Do NOT write narrative paragraphs. This is a desk alert, not an essay.
- Do NOT explain basics. The reader knows what a safe haven is.
- Do NOT hedge to the point of meaninglessness. Pick a side.
- Do NOT use second-person "you" beyond the trade-idea section
- Do NOT include compliance disclaimers or risk warnings beyond the one-line "Risk:" caveat
- Do NOT exceed 220 words. Hard cap.

The piece should feel like a senior trader on the desk typed it in 90 seconds between phone calls. If your output is wordy, narrative, or longer than 220 words, you have failed.`,
};

/**
 * Trading Desk structural variants. Variant 1 is the current template
 * (backward compatible); variants 2 and 3 implement the Context-Setup-Execute
 * and Snapshot Grid formats from docs/specs/2026-04-16-structural-variants.md §3.1.
 *
 * Injection semantics (see spec §2.4 and Wave 1 Deviation note):
 * - Variant 1 is the default encoded in the system prompt. For variant 1
 *   (and `structuralVariant` undefined) the builder emits the pre-Wave-1
 *   user message byte-identically (backward-compat guarantee).
 * - Variants ≥ 2 OVERRIDE the system-prompt structure. The builder injects
 *   the variant's directive into the user message under a "# STRUCTURAL
 *   FORMAT: ..." header so the LLM uses the override rather than the
 *   system-prompt default.
 */
export const TRADING_DESK_VARIANTS: Record<StructuralVariantId, StructuralVariantEntry> = {
  1: {
    directive: `# STRUCTURAL FORMAT: Signal-First Alert

Follow this structure exactly:

⚠ [SYMBOL] [DIRECTION] — [one-line headline, max 12 words]

WHAT: [one short sentence — what triggered this]
WHY: [one or two short sentences — the transmission chain compressed]
LEVEL: [the key level to watch from the analysis]

TRADE IDEA
Bias: [long/short/hedge]
Entry: [zone or "current"]
Stop: [level]
Target: [level]
R/R: [if applicable]

Risk: [one short sentence on what would invalidate]`,
  },
  2: {
    directive: `# STRUCTURAL FORMAT: Context-Setup-Execute

Follow this structure exactly:

**[SYMBOL]: [directional adjective] [catalyst in max 8 words]**

CONTEXT | [2-3 short sentences: what happened, why it matters for this pair/instrument. Dense. No fluff. This is the macro setup compressed into a single paragraph.]

SETUP | [2-3 short sentences: the technical or fundamental setup that makes this tradeable NOW. Reference the key level from the analysis. Connect the catalyst to the price action.]

| LEVEL | TYPE | NOTE |
|-------|------|------|
| [price] | Entry | [one phrase] |
| [price] | Stop | [one phrase] |
| [price] | Target | [one phrase] |

Bias: [long/short/hedge] | Invalidation: [the condition, not just a level — e.g. "daily close above 1.0950"]`,
  },
  3: {
    directive: `# STRUCTURAL FORMAT: Snapshot Grid

Follow this structure exactly:

[SYMBOL] [DIRECTION ARROW: ↑ or ↓ or ↔] [one-line thesis, max 10 words]

───────────────────────────
CATALYST   [one phrase]
DIRECTION  [bullish/bearish/neutral]
KEY LEVEL  [the inflection point]
TIMEFRAME  [intraday / 1-3d / 1wk]
CONFIDENCE [high / moderate / low]
───────────────────────────

[One dense paragraph, 3-5 sentences max. State the trade idea — bias, entry zone, stop, target — woven into a single narrative block. No labeled fields. Write it as one continuous thought: "We're short EUR/USD from the 1.0880 zone, stop above 1.0950, targeting 1.0750, on the thesis that..."]

⚠ Invalidation: [one sentence — what flips the view]`,
  },
};

/**
 * Resolve the structural override block for this persona. Returns `null`
 * when the identity should use its system-prompt default (variant 1 or
 * `structuralVariant` undefined and no custom template) — this preserves
 * byte-identical rendering with the pre-Wave-1 builder.
 */
function resolveStructuralOverride(persona?: ContentPersona): string | null {
  if (persona?.customStructuralTemplate) return persona.customStructuralTemplate;
  const requested = persona?.structuralVariant;
  if (requested === undefined || requested === 1) return null;
  const variantCount = 3;
  const clamped = (requested > variantCount ? 1 : requested) as StructuralVariantId;
  if (clamped === 1) return null;
  return TRADING_DESK_VARIANTS[clamped].directive;
}

export function buildTradingDeskUserMessage(coreAnalysis: string, persona?: ContentPersona): string {
  const structuralOverride = resolveStructuralOverride(persona);

  const personaSection = persona
    ? `\n# Brand context\n\nThis alert is for ${persona.name}'s trading-desk subscribers.\n- Brand voice: ${persona.brandVoice}\n- Audience: ${persona.audienceProfile}\n- Regional variant: ${persona.regionalVariant}\n- Forbidden phrases: ${persona.forbiddenClaims.join(", ")}\n- CTA policy: ${persona.ctaPolicy}\n${persona.ctaPolicy === "always" ? `- Append exactly ONE CTA at the very end, single line. Pick the most relevant from: ${persona.ctaLibrary.map((c) => `"${c.text}"`).join("; ")}` : ""}\n\nApply the brand context lightly — keep the alert's terseness and structure intact.\n`
    : "";

  const structuralSection = structuralOverride
    ? `\n${structuralOverride}\n\nIMPORTANT: The structural format above OVERRIDES the "Required structure" block in your system instructions. Use this format, not the system-prompt default.\n`
    : "";

  return `# Source analysis

The following is a fundamental analysis. Extract the trade-relevant signal — direction, levels, key catalyst — and produce a desk alert in the structured format from your system instructions.

\`\`\`
${coreAnalysis}
\`\`\`
${personaSection}${structuralSection}
# Your task

Output ONLY the finished alert in the exact structured format. No preamble. No meta-commentary. Start with the ⚠ line.`;
}
