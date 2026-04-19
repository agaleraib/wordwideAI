# Per-Tenant Structural Variants for Identity Agents

**Status:** Ready for implementation
**Date:** 2026-04-16
**Author:** Albert Galera + Claude
**Related:**
- `docs/specs/2026-04-07-content-uniqueness.md` -- v1 uniqueness gate (thresholds referenced)
- `docs/specs/2026-04-16-content-uniqueness-v2.md` -- v2 archetype model (structural variants complement this)
- `docs/specs/2026-04-16-archetype-validation.md` -- archetype validation PoC (parallel workstream)
- `docs/specs/2026-04-12-editorial-memory.md` -- editorial memory system (not modified by this spec)

---

## Prior Work

Builds on: [Content Uniqueness v1](2026-04-07-content-uniqueness.md) and [Content Uniqueness v2 -- Framework Archetype Model](2026-04-16-content-uniqueness-v2.md)

Assumes:
- The 6 identity agents and their prompt structures from `packages/api/src/benchmark/uniqueness-poc/prompts/identities/`
- The `ContentPersona` type from `packages/api/src/benchmark/uniqueness-poc/types.ts`
- The `IdentityDefinition` type and `RegisteredIdentity` interface from the identity registry
- The existing PoC harness infrastructure (runner, similarity scoring, LLM judge)
- Cross-tenant cosine threshold of 0.80 and ROUGE-L threshold of 0.40 from the v1 spec

Changes:
- Adds a `structuralVariant` field to `ContentPersona` (or derives it from tenant ID)
- Adds per-identity variant prompt blocks to each identity file
- Modifies `buildXxxUserMessage` functions to accept and inject structural variant directives
- Does NOT modify the v2 archetype model -- structural variants are an orthogonal layer that works with both the current identity system and the future archetype system

---

## 1. Problem Statement

### 1.1 Structural rigidity in the current identity prompts

Every identity agent has a fixed structural template that all tenants share. Looking at the current prompts:

**Trading Desk** -- "Required structure (follow exactly)":
```
Warning [SYMBOL] [DIRECTION] -- [headline]
WHAT: [...]
WHY: [...]
LEVEL: [...]
TRADE IDEA
  Bias / Entry / Stop / Target / R/R
Risk: [...]
```

**Senior Strategist** -- "Required structure (follow this template)":
```
1. Title
2. Header (dated, conviction call)
3. Executive Summary
4. Background and current context
5. Detailed scenario analysis (Base / Upside / Downside)
6. Cross-asset implications
7. Recommended positioning
8. Key risks
9. Signed-off conclusion
```

**Educator** -- "Structure (follow this template)":
```
1. Title (teaching-framed)
2. Opening hook
3. The concept (definition)
4. The worked example (step-by-step)
5. The lessons (2-3 principles)
6. Test your understanding
```

**In-House Journalist** -- "Structure (loose)":
```
1. Headline
2. Lead paragraph (who/what/when/where)
3. Background paragraph
4. Core analytical narrative
5. Attributions
6. Forward-looking close
```

**Newsletter Editor** -- "Structure (loose)":
```
1. Warm conversational opener
2. What happened (plain English)
3. Why this matters to you
4. House view (directional)
5. Forward-looking note
6. Friendly close
```

**Beginner Blogger** -- "Structure":
```
1. Catchy title
2. Relatable opening hook
3. What just happened (no jargon)
4. Cause-and-effect with analogy
5. What this means for you
6. Soft educational CTA
```

### 1.2 The problem: identical skeletons across tenants

When two tenants both use the In-House Journalist identity, their outputs have:
- The same section ordering (headline -> lead -> background -> narrative -> quotes -> forward look)
- The same formatting approach (all prose, no lists, no tables)
- The same narrative arc (news-first, then context, then analysis, then outlook)

Even with different persona overlays (brand voice, angles, personality tags, company background), the visual shape is identical. Side-by-side, they look like the same product with different skins. This is exactly the failure mode described in the v1 uniqueness spec section 1: "if two clients can compare their dashboards and see the same article with different brand wrappers, the product fails."

### 1.3 What structural variants solve

Structural variants give each identity 2-3 alternative structural templates that preserve the identity's voice and analytical depth but use genuinely different visual layouts. The variant is assigned per tenant (deterministically from tenant ID) and remains consistent across all runs for that tenant. This provides:

- **Cross-tenant differentiation by construction.** Two tenants using the same identity get different visual shapes. The articles look like different products, not the same template.
- **Intra-tenant consistency.** A single tenant always gets the same variant. Their readers experience a consistent brand format.
- **Orthogonality with existing layers.** Structural variants compose with persona overlays, angle tags, personality tags, conformance pass, and editorial memory. Each layer adds independent differentiation.

### 1.4 What structural variants do NOT solve

- **Analytical convergence.** Two tenants may still reach the same conclusions. Structural variants change how conclusions are presented, not what they are. The v2 archetype model addresses analytical convergence.
- **Intra-tenant cross-pipeline differentiation.** Different pipelines for the same tenant already use different identities. Structural variants target cross-tenant same-identity overlap.

---

## 2. Design

### 2.1 Variant assignment

Each `ContentPersona` (or, in production, each `ContentPipeline`) gets a structural variant assigned deterministically from the tenant ID:

```ts
type StructuralVariantId = 1 | 2 | 3;

function assignStructuralVariant(tenantId: string, identityId: string): StructuralVariantId {
  // Deterministic hash: same tenant + identity always gets the same variant.
  // Different identities for the same tenant may get different variants.
  const input = `${tenantId}::${identityId}`;
  const hash = hashString(input); // simple numeric hash
  const variantCount = getVariantCount(identityId); // 2 or 3
  return ((hash % variantCount) + 1) as StructuralVariantId;
}
```

