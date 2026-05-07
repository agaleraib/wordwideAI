/**
 * Conformance pass — enforces persona-specific brand voice on each
 * cross-tenant output to drive structural divergence.
 *
 * Uses a dedicated brand-voice enforcement prompt (not the translation
 * engine's Style & Voice specialist) because the content pipeline's job
 * is different: rewrite a draft article to sound like a specific brand,
 * not fix a translation against a source document.
 *
 * What runs:
 *   - Brand voice enforcement (formality, sentence structure, hedging,
 *     person preference, company background, CTAs, forbidden claims)
 *
 * What does NOT run (by design — see session discussion 2026-04-10):
 *   - Terminology / glossary (per-language concern, not the divergence
 *     driver at this stage)
 *   - Structural specialist (source-vs-translation, doesn't apply)
 *   - Linguistic specialist (translation quality only)
 *   - Full 13-metric scoring loop (overkill, mixes concerns)
 */

import type { ContentPersona, IdentityOutput } from "./types.js";
import type { ToneProfile } from "../../profiles/types.js";
import { callAgentWithUsage } from "../../lib/anthropic.js";
import { parseSpecialistResponse } from "../../agents/specialists/shared.js";
import { computeCostUsd } from "./pricing.js";
import { modelForTier } from "./pricing.js";

// ───────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────

export interface ConformanceResult {
  /** The rewritten body after the brand voice pass. */
  body: string;
  /** The specialist's reasoning for what it changed. */
  reasoning: string;
  /** Token usage from the specialist call. */
  usage: { inputTokens: number; outputTokens: number };
  /** Whether the specialist actually changed anything. */
  changed: boolean;
  /** Cost of this specialist call. */
  costUsd: number;
}

// ───────────────────────────────────────────────────────────────────
// Dedicated conformance prompt (fix #1 — no more source=translation)
// ───────────────────────────────────────────────────────────────────

/**
 * Conformance specialist system prompt. Exported so the Wave M reproducibility
 * receipt (audit §5.1) can capture its SHA-256 hash in
 * `RunManifest.reproducibility.promptVersions.conformance` — bytes-equivalent
 * checks on this prompt are the only way to detect silent edits between waves.
 */
export const CONFORMANCE_SYSTEM_PROMPT = `You are a brand voice enforcement specialist for financial content.

You receive a draft article and a target brand profile. Your job is to rewrite the article so it sounds like it was written BY that brand, FOR that brand's audience. You are adjusting voice and weaving in brand context, while preserving all facts.

YOUR SCOPE:
- Formality level (match the target exactly)
- Sentence length and rhythm (match the target range)
- Hedging frequency (strip or add hedging per the target)
- Person preference (first/second/third as specified)
- Brand rule compliance (enforce every rule listed)
- Company references (weave in company background facts naturally where they add credibility or context — do not force every fact into every piece)
- CTA compliance (include or exclude calls-to-action per the policy)
- Forbidden claims (remove any that appear)

YOU MUST NOT:
- Change the factual claims, numbers, percentages, or analytical conclusions
- Add or remove analytical sections or change the document's topical coverage
- Change the meaning of any statement
- Invent financial data, price targets, or probabilities not in the draft

Your output must be the COMPLETE rewritten article.
After the article, add a line "---REASONING---" followed by a brief list of what you changed and why.`;

function buildConformancePrompt(
  body: string,
  persona: ContentPersona,
  tone: InferredTone,
): string {
  const lines: string[] = [];

  lines.push("Rewrite this draft article to match the target brand profile.\n");

  lines.push("DRAFT ARTICLE:");
  lines.push("---");
  lines.push(body);
  lines.push("---\n");

  lines.push("TARGET BRAND PROFILE:");
  lines.push(`- Brand: ${persona.name}`);
  lines.push(`- Voice: ${persona.brandVoice}`);
  lines.push(`- Target audience: ${persona.audienceProfile}`);
  lines.push(`- Brand positioning: ${persona.brandPositioning}`);
  lines.push(`- Formality level: ${tone.formalityLevel}/5`);
  lines.push(`- Target avg sentence length: ${tone.avgSentenceLength} words (±6)`);
  lines.push(`- Person preference: ${tone.personPreference} person`);
  lines.push(`- Hedging frequency: ${tone.hedgingFrequency}`);
  lines.push(`- Regional variant: ${persona.regionalVariant}`);

  if (persona.companyBackground && persona.companyBackground.length > 0) {
    lines.push(`\nCOMPANY BACKGROUND (weave naturally where relevant):`);
    for (const fact of persona.companyBackground) {
      lines.push(`  - ${fact}`);
    }
  }

  if (persona.forbiddenClaims.length > 0) {
    lines.push(`\nFORBIDDEN CLAIMS (must not appear):`);
    for (const claim of persona.forbiddenClaims) {
      lines.push(`  - "${claim}"`);
    }
  }

  if (persona.ctaPolicy === "always" && persona.ctaLibrary.length > 0) {
    lines.push(`\nCTA POLICY: Must include at least one call-to-action from:`);
    for (const cta of persona.ctaLibrary) {
      lines.push(`  - "${cta.text}"`);
    }
  } else if (persona.ctaPolicy === "never") {
    lines.push(`\nCTA POLICY: Must NOT include any call-to-action or sales language.`);
  } else if (persona.ctaPolicy === "when-relevant") {
    lines.push(`\nCTA POLICY: Include a call-to-action only if it fits naturally. Available:`);
    for (const cta of persona.ctaLibrary) {
      lines.push(`  - "${cta.text}"`);
    }
  }

  lines.push(`\nInstructions:`);
  lines.push(`1. Rewrite the draft to match formality level ${tone.formalityLevel}/5.`);
  lines.push(`2. Adjust sentence length toward ~${tone.avgSentenceLength} words average.`);
  lines.push(`3. ${tone.hedgingFrequency === "low" ? "Strip hedging language — be direct and high-conviction." : tone.hedgingFrequency === "high" ? "Add appropriate hedging — measured, calibrated, acknowledging uncertainty." : "Use moderate hedging where appropriate."}`);
  lines.push(`4. Use ${tone.personPreference} person throughout.`);
  lines.push(`5. Preserve ALL factual claims, numbers, and analytical conclusions exactly.`);
  lines.push(`6. Return the COMPLETE rewritten article.`);

  return lines.join("\n");
}

