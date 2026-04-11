/**
 * Risk classification for tag prompt descriptions.
 *
 * Implements the lightweight static keyword scan that backs the playground's
 * per-tag ⚠️ caution badge. The full governing-rule rationale lives at the
 * top of `tags.ts` — the short version is: tags must license emphasis and
 * ordering, NEVER counter-claims. A "caution" classification means the tag
 * description contains language that has historically been correlated with
 * fabrication_risk verdicts under the two-axis judge.
 *
 * This is intentionally a coarse static scan, not an LLM call — the
 * playground reads it on every request, and the categorisation is meant to
 * be a quick advisory rather than a verdict.
 *
 * Spec: docs/specs/2026-04-08-uniqueness-poc-playground.md §5 / §C.1.
 */

const CAUTION_KEYWORDS: ReadonlyArray<string> = [
  "challenge the consensus",
  "the consensus is",
  "underpricing",
  "be willing to be wrong",
  "what if the data is misleading",
  "misleading",
  "take the unfashionable side",
  "challenge",
  "not fundamentals",
];

export type TagRisk = "safe" | "caution";

export function classifyTagRisk(description: string): TagRisk {
  const lower = description.toLowerCase();
  return CAUTION_KEYWORDS.some((kw) => lower.includes(kw)) ? "caution" : "safe";
}