Properties:
- **Deterministic.** Same tenant, same identity, same variant. Always.
- **Uniform distribution.** Over a large tenant population, variants are roughly evenly distributed.
- **Per-identity.** A tenant using both Journalist and Newsletter Editor may get variant 2 for one and variant 1 for the other. This is fine -- each identity's variants are independent.
- **Override-capable.** A tenant can explicitly pick a variant at onboarding, overriding the hash assignment. Stored as an optional field on the persona/pipeline.

### 2.2 ContentPersona type change

```ts
export interface ContentPersona {
  // ... existing fields ...

  /**
   * Structural variant for identity-agent output formatting.
   * Assigned deterministically from tenant ID + identity ID at onboarding,
   * or explicitly chosen by the tenant.
   *
   * When undefined, defaults to variant 1 (the current/legacy template).
   * This preserves backward compatibility with existing runs.
   */
  structuralVariant?: StructuralVariantId;

  /**
   * Custom structural template provided by the tenant. When present,
   * this overrides the pre-built variant lookup entirely — the tenant
   * gets exactly this structural directive injected into the identity call.
   *
   * Use case: enterprise tenants who already publish in a specific house
   * format and want their AI-generated content to match it exactly.
   *
   * The string should follow the same format as the pre-built variant
   * templates (a markdown block with structural directives). The identity's
   * voice, factual fidelity rules, and what-not-to-do constraints still
   * apply — only the structural layout changes.
   */
  customStructuralTemplate?: string;
}

/** Structural variant identifier. Each identity has 2-3 variants. */
export type StructuralVariantId = 1 | 2 | 3;
```

### 2.3 Resolution order

The structural directive for any identity call is resolved as:

```ts
const variantCount = IDENTITY_VARIANT_COUNTS[identityId]; // 2 or 3
const requestedVariant = persona?.structuralVariant ?? 1;
const clampedVariant = requestedVariant > variantCount ? 1 : requestedVariant; // fallback to default if out of range

const structuralDirective =
  persona?.customStructuralTemplate                   // 1. tenant-provided custom template
  ?? IDENTITY_VARIANTS[clampedVariant];               // 2. pre-built variant (clamped to identity's range)
```

Three tiers:
1. **Custom template** — enterprise tenants provide their own structural format. Full control, their responsibility to test.
2. **Pre-built variant** — most tenants pick (or are assigned) one of 2-3 pre-built variants per identity. Tested and validated by us. If the variant ID exceeds the identity's variant count (e.g., variant 3 on a 2-variant identity), it falls back to variant 1.
3. **Default (variant 1)** — backward compatible. The current template. No config needed.

This means the pre-built variants cover the majority of tenants at onboarding, while the custom template is an escape hatch for tenants with specific house formats. No new architecture — just a string field that bypasses the lookup.

### 2.4 How identity prompts branch on variant

Each identity file exports a variant map alongside the existing prompt. The `buildXxxUserMessage` function resolves the structural directive per section 2.3 and injects it into the user message (not the system prompt), so the identity's core voice remains constant while the structural instruction varies.

```ts
// Example pattern (each identity implements this)
export const TRADING_DESK_VARIANTS: Record<StructuralVariantId, string> = {
  1: `... variant 1 structural template (current) ...`,
  2: `... variant 2 structural template ...`,
  3: `... variant 3 structural template ...`,
};

export function buildTradingDeskUserMessage(
  coreAnalysis: string,
  persona?: ContentPersona,
): string {
  const structuralDirective =
    persona?.customStructuralTemplate
    ?? TRADING_DESK_VARIANTS[persona?.structuralVariant ?? 1];
  // ... inject structuralDirective into the user message ...
}
```

The structural directive replaces (or overrides) the `# Required structure` / `# Structure` section in the system prompt. The system prompt retains voice, format constraints, factual fidelity, and what-not-to-do rules. Only the structural template changes.

### 2.5 Integration with the v2 archetype model

In the v2 archetype model, identity agents become "format agents" within an archetype. Structural variants apply at the format-agent level, not the archetype level. An archetype's `structuralTemplate` (v2 spec section 2.3) defines the archetype's analytical sections. The identity's structural variant defines how those sections are visually rendered. These are complementary, not competing.

For the PoC (this spec), structural variants are implemented against the current identity system. Migration to the archetype model is a separate workstream.

---

## 3. Structural Variant Designs

Each identity gets 2-3 variants. Variant 1 is always the current template (backward compatible). Each variant preserves the identity's voice, analytical depth, and character while using a different visual shape.

### 3.1 Trading Desk (3 variants)

**Variant 1 -- Signal-First Alert (current)**

The existing template. Terse vertical layout: headline warning, WHAT/WHY/LEVEL fields, structured TRADE IDEA block with Bias/Entry/Stop/Target/R:R, one-line Risk caveat.

```
# STRUCTURAL FORMAT: Signal-First Alert

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

Risk: [one short sentence on what would invalidate]
```

**Variant 2 -- Context-Setup-Execute**

Builds context before the call. Three dense paragraphs instead of labeled fields, with the trade idea woven into a levels table. The reader gets the "why" before the "what to do" -- same urgency, different information architecture.

```
# STRUCTURAL FORMAT: Context-Setup-Execute

Follow this structure exactly:

**[SYMBOL]: [directional adjective] [catalyst in max 8 words]**

CONTEXT | [2-3 short sentences: what happened, why it matters for this pair/instrument. Dense. No fluff. This is the macro setup compressed into a single paragraph.]

SETUP | [2-3 short sentences: the technical or fundamental setup that makes this tradeable NOW. Reference the key level from the analysis. Connect the catalyst to the price action.]

| LEVEL | TYPE | NOTE |
|-------|------|------|
| [price] | Entry | [one phrase] |
| [price] | Stop | [one phrase] |
| [price] | Target | [one phrase] |

Bias: [long/short/hedge] | Invalidation: [the condition, not just a level — e.g. "daily close above 1.0950"]
```

