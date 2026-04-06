/**
 * Profile Extraction Agent — extracts client profile parameters from text samples.
 *
 * Two-phase approach:
 *   Phase 1 (source-only): Extract brand rules, tone, compliance patterns, forbidden
 *           terms from the CLIENT'S original documents. These are the client's baseline.
 *   Phase 2 (pairs): Extract glossary mappings from source + translation pairs.
 *           Glossary needs both sides to know the term → translation mapping.
 *
 * Recommended sample sizes:
 *   - Minimum:  5 documents  — basic terminology + tone direction
 *   - Solid:   10-15 docs    — reliable statistics (sentence length, passive %, formality)
 *   - Ideal:   20+ docs      — high-confidence glossary + full style fingerprint
 */

import { runAgentStructured } from "../lib/anthropic.js";
import type { AgentConfig, EventHandler } from "../lib/types.js";
import type { LanguageProfile } from "../profiles/types.js";
import { LanguageProfileSchema } from "../profiles/types.js";

// --- Types ---

export interface TextSample {
  /** Source text (English) — the client's original content */
  source: string;
  /** Human translation (optional — only needed for glossary extraction) */
  translation?: string;
}

export interface ExtractionRequest {
  clientId: string;
  clientName: string;
  targetLanguage: string;
  regionalVariant?: string;
  samples: TextSample[];
}

export interface ExtractionResult {
  clientId: string;
  clientName: string;
  sourceLanguage: string;
  targetLanguage: string;
  extractedProfile: LanguageProfile;
  sampleCount: number;
  confidence: "low" | "medium" | "high";
  warnings: string[];
}

// --- Confidence ---

function assessConfidence(sampleCount: number): "low" | "medium" | "high" {
  if (sampleCount >= 15) return "high";
  if (sampleCount >= 5) return "medium";
  return "low";
}

function buildWarnings(req: ExtractionRequest): string[] {
  const warnings: string[] = [];
  const count = req.samples.length;

  if (count < 3) {
    warnings.push(
      `Only ${count} sample(s) provided. Minimum 5 recommended for reliable extraction.`,
    );
  } else if (count < 5) {
    warnings.push(
      `${count} samples provided. 10-15 recommended for reliable tone statistics.`,
    );
  }

  const withTranslation = req.samples.filter((s) => s.translation).length;
  if (withTranslation === 0) {
    warnings.push(
      "No translation pairs provided. Glossary will contain source terms only (no target translations). " +
        "Provide source + human translation pairs for glossary mappings.",
    );
  } else if (withTranslation < 5) {
    warnings.push(
      `Only ${withTranslation} translation pairs. 5+ recommended for reliable glossary coverage.`,
    );
  }

  return warnings;
}

// --- Phase 1: Source-Only Extraction (brand, tone, compliance) ---

const PHASE1_SYSTEM_PROMPT = `You are a senior localization analyst at WordwideFX. You are analyzing the CLIENT'S OWN original documents to understand their brand voice, tone, and communication style.

IMPORTANT: These are the client's original texts — they define the baseline. Extract rules based on what the client ACTUALLY does consistently, not what they should ideally do. If the client capitalizes their name inconsistently, note the dominant pattern but do NOT create a rule they themselves don't follow consistently.

For each rule or pattern, only include it if observed in at least 60% of the samples.`;

function buildPhase1Prompt(req: ExtractionRequest): string {
  return `${PHASE1_SYSTEM_PROMPT}

CLIENT: ${req.clientName} (${req.clientId})
SAMPLES PROVIDED: ${req.samples.length}

Analyze ALL source documents and extract:

1. TONE PROFILE (from the client's own writing style):
   - formalityLevel (1-5): Assess from their word choice, sentence structure, register
   - description: Short description of the tone
   - avgSentenceLength: Count words per sentence across samples, compute mean
   - sentenceLengthStddev: Compute standard deviation
   - personPreference: "first" / "second" / "third" — which do they actually use?
   - hedgingFrequency: "low" / "moderate" / "high" — how often do they hedge?

2. BRAND RULES: Only include rules the client follows CONSISTENTLY (60%+ of samples):
   - Capitalization patterns for their brand name and product names
   - Terms they always keep untranslated
   - Formatting conventions they always use

3. FORBIDDEN TERMS: Terms the client never uses despite being common alternatives.

4. COMPLIANCE PATTERNS: Regulatory disclaimers or required phrases that appear consistently.

Be precise. Use actual counts. Do NOT create aspirational rules — only reflect what the client actually does.`;
}

