/**
 * Deterministic metric scorers — ported from finflow/agents/scoring_agent.py.
 *
 * 6 code-based metrics that use regex and string matching.
 * No LLM calls needed.
 */

import type { MetricScore } from "./scorecard.js";
import type { LanguageProfile, ScoringConfig } from "../profiles/types.js";

// --- Glossary Compliance ---

export function scoreGlossaryCompliance(
  source: string,
  translation: string,
  lang: LanguageProfile,
  scoring: ScoringConfig,
): MetricScore {
  const sourceLower = source.toLowerCase();
  const transLower = translation.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const [enTerm, targetTerm] of Object.entries(lang.glossary)) {
    if (enTerm.startsWith("_")) continue;
    if (sourceLower.includes(enTerm.toLowerCase())) {
      if (transLower.includes(targetTerm.toLowerCase())) {
        matched.push(enTerm);
      } else {
        missed.push(enTerm);
      }
    }
  }

  const total = matched.length + missed.length;
  const pct = total > 0 ? (matched.length / total) * 100 : 100;
  const threshold = scoring.metricThresholds["glossary_compliance"] ?? 95;

  return {
    name: "glossary_compliance",
    category: "terminology",
    score: Math.round(pct),
    threshold,
    passed: pct >= threshold,
    details: `${matched.length}/${total} glossary terms correctly used`,
    evidence: missed
      .slice(0, 10)
      .map((t) => `MISSED: '${t}' → expected '${lang.glossary[t]}'`),
  };
}

// --- Term Consistency ---

export function scoreTermConsistency(
  translation: string,
  lang: LanguageProfile,
  scoring: ScoringConfig,
  glossaryScore: MetricScore | undefined,
): MetricScore {
  const baseScore = glossaryScore?.score ?? 100;
  const score =
    baseScore >= 90
      ? Math.min(100, baseScore + 5)
      : Math.max(0, baseScore - 5);
  const threshold = scoring.metricThresholds["term_consistency"] ?? 90;

  return {
    name: "term_consistency",
    category: "terminology",
    score,
    threshold,
    passed: score >= threshold,
    details: `Derived from glossary compliance (${baseScore}%)`,
    evidence: [],
  };
}

// --- Untranslated Terms ---

const KEEP_ENGLISH = new Set([
  "eur/usd", "gbp/usd", "usd/jpy", "aud/usd", "usd/chf", "nzd/usd",
  "rsi", "macd", "ema", "sma", "atr", "adx", "cci",
  "fed", "ecb", "boj", "boe", "rba", "snb",
  "oanda", "alpari", "pip", "stop loss", "take profit",
  "fibonacci", "bollinger", "ichimoku",
]);

export function scoreUntranslatedTerms(
  source: string,
  translation: string,
  lang: LanguageProfile,
  scoring: ScoringConfig,
): MetricScore {
  const sourceWords = new Set(
    source.toLowerCase().match(/\b[a-zA-Z]{4,}\b/g) ?? [],
  );
  const transWords = new Set(
    translation.toLowerCase().match(/\b[a-zA-Z]{4,}\b/g) ?? [],
  );

  const shared = [...sourceWords].filter((w) => transWords.has(w));

  const suspicious: string[] = [];
  for (const word of shared) {
    if (KEEP_ENGLISH.has(word)) continue;

    for (const [enTerm, targetTerm] of Object.entries(lang.glossary)) {
      if (enTerm.startsWith("_")) continue;
      if (
        word.includes(enTerm.toLowerCase()) ||
        enTerm.toLowerCase().includes(word)
      ) {
        if (
          source.toLowerCase().includes(enTerm.toLowerCase()) &&
          !translation.toLowerCase().includes(targetTerm.toLowerCase())
        ) {
          suspicious.push(word);
          break;
        }
      }
    }
  }

  const totalTranslatable = Math.max(
    [...sourceWords].filter((w) => !KEEP_ENGLISH.has(w)).length,
    1,
  );
  const untranslatedPct = (suspicious.length / totalTranslatable) * 100;
  const score = Math.max(0, Math.round(100 - untranslatedPct * 10));
  const threshold = scoring.metricThresholds["untranslated_terms"] ?? 95;

  return {
    name: "untranslated_terms",
    category: "terminology",
    score,
    threshold,
    passed: score >= threshold,
    details: `${suspicious.length} potentially untranslated terms detected`,
    evidence: suspicious
      .slice(0, 10)
      .map((w) => `'${w}' found in both source and translation`),
  };
}