**Variant 3 -- Snapshot Grid**

A scannable card format. One-line directional call at the top, a two-column market snapshot grid with key metrics, then a single narrative paragraph with the trade thesis. Designed for mobile consumption and rapid scanning.

```
# STRUCTURAL FORMAT: Snapshot Grid

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

⚠ Invalidation: [one sentence — what flips the view]
```

### 3.2 In-House Journalist (3 variants)

**Variant 1 -- Classic Column (current)**

The existing template. Prose journalism: headline, lead paragraph (who/what/when/where), background, narrative analytical body with attributed quotes, forward-looking close. No bullet points, no headings within the body. Reuters/Bloomberg column style.

```
# STRUCTURAL FORMAT: Classic Column

Write as journalism prose, no headings within the body. Structure loosely as:
1. A strong headline capturing the news and market angle
2. A lead paragraph grounding the reader (who, what, when, where, market impact)
3. A background paragraph with context for the move
4. The core analytical content as narrative prose — build cause-effect chains as journalism, not a textbook
5. Attributed observations ("one strategist noted...", "sources familiar with the matter said...")
6. A forward-looking close: what to watch, where the story goes, what changes the picture

No bullet points. No numbered lists. No subheadings. Pure prose journalism, 3-5 sentence paragraphs.
```

**Variant 2 -- Inverted Pyramid with Sidebar**

Leads with the conclusion and market impact (inverted pyramid), then adds a visually separated sidebar or boxed section with key levels/data, then fills in the analytical narrative. The reader gets the essential takeaway in the first 100 words, then chooses to read deeper. Wire-service meets data-journalism style.

```
# STRUCTURAL FORMAT: Inverted Pyramid with Data Sidebar

Structure as follows:

1. **Headline** — factual, punchy, conveys direction and magnitude
2. **Dateline + lead paragraph** — THE most important conclusion first. What happened, what it means for markets, and what the directional implication is. The reader who stops here still gets the story. (3-4 sentences, front-loaded)
3. **Key Figures** — a compact data block set apart from the prose:
   ```
   [Instrument]: [level] ([change]) | [Instrument]: [level] ([change]) | [Related]: [level] ([change])
   ```
4. **The analytical narrative** — 3-4 paragraphs building the cause-effect chain. Same journalism voice, same attributed quotes, but the narrative serves as SUPPORTING EVIDENCE for the conclusion already stated in the lead. Work backward from the conclusion, not forward toward it.
5. **What Would Change This View** — a single short paragraph (2-3 sentences) naming the counter-scenario. End the piece here. No warm close — the wire-service format ends when the information ends.

No bullet points in the narrative sections. The Key Figures block is the only non-prose element.
```

**Variant 3 -- Dispatch Format**

Short, high-frequency dispatch format. A bold one-line market read at the top, followed by 3 tight thematic paragraphs each led by a bold topic phrase. No headline in the traditional sense -- the dispatch opens with the market read. Feels like an FT "Markets Dispatch" or Bloomberg "Five Things" segment, but as continuous prose.

```
# STRUCTURAL FORMAT: Market Dispatch

Structure as follows:

1. **Market read** — a single bold opening sentence that captures the day's dominant theme and directional read. This IS the headline. No separate headline above it. Example: "**The dollar found a bid it wasn't expecting, and the euro is paying the price.**"
2. **First block** — Led by a bold topic phrase (e.g., "**The Fed's pivot.**"). 3-4 sentences covering the primary catalyst. Journalism prose, attributed quotes welcome.
3. **Second block** — Led by a bold topic phrase (e.g., "**The cross-asset read.**"). 3-4 sentences on the transmission chain — how the catalyst moves through other markets. Different angle from the first block.
4. **Third block** — Led by a bold topic phrase (e.g., "**What to watch.**"). 3-4 sentences on what happens next — the forward-looking view, the risk, the levels that matter.

No separate headline. No subheadings beyond the bold topic phrases. No bullet points. Total length stays within the identity's word range. The dispatch should feel like it was written fast, filed tight, and designed to be read standing up.
```

### 3.3 Senior Strategist (3 variants)

**Variant 1 -- Full Positioning Note (current)**

The existing template. Title, dated header with conviction call, Executive Summary, Background, Detailed Scenario Analysis (Base/Upside/Downside with probability weights), Cross-Asset Implications, Recommended Positioning, Key Risks, Signed-off Conclusion.

```
# STRUCTURAL FORMAT: Full Positioning Note

Follow this template:
1. **Title**: institutional ("EUR/USD: Positioning for the Risk-Off Bid")
2. **Header**: dated, one-line conviction call ("Bearish EUR/USD | Conviction: High | Horizon: 1-4 weeks")
3. **Executive Summary** (3-4 sentences): headline view, conviction, positioning, time horizon
4. **Background and current context**: one paragraph
5. **Detailed scenario analysis**: Base / Upside / Downside with probability weights and target ranges
6. **Cross-asset implications**: connected markets, leveraged plays, hedges
7. **Recommended positioning**: long/short/hedge bias with sizing note
8. **Key risks and what would change the view**: strongest counter-argument, flip trigger
9. **Signed-off conclusion**: one paragraph + faux signature ("— Macro Strategy Team")
```

**Variant 2 -- Thesis-Antithesis-Synthesis**

A dialectical structure. Opens with the dominant market thesis, then systematically dismantles it with the bear case (antithesis), then synthesizes a nuanced positioning view that accounts for both. No probability-weighted scenarios -- instead, two opposing arguments and a resolution. Reads like a long-form essay, not a research template.

