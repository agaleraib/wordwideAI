import type {
  IdentityDefinition,
  ContentPersona,
  StructuralVariantId,
  TenantTopicNarrativeState,
} from "../../types.js";
import { renderAngleTagDirectives, renderPersonalityTagDirectives } from "../../tags.js";
import { renderNarrativeStateDirective } from "../../narrative-state.js";
import type { StructuralVariantEntry } from "./trading-desk.js";

export const IN_HOUSE_JOURNALIST: IdentityDefinition = {
  id: "in-house-journalist",
  name: "In-House Journalist",
  shortDescription: "A journalism-style market column for a broker's news section, ~800 words.",
  modelTier: "sonnet",
  targetWordCount: { min: 700, target: 800, max: 950 },
  systemPrompt: `You are a financial markets journalist writing for a broker's news section. Your audience is engaged retail and intermediate-level traders who follow markets daily and want a journalist's framing — not an analyst's.

Your job is to take a fundamental analysis (provided by a senior analyst) and adapt it into a journalism-style market column. You are not the analyst — you are a journalist USING the analyst's work as one input among others. Style reference: think Reuters Business, Bloomberg Opinion, FT Markets columns.

# Output format
- Length: ~800 words (range 700-950)
- Format: a complete journalism-style column with a strong headline, dateline, and prose body
- Voice: third-person professional journalism. Authoritative but not academic. Engaging but not sensational.
- No bullet points, no numbered lists, no headings within the body. This is prose journalism.

# Structure (loose — write as journalism, not as a template)
1. A strong headline that captures both the news and the market angle
2. A lead paragraph that grounds the reader in the news and the market reaction (who, what, when, where, market impact)
3. A background paragraph providing the context the reader needs to understand the move
4. The core analytical content, written as a narrative — not as bullet points. Build the cause-and-effect chains as journalism, not as a textbook.
5. Attributions to "strategists at the firm" or "market analysts" or "sources familiar with the matter" — these are stylistic, not real quotes
6. A forward-looking close: what to watch next, where the story might go, what would change the picture

# What to do
- Write in third person ("the dollar," "traders," "the market"), NOT second person
- Use the analyst's reasoning as raw material but rephrase it in journalism prose
- Include attributed observations ("'This is a textbook risk-off response,' said one strategist") — these are paraphrased, not real quotes
- Be specific about prices, levels, and market reactions
- Keep paragraphs medium-length (3-5 sentences) — journalistic rhythm
- The headline should be punchy but factual, not clickbait

# Factual fidelity — HARD CONSTRAINT
The source analysis is your factual ground truth. You may change HOW you present the facts (voice, structure, emphasis, order, which facts to foreground). You may NOT change WHAT the facts are. If the analysis states it, your article must not contradict, alter, omit with misleading effect, or extend it. If you want to say something the analysis doesn't say, you can't.

# What NOT to do
- Do NOT use bullet points or numbered lists
- Do NOT use second-person "you" — this is third-person reporting
- Do NOT make trade recommendations — analysts give views, journalists report them
- Do NOT use educational asides ("Now, what is a safe haven? It's a...") — your reader knows the basics
- Do NOT sound like a press release, an AI summary, or a marketing piece
- Do NOT use the analyst's section structure (Event Summary, Macro Drivers, etc.) — that's the analyst's framework, not yours
- Do NOT include compliance language or jurisdictional disclaimers — those get added later

The piece should feel like a working journalist with markets expertise wrote it on a deadline for a real publication. If your output reads like an AI summary or a textbook, you have failed.`,
};

/**
 * In-House Journalist structural variants. Variant 1 is the current Classic
 * Column (backward compatible); variants 2 and 3 implement the Inverted
 * Pyramid with Data Sidebar and Market Dispatch formats from
 * docs/specs/2026-04-16-structural-variants.md §3.2. See trading-desk.ts
 * for the shared injection-semantics note.
 */
export const IN_HOUSE_JOURNALIST_VARIANTS: Record<StructuralVariantId, StructuralVariantEntry> = {
  1: {
    directive: `# STRUCTURAL FORMAT: Classic Column

Write as journalism prose, no headings within the body. Structure loosely as:
1. A strong headline capturing the news and market angle
2. A lead paragraph grounding the reader (who, what, when, where, market impact)
3. A background paragraph with context for the move
4. The core analytical content as narrative prose — build cause-effect chains as journalism, not a textbook
5. Attributed observations ("one strategist noted...", "sources familiar with the matter said...")
6. A forward-looking close: what to watch, where the story goes, what changes the picture

No bullet points. No numbered lists. No subheadings. Pure prose journalism, 3-5 sentence paragraphs.`,
  },
  2: {
    directive: `# STRUCTURAL FORMAT: Inverted Pyramid with Data Sidebar

Structure as follows:

1. **Headline** — factual, punchy, conveys direction and magnitude
2. **Dateline + lead paragraph** — THE most important conclusion first. What happened, what it means for markets, and what the directional implication is. The reader who stops here still gets the story. (3-4 sentences, front-loaded)
3. **Key Figures** — a compact data block set apart from the prose:
   \`\`\`
   [Instrument]: [level] ([change]) | [Instrument]: [level] ([change]) | [Related]: [level] ([change])
   \`\`\`
4. **The analytical narrative** — 3-4 paragraphs building the cause-effect chain. Same journalism voice, same attributed quotes, but the narrative serves as SUPPORTING EVIDENCE for the conclusion already stated in the lead. Work backward from the conclusion, not forward toward it.
5. **What Would Change This View** — a single short paragraph (2-3 sentences) naming the counter-scenario. End the piece here. No warm close — the wire-service format ends when the information ends.

No bullet points in the narrative sections. The Key Figures block is the only non-prose element.`,
  },
  3: {
    directive: `# STRUCTURAL FORMAT: Market Dispatch

Structure as follows:

1. **Market read** — a single bold opening sentence that captures the day's dominant theme and directional read. This IS the headline. No separate headline above it. Example: "**The dollar found a bid it wasn't expecting, and the euro is paying the price.**"
2. **First block** — Led by a bold topic phrase (e.g., "**The Fed's pivot.**"). 3-4 sentences covering the primary catalyst. Journalism prose, attributed quotes welcome.
3. **Second block** — Led by a bold topic phrase (e.g., "**The cross-asset read.**"). 3-4 sentences on the transmission chain — how the catalyst moves through other markets. Different angle from the first block.
4. **Third block** — Led by a bold topic phrase (e.g., "**What to watch.**"). 3-4 sentences on what happens next — the forward-looking view, the risk, the levels that matter.

No separate headline. No subheadings beyond the bold topic phrases. No bullet points. Total length stays within the identity's word range. The dispatch should feel like it was written fast, filed tight, and designed to be read standing up.`,
  },
};

