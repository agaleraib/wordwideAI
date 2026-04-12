# Syntactic Calculus Metric

**Date:** 2026-04-06
**Status:** Pending (design complete, implementation queued)
**Branch:** feat/translation-engine

## Problem

LLM translations exhibit "translationese" — they mirror the source language's syntax instead of using natural target-language constructions. For example, English-to-Spanish translations that rigidly follow English SVO order, omit pro-drop, or calque English relative clause structures instead of using idiomatic Spanish syntax.

This is a well-documented linguistic phenomenon. The syntactic calculus metric detects and penalizes it.

## Definition

A **syntactic calculus** is a set of **valid expressions** (natural target-language patterns) and **rules** (what to check for and penalize). Each target language has its own rule set because syntax differs fundamentally across languages.

## Design

### Metric Properties

| Property | Value |
|---|---|
| Name | `syntactic_calculus` |
| Category | `linguistic` |
| Method | LLM-judged (separate call) |
| Default threshold | 85 |
| Default weight | 1.5 (higher than average — this is a core translation quality signal) |

### Why a Separate LLM Call

The existing LLM judge batch evaluates 6 metrics in one call. Syntactic calculus requires a language-specific rule set (10-20 rules with examples) that would double the prompt size. A separate call:
- Keeps the existing judge stable
- Allows different model/temperature tuning for syntax analysis
- Enables the rule set to grow without affecting other metrics

### Per-Language Rule Sets

Stored as JSON files in `packages/api/src/scoring/syntactic-rules/`:

```
packages/api/src/scoring/syntactic-rules/
  es.json       # Spanish (manually curated reference)
  zh.json       # Chinese (auto-generated)
  ja.json       # Japanese (auto-generated)
  _template.json  # Schema documentation
```

#### Rule Set Schema

```json
{
  "language": "es",
  "languageName": "Spanish",
  "version": 1,
  "generatedBy": "manual | llm",
  "rules": [
    {
      "id": "es-prodrop",
      "name": "Pro-drop usage",
      "description": "Spanish is a pro-drop language. Explicit subject pronouns should only appear for emphasis or disambiguation.",
      "category": "word_order",
      "severity": "high",
      "examples": {
        "translationese": "Él dijo que él cree que el mercado...",
        "natural": "Dijo que cree que el mercado..."
      }
    }
  ]
}
```

Rule fields:
- **id**: Unique identifier (`{lang}-{short-name}`)
- **name**: Human-readable rule name
- **description**: What the rule checks and why
- **category**: One of `word_order`, `morphosyntax`, `clause_structure`, `discourse`, `lexical_syntax`
- **severity**: `high` (20pt penalty), `medium` (10pt penalty), `low` (5pt penalty)
- **examples.translationese**: What a calqued translation looks like
- **examples.natural**: What a natural target-language sentence looks like

### Auto-Generation Flow

When a new language is added, syntactic rules are generated automatically.

#### Primary: CLI Command

```bash
bun run syntactic-rules:generate <lang-code>
# e.g.: bun run syntactic-rules:generate pt
```

This calls Claude with:
1. The Spanish rule set as a reference template
2. The target language code
3. Instructions to produce equivalent rules for the target language's syntax

Output is written to `packages/api/src/scoring/syntactic-rules/{lang}.json` for human review.

#### Fallback: Lazy Generation at Score Time

If `scoreSyntacticCalcuus()` is called for a language with no rule file:
1. Generate rules on-the-fly using the same LLM prompt
2. Cache to disk for future use
3. Log a warning: "Auto-generated syntactic rules for {lang} — review recommended"
4. Score proceeds with the generated rules

### Scoring Integration

New file: `packages/api/src/scoring/syntactic-calculus.ts`

```typescript
export async function scoreSyntacticCalculus(
  source: string,
  translation: string,
  lang: LanguageProfile,
  language: string,
  scoring: ScoringConfig,
  modelTier: ModelTier = "opus",
): Promise<MetricScore>
```

Called by the scoring agent after the existing LLM judge batch. The prompt includes:
- Source text and translation
- The full rule set for the target language
- Instructions to score 0-100 based on rule violations found

### Weighting

The existing `metricWeights` system in `ScoringConfig` already supports per-metric weights. Syntactic calculus gets a default weight of **1.5** (vs 1.0 for most metrics) because:
- It catches a class of errors no other metric targets
- Translationese is the most common LLM translation defect
- It directly impacts perceived translation quality

Clients can override this in their profile.

## Files to Create/Modify

### New Files
- `packages/api/src/scoring/syntactic-rules/es.json` — Spanish rules (reference)
- `packages/api/src/scoring/syntactic-rules/_template.json` — Schema docs
- `packages/api/src/scoring/syntactic-calculus.ts` — Scoring function
- `packages/api/src/scoring/generate-rules.ts` — Auto-generation logic
- `packages/api/scripts/generate-syntactic-rules.ts` — CLI entry point

### Modified Files
- `packages/api/src/profiles/types.ts` — Add `syntactic_calculus` to ALL_METRICS, categories, thresholds
- `packages/api/src/scoring/metrics.ts` — Add to LLM_JUDGE_METRICS
- `packages/api/src/agents/scoring-agent.ts` — Call syntactic calculus after LLM judge
- `packages/api/src/agents/specialists/linguistic.ts` — Add to scope
- `packages/api/src/agents/quality-arbiter.ts` — Update specialist description
- `packages/api/package.json` — Add `syntactic-rules:generate` script

## Spanish Rule Set (Reference)

See `packages/api/src/scoring/syntactic-rules/es.json` — manually curated, serves as the template for auto-generating other languages.