```
# STRUCTURAL FORMAT: Thesis-Antithesis-Synthesis

Follow this structure:

1. **Title**: framed as a tension or question ("EUR/USD: Is the Rate Differential Story Overstated?", "Gold: Hedge or Crowded Trade?")
2. **Conviction line**: one sentence, positioned right after the title. Same format: "Conviction: [High/Moderate/Low] | [Direction] | Horizon: [timeframe]"
3. **The Prevailing Thesis** — 2-3 paragraphs. State the consensus view as strongly as its proponents would state it. Steelman it. Include the data points and arguments that support it. Write it as if you believe it.
4. **The Counterargument** — 2-3 paragraphs. Now dismantle it. Name the assumptions that could break. Surface the data the thesis is ignoring. Reference the cross-asset signals that complicate the picture. Do not strawman — this should be a genuine challenge.
5. **Synthesis and Positioning** — 2-3 paragraphs. Your actual view: what do you take from each side? Where does the weight of evidence land? State the directional conviction clearly. Include a sizing note and a time horizon. Name the specific trigger that would force you to revisit.
6. **The Asymmetric Tail** — one short paragraph. What is the tail-risk scenario that neither the thesis nor the antithesis adequately prices? What would you do if it materializes?
7. **Sign-off**: one line ("— [Team Name]")

No scenario probability tables. No bullet-point lists. Dense institutional prose throughout.
```

**Variant 3 -- Executive Briefing**

A compressed, high-density format for the CIO who reads 20 notes a day. Front-loads the positioning call with a structured decision box, then provides a single dense analytical paragraph, then a compact scenario table. Half the length of the full positioning note -- maximum information per word.

```
# STRUCTURAL FORMAT: Executive Briefing

Follow this structure:

1. **Title**: direct, no question marks ("EUR/USD: Short into ECB Divergence")
2. **Decision Box** — a compact structured block:
   ```
   VIEW:       [one sentence — the directional call]
   CONVICTION: [High / Moderate / Low]
   HORIZON:    [timeframe]
   EXPRESSION: [specific instrument or pair] — [long/short/hedge] — [sizing: tactical/core/max]
   HEDGE:      [instrument] if [condition]
   FLIP IF:    [the specific trigger that reverses the view]
   ```
3. **The Case** — ONE dense paragraph, 150-200 words. The entire analytical argument compressed. Every sentence must carry information. No scene-setting, no background for its own sake. This paragraph alone should be sufficient for a CIO to understand the view and its basis.
4. **Scenarios** — a compact table:
   | Scenario | Probability | Target | Trigger |
   |----------|-------------|--------|---------|
   | Base | [%] | [level] | [condition] |
   | Upside | [%] | [level] | [condition] |
   | Downside | [%] | [level] | [condition] |
5. **Cross-Asset** — 2-3 sentences naming the correlated plays and hedges. No elaboration beyond what's needed.
6. **Sign-off**: "— [Team Name]"

Target total length: 600-800 words (deliberately shorter than the standard 1000-1400). Information density is the priority.
```

### 3.4 Newsletter Editor (2 variants)

**Variant 1 -- Conversational Email (current)**

The existing template. Warm opener, explanation of what happened, "why this matters to you," house view (directional), forward-looking note, friendly close. Flowing prose, personal pronouns, email rhythm.

```
# STRUCTURAL FORMAT: Conversational Email

Structure loosely as:
1. A warm conversational opener — "Good morning. We've been watching one story this week..."
2. A clear explanation of what happened, plain English with sophistication
3. The "why this matters to you" framing — personal, second-person
4. The house view — a clear directional statement owned by "we"
5. A forward-looking note about what to monitor
6. A friendly close — "We'll be tracking this all week. Hit reply if you have questions."

Flowing prose. Personal pronouns. Short paragraphs. Email-friendly rhythm. No bullet points or lists.
```

**Variant 2 -- Three Things Format**

A structured newsletter format built around a numbered list of three takeaways, bookended by a conversational intro and close. Each takeaway is a short paragraph with a bold lead-in. Same warm voice, same house-view conviction, but the reader can scan the three points and choose which to read deeply. Common in high-performing email newsletters (Morning Brew, Axios).

```
# STRUCTURAL FORMAT: Three Things

Structure as follows:

1. **Conversational lead-in** — 2-3 sentences that set the scene. Same warm, personal voice. "This week's Fed decision is one of those moments where the market tells you something about itself. Here are three things we think you should take away."
2. **Thing 1: [bold topic phrase]** — A short paragraph (3-5 sentences) on the primary takeaway. What happened, why it matters. Include the house view here — don't save it for later.
3. **Thing 2: [bold topic phrase]** — A short paragraph (3-5 sentences) on the second takeaway. A different angle — the cross-asset implication, the risk, the opportunity, or the "thing most people are missing."
4. **Thing 3: [bold topic phrase]** — A short paragraph (3-5 sentences) on the forward-looking takeaway. What to watch, when the next inflection point is, what would change the view.
5. **One-line close** — Brief, warm. "That's the view from here. Talk next week." or "Questions? Hit reply. We read every one."

The bold topic phrases are the scannable hooks. The paragraphs below them are the substance. Same "we"/"you" voice throughout. Same conversational warmth. Total word count stays within 350-480.
```

### 3.5 Educator (3 variants)

**Variant 1 -- Concept Walkthrough (current)**

The existing template. Teaching-framed title, opening hook, concept definition, step-by-step worked example, transferable lessons, test-your-understanding quiz.

