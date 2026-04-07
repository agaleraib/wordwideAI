# FinFlow Translation Engine — 13 Evaluation Metrics Reference

**Objective technical reference. All claims are backed by measured data from benchmark runs on IronFX financial documents (AM050115, AM050415, AM050515), April 2026.**

---

## Overview

Each translation is evaluated against 13 metrics organized in 4 categories. 6 metrics are deterministic (code-based, 100% reproducible). 7 metrics are LLM-judged (Claude at temperature=0, near-deterministic).

**Pass condition:** A translation passes when EVERY individual metric meets its threshold AND the weighted aggregate score meets the aggregate threshold (default 88).

---

## Scoring Method Classification

| Method | Metrics | Reproducibility | Cost |
|--------|---------|----------------|------|
| **Deterministic (code)** | glossary_compliance, term_consistency, untranslated_terms, numerical_accuracy, formatting_preservation, paragraph_alignment | 100% identical every run | $0 |
| **LLM-judged (temperature=0)** | formality_level, sentence_length_ratio, passive_voice_ratio, brand_voice_adherence, fluency, meaning_preservation, regional_variant | Near-deterministic (see consistency data below) | ~$0.35/call (Opus) |

### Consistency proof (measured)

Same text scored 5 times with Claude Opus at temperature=0:

| Metric | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Range |
|--------|-------|-------|-------|-------|-------|-------|
| formality_level | 88 | 88 | 88 | 88 | 88 | **0** |
| sentence_length_ratio | 82 | 82 | 82 | 82 | 82 | **0** |
| passive_voice_ratio | 75 | 75 | 75 | 75 | 75 | **0** |
| brand_voice_adherence | 72 | 72 | 72 | 72 | 72 | **0** |
| fluency | 92 | 93 | 92 | 93 | 92 | **1** |
| meaning_preservation | 95 | 95 | 95 | 95 | 95 | **0** |
| regional_variant | 92 | 90 | 93 | 92 | 93 | **3** |

**Result:** 5/7 LLM metrics are perfectly deterministic (range 0). 2 metrics (fluency, regional_variant) vary by 1-3 points. Aggregate variance across 5 runs: 0.2 points.

Additional test: brand_voice_adherence scored 3 times each on two different translations (FinFlow vs Generic LLM). FinFlow: 72, 72, 72. Generic: 78, 78, 78. The 6-point gap is real and reproducible, not variance.

**Conclusion:** At temperature=0, the LLM judge is functionally deterministic. The maximum observed variance (3 points on regional_variant) would only flip a pass/fail verdict if the score sits exactly on the threshold boundary.

---

## Category 1: Terminology Accuracy

### 1. glossary_compliance

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 95 |
| **What it measures** | Percentage of client glossary terms correctly translated |
| **How it works** | For each glossary entry where the English term appears in the source, check if the expected target translation appears (case-insensitive substring match) in the output |
| **Score formula** | `matched / (matched + missed) × 100` |
| **Reproducibility** | 100% — pure string matching |

**Known limitations:**
- Exact substring match. "sobrecompra" does not match "sobrecomprado" (noun vs adjective of the same root). Synonym support is implemented in `checkCompliance()` in `glossary-patcher.ts` but not yet in the deterministic scorer.
- A glossary term translated as a valid synonym scores as a miss. Measured: FinFlow scores 85% on AM050415 with the v2 glossary, but manual review showed 5 of the 7 "missed" terms were valid alternative translations (e.g., "zona de sobrecompra" vs "territorio de sobrecompra").
- Glossary quality directly determines score accuracy. The v1 glossary (extracted from human translations without validation) contained 2 mistranslations and multiple awkward terms. The v2 glossary (frequency + back-translation + domain validation) reduced false failures.

**Measured scores:**
- FinFlow: 85-95 (varies by document and glossary version)
- Generic LLM (no glossary): 52-84
- Human translator: 82-98

