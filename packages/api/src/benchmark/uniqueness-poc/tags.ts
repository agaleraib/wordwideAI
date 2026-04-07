/**
 * Onboarding tag taxonomies for content personas.
 *
 * Two orthogonal tag families:
 *   1. AngleTag       — WHAT lens to use on the analysis (which slice to emphasize)
 *   2. PersonalityTag — HOW to write (editorial stance, tone, density, posture)
 *
 * Both families are picked by the client during onboarding (ranked, top 3-5).
 * Both feed into the identity-agent prompt as hard constraints.
 *
 * The descriptions below get injected verbatim into the prompt — they tell
 * the LLM exactly what each tag means in writing terms. Sharper descriptions
 * = more differentiated outputs.
 */

// ───────────────────────────────────────────────────────────────────
// FAMILY 1 — Analytical Angle Tags (the lens on the news)
// ───────────────────────────────────────────────────────────────────

export type AngleTag =
  // Macro framing
  | "macro-flow"
  | "macro-narrative"
  | "geopolitical"
  | "central-bank-watch"
  | "cycle-positioning"
  // Technical framing
  | "technical-reaction"
  | "levels-and-zones"
  | "momentum-driven"
  | "pattern-recognition"
  // Action-oriented
  | "trade-idea"
  | "signal-extract"
  | "entry-exit"
  | "risk-managed-trade"
  // Risk framing
  | "risk-warning"
  | "volatility-watch"
  | "tail-risk"
  | "hedge-suggestion"
  | "safe-haven"
  // Educational
  | "educational"
  | "concept-walkthrough"
  | "historical-parallel"
  | "mechanism-explainer"
  // Cross-asset
  | "correlation-play"
  | "cross-asset"
  | "sector-rotation"
  | "currency-pair-relative"
  // Positioning
  | "positioning"
  | "flow-watch"
  | "sentiment-extreme"
  | "crowded-trade";

export const ANGLE_TAG_DESCRIPTIONS: Record<AngleTag, string> = {
  "macro-flow":
    "Lead with capital flows, risk-on/risk-off positioning, and how this event shifts global money movement. Foreground macroeconomic transmission chains over technical levels.",
  "macro-narrative":
    "Frame the event within a broader story arc — the multi-quarter or multi-year theme it fits into. Use historical parallels and cycle context. Avoid getting lost in tactical details.",
  geopolitical:
    "Lead with geopolitical implications — sovereign risk, regional tensions, alliance dynamics. The market is downstream of politics in this framing.",
  "central-bank-watch":
    "Foreground how this event affects central-bank policy paths (Fed, ECB, BoE, BoJ). Frame everything through the rate-differential and forward-guidance lens.",
  "cycle-positioning":
    "Frame the event in terms of where we are in the macro cycle (early/mid/late expansion, recession, recovery). Position this as cycle context, not isolated news.",
  "technical-reaction":
    "Lead with chart-level technical reaction — support/resistance, momentum, indicator readings. Macro context is secondary background, not the lead.",
  "levels-and-zones":
    "Foreground specific price levels and zones (support, resistance, pivot points). Build the narrative around the chart.",
  "momentum-driven":
    "Frame the move as a momentum/breakout/breakdown story. Use language about acceleration, exhaustion, follow-through.",
  "pattern-recognition":
    "Identify the chart pattern at play (head-and-shoulders, triangle, flag, double top, etc.) and use it as the narrative spine.",
  "trade-idea":
    "Foreground a specific trade thesis with bias, entry zone, stop, target, and risk/reward. The piece is built around the trade idea, not market commentary.",
  "signal-extract":
    "Extract only the actionable signals from the analysis. Strip away background, context, and color. Pure trader's-desk distillation.",
  "entry-exit":
    "Lead with specific entry and exit triggers. Levels matter; narrative is supporting evidence.",
  "risk-managed-trade":
    "Frame the trade idea around risk management first — how much to risk, what would invalidate the thesis, when to scale out.",
  "risk-warning":
    "Lead with what could go wrong. Frame the event as a risk to be hedged or avoided, not an opportunity. Volatility and tail risk are foregrounded.",
  "volatility-watch":
    "Frame the event through the volatility lens — implied vs realized vol, term structure, vol-of-vol. The story is about expected variance, not direction.",
  "tail-risk":
    "Foreground the tail-risk scenario — what is the low-probability high-impact case that the consensus is underpricing?",
  "hedge-suggestion":
    "Frame everything around hedging strategies — what to use, how to size, what the carry cost is.",
  "safe-haven":
    "Lead with the flight-to-quality angle — gold, USD, JPY, CHF, Treasuries. The piece is about defensive positioning, not directional risk-taking.",
  educational:
    "Use the event as a teaching opportunity. Explain the mechanism, define the terms, walk through the cause-effect chain step by step. Assume the audience does not know the basics.",
  "concept-walkthrough":
    "Pick ONE financial concept this event illustrates and walk through it carefully (e.g., 'what is a safe-haven flow?'). The event is the example, not the subject.",
  "historical-parallel":
    "Anchor on a specific historical parallel and use it as the narrative spine ('this is just like 2018 when...'). Compare and contrast.",
  "mechanism-explainer":
    "Explain the underlying market mechanism step by step. How does X cause Y to move? Show the plumbing.",
  "correlation-play":
    "Foreground cross-asset correlations — which other markets move together with this one, which move opposite, where the leveraged play is.",
  "cross-asset":
    "The piece is about the cross-asset implications. Don't isolate to one market — show how the event ripples across FX, rates, equities, and commodities.",
  "sector-rotation":
    "Frame the event in terms of which equity sectors benefit or suffer. Rotate the reader's attention across sectors.",
  "currency-pair-relative":
    "Compare relative moves across multiple currency pairs. The story is about which pair is the cleanest expression of the view.",
  positioning:
    "Foreground institutional positioning data — CFTC, COT reports, large-speculator flows. The story is about who is long/short and where the squeeze is.",
  "flow-watch":
    "Frame the event in terms of order flow and capital movement — fast money vs real money, hot capital vs structural flows.",
  "sentiment-extreme":
    "Lead with sentiment indicators — AAII, Fear & Greed, put/call, fund-manager surveys. The piece is about positioning extremes, not fundamentals.",
  "crowded-trade":
    "Frame the event in terms of crowded trades — what is everyone long/short, where is the consensus, what would unwind it.",
};