```
# STRUCTURAL FORMAT: Concept Walkthrough

Follow this template:
1. **Title**: teaching-framed ("What Today's Rate Decision Teaches Us About Central Bank Policy")
2. **Opening hook**: "This week's market move is a textbook example of [concept]. Let's break it down."
3. **The concept**: clear definition of the key macro/financial concept being illustrated
4. **The worked example**: walk through the event step-by-step, tracing each link in the cause-effect chain. Use "Step 1: ...", "Step 2: ..." or numbered paragraphs.
5. **The lessons**: 2-3 specific principles applicable to FUTURE events. Transferable, not event-specific.
6. **Test your understanding**: a single question or scenario with the answer included.
```

**Variant 2 -- Before-and-After Case Study**

Structures the lesson around a before/after comparison: what the market looked like before the event, what it looks like after, and what changed in between. The teaching happens through contrast rather than step-by-step walkthrough. Feels like a case study in a business school, not a textbook chapter.

```
# STRUCTURAL FORMAT: Before-and-After Case Study

Follow this structure:

1. **Title**: framed as a transformation ("How One Fed Decision Reshaped the EUR/USD Outlook", "From Risk-On to Risk-Off: A Market in 24 Hours")
2. **The Setup: Before** — 1-2 paragraphs describing the market state before the event. What were traders expecting? What was the consensus? What were the key levels? Paint the "before" picture clearly so the contrast with "after" is vivid. Define any concepts inline as you introduce them.
3. **The Catalyst** — 1 paragraph on what happened. Just the facts. Keep it tight.
4. **The Aftermath: After** — 1-2 paragraphs describing the market after the event. What changed? Which assets moved and by how much? How did expectations shift? Explicitly contrast with the "before" picture — "Traders who were expecting X now face Y."
5. **Why This Happened: Connecting the Dots** — 1-2 paragraphs explaining the mechanism. This is where the teaching lives. Why did the catalyst produce this specific aftermath? What is the general principle at work? Use analogies here.
6. **Your Takeaway** — a boxed or set-apart section with 2-3 bullet points. Each bullet is a transferable principle the student can apply to the next event. Phrased as rules: "When [condition], expect [consequence] because [mechanism]."

No quiz section. The before/after contrast IS the test — the student learns to recognize the pattern.
```

**Variant 3 -- Socratic Dialogue**

Structures the lesson as a series of questions and answers. Each section is led by a question the student might ask, followed by the answer. The progression of questions builds from "what happened?" through "why?" to "what should I learn?" Creates an interactive feel even in static text. Uncommon format that is visually distinct from any other identity.

```
# STRUCTURAL FORMAT: Socratic Dialogue

Follow this structure:

1. **Title**: question-led ("Why Did the Dollar Jump After the Fed Decision? A Lesson in Rate Expectations")
2. **Opening** — 2-3 sentences setting the context. "If you woke up to a stronger dollar this morning and wondered why, you're asking the right question. Let's walk through it together."
3. **Q: What actually happened?** — Answer in 2-3 sentences. Plain facts, no jargon. Define any term the first time you use it.
4. **Q: Why did markets react that way?** — Answer in 3-5 sentences. This is the core teaching section. Walk through the transmission mechanism. Use an analogy. Be patient.
5. **Q: [A deeper follow-up question specific to this event]** — This question should push one level deeper. Example: "Q: But wait -- if the Fed didn't actually raise rates, why did the dollar go UP?" Answer in 3-5 sentences. This is where the non-obvious insight lives.
6. **Q: What does this mean for me as a trader/investor?** — Answer in 2-3 sentences. Practical, grounded, no specific trade recommendations. Frame it as a principle, not advice.
7. **Q: How will I know when this pattern is happening again?** — Answer in 2-3 sentences. Give the student a recognition checklist: "Watch for [signal 1], [signal 2], and [signal 3]. When you see them together, the same mechanism is likely at work."
8. **Closing** — 1-2 sentences. Encouraging, forward-looking. "Markets will give you this lesson again. Now you'll recognize it."

Each Q section uses **bold** for the question. The progression must feel natural — each question flows from the previous answer. The student should feel like they're in a conversation, not reading a FAQ.
```

### 3.6 Beginner Blogger (2 variants)

**Variant 1 -- Story-Led Blog Post (current)**

The existing template. Catchy title, relatable opening hook, "what just happened" section, cause-and-effect with analogy, "what this means for you," soft educational CTA. Warm, conversational prose with no bullet points.

```
# STRUCTURAL FORMAT: Story-Led Blog Post

Structure as:
1. Catchy, intriguing title (not clickbait, but inviting)
2. A relatable opening hook — a question, a scenario, or "why this matters to you"
3. A "what just happened" section in plain English — no jargon
4. The cause-and-effect explanation, step by step, with at least one everyday analogy
5. A "what this means for you" section — practical, grounded
6. A soft educational CTA — "want to learn more? check out our beginner guide"

All prose. No bullet points. Short paragraphs (2-4 sentences). Warm and friendly throughout.
```

**Variant 2 -- Visual Explainer**

Uses a more structured, visual-friendly format with short labeled sections, a simple "how it works" diagram rendered in text, and a boxed key-takeaway at the end. Same friendly voice, same beginner audience, but the reader can scan section labels and jump to what interests them. Feels like a Vox or The Hustle explainer.

