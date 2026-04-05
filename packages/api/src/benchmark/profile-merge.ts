/**
 * Profile merge — assembles a ClientProfile from brand + glossary files.
 *
 * Brand file (language-agnostic): tone, brandRules, forbiddenTerms, compliancePatterns
 * Glossary file (per-language): glossary, regionalVariant, scoring
 */

import { ClientProfileSchema } from "../profiles/types.js";
import type { ClientProfile } from "../profiles/types.js";

interface BrandFile {
  clientId: string;
  clientName: string;
  sourceLanguage: string;
  tone: Record<string, unknown>;
  brandRules: string[];
  forbiddenTerms: string[];
  compliancePatterns: string[];
}

interface GlossaryFile {
  language: string;
  regionalVariant: string;
  glossary: Record<string, string>;
  glossarySynonyms?: Record<string, string[]>;
  scoring: Record<string, unknown>;
  /** Optional per-language tone overrides (e.g. passiveVoiceTargetPct for Spanish) */
  toneOverrides?: Record<string, unknown>;
}

export interface MergedProfile {
  profile: ClientProfile;
  synonyms: Record<string, string[]>;
}

export async function mergeProfile(
  brandPath: string,
  glossaryPath: string,
): Promise<ClientProfile>;
export async function mergeProfile(
  brandPath: string,
  glossaryPath: string,
  opts: { withSynonyms: true },
): Promise<MergedProfile>;
export async function mergeProfile(
  brandPath: string,
  glossaryPath: string,
  opts?: { withSynonyms?: boolean },
): Promise<ClientProfile | MergedProfile> {
  const brand: BrandFile = await Bun.file(brandPath).json();
  const glossary: GlossaryFile = await Bun.file(glossaryPath).json();

  // Merge tone: start with brand baseline, apply per-language overrides
  const mergedTone = { ...brand.tone };
  if (glossary.toneOverrides) {
    for (const [key, value] of Object.entries(glossary.toneOverrides)) {
      mergedTone[key] = value;
    }
  }

  const profile = ClientProfileSchema.parse({
    clientId: brand.clientId,
    clientName: brand.clientName,
    sourceLanguage: brand.sourceLanguage,
    languages: {
      [glossary.language]: {
        regionalVariant: glossary.regionalVariant,
        glossary: glossary.glossary,
        tone: mergedTone,
        brandRules: brand.brandRules,
        forbiddenTerms: brand.forbiddenTerms,
        compliancePatterns: brand.compliancePatterns,
        scoring: glossary.scoring,
      },
    },
  });

  if (opts?.withSynonyms) {
    return { profile, synonyms: glossary.glossarySynonyms ?? {} };
  }
  return profile;
}