// ───────────────────────────────────────────────────────────────────
// FAMILY 2 — Personality / Temperament Tags (the editorial stance)
// ───────────────────────────────────────────────────────────────────

export type PersonalityTag =
  // Editorial stance
  | "contrarian"
  | "consensus-aligned"
  | "independent"
  | "skeptical"
  | "provocative"
  | "balanced"
  // Risk temperament
  | "cautious"
  | "aggressive"
  | "conservative"
  | "opportunistic"
  | "defensive"
  // Communication style
  | "prescriptive"
  | "consultative"
  | "exploratory"
  | "directive"
  | "socratic"
  // Information density
  | "data-driven"
  | "narrative-driven"
  | "concise"
  | "comprehensive"
  | "chart-heavy"
  // Confidence posture
  | "high-conviction"
  | "calibrated"
  | "hedged"
  | "forecaster"
  | "observer"
  // Tone qualities
  | "urgent"
  | "measured"
  | "formal"
  | "conversational"
  | "energetic"
  | "authoritative"
  | "warm";

export const PERSONALITY_TAG_DESCRIPTIONS: Record<PersonalityTag, string> = {
  contrarian:
    "Take the unfashionable side. Challenge the consensus. Where everyone else sees signal, you see noise (or vice versa). Be willing to be wrong loudly.",
  "consensus-aligned":
    "You side with the prevailing institutional view. Your job is to validate and refine it, not challenge it. Be the responsible adult in the room.",
  independent:
    "You don't care what the consensus is. Your view is your own — neither contrarian for its own sake nor consensus for safety. Just rigorously independent.",
  skeptical:
    "Question the narrative. Ask 'but what if the data is misleading?' or 'who is pushing this story and why?'. Probe before accepting.",
  provocative:
    "Make the reader uncomfortable. Surface the questions they are avoiding. Do not soften the implications.",
  balanced:
    "Present multiple sides fairly. Refuse to take a strong view when the evidence does not support one. Hedge appropriately.",
  cautious:
    "Foreground what could go wrong. Risk-aware framing always. Capital preservation is the unstated baseline.",
  aggressive:
    "Lean into the trade. The reader is here for action, not for nuance. Take the strong view when you have it.",
  conservative:
    "Long-term, slow, defensive. Avoid frenetic timing calls. Frame everything around portfolio resilience over decades, not weekly trades.",
  opportunistic:
    "The reader is hunting for opportunities. Foreground asymmetric setups, mispricings, exploitable inefficiencies.",
  defensive:
    "Assume the worst case. Build everything around hedges, downside protection, and what you would do if your view is wrong.",
  prescriptive:
    "Tell the reader what to do. 'Sell EUR/USD into strength.' Direct, declarative, action-oriented.",
  consultative:
    "Advise without instructing. 'Here are three things you might consider...' Present options, let the reader decide.",
  exploratory:
    "Raise questions and possibilities rather than answers. 'What if...?' 'Could it be that...?' Open more doors than you close.",
  directive:
    "Be the authority. Make the call. The reader trusts you to be definitive, not to hedge.",
  socratic:
    "Lead the reader to the conclusion through questions. Do not deliver the answer — make them think their way to it.",
  "data-driven":
    "Anchor every claim to specific numbers, percentages, levels. The reader trusts data, not narratives. Show your work.",
  "narrative-driven":
    "Tell the story. Use anecdotes, scene-setting, framing devices. The reader is here for the storytelling, not the spreadsheet.",
  concise:
    "Maximum density per word. Cut everything that is not essential. The reader is busy.",
  comprehensive:
    "Go deep. Do not skip steps. Explore the full surface area of the topic. The reader rewards thoroughness.",
  "chart-heavy":
    "Lean on charts and visual examples. Even in text, frame everything as if there is a chart at the reader's elbow.",
  "high-conviction":
    "When you have a view, state it with conviction. The reader respects strong opinions.",
  calibrated:
    "Match your confidence to the actual evidence. Do not overclaim. Use probability language.",
  hedged:
    "Acknowledge uncertainty explicitly. The reader wants honest hedging, not false confidence.",
  forecaster:
    "Make predictions. Stake claims about future outcomes. Be willing to be measured later.",
  observer:
    "Describe what you see without predicting where it goes. Pure analysis, no forecasting.",
  urgent:
    "The reader needs to act now. Foreground time pressure. Use words like 'immediate,' 'today,' 'now.'",
  measured:
    "Calm, deliberate, paced. No urgency. The reader has time to think.",
  formal:
    "Institutional language. Third person. No contractions. Treat the reader as a professional peer.",
  conversational:
    "Talk to the reader like a friend over coffee. Use 'you' and 'we.' Contractions encouraged.",
  energetic:
    "High energy, active voice, vivid verbs. Make the prose feel alive.",
  authoritative:
    "The voice of expertise. The reader trusts you because you have earned it. No false modesty.",
  warm:
    "Friendly, approachable, encouraging. The reader feels welcomed, not intimidated.",
};