```
# STRUCTURAL FORMAT: Visual Explainer

Structure as follows:

1. **Title**: framed as a question or "explained" format ("The Fed Just Hit Pause on Rate Cuts -- Here's What That Actually Means", "Dollar Up, Euro Down: Explained Simply")
2. **The TL;DR** — 2-3 sentences in bold or set apart. The entire story compressed for the reader who will only read this. Plain English, no jargon.
3. **What happened** — A short section (heading: "What happened"). 2-3 sentences, just the facts.
4. **Why it matters** — A short section (heading: "Why it matters"). 3-4 sentences explaining the mechanism. Define every technical term inline. Include ONE analogy.
5. **How it works** — A simple text diagram showing the cause-effect chain:
   ```
   [Cause] → [First effect] → [Second effect] → [What you see on your screen]
   ```
   Example: "Fed signals fewer rate cuts → Dollar becomes more attractive → Money flows into USD → EUR/USD drops"
   Follow the diagram with 2-3 sentences elaborating on the chain.
6. **The bottom line** — A boxed or set-apart section (heading: "The bottom line"). 2-3 sentences. What this means for the reader personally. No trade recommendations. End with an encouraging note.

Use short section headings. Keep each section tight (2-4 sentences). The text diagram is the signature element of this format — it makes the invisible mechanism visible. Same warm, friendly voice throughout.
```

---

## 4. Variant Count Summary

| Identity | Variants | Rationale |
|----------|----------|-----------|
| Trading Desk | 3 | High structural rigidity in v1 (exact template). Three genuinely different alert formats exist in practice (signal-first, context-setup, snapshot). |
| In-House Journalist | 3 | Journalism has well-established structural archetypes (classic column, inverted pyramid, dispatch). |
| Senior Strategist | 3 | Institutional research has distinct formats (full note, thesis-antithesis, executive briefing). The exec briefing's shorter length is a genuine differentiator. |
| Newsletter Editor | 2 | Newsletter format has less structural diversity -- the "email" constraint limits how different variants can be. Two is honest. |
| Educator | 3 | Educational content has rich structural diversity (walkthrough, case study, Socratic). Each is a real pedagogical approach. |
| Beginner Blogger | 2 | Beginner content is constrained by simplicity requirements. Two formats (prose narrative, visual explainer) cover the realistic range. |
| **Total** | **16** | |

---

## 5. Expected Impact on Uniqueness Metrics

### 5.1 How structural variants affect each metric

| Metric | Expected impact | Why |
|--------|----------------|-----|
| **Cosine similarity** | Moderate reduction (est. 0.03-0.08 drop) | Embeddings are more semantic than structural, but different section ordering and information architecture do change the embedding space. The biggest impact comes from variants that change what information leads vs. trails (inverted pyramid vs. classic column). |
| **ROUGE-L** | Strong reduction (est. 0.08-0.15 drop) | ROUGE-L measures n-gram overlap, which is heavily influenced by structural templates. Two outputs with different section orderings, different heading styles, and different formatting (prose vs. table vs. labeled fields) will share far fewer long common subsequences. |
| **LLM judge: presentation similarity** | Strong reduction (est. 0.10-0.20 drop) | The two-axis judge explicitly evaluates "structural shape" and "headings, narrative arc" (v1 spec section 6.3). Different variants directly target this dimension. |
| **LLM judge: factual fidelity** | No change (0.00) | Structural variants change presentation, not facts. Fidelity should be unaffected. |

### 5.2 Interaction with existing differentiation layers

Structural variants are additive with:
- **Persona overlays** (brand voice, CTA, company background): voice-level differentiation on top of structural differentiation
- **Angle tags**: what to emphasize, within a different structure
- **Personality tags**: how to write, within a different structure
- **Conformance pass**: deterministic style corrections applied after structural shaping
- **Editorial memory**: temporal continuity across articles, within a consistent structural format

The layers compound. Each is independently insufficient; together they produce the differentiation the business requires.

---

## 6. Requirements

### Phase 1: Type System and Variant Assignment

#### 6.1 ContentPersona Type Extension (done in c317102)

**Acceptance criteria:**
- [x] `ContentPersona` in `types.ts` has new optional fields `structuralVariant?: StructuralVariantId` and `customStructuralTemplate?: string`
- [x] `StructuralVariantId` is exported as `type StructuralVariantId = 1 | 2 | 3`
- [x] Resolution order is documented in a JSDoc comment: custom template > pre-built variant > default (variant 1)
- [x] `bun run typecheck` passes with no errors in `packages/api/`
- [x] All existing test runs and harness invocations continue to work with both fields undefined (backward compatible)

#### 6.2 Variant Assignment Function (done in c317102)

**Acceptance criteria:**
- [x] A pure function `assignStructuralVariant(tenantId: string, identityId: string): StructuralVariantId` exists in a new file `packages/api/src/benchmark/uniqueness-poc/structural-variants.ts`
- [x] The function is deterministic: `assignStructuralVariant("tenant-a", "trading-desk") === assignStructuralVariant("tenant-a", "trading-desk")` for any number of calls
- [x] The function distributes variants uniformly: over 1000 random tenant IDs, each variant appears at least 25% of the time (for 3-variant identities) or 40% of the time (for 2-variant identities)
- [x] The function respects per-identity variant counts: never returns variant 3 for identities that only have 2 variants
- [x] A `IDENTITY_VARIANT_COUNTS` constant maps each identity ID to its variant count

### Phase 2: Variant Prompt Implementation

#### 6.3 Trading Desk Variants

**Acceptance criteria:**
- [ ] `TRADING_DESK_VARIANTS` constant exported from `trading-desk.ts` with entries for variants 1, 2, and 3
- [ ] Variant 1 matches the current structural template exactly (no behavioral change for existing runs)
- [ ] `buildTradingDeskUserMessage` accepts `persona?.structuralVariant` and injects the correct variant template
- [ ] When `structuralVariant` is undefined, variant 1 is used (backward compatible)

#### 6.4 In-House Journalist Variants

**Acceptance criteria:**
- [ ] `IN_HOUSE_JOURNALIST_VARIANTS` constant exported from `in-house-journalist.ts` with entries for variants 1, 2, and 3
- [ ] Variant 1 matches the current structural template exactly
- [ ] `buildInHouseJournalistUserMessage` accepts and injects the correct variant template
- [ ] Backward compatible when `structuralVariant` is undefined