### 2. term_consistency

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 90 |
| **What it measures** | Whether the same source term is translated the same way throughout the document |
| **How it works** | Derived from glossary_compliance: if compliance ≥90%, add 5 points (max 100); if <90%, subtract 5 points |
| **Score formula** | `glossary_compliance >= 90 ? min(100, compliance + 5) : max(0, compliance - 5)` |
| **Reproducibility** | 100% — derived from another deterministic metric |

**Known limitation:** This is a proxy metric, not a true consistency check. It does not independently verify that the same term is translated identically across paragraphs. A proper implementation would track each glossary term's translation across all occurrences.

### 3. untranslated_terms

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 95 |
| **What it measures** | English words left untranslated in the target language output |
| **How it works** | Finds English words (4+ characters) that appear in both source and translation. Excludes known keep-in-English terms (currency pairs, indicator abbreviations, proper nouns). Cross-references with glossary to identify terms that should have been translated. |
| **Score formula** | `max(0, 100 - (suspicious_count / translatable_count × 10))` |
| **Reproducibility** | 100% — regex + set operations |

**Known limitation:** The KEEP_ENGLISH set is hardcoded (contains ~30 terms like RSI, MACD, EUR/USD). Client-specific terms that should stay in English (e.g., "QQE", "SAAR") must be in this set or they'll be flagged as untranslated. The glossary's brand rules handle this at the translation level but the scorer doesn't cross-reference brand rules.

---

## Category 2: Style & Voice

### 4. formality_level

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 85 |
| **What it measures** | Whether the translation matches the client's target formality level (1-5 scale) |
| **How it works** | The LLM judge receives the target formality level and description from the client profile, reads the translation, and scores 0-100 based on register match. Deducts for each deviation from target. |
| **Prompt instruction** | "Does the translation match the target formality level? Score 100 if perfect match, deduct for each deviation." |
| **Reproducibility** | 100% (0 variance across 5 runs) |

**Measured scores:**
- FinFlow: 85-88
- Generic LLM: 82-88
- Human translator: 82

**Observation:** The LLM judge evaluates this against the client profile's formality target. A translation at formality 3/5 targeting 3/5 will score higher than one at 4/5 targeting 3/5, even if the 4/5 translation is objectively higher quality. This is by design — the metric measures client fit, not absolute quality.

### 5. sentence_length_ratio

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 80 |
| **What it measures** | Whether sentence lengths match the client's target average |
| **How it works** | The LLM judge counts approximate sentence lengths, computes the average, and compares against the profile target (e.g., 22.5 words ± 11.8 stddev). Scores 100 if within 1 stddev. |
| **Prompt instruction** | "Are sentence lengths consistent with the target average (X words, stddev Y)? Score 100 if within 1 stddev." |
| **Reproducibility** | 100% (0 variance across 5 runs) |

**Limitation:** The LLM estimates sentence length — it does not mechanically count words. This could be made deterministic with a code-based word counter, which would be more accurate. The LLM approach is used because sentence boundaries in Spanish financial text are ambiguous (semicolons, colons, bullet points).

### 6. passive_voice_ratio

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 75 (ES), 80 (default) |
| **What it measures** | Whether passive/active voice balance matches the client's target |
| **How it works** | The LLM judge estimates the percentage of passive constructions and scores based on proximity to the target. Score 100 if within 5% of target. |
| **Prompt instruction** | "Is the passive/active voice balance close to target (X% passive)? Score 100 if within 5%." |
| **Reproducibility** | 100% (0 variance across 5 runs) |

**Language-specific note:** Spanish uses reflexive passive ("se") constructions more than English. The brand profile target of 12% (extracted from English source docs) is inappropriate for Spanish. The ES glossary overrides this to 25%. Measured FinFlow passive voice: 72-78 across 3 docs, suggesting the target may need further adjustment.