// --- Numerical Accuracy ---

export function scoreNumericalAccuracy(
  source: string,
  translation: string,
  scoring: ScoringConfig,
): MetricScore {
  const numberPattern = /[-]?\d+[.,]?\d*%?/g;
  const sourceNumbers = new Set(source.match(numberPattern) ?? []);
  const transNumbers = new Set(translation.match(numberPattern) ?? []);

  const missing: string[] = [];
  for (const num of sourceNumbers) {
    if (transNumbers.has(num)) continue;

    // Try swapped separators (1,234.56 <-> 1.234,56)
    const swapped = num
      .replace(/,/g, "COMMA")
      .replace(/\./g, ",")
      .replace(/COMMA/g, ".");
    if (transNumbers.has(swapped)) continue;

    // Try without thousands separator
    const stripped = num.replace(/,/g, "");
    if (transNumbers.has(stripped)) continue;

    missing.push(num);
  }

  const total = Math.max(sourceNumbers.size, 1);
  const preserved = total - missing.length;
  const score = Math.round((preserved / total) * 100);
  const threshold = scoring.metricThresholds["numerical_accuracy"] ?? 100;

  return {
    name: "numerical_accuracy",
    category: "structural",
    score,
    threshold,
    passed: score >= threshold,
    details: `${preserved}/${total} numbers preserved correctly`,
    evidence: missing
      .slice(0, 10)
      .map((n) => `MISSING: '${n}' not found in translation`),
  };
}

// --- Formatting Preservation ---

interface FormatCheck {
  pattern: RegExp;
  description: string;
}

const FORMAT_CHECKS: Record<string, FormatCheck> = {
  headers: { pattern: /^#{1,6}\s/gm, description: "markdown headers" },
  bullets: { pattern: /^\s*[-*\u2022]\s/gm, description: "bullet points" },
  numbered: { pattern: /^\s*\d+[.)]\s/gm, description: "numbered lists" },
  bold: { pattern: /\*\*[^*]+\*\*/g, description: "bold text" },
  horizontal_rules: { pattern: /^---+$/gm, description: "horizontal rules" },
};

export function scoreFormattingPreservation(
  source: string,
  translation: string,
  scoring: ScoringConfig,
): MetricScore {
  let preserved = 0;
  let total = 0;
  const issues: string[] = [];

  for (const [, check] of Object.entries(FORMAT_CHECKS)) {
    const sourceCount = (source.match(check.pattern) ?? []).length;
    const transCount = (translation.match(check.pattern) ?? []).length;

    if (sourceCount > 0) {
      total++;
      if (transCount >= sourceCount * 0.8) {
        preserved++;
      } else {
        issues.push(
          `${check.description}: source=${sourceCount}, translation=${transCount}`,
        );
      }
    }
  }

  const score = Math.round((preserved / Math.max(total, 1)) * 100);
  const threshold =
    scoring.metricThresholds["formatting_preservation"] ?? 90;

  return {
    name: "formatting_preservation",
    category: "structural",
    score,
    threshold,
    passed: score >= threshold,
    details: `${preserved}/${total} formatting elements preserved`,
    evidence: issues,
  };
}

// --- Paragraph Alignment ---

export function scoreParagraphAlignment(
  source: string,
  translation: string,
  scoring: ScoringConfig,
): MetricScore {
  const sourceParas = source
    .split("\n\n")
    .filter((p) => p.trim().length > 0);
  const transParas = translation
    .split("\n\n")
    .filter((p) => p.trim().length > 0);

  const sourceCount = Math.max(sourceParas.length, 1);
  const transCount = Math.max(transParas.length, 1);
  const ratio = transCount / sourceCount;

  let score: number;
  if (ratio >= 0.8 && ratio <= 1.2) {
    score = 100;
  } else if (ratio >= 0.6 && ratio <= 1.4) {
    score = 85;
  } else if (ratio >= 0.4 && ratio <= 1.6) {
    score = 70;
  } else {
    score = 50;
  }

  const threshold = scoring.metricThresholds["paragraph_alignment"] ?? 85;

  return {
    name: "paragraph_alignment",
    category: "structural",
    score,
    threshold,
    passed: score >= threshold,
    details: `Source: ${sourceCount} paragraphs, Translation: ${transCount} (ratio: ${ratio.toFixed(2)})`,
    evidence: [],
  };
}