#### 6.5 Senior Strategist Variants

**Acceptance criteria:**
- [ ] `SENIOR_STRATEGIST_VARIANTS` constant exported from `senior-strategist.ts` with entries for variants 1, 2, and 3
- [ ] Variant 1 matches the current structural template exactly
- [ ] `buildSeniorStrategistUserMessage` accepts and injects the correct variant template
- [ ] Backward compatible when `structuralVariant` is undefined

#### 6.6 Newsletter Editor Variants

**Acceptance criteria:**
- [ ] `NEWSLETTER_EDITOR_VARIANTS` constant exported from `newsletter-editor.ts` with entries for variants 1 and 2
- [ ] Variant 1 matches the current structural template exactly
- [ ] `buildNewsletterEditorUserMessage` accepts and injects the correct variant template
- [ ] Backward compatible when `structuralVariant` is undefined

#### 6.7 Educator Variants

**Acceptance criteria:**
- [ ] `EDUCATOR_VARIANTS` constant exported from `educator.ts` with entries for variants 1, 2, and 3
- [ ] Variant 1 matches the current structural template exactly
- [ ] `buildEducatorUserMessage` accepts and injects the correct variant template
- [ ] Backward compatible when `structuralVariant` is undefined

#### 6.8 Beginner Blogger Variants

**Acceptance criteria:**
- [ ] `BEGINNER_BLOGGER_VARIANTS` constant exported from `beginner-blogger.ts` with entries for variants 1 and 2
- [ ] Variant 1 matches the current structural template exactly
- [ ] `buildBeginnerBloggerUserMessage` accepts and injects the correct variant template
- [ ] Backward compatible when `structuralVariant` is undefined

### Phase 3: Harness Integration and Persona Fixtures

#### 6.9 Persona Fixture Updates

**Acceptance criteria:**
- [ ] `broker-a.json` has `"structuralVariant": 1` (or no field, defaulting to 1)
- [ ] `broker-b.json` has `"structuralVariant": 2`
- [ ] `broker-c.json` has `"structuralVariant": 3` (for 3-variant identities) or `"structuralVariant": 2` (for 2-variant identities)
- [ ] `broker-d.json` has `"structuralVariant": 1` (to test that two different personas with the same variant still differ via other layers)
- [ ] All fixture files pass validation against the updated `ContentPersona` schema

#### 6.10 Runner Integration

**Acceptance criteria:**
- [ ] The Stage 2 (identity adaptation) and Stage 6 (cross-tenant matrix) code paths read `persona.structuralVariant` and pass it through to `buildXxxUserMessage`
- [ ] The run manifest records which structural variant was used for each output (add to `IdentityOutput` or a new field on the cross-tenant matrix)
- [ ] A run with `--full` produces outputs where different personas use different structural variants for the same identity
- [ ] The raw-data.json includes the structural variant ID for each output

#### 6.11 Report and Analysis Updates

**Acceptance criteria:**
- [ ] The text report (`report.ts`) mentions the structural variant used for each output in the cross-tenant matrix section
- [ ] The analysis script surfaces variant information when analyzing cross-tenant pairs

### Phase 4: Validation Run

#### 6.12 Structural Variant Validation

**Acceptance criteria:**
- [ ] Run the full PoC harness (`--full --editorial-memory`) with the updated persona fixtures on at least 2 events
- [ ] Cross-tenant pairs using different structural variants show lower cosine similarity than the baseline (document the delta)
- [ ] Cross-tenant pairs using different structural variants show lower ROUGE-L than the baseline (document the delta)
- [ ] No degradation in factual fidelity scores (judge fidelity remains >= 0.90)
- [ ] Results written up with specific numbers in a run analysis

---

## 7. Implementation Plan (Sprint Contracts)

### Phase 1 -- Type System and Assignment

- [x] **Task 1:** Add `StructuralVariantId` type and `structuralVariant` field to `ContentPersona` (done in c317102)
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/types.ts`
  - **Depends on:** Nothing
  - **Verify:** `bun run typecheck` passes. Existing harness runs without errors when `structuralVariant` is undefined.

- [x] **Task 2:** Implement variant assignment function and identity variant count registry (done in c317102)
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/structural-variants.ts` (new)
  - **Depends on:** Task 1
  - **Verify:** Write a quick inline test: call `assignStructuralVariant` with 1000 random UUIDs, assert uniform distribution and determinism. `bun run typecheck` passes.

### Phase 2 -- Variant Prompts (can be parallelized across identities)

- [ ] **Task 3:** Implement Trading Desk structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/trading-desk.ts`
  - **Depends on:** Task 1
  - **Verify:** `bun run typecheck` passes. `TRADING_DESK_VARIANTS[1]` contains the current template text. `buildTradingDeskUserMessage(analysis, { ...persona, structuralVariant: 2 })` returns a string containing variant 2's structural directive.

- [ ] **Task 4:** Implement In-House Journalist structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/in-house-journalist.ts`
  - **Depends on:** Task 1
  - **Verify:** Same pattern as Task 3. Variant 1 matches current template.

- [ ] **Task 5:** Implement Senior Strategist structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/senior-strategist.ts`
  - **Depends on:** Task 1
  - **Verify:** Same pattern as Task 3. Variant 1 matches current template. Variant 3 (Executive Briefing) uses different target word count (600-800 vs. 1000-1400).

- [ ] **Task 6:** Implement Newsletter Editor structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/newsletter-editor.ts`
  - **Depends on:** Task 1
  - **Verify:** Same pattern as Task 3. Only 2 variants (no variant 3).

