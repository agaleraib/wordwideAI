/**
 * Conformance pass — runs the translation engine's Style & Voice specialist
 * on each cross-tenant output to enforce persona-specific brand voice.
 *
 * This is the bridge between the content pipeline (which generates content
 * from a shared core analysis) and the translation engine's per-tenant
 * quality enforcement. The goal is NOT language quality — it's brand voice
 * divergence. Two outputs from the same identity agent tend to converge
 * structurally; running each through a Style & Voice pass tuned to the
 * broker's specific brand rules pushes them apart organically.
 *
 * What runs:
 *   - Style & Voice specialist (formality, sentence structure, brand adherence)
 *
 * What does NOT run (by design — see session discussion 2026-04-10):
 *   - Terminology / glossary (per-language concern; English glossary could be
 *     added later but is not the divergence driver)
 *   - Structural specialist (designed for source-vs-translation comparison,
 *     no source document in content generation)
 *   - Linguistic specialist (translation quality only)
 *   - Full 13-metric scoring loop (overkill, mixes concerns)
 */

import type { ContentPersona } from "./types.js";
import type { IdentityOutput } from "./types.js";
import type { LanguageProfile, ToneProfile } from "../../profiles/types.js";
import type { FailedMetricData } from "../../agents/specialists/shared.js";
import { LanguageProfileSchema } from "../../profiles/types.js";
import { correctStyle } from "../../agents/specialists/style.js";

export interface ConformanceResult {
  /** The rewritten body after the Style & Voice pass. */
  body: string;
  /** The specialist's reasoning for what it changed. */
  reasoning: string;
  /** Token usage from the specialist call. */
  usage: { inputTokens: number; outputTokens: number };
  /** Whether the specialist actually changed anything. */
  changed: boolean;
}

/**
 * Map a ContentPersona's brand voice description into a LanguageProfile
 * that the Style & Voice specialist can consume.
 *
 * The mapping is interpretive — ContentPersona has free-text brand voice
 * while LanguageProfile has structured tone fields. We extract what we
 * can and pass the rest as brandRules.
 */
export function personaToLanguageProfile(persona: ContentPersona): LanguageProfile {
  const tone = inferToneFromPersona(persona);
  const brandRules = buildBrandRules(persona);

  return LanguageProfileSchema.parse({
    regionalVariant: persona.regionalVariant,
    tone,
    brandRules,
    // No glossary in the content pipeline (English-only, not translation).
    // No compliancePatterns (jurisdiction-level, not style-level).
  });
}

/**
 * Infer structured ToneProfile fields from the persona's free-text
 * brandVoice description. Conservative defaults — better to under-specify
 * and let the specialist work from brandRules than to hallucinate a
 * formality level.
 */