// ───────────────────────────────────────────────────────────────────
// Tone inference (unchanged from before)
// ───────────────────────────────────────────────────────────────────

interface InferredTone {
  formalityLevel: number;
  avgSentenceLength: number;
  personPreference: "first" | "second" | "third";
  hedgingFrequency: "low" | "moderate" | "high";
}

/**
 * Infer structured tone fields from the persona's brandVoice and
 * personalityTags. Conservative defaults.
 */
export function inferToneFromPersona(persona: ContentPersona): InferredTone {
  const tagText = persona.personalityTags?.join(" ").toLowerCase() ?? "";
  const bv = persona.brandVoice.toLowerCase() + " " + tagText;

  let formalityLevel = 3;
  if (
    bv.includes("institutional") ||
    bv.includes("conservative") ||
    bv.includes("formal") ||
    bv.includes("measured") ||
    bv.includes("authoritative")
  ) {
    formalityLevel = 5;
  } else if (bv.includes("professional") || bv.includes("serious")) {
    formalityLevel = 4;
  } else if (
    bv.includes("conversational") ||
    bv.includes("accessible") ||
    bv.includes("casual")
  ) {
    formalityLevel = 2;
  } else if (
    bv.includes("energetic") ||
    bv.includes("urgent") ||
    bv.includes("action-oriented") ||
    bv.includes("punchy")
  ) {
    formalityLevel = 1;
  }

  let avgSentenceLength = 20;
  if (formalityLevel >= 4) avgSentenceLength = 26;
  if (formalityLevel <= 2) avgSentenceLength = 14;

  let hedgingFrequency: "low" | "moderate" | "high" = "moderate";
  if (bv.includes("high-conviction") || bv.includes("direct") || bv.includes("urgent")) {
    hedgingFrequency = "low";
  } else if (bv.includes("measured") || bv.includes("conservative") || bv.includes("nuance")) {
    hedgingFrequency = "high";
  }

  let personPreference: "first" | "second" | "third" = "third";
  if (bv.includes("conversational") || bv.includes("peer")) {
    personPreference = "second";
  }

  return { formalityLevel, avgSentenceLength, personPreference, hedgingFrequency };
}

// ───────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────

const CONFORMANCE_MODEL_TIER = "sonnet" as const;

/**
 * Run the brand voice enforcement specialist on a single output.
 */
export async function runConformancePass(
  output: IdentityOutput,
  persona: ContentPersona,
): Promise<ConformanceResult> {
  const tone = inferToneFromPersona(persona);
  const prompt = buildConformancePrompt(output.body, persona, tone);
  const model = modelForTier(CONFORMANCE_MODEL_TIER);

  const result = await callAgentWithUsage(
    CONFORMANCE_MODEL_TIER,
    CONFORMANCE_SYSTEM_PROMPT,
    prompt,
    8192,
  );

  const [correctedText, reasoning] = parseSpecialistResponse(result.text);
  const changed = correctedText.trim() !== output.body.trim();
  const costUsd = computeCostUsd(model, result.usage.inputTokens, result.usage.outputTokens);

  return {
    body: correctedText,
    reasoning,
    usage: result.usage,
    changed,
    costUsd,
  };
}

/**
 * Run conformance on all cross-tenant outputs in parallel.
 * Returns the outputs with bodies replaced + total conformance cost.
 */
export async function runConformancePassAll(
  outputs: IdentityOutput[],
  personas: ContentPersona[],
  onTenantConformed?: (index: number, changed: boolean) => void,
): Promise<{
  outputs: IdentityOutput[];
  conformanceResults: ConformanceResult[];
  totalCostUsd: number;
}> {
  const results = await Promise.all(
    outputs.map(async (output, i) => {
      const result = await runConformancePass(output, personas[i]!);
      onTenantConformed?.(i, result.changed);
      return result;
    }),
  );

  const conformedOutputs = outputs.map((output, i) => ({
    ...output,
    body: results[i]!.body,
  }));

  const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

  return {
    outputs: conformedOutputs,
    conformanceResults: results,
    totalCostUsd,
  };
}