- [ ] **Task 7:** Implement Educator structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/educator.ts`
  - **Depends on:** Task 1
  - **Verify:** Same pattern as Task 3. Variant 1 matches current template.

- [ ] **Task 8:** Implement Beginner Blogger structural variants
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/beginner-blogger.ts`
  - **Depends on:** Task 1
  - **Verify:** Same pattern as Task 3. Only 2 variants (no variant 3).

- [ ] **Task 9:** Update identity registry to export variant maps
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/prompts/identities/index.ts`
  - **Depends on:** Tasks 3-8
  - **Verify:** `RegisteredIdentity` type includes a `variantCount` field or the variant maps are accessible via a registry lookup. `bun run typecheck` passes.

### Phase 3 -- Harness Integration

- [ ] **Task 10:** Update persona fixture files with structural variant assignments
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/personas/broker-a.json`, `broker-b.json`, `broker-c.json`, `broker-d.json`
  - **Depends on:** Task 1
  - **Verify:** Each file is valid JSON and passes the `ContentPersona` schema. Variants are distributed across brokers.

- [ ] **Task 11:** Wire structural variants through the runner (Stage 2 and Stage 6)
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/runner.ts`, `packages/api/src/benchmark/uniqueness-poc/index.ts`
  - **Depends on:** Tasks 9, 10
  - **Verify:** Run `bun run poc:uniqueness -- --stage 2` with a persona that has `structuralVariant: 2`. Inspect the output -- it should follow variant 2's structural format, not variant 1's.

- [ ] **Task 12:** Record structural variant in output metadata and run manifest
  - **Files:** `packages/api/src/benchmark/uniqueness-poc/types.ts` (add to `IdentityOutput`), `packages/api/src/benchmark/uniqueness-poc/persist.ts`, `packages/api/src/benchmark/uniqueness-poc/report.ts`
  - **Depends on:** Task 11
  - **Verify:** `raw-data.json` from a test run includes `structuralVariant` on each identity output. The text report mentions variant IDs.

### Phase 4 -- Validation

- [ ] **Task 13:** Run validation and document results
  - **Files:** No code changes. Run the harness, collect results, write analysis.
  - **Depends on:** Task 12
  - **Verify:** At least 2 events run with `--full`. Cross-tenant similarity numbers documented. Comparison with baseline (pre-variant) numbers included. Factual fidelity unaffected.

---

## 8. Constraints

- **Strict TypeScript, no `any`.** All new types and functions must pass `bun run typecheck`.
- **Backward compatible.** Existing runs with `structuralVariant: undefined` must produce identical results to pre-change behavior.
- **PoC harness first.** This spec targets `packages/api/src/benchmark/uniqueness-poc/`. Production pipeline integration is a separate workstream.
- **No system prompt changes.** Structural variants are injected via the user message (or a dedicated structural directive section), not by modifying the identity's system prompt. The system prompt defines the identity's voice and rules; the user message defines the structural template for this specific invocation.
- **Variant 1 = current template.** For every identity, variant 1 must be the exact current structural template. No existing behavior changes.

---

## 9. Out of Scope

- **Production pipeline integration.** This spec covers the PoC harness only. Wiring structural variants into the production content pipeline is deferred.
- **Tenant-facing variant selection UI.** Tenants cannot choose their variant through a UI yet. The assignment is deterministic from tenant ID or hardcoded in the persona fixture.
- **Dynamic variant creation.** The variants are pre-authored and static. A future system where tenants define custom structural templates is out of scope.
- **Cross-identity structural variants.** Each identity's variants are independent. There is no mechanism for "this tenant always gets variant 2 across all identities."
- **Variant-aware editorial memory.** Editorial memory does not track which structural variant was used. A future iteration might use variant-consistent memory retrieval.
- **Changes to the v2 archetype model.** Structural variants compose with archetypes but do not modify the archetype spec.

---

## 10. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Should the structural variant be injected into the system prompt or user message? | System prompt = more reliable adherence; user message = cleaner separation of concerns. Current spec says user message. | Phase 2 start |
| 2 | Should the Senior Strategist variant 3 (Executive Briefing) override the identity's `targetWordCount`? It targets 600-800 words vs. the identity's 1000-1400. | Affects word-count validation in the report. May need per-variant word count ranges. | Phase 2 (Task 5) |
| 3 | How should structural variants interact with the v2 archetype's `structuralTemplate` field? | If archetypes define section ordering and variants define visual rendering, we need clarity on which takes precedence. | Before v2 archetype implementation (not blocking this spec) |
| 4 | Should the CHANGELOG.md for identity prompts track variant additions as a prompt change? | Affects prompt hash tracking and run reproducibility analysis. | Phase 2 start |

---

## 11. Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-16 | 2-3 variants per identity, not more | More variants = more maintenance, harder to validate quality. 2-3 covers the realistic structural diversity for each professional context without over-engineering. |
| 2026-04-16 | Variant 1 = current template for all identities | Backward compatibility. No existing behavior changes. Existing validation runs remain valid baselines. |
| 2026-04-16 | Newsletter Editor and Beginner Blogger get 2 variants, others get 3 | These two identities have tighter format constraints (email length, simplicity requirements) that limit how structurally different variants can realistically be. Two is honest. |
| 2026-04-16 | Structural variant assignment is per tenant+identity, not per tenant | A tenant using both Journalist and Educator may get different variants for each. This maximizes differentiation surface and avoids the problem of "tenant B always gets variant 2 for everything." |
| 2026-04-16 | Variants go in user message, not system prompt | System prompt defines the identity's voice and rules (stable across all tenants). User message defines the per-invocation context (persona, angle, variant). This separation is clean and consistent with how persona overlays are already injected. |
| 2026-04-16 | PoC harness first, production pipeline later | The PoC harness is where we measure impact. Production integration depends on validating that structural variants actually improve uniqueness scores before investing in pipeline plumbing. |