### 7. brand_voice_adherence

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 75 (ES), 95 (default) |
| **What it measures** | Whether ALL brand rules from the client profile are followed |
| **How it works** | The LLM judge evaluates each brand rule against the translation. Starts at 100, deducts 20 per violation detected. |
| **Prompt instruction** | "Are ALL brand rules followed? Score 100 if all satisfied, deduct 20 per violation." |
| **Reproducibility** | 100% (0 variance across 3 runs on same text) |

**Critical finding:** Generic LLM (no profile) scored 78 while FinFlow (with profile) scored 72 on AM050515. This is NOT scoring inconsistency — it is reproducible (72, 72, 72 vs 78, 78, 78 across 3 runs each). The cause: the generic LLM naturally preserved English terms in parentheses (e.g., "recorte (haircut)") matching the source document's style, while FinFlow's glossary-driven approach replaced with just the Spanish term. The 20-point per-violation penalty makes this metric sensitive to single formatting choices.

**Known issue:** Brand rules extracted from English source documents may not translate directly to translation rules. Example: "Basis points abbreviated as 'bps'" is true in the English source but the glossary correctly translates bps → pb. The brand rules were reconciled to defer to glossary for term translations, but formatting rules (like parenthetical English terms) are not yet handled.

---

## Category 3: Structural Fidelity

### 8. formatting_preservation

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 90 |
| **What it measures** | Whether structural elements survive translation: headers, bullets, numbered lists, bold text, horizontal rules |
| **How it works** | Counts regex matches for each formatting type in source and translation. Requires ≥80% of source counts per element type. If source has zero formatting elements, returns score 100. |
| **Score formula** | `(preserved_element_types / total_element_types) × 100` or 100 if no formatting in source |
| **Reproducibility** | 100% — regex counting |

**Note:** All test documents are .docx files converted to plain text via mammoth. This conversion strips most formatting. All test docs score 100/100 because the source has no markdown formatting elements. This metric would be meaningful for markdown-native documents.

### 9. numerical_accuracy

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 100 |
| **What it measures** | Whether all numbers, prices, percentages from the source appear in the translation |
| **How it works** | Extracts all numbers via regex from both source and translation. For each source number, checks if it exists in the translation, including locale-swapped separators (1,234.56 ↔ 1.234,56) and stripped thousands separators. |
| **Score formula** | `(preserved_numbers / total_source_numbers) × 100` |
| **Reproducibility** | 100% — regex + set comparison |

**This is FinFlow's strongest differentiator.** Measured scores:
- FinFlow: 100 (3/3 test docs — zero numerical errors)
- Generic LLM: 86-98 (misses 1-7 numbers per doc)
- Human translator: 92-93 (digit transpositions: 0.7740→0.7440, 1224→1124, 58.40→28.40)

**Known limitation:** When a glossary term changes a digit to a word (e.g., "4-hour chart" → "gráfico de cuatro horas"), the scorer flags the missing digit "4" as a numerical error. This is a false positive — the glossary instruction was followed correctly.

### 10. paragraph_alignment

| Property | Value |
|----------|-------|
| **Method** | Deterministic (code) |
| **Default threshold** | 85 |
| **What it measures** | Whether the output has a proportional number of paragraphs to the source |
| **How it works** | Splits both texts on double newlines, counts paragraphs, computes ratio. Ratio 0.8-1.2 scores 100, 0.6-1.4 scores 85, 0.4-1.6 scores 70, below scores 50. |
| **Score formula** | Tiered: ratio 0.8-1.2 → 100, 0.6-1.4 → 85, 0.4-1.6 → 70, else → 50 |
| **Reproducibility** | 100% — paragraph counting |

**Measured scores:**
- FinFlow: 100 (3/3 docs — paragraph structure preserved)
- Generic LLM: 100
- Human translator: 70 (consistently compresses paragraphs, e.g., 31→18 on AM050115)

---

## Category 4: Linguistic Quality