const PHASE1_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    tone: {
      type: "object" as const,
      properties: {
        formalityLevel: {
          type: "number" as const,
          description: "1-5 (1=casual, 5=institutional)",
        },
        description: {
          type: "string" as const,
          description: "Short tone description based on observed style",
        },
        avgSentenceLength: {
          type: "number" as const,
          description: "Observed average words per sentence",
        },
        sentenceLengthStddev: {
          type: "number" as const,
          description: "Observed sentence length standard deviation",
        },
        personPreference: {
          type: "string" as const,
          enum: ["first", "second", "third"],
          description: "Dominant person preference observed",
        },
        hedgingFrequency: {
          type: "string" as const,
          enum: ["low", "moderate", "high"],
          description: "Observed hedging frequency",
        },
      },
      required: [
        "formalityLevel",
        "description",
        "avgSentenceLength",
        "sentenceLengthStddev",
        "personPreference",
        "hedgingFrequency",
      ],
    },
    brandRules: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "Brand rules observed consistently (60%+ of samples). Each rule should note the observed frequency.",
    },
    forbiddenTerms: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Terms the client consistently avoids",
    },
    compliancePatterns: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Regulatory disclaimers or required phrases",
    },
  },
  required: ["tone", "brandRules", "forbiddenTerms", "compliancePatterns"],
};

// --- Phase 2: Glossary Extraction (needs pairs) ---

const PHASE2_SYSTEM_PROMPT = `You are a senior localization analyst at WordwideFX. You are analyzing source texts and their professional human translations to build a glossary of term mappings.

Extract ONLY terms where you can see both the source term and its translation. Focus on:
- Financial domain terms (forex, trading, market analysis terminology)
- Client-specific terminology and product names
- Terms that appear in multiple samples with consistent translations

For each term, only include it if the translation is used consistently (not a one-off variant).
Also detect the regional variant from the translation samples.`;

function buildPhase2Prompt(
  req: ExtractionRequest,
  pairsOnly: TextSample[],
): string {
  return `${PHASE2_SYSTEM_PROMPT}

CLIENT: ${req.clientName}
TARGET LANGUAGE: ${req.targetLanguage}
REGIONAL VARIANT: ${req.regionalVariant || "detect from translations"}
TRANSLATION PAIRS: ${pairsOnly.length}

Extract the glossary and detect the regional variant.`;
}

const PHASE2_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    regionalVariant: {
      type: "string" as const,
      description:
        "BCP-47 tag detected from translations (e.g. es-ES, es-MX, en-GB)",
    },
    glossary: {
      type: "object" as const,
      additionalProperties: { type: "string" as const },
      description:
        "Source term -> target translation mapping. Only include terms observed in translations.",
    },
  },
  required: ["regionalVariant", "glossary"],
};

// --- User Message Builders ---

function buildPhase1UserMessage(samples: TextSample[]): string {
  const parts: string[] = [
    "Analyze these CLIENT ORIGINAL documents (source language only):\n",
  ];

  for (const [i, sample] of samples.entries()) {
    parts.push(`--- DOCUMENT ${i + 1} ---`);
    parts.push(sample.source);
    parts.push("");
  }

  parts.push(
    "Extract the client's tone, brand rules, forbidden terms, and compliance patterns. " +
      "Only include rules the client follows consistently.",
  );
  return parts.join("\n");
}