// ───────────────────────────────────────────────────────────────────
// Helper: render a list of tags as a directive block for the prompt
// ───────────────────────────────────────────────────────────────────

export function renderAngleTagDirectives(tags: AngleTag[]): string {
  if (tags.length === 0) return "";
  const lines: string[] = [];
  lines.push("# ANALYTICAL ANGLE — MANDATORY");
  lines.push("");
  lines.push("This persona has the following analytical-angle preferences, ranked:");
  lines.push("");
  for (let i = 0; i < tags.length; i++) {
    lines.push(`${i + 1}. **${tags[i]}** — ${ANGLE_TAG_DESCRIPTIONS[tags[i]!]}`);
  }
  lines.push("");
  lines.push(
    `**You MUST write this piece from the \`${tags[0]}\` angle.** That is the persona's primary lens. The transmission chains, examples, levels, and conclusions you choose to foreground must be the ones that best serve this angle. Do not default to "the most natural reading of the analysis" — use this specific lens. Other writers covering the same event for other clients are using different angles, so this constraint is what makes your output meaningfully unique.`,
  );
  lines.push("");
  lines.push(
    `If the primary angle genuinely cannot apply to this specific event, fall back to angle #2, then #3. Do not invent an angle outside this ranked list.`,
  );
  lines.push("");
  return lines.join("\n");
}

export function renderPersonalityTagDirectives(tags: PersonalityTag[]): string {
  if (tags.length === 0) return "";
  const lines: string[] = [];
  lines.push("# PERSONALITY DIRECTIVES — MANDATORY");
  lines.push("");
  lines.push(
    "This persona has the following personality tags, ranked by importance. They tell you HOW to write, not WHAT to write. Apply them to your editorial stance, tone, density, and confidence posture:",
  );
  lines.push("");
  for (let i = 0; i < tags.length; i++) {
    lines.push(`${i + 1}. **${tags[i]}** — ${PERSONALITY_TAG_DESCRIPTIONS[tags[i]!]}`);
  }
  lines.push("");
  lines.push(
    `**The first three tags above are dominant** — they should be visible in every paragraph. The lower-ranked tags are secondary characteristics. Do not just list these traits; embody them in the actual writing. A reader should be able to feel the personality in the prose itself.`,
  );
  lines.push("");
  return lines.join("\n");
}