### 11. fluency

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 85 |
| **What it measures** | Whether the translation reads naturally in the target language |
| **How it works** | The LLM judge reads the translation and scores 0-100 based on natural reading flow. Penalizes awkward phrasings, calques from English, and unnatural word order. |
| **Prompt instruction** | "Does the translation read naturally in [language]? No awkward phrasings, no calques from English." |
| **Reproducibility** | Range of 1 point (92-93 across 5 runs) |

**Measured scores:**
- FinFlow: 88-92
- Generic LLM (Opus unconstrained): 90-92
- Generic LLM (ChatGPT 5.4): 93
- Human translator: 75-83

**Key observation:** FinFlow and generic LLM score essentially the same on fluency (88-92 vs 90-92). The 2-4 point gap is within the metric's measurement precision. The human translator scores significantly lower (75-83). This contradicts the assumption that human translation is the fluency gold standard — on these financial documents, both LLMs produce more fluent Spanish than the human translator.

**Why this metric cannot be made fully deterministic:** Fluency is inherently subjective — it requires understanding whether a sentence "sounds natural" to a native speaker. Proxy metrics (perplexity, n-gram frequency) correlate with fluency but don't capture it fully. The LLM judge at temperature=0 is the best available automated proxy, with ±1 point variance.

### 12. meaning_preservation

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 90 |
| **What it measures** | Whether the semantic meaning of every sentence is preserved |
| **How it works** | The LLM judge compares source and translation sentence by sentence, checking for additions, omissions, or distortions of meaning. Penalizes: changed hedging (possibility→certainty), reversed direction (overbought→oversold), omitted qualifiers. |
| **Prompt instruction** | "Is the semantic meaning of every sentence preserved? No additions, omissions, or distortions." |
| **Reproducibility** | 100% (0 variance across 5 runs) |

**Measured scores:**
- FinFlow: 92-95
- Generic LLM: 93
- Human translator: 48-76

**Critical finding:** Human translators score dramatically lower on meaning preservation (48-76) due to:
- Overbought/oversold reversal (AM050115: "overbought" → "sobreventa" = oversold)
- Price level transpositions (0.7740→0.7440, 1224→1124)
- Hedging language changes ("may test resistance" → "will test resistance")

These are not style preferences — they are factual errors in financial analysis that could mislead traders. The scoring correctly identifies them.

### 13. regional_variant

| Property | Value |
|----------|-------|
| **Method** | LLM-judged (temperature=0) |
| **Default threshold** | 90 |
| **What it measures** | Whether the correct regional language variant is used consistently |
| **How it works** | The LLM judge checks vocabulary, grammar markers, and spelling conventions against the target regional variant (e.g., es-ES vs es-MX). For Spanish: vosotros/ustedes, ordenador/computadora, accent conventions. |
| **Prompt instruction** | "Is the correct regional variant used consistently? Check vocabulary, grammar, spelling for [variant]." |
| **Reproducibility** | Range of 3 points (90-93 across 5 runs) — the highest variance of all metrics |

**Measured scores:**
- FinFlow: 88-95
- Generic LLM: 90
- Human translator: 88

**Observation:** This is the least consistent LLM metric (±3 points). The judge sometimes flags borderline cases differently (e.g., a word used in both es-ES and es-MX). For critical applications, this metric could be supplemented with a deterministic checker using a regional vocabulary whitelist.

---

## Aggregate Score Calculation

The aggregate is a weighted average of all 13 metric scores. Weights are configurable per client per language. Default: equal weights (1/13 each).

```
aggregate = Σ (metric_score × weight) / Σ weights
```