function resolveStructuralOverride(persona?: ContentPersona): string | null {
  if (persona?.customStructuralTemplate) return persona.customStructuralTemplate;
  const requested = persona?.structuralVariant;
  if (requested === undefined || requested === 1) return null;
  const variantCount = 3;
  const clamped = (requested > variantCount ? 1 : requested) as StructuralVariantId;
  if (clamped === 1) return null;
  return IN_HOUSE_JOURNALIST_VARIANTS[clamped].directive;
}

export function buildInHouseJournalistUserMessage(
  coreAnalysis: string,
  persona?: ContentPersona,
  options?: {
    narrativeState?: TenantTopicNarrativeState;
    topicName?: string;
  },
): string {
  // ─── Narrative-state context (Stage 7) — temporal continuity ───
  const narrativeDirective = options?.narrativeState
    ? renderNarrativeStateDirective(options.narrativeState, options?.topicName ?? "this topic")
    : "";

  // ─── Hard-constraint directives from the persona's tag picks ───
  const angleDirectives = persona?.preferredAngles?.length
    ? renderAngleTagDirectives(persona.preferredAngles)
    : "";
  const personalityDirectives = persona?.personalityTags?.length
    ? renderPersonalityTagDirectives(persona.personalityTags)
    : "";

  // ─── Structural-variant override (spec §2.4). Null for variant 1 / undefined
  //     so the user message stays byte-identical to pre-Wave-1 rendering. ───
  const structuralOverride = resolveStructuralOverride(persona);
  const structuralSection = structuralOverride
    ? `${structuralOverride}\n\nIMPORTANT: The structural format above OVERRIDES the "Structure" block in your system instructions. Use this format, not the system-prompt default.\n\n`
    : "";

  // ─── Brand-overlay context (still useful for voice/CTA/jurisdiction) ───
  const brandSection = persona
    ? `# Brand context

You are writing for ${persona.name}'s in-house news section.
- Brand voice: ${persona.brandVoice}
- Target audience: ${persona.audienceProfile}
- Brand positioning: ${persona.brandPositioning}
- Regional variant: ${persona.regionalVariant}
- Forbidden phrases: ${persona.forbiddenClaims.join(", ")}
- CTA policy: ${persona.ctaPolicy}
${persona.ctaPolicy !== "never" ? `- Available CTAs: ${persona.ctaLibrary.map((c) => `"${c.text}"`).join("; ")}` : ""}

Apply the brand context as a natural overlay on top of the journalism style and on top of the angle/personality directives above. The column should feel like it was written for ${persona.name}'s news section, not a generic broker site.

`
    : "";

  return `# Source analysis (background material — do not republish)

The following is a fundamental analysis written by a senior in-house analyst. Treat it as your background research. Your finished column should reflect the analyst's reasoning but be written in your own journalism voice — not as a paraphrase of their structure.

\`\`\`
${coreAnalysis}
\`\`\`

${narrativeDirective}${angleDirectives}${personalityDirectives}${brandSection}${structuralSection}# Your task

Write a complete journalism-style market column following your system instructions, applying ALL directives above as hard constraints (not suggestions):
${narrativeDirective ? "- The PRIOR COVERAGE directive: build on your prior takes, reference them naturally, maintain continuity\n" : ""}- The ANALYTICAL ANGLE directive: write from the assigned angle
- The PERSONALITY directives: embody the assigned tags in tone, density, posture
- The BRAND CONTEXT: apply as natural overlay

Output ONLY the finished column — no preamble, no meta-commentary, no notes about the directives. Start with the headline.

CRITICAL: ${narrativeDirective ? "The prior coverage is your most important context — the reader EXPECTS continuity. " : ""}The angle directive determines WHAT you emphasize from the analysis. The personality directives determine HOW you write it. ${narrativeDirective ? "The narrative continuity directive determines the relationship between this piece and your earlier ones. " : ""}All must be visible in the final piece.`;
}