function inferToneFromPersona(persona: ContentPersona): Partial<ToneProfile> {
  // Scan both brandVoice and personalityTags for tone markers — tags
  // like "high-conviction" and "aggressive" are as relevant as brandVoice
  // text but live in a different field.
  const tagText = persona.personalityTags?.join(" ").toLowerCase() ?? "";
  const bv = persona.brandVoice.toLowerCase() + " " + tagText;

  // Formality: scan for explicit markers
  let formalityLevel = 3; // neutral default
  if (
    bv.includes("institutional") ||
    bv.includes("conservative") ||
    bv.includes("formal") ||
    bv.includes("measured") ||
    bv.includes("authoritative")
  ) {
    formalityLevel = 5;
  } else if (
    bv.includes("professional") ||
    bv.includes("serious")
  ) {
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

  // Sentence length: energetic/punchy = short, institutional = long
  let avgSentenceLength = 20;
  if (formalityLevel >= 4) avgSentenceLength = 26;
  if (formalityLevel <= 2) avgSentenceLength = 14;

  // Hedging: conservative = high, action-oriented = low
  let hedgingFrequency: "low" | "moderate" | "high" = "moderate";
  if (bv.includes("high-conviction") || bv.includes("direct") || bv.includes("urgent")) {
    hedgingFrequency = "low";
  } else if (bv.includes("measured") || bv.includes("conservative") || bv.includes("nuance")) {
    hedgingFrequency = "high";
  }

  // Person preference
  let personPreference: "first" | "second" | "third" = "third";
  if (bv.includes("conversational") || bv.includes("peer")) {
    personPreference = "second";
  }

  return {
    formalityLevel,
    description: persona.brandVoice.slice(0, 200),
    avgSentenceLength,
    sentenceLengthStddev: 6,
    personPreference,
    hedgingFrequency,
  };
}

/**
 * Build brandRules array from persona fields. These are the constraints
 * the Style & Voice specialist checks against. Each rule is a single
 * actionable directive.
 */
function buildBrandRules(persona: ContentPersona): string[] {
  const rules: string[] = [];

  // Brand voice as the primary style directive
  rules.push(`Brand voice: ${persona.brandVoice}`);

  // Audience framing
  if (persona.audienceProfile) {
    rules.push(`Target audience: ${persona.audienceProfile}`);
  }

  // Brand positioning
  if (persona.brandPositioning) {
    rules.push(`Brand positioning: ${persona.brandPositioning}`);
  }

  // Forbidden claims
  for (const claim of persona.forbiddenClaims) {
    rules.push(`FORBIDDEN: must not use the phrase "${claim}" or equivalent`);
  }

  // CTA policy
  if (persona.ctaPolicy === "always" && persona.ctaLibrary.length > 0) {
    rules.push(
      `Must include at least one call-to-action from: ${persona.ctaLibrary.map((c) => `"${c.text}"`).join(", ")}`,
    );
  } else if (persona.ctaPolicy === "never") {
    rules.push("Must NOT include any call-to-action or sales language");
  }

  return rules;
}

/**
 * Run the Style & Voice specialist on a single output, using the
 * persona's brand rules as the enforcement target.
 *
 * The "source text" parameter (which the specialist normally uses to
 * compare against the original) receives the identity output itself —
 * we don't want structural comparison, we want the specialist to
 * rewrite the output to match the brand voice profile. Passing the
 * same text as both source and translation signals "the content is
 * correct, just adjust the style."
 */
export async function runConformancePass(
  output: IdentityOutput,
  persona: ContentPersona,
): Promise<ConformanceResult> {
  const langProfile = personaToLanguageProfile(persona);

  // The failed metrics signal tells the specialist what to focus on.
  // We flag brand_voice_adherence as the primary concern since that's
  // the divergence driver.
  const failedMetrics: Record<string, FailedMetricData> = {
    brand_voice_adherence: {
      score: 70, // synthetic low score to trigger enforcement
      threshold: 95,
      details: `Enforce ${persona.name} brand voice: ${persona.brandVoice.slice(0, 150)}`,
      evidence: [
        `Target brand: ${persona.name}`,
        `Voice: ${persona.brandVoice.slice(0, 100)}`,
      ],
    },
  };

  const result = await correctStyle(
    output.body, // "source" = the generated content itself
    output.body, // "translation" = same content, to be rewritten for style
    langProfile,
    failedMetrics,
  );

  const changed = result.correctedText.trim() !== output.body.trim();

  return {
    body: result.correctedText,
    reasoning: result.reasoning,
    usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
    changed,
  };
}

/**
 * Run conformance on all cross-tenant outputs in parallel.
 * Returns the outputs with their bodies replaced by the specialist's
 * rewritten versions.
 */
export async function runConformancePassAll(
  outputs: IdentityOutput[],
  personas: ContentPersona[],
  onTenantConformed?: (index: number, changed: boolean) => void,
): Promise<{
  outputs: IdentityOutput[];
  conformanceResults: ConformanceResult[];
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
    // Keep original token counts — the conformance pass is a separate cost line
  }));

  return {
    outputs: conformedOutputs,
    conformanceResults: results,
  };
}