IronFX ES custom weights:
| Metric | Weight | Rationale |
|--------|--------|-----------|
| glossary_compliance | 3.0 | Client terminology is the product |
| numerical_accuracy | 3.0 | Financial accuracy is non-negotiable |
| term_consistency | 2.0 | Consistency across document |
| untranslated_terms | 2.0 | Complete translation |
| meaning_preservation | 2.0 | Semantic accuracy |
| brand_voice_adherence | 1.5 | Brand alignment |
| formality_level | 1.0 | Style |
| fluency | 1.0 | Readability |
| regional_variant | 1.0 | Locale correctness |
| formatting_preservation | 1.0 | Structure |
| paragraph_alignment | 1.0 | Structure |
| sentence_length_ratio | 0.5 | Minor style concern |
| passive_voice_ratio | 0.5 | Minor style concern |

**Rationale for weighting:** Glossary compliance and numerical accuracy are deterministic, business-critical, and FinFlow's primary differentiator. Fluency and passive voice are LLM-judged, less critical, and the difference between 82 and 92 is subtle. Weighting reflects business value, not measurement precision.

---

## Cross-Document Consistency (separate tool)

The 13 metrics above score a single document in isolation. They do not measure whether the system produces **identical terminology across multiple translations of the same or different documents**. This is measured by a separate tool: `consistency-test.ts`.

### How it works

The consistency benchmark runs the same document N times (default 5) through both FinFlow and a generic LLM, then compares term-by-term:

1. For each glossary term in the source, check which Spanish translation was used in each run
2. A term is **consistent** if all N runs produce the same translation
3. A term is **drifting** if any run produces a different translation

### What it measures

| Metric | Description |
|--------|-------------|
| **consistency_rate** | Percentage of glossary terms translated the same way across all runs |
| **drifting_terms** | Count and list of terms that changed between runs |
| **variant_count** | For each drifting term, how many different translations were used |

### Why this matters

A generic LLM (no profile) translates from scratch each time. Without a glossary anchor, it may use "tendencia alcista" in one run and "tendencia ascendente" in the next — both valid, but inconsistent. For a client publishing 500 reports/year, this drift means their terminology changes randomly across documents.

FinFlow's glossary reference in the translation prompt should produce the same term choices every time, because the model sees the same glossary and the same source text.

### Expected results (not yet measured)

Based on our scoring consistency data (13 metrics are near-deterministic at temperature=0), FinFlow should show high terminology consistency. The generic LLM's consistency is unknown — this is what the benchmark will measure.

**Status:** Tool built (`packages/api/src/benchmark/consistency-test.ts`), not yet run. Blocked on glossary formatting fix (Blocker A in plan). Will be run on AM050515 with 5 runs each.

### Output

- `{reportId}-consistency.json` — full per-term consistency data
- `{reportId}-consistency.csv` — term, finflow_consistent, generic_consistent, generic_variants (for presentations)
- `{reportId}-finflow-run{N}.txt` / `{reportId}-generic-run{N}.txt` — all translations saved for manual review

### Cost

5 FinFlow runs + 5 Generic runs × ~$0.38 each = ~$3.80 per document.

---

## Long-Term Terminology Drift (not yet built)

A future tool to monitor whether FinFlow's terminology choices change over time as the underlying LLM model is updated. This would:

1. Store a baseline set of translations (per glossary term) from the current model version
2. Periodically re-translate the same documents and compare against baseline
3. Flag any terms where the model's preferred translation has shifted

This is lower priority than cross-document consistency but important for production deployments where model updates (e.g., Claude Opus 4.6 → 4.7) could silently change translation preferences.

**Status:** Not built. Will be considered after the full 30-doc benchmark validates the current pipeline.

---

## What This Scoring System Cannot Measure

1. **Client satisfaction** — Scores measure technical quality, not whether the client is happy with the output.
2. **Cultural appropriateness** — Financial metaphors that work in one culture may not work in another. The judge checks regional variant but not cultural fit.
3. **Translation speed** — Scoring measures quality, not throughput.
4. **Cross-model consistency** — The scoring system does not detect if a model update changes translation preferences. (See Long-Term Terminology Drift above.)