function buildPhase2UserMessage(pairs: TextSample[]): string {
  const parts: string[] = [
    "Analyze these source + translation pairs for glossary extraction:\n",
  ];

  for (const [i, sample] of pairs.entries()) {
    parts.push(`--- PAIR ${i + 1} ---`);
    parts.push(`SOURCE:\n${sample.source}`);
    parts.push(`TRANSLATION:\n${sample.translation}`);
    parts.push("");
  }

  parts.push(
    "Extract the glossary mappings and detect the regional variant. " +
      "Only include terms with consistent translations across samples.",
  );
  return parts.join("\n");
}

// --- Main ---

export async function extractProfile(
  req: ExtractionRequest,
  onEvent?: EventHandler,
): Promise<ExtractionResult> {
  const warnings = buildWarnings(req);
  const confidence = assessConfidence(req.samples.length);

  // Phase 1: Source-only → brand, tone, compliance
  onEvent?.({
    stage: "extraction",
    status: "phase1",
    message: `Phase 1: Analyzing ${req.samples.length} source document(s) for tone and brand rules...`,
    timestamp: new Date().toISOString(),
    data: { sampleCount: req.samples.length, confidence },
  });

  const phase1Config: AgentConfig = {
    name: "ProfileExtractionAgent-Phase1",
    systemPrompt: buildPhase1Prompt(req),
    model: "opus",
    maxTokens: 4096,
  };

  const { result: phase1 } = await runAgentStructured(
    phase1Config,
    buildPhase1UserMessage(req.samples),
    "extract_client_baseline",
    "Extract tone profile, brand rules, forbidden terms, and compliance patterns from client source documents",
    PHASE1_TOOL_SCHEMA,
    (input) => input,
  );

  // Phase 2: Pairs → glossary + regional variant
  const pairs = req.samples.filter((s) => s.translation);
  let glossary: Record<string, string> = {};
  let regionalVariant = req.regionalVariant ?? req.targetLanguage;

  if (pairs.length > 0) {
    onEvent?.({
      stage: "extraction",
      status: "phase2",
      message: `Phase 2: Extracting glossary from ${pairs.length} translation pair(s)...`,
      timestamp: new Date().toISOString(),
    });

    const phase2Config: AgentConfig = {
      name: "ProfileExtractionAgent-Phase2",
      systemPrompt: buildPhase2Prompt(req, pairs),
      model: "opus",
      maxTokens: 4096,
    };

    const { result: phase2 } = await runAgentStructured(
      phase2Config,
      buildPhase2UserMessage(pairs),
      "extract_glossary",
      "Extract glossary term mappings and regional variant from translation pairs",
      PHASE2_TOOL_SCHEMA,
      (input) => input,
    );

    glossary = (phase2.glossary as Record<string, string>) ?? {};
    if (typeof phase2.regionalVariant === "string" && phase2.regionalVariant) {
      regionalVariant = phase2.regionalVariant;
    }
  }

  // Combine into LanguageProfile
  const extractedProfile = LanguageProfileSchema.parse({
    regionalVariant,
    glossary,
    tone: phase1.tone,
    brandRules: phase1.brandRules,
    forbiddenTerms: phase1.forbiddenTerms,
    compliancePatterns: phase1.compliancePatterns,
  });

  onEvent?.({
    stage: "extraction",
    status: "complete",
    message: `Profile extracted: ${Object.keys(glossary).length} glossary terms, ` +
      `formality ${extractedProfile.tone.formalityLevel}/5, ` +
      `${extractedProfile.brandRules.length} brand rules. ` +
      `Confidence: ${confidence}.`,
    timestamp: new Date().toISOString(),
  });

  return {
    clientId: req.clientId,
    clientName: req.clientName,
    sourceLanguage: "en",
    targetLanguage: req.targetLanguage,
    extractedProfile,
    sampleCount: req.samples.length,
    confidence,
    warnings,
  };
}
