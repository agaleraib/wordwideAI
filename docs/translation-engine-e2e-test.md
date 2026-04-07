# FinFlow Translation Engine -- E2E Test Workflow & Quality Evaluation

**WordwideFX -- Technical Reference -- April 2026**

A complete guide to how every document flows through the FinFlow Translation Engine, and how quality is measured across 13 objective metrics with configurable thresholds.

---

## Contents

1. [E2E Test Workflow](#1-e2e-test-workflow)
2. [Quality Evaluation Parameters](#2-quality-evaluation-parameters)
3. [Scoring System Deep Dive](#3-scoring-system-deep-dive)
4. [Specialist Correction Pipeline](#4-specialist-correction-pipeline)
5. [Client Profile Parameters](#5-client-profile-parameters)
6. [Profile Extraction from Text Samples](#6-profile-extraction-from-text-samples)
7. [Running an E2E Test](#7-running-an-e2e-test)
8. [Example Scorecard](#8-example-scorecard)

---

## 1. E2E Test Workflow

Every document follows a deterministic pipeline. The system either produces a fully-scored, quality-gated translation, or escalates to human review with a complete audit trail explaining exactly where and why quality thresholds were not met.

### Pipeline Steps

1. **Prepare** -- Provide the source document (Document A) and a client identifier. The system accepts plain text or Markdown. For new clients, provide reference translation pairs for profile extraction.

2. **Profile Load / Extract** -- Load the client profile from the store: glossary, tone targets, regional variant, brand rules, compliance patterns, and per-metric scoring thresholds. If no profile exists, extract one from reference pairs.

3. **Translation** -- The Translation Agent (Opus) produces the initial translation with the full client profile injected into its system prompt -- glossary, tone, formality level, regional variant, brand rules, and all constraints.

4. **Scoring** -- The Scoring Agent (Opus) evaluates all 13 metrics. Six are deterministic (code-based checks for glossary, numbers, formatting, etc.). Seven use LLM-as-judge with structured output at temperature=0 for consistency.

5. **Quality Gate** -- Pass condition: every metric meets its individual threshold X_i AND the weighted aggregate score meets the overall threshold Y (default 88). If both conditions hold, the translation is released.

6. **Correction Loop (if failed)** -- The Quality Arbiter (Haiku) reads the scorecard and routes to specialist agents in sequence. Each specialist targets only its failed category and preserves all prior corrections. After specialists run, the Scoring Agent re-evaluates. Maximum 2 correction rounds.

7. **Output** -- The final result includes the translated text, a full scorecard with all 13 metric scores, pass/fail verdict, and the complete audit trail. If thresholds are still not met after 2 rounds, the system escalates to HITL review.

### Complete Pipeline Flow

```
+-------------------------------+     +-----------------------------------+
| STEP 1                        |     | PROFILE                           |
| Source Document + Client ID   |     | Glossary / Tone / Brand / Thresh. |
+---------------+---------------+     +----------------+------------------+
                |                                      |
                v                          (injected)  |
        +-------+--------------------------------------+-------+
        |           TRANSLATION AGENT (Opus)                   |
        |         Full profile context in system prompt         |
        +---------------------------+--------------------------+
                                    |
                                    v
        +---------------------------+--------------------------+
        |            SCORING AGENT (Opus)                      |
        |          13 metrics evaluated (6 det. + 7 LLM)       |
        +---------------------------+--------------------------+
                                    |
                                    v
                            +-------+-------+
                           /  All X_i met    \
                          /   & agg >= Y ?    \
                          \                   /
                           +--+----------+--+
                              |          |
                         YES  |          |  NO
                              v          v
                 +------------+--+    +--+----------------------------+
                 | PASS -- Done  |    | QUALITY ARBITER (Haiku)      |
                 | Output Final  |    | Routes to failed specialists |
                 +---------------+    +--+---------------------------+
                                         |
                                         v
        +----------+    +----------+    +----------+    +----------+
        |Terminol. +--->|Style &   +--->|Structural+--->|Linguistic|
        |Specialist|    |Voice Sp. |    |Specialist|    |Specialist|
        +----------+    +----------+    +----------+    +----------+
             Only failed categories invoked -- corrections compound
                                         |
                                         v
                 +---------------------------+-----------------+
                 |          RE-SCORE (Scoring Agent)           |
                 |        All 13 metrics re-evaluated          |
                 +---------------------------+-----------------+
                                         |
                    +--------------------+--------------------+
                    |                    |                    |
                    v                    v                    v
             +-----------+     +-----------------+   +---------------+
             | Pass? DONE|     |Fail + round < 2?|   |Round 2 exhaust|
             |           |     |  Loop back to   |   |  --> HITL     |
             +-----------+     |  Arbiter        |   +---------------+
                               +-----------------+
```

---

## 2. Quality Evaluation Parameters

The Scoring Agent evaluates every translation against 13 metrics organized into four categories. Each metric is scored 0-100 with a configurable per-client threshold. Six metrics use deterministic code-based checks; seven use LLM-as-judge evaluation.

### Category 1: Terminology Accuracy

*Specialist: Terminology*

| Metric | What It Measures | Method | Threshold | Failure Example |
|--------|-----------------|--------|-----------|-----------------|
| `glossary_compliance` | Percentage of glossary terms correctly translated. For each source term found in the document, checks whether the expected target translation appears in the output. | Deterministic | **95** | Source contains "support level" but output uses "nivel de apoyo" instead of the glossary-mandated "nivel de soporte". |
| `term_consistency` | Whether the same source term is always translated the same way throughout the document. Derived from glossary compliance in MVP; full NLP alignment planned. | Deterministic | **90** | "Resistance level" translated as "nivel de resistencia" in paragraph 1 but "barrera de resistencia" in paragraph 4. |
| `untranslated_terms` | Financial terms left in the source language without justification. Proper nouns, currency pairs (EUR/USD), and indicator abbreviations (RSI, MACD) are excluded. | Deterministic | **95** | English word "bearish" left untranslated in the Spanish output when glossary defines it as "bajista". |

### Category 2: Style & Voice

*Specialist: Style*

| Metric | What It Measures | Method | Threshold | Failure Example |
|--------|-----------------|--------|-----------|-----------------|
| `formality_level` | Register match against the client's target (1=casual to 5=institutional). The LLM classifies the output register and penalizes deviation from the target level. | LLM-as-Judge | **85** | Client targets level 4 (institutional) but output uses colloquial phrasing like "el precio se fue para arriba" instead of "el precio registro un incremento". |
| `sentence_length_ratio` | Average sentence length compared to the client's preferred range. Scored based on distance from the client's mean sentence length. | LLM-as-Judge | **80** | Client average is 22 words/sentence but the translation averages 38 words with long compound sentences. |
| `passive_voice_ratio` | Percentage of passive constructions compared to the client's baseline. Scored on proximity to the target passive voice percentage. | LLM-as-Judge | **80** | Client targets 25% passive voice but translation uses 48% passive constructions, making the text feel overly detached. |
| `brand_voice_adherence` | Compliance with explicit brand rules defined in the client profile. Each rule violation deducts 20 points from the score. | LLM-as-Judge | **95** | Brand rule states "Always write OANDA in uppercase" but output contains "Oanda" or "oanda". |

### Category 3: Structural Fidelity

*Specialist: Structural*

| Metric | What It Measures | Method | Threshold | Failure Example |
|--------|-----------------|--------|-----------|-----------------|
| `formatting_preservation` | Whether structural elements survive translation: headers, bullets, numbered lists, bold text, horizontal rules. Uses 80% tolerance per element type. | Deterministic | **90** | Source has 5 bullet points but translation merges them into 2 paragraphs, losing the list structure. |
| `numerical_accuracy` | All numbers, prices, percentages, and financial figures from the source must appear in the translation. Handles locale-specific formatting (1,234.56 vs 1.234,56). | Deterministic | **100** | Source states "1.0850" as a price level but the translation shows "1.0805" -- a transposition error that could mislead traders. |
| `paragraph_alignment` | Output paragraph count is proportional to source. Ratios of 0.8-1.2 score 100; wider deviations are penalized progressively. | Deterministic | **85** | Source has 12 paragraphs but translation compresses into 6, losing the document's informational structure. |

### Category 4: Linguistic Quality

*Specialist: Linguistic*

| Metric | What It Measures | Method | Threshold | Failure Example |
|--------|-----------------|--------|-----------|-----------------|
| `fluency` | Natural reading flow in the target language. No awkward phrasings, no calques from English, natural flow for a native speaker. LLM-judged on a 0-100 scale. | LLM-as-Judge | **85** | Sentence reads "El par hizo un alto mas arriba" (calque of "the pair made a high above") instead of natural "El par alcanzo un nuevo maximo". |
| `meaning_preservation` | Semantic equivalence between source and translation. No additions, omissions, or distortions of meaning. LLM compares source meaning against output. | LLM-as-Judge | **90** | Source says "the pair may test resistance" (possibility) but translation says "el par probara la resistencia" (certainty), distorting the hedging. |
| `regional_variant` | Correct regional variant used consistently. Checks vocabulary, grammar markers (vosotros/ustedes), spelling conventions for the target variant (es-ES, es-AR, es-MX, etc.). | LLM-as-Judge | **90** | Profile targets es-ES but translation uses Latin American "computadora" instead of Peninsular "ordenador", or mixes "ustedes" with "vosotros". |

---

## 3. Scoring System Deep Dive

Quality is binary: a translation either meets every threshold or it does not. This section details the exact mechanics of how pass/fail is determined and how clients can customize the scoring configuration.

### Per-Metric Thresholds (X_i)

Each metric has its own minimum acceptable score. These are configurable per client and per language. The defaults are tuned for institutional-grade financial translation where terminology accuracy and numerical correctness are paramount.

> **Key principle:** A translation with 12 metrics passing at 100 and 1 metric at 79 (threshold 80) is still a FAIL. Every single threshold must be met. There is no "close enough" in financial translation.

### Aggregate Score Calculation

The aggregate score is a **weighted average** of all 13 metric scores. By default, all metrics carry equal weight (1/13 each). The formula:

```typescript
// From packages/api/src/agents/scoring-agent.ts -- computeAggregate()
let weightedSum = 0;
let totalWeight = 0;

for (const [metricName, metricScore] of Object.entries(card.metrics)) {
  const weight = scoring.getWeight(metricName); // default: 1/13
  weightedSum += metricScore.score * weight;
  totalWeight += weight;
}

const aggregate = weightedSum / totalWeight;
```

### Overall Threshold (Y)

The aggregate score must meet the overall threshold **Y**, which defaults to **88**. This ensures that even when every individual metric passes, the translation must also demonstrate strong quality across the board.

### Pass Condition

```
PASS requires BOTH:
  1. ALL metrics[i].score >= threshold[i]    # every X_i met
  2. aggregate_score >= aggregate_threshold   # Y met (default: 88)

FAIL triggers if EITHER:
  1. ANY metric[i].score < threshold[i]      # any X_i missed
  2. aggregate_score < aggregate_threshold    # Y missed
```

Implemented in `packages/api/src/agents/scoring-agent.ts`:

```typescript
card.passed =
  card.failedMetrics.length === 0 &&
  card.aggregateScore >= scoring.aggregateThreshold;
```

### Weight Customization

Clients can override metric weights to prioritize certain quality dimensions. Weights are normalized to sum to 1.0. If `metric_weights` is empty (the default), all metrics are weighted equally.

```json
// OANDA: prioritize numerical accuracy and glossary
{
  "metric_weights": {
    "numerical_accuracy": 3.0,
    "glossary_compliance": 2.0,
    "meaning_preservation": 2.0,
    "brand_voice_adherence": 1.5
  }
}
```

> **Important:** When custom weights are set, any metric not listed receives a weight of 0.0 and is excluded from the aggregate calculation. It is still evaluated and must still pass its individual threshold. This means a client can exclude a metric from the aggregate while still enforcing its minimum.

Weight resolution from `packages/api/src/models.ts`:

```typescript
getWeight(metric: string): number {
  // Return weight for a metric. If no custom weights, all equal.
  if (!this.metricWeights || Object.keys(this.metricWeights).length === 0) {
    return 1.0 / ALL_METRICS.length;
  }
  const total = Object.values(this.metricWeights).reduce((a, b) => a + b, 0);
  return total > 0 ? (this.metricWeights[metric] ?? 0) / total : 0;
}
```

---

## 4. Specialist Correction Pipeline

When a translation fails the quality gate, the system does not simply re-prompt the same agent. Research shows that LLMs anchor to their own output. Instead, failed metrics are routed to domain-specific specialist agents, each an expert in one quality dimension.

### Quality Arbiter Routing

The Quality Arbiter (Haiku) reads the full scorecard and produces a structured correction plan:

```json
{
  "failed_categories": ["terminology", "style"],
  "correction_sequence": ["terminology", "style"],
  "rationale": "Fix terms first (mechanical), then style (depends on final wording)",
  "conflict_risks": ["Style rewrite may re-introduce non-glossary terms"],
  "escalate_to_hitl": false,
  "escalation_reason": ""
}
```

### Specialist Execution Order

The default execution order is **most mechanical first, most nuanced last**. This ensures that deterministic corrections (glossary, numbers) are locked in before subjective polishing occurs. The Arbiter can reorder if the scorecard suggests a different priority.

```
+---+----------------------------------------------+
| 1 | TERMINOLOGY SPECIALIST (Opus)                 |
|   | Corrects glossary compliance, term            |
|   | consistency, and untranslated terms.           |
|   | Receives full glossary + missed terms.         |
|   | Preserves: style, formatting, numbers,         |
|   |   sentence structure, regional variant.        |
+---+----------------------------------------------+
  |
  v
+---+----------------------------------------------+
| 2 | STYLE & VOICE SPECIALIST (Opus)               |
|   | Rewrites for formality, sentence structure,    |
|   | passive/active voice, brand voice adherence.   |
|   | Receives tone profile and brand rules.         |
|   | Preserves: glossary terms, numbers,            |
|   |   formatting, paragraph structure.             |
+---+----------------------------------------------+
  |
  v
+---+----------------------------------------------+
| 3 | STRUCTURAL SPECIALIST (Opus)                   |
|   | Fixes formatting preservation, numerical       |
|   | accuracy, and paragraph alignment.             |
|   | Preserves: terminology, style, voice,          |
|   |   linguistic quality.                          |
+---+----------------------------------------------+
  |
  v
+---+----------------------------------------------+
| 4 | LINGUISTIC SPECIALIST (Opus)                   |
|   | Polishes fluency, validates meaning            |
|   | preservation, enforces regional variant.        |
|   | The "native speaker" final pass.               |
|   | Preserves: all terminology, style, structural, |
|   |   and brand corrections from prior steps.      |
+---+----------------------------------------------+
```

### Correction Rounds & Escalation

The system allows a maximum of **2 correction rounds** (configurable via `max_revision_attempts`). After each round, the full scorecard is re-evaluated. Escalation to HITL (Human-in-the-Loop) occurs when:

- **No Improvement Detected** -- After a correction round, the Arbiter compares the current scorecard to the previous one. If failing metrics did not improve (or regressed), further specialist passes are unlikely to help.

- **Max Rounds Exhausted** -- After 2 correction rounds, if thresholds still are not met, the system stops. The human reviewer receives the full audit trail: original translation, every specialist correction, reasoning, and all scores.

### Selective Invocation

Only specialists whose categories have failing metrics are invoked. If only terminology fails, only the Terminology Specialist runs. This minimizes unnecessary agent calls and preserves quality in domains that already pass. In the best case (translation passes first try), the pipeline is just 2 agent calls: Translation + Scoring.

> **Agent call counts:** Best case: 2 calls (translate + score). Typical case (1-2 categories fail): 4-5 calls. Worst case (all 4 categories fail): 8 calls per document.

---

## 5. Client Profile Parameters

The client profile is the complete personalization layer. It defines everything the system needs to translate and evaluate a document for a specific client and language pair. Profiles can be created manually via the API or **extracted automatically** from text samples using the Profile Extraction Agent (see [Section 6](#6-profile-extraction-from-text-samples)).

### Tone Profile

| Parameter | Description |
|-----------|-------------|
| `formality_level` | 1-5 (1=casual, 5=institutional) |
| `description` | e.g. "professional, conservative, institutional" |
| `passive_voice_target_pct` | Target % of passive constructions (e.g. 25.0) |
| `avg_sentence_length` | Mean words per sentence (e.g. 22.0) |
| `sentence_length_stddev` | Acceptable variation (e.g. 6.0) |
| `person_preference` | first / second / third person |
| `hedging_frequency` | low / moderate / high |

### Glossary

| Parameter | Description |
|-----------|-------------|
| `format` | Source term -> target translation mapping |
| `enforcement` | Mandatory -- scored by `glossary_compliance` |
| `example` | "support level" -> "nivel de soporte" |
| `meta fields` | Keys starting with `_` are skipped during scoring |

### Regional Variant

| Parameter | Description |
|-----------|-------------|
| `format` | BCP-47 tag (e.g. es-ES, es-AR, es-MX, en-GB) |
| `effect` | Controls vocabulary, grammar, spelling conventions |
| `scoring` | Checked by `regional_variant` metric (LLM-judged) |

### Brand Rules

| Parameter | Description |
|-----------|-------------|
| `format` | List of explicit mandates (string[]) |
| `example` | "Always write OANDA in uppercase" |
| `penalty` | -20 points per violation in `brand_voice_adherence` |

### Forbidden Terms

| Parameter | Description |
|-----------|-------------|
| `format` | List of terms that must never appear in output |
| `enforcement` | Checked during translation and scoring |

### Scoring Configuration

| Parameter | Description |
|-----------|-------------|
| `metric_thresholds` | Per-metric minimum scores (Record<string, number>) |
| `aggregate_threshold` | Overall minimum (default: 88) |
| `metric_weights` | Custom weights (empty = equal weighting) |
| `max_revision_attempts` | Correction rounds before HITL (default: 2) |

### Full Profile JSON Structure

```json
{
  "client_id": "oanda",
  "client_name": "OANDA",
  "source_language": "en",
  "languages": {
    "es": {
      "regional_variant": "es-ES",
      "glossary": {
        "support level": "nivel de soporte",
        "resistance level": "nivel de resistencia"
      },
      "tone": {
        "formality_level": 4,
        "description": "professional, conservative, institutional",
        "passive_voice_target_pct": 25,
        "avg_sentence_length": 22,
        "sentence_length_stddev": 6,
        "person_preference": "third",
        "hedging_frequency": "moderate"
      },
      "brand_rules": [
        "Always write OANDA in uppercase",
        "Refer to platform as plataforma de trading de OANDA"
      ],
      "forbidden_terms": [],
      "compliance_patterns": [],
      "scoring": {
        "metric_thresholds": { "glossary_compliance": 95, "..." : "..." },
        "aggregate_threshold": 88,
        "metric_weights": {},
        "max_revision_attempts": 2
      }
    }
  }
}
```

### Default Metric Thresholds

All 13 defaults from `packages/api/src/models.ts`:

```typescript
const DEFAULT_METRIC_THRESHOLDS = {
  // Category 1: Terminology Accuracy
  glossary_compliance: 95,
  term_consistency: 90,
  untranslated_terms: 95,
  // Category 2: Style & Voice
  formality_level: 85,
  sentence_length_ratio: 80,
  passive_voice_ratio: 80,
  brand_voice_adherence: 95,
  // Category 3: Structural Fidelity
  formatting_preservation: 90,
  numerical_accuracy: 100,
  paragraph_alignment: 85,
  // Category 4: Linguistic Quality
  fluency: 85,
  meaning_preservation: 90,
  regional_variant: 90,
} as const;

const DEFAULT_AGGREGATE_THRESHOLD = 88;
const DEFAULT_MAX_REVISION_ATTEMPTS = 2;
```

### Metric-to-Category Mapping

```typescript
const METRIC_CATEGORIES = {
  terminology: ["glossary_compliance", "term_consistency", "untranslated_terms"],
  style:       ["formality_level", "sentence_length_ratio", "passive_voice_ratio",
                "brand_voice_adherence"],
  structural:  ["formatting_preservation", "numerical_accuracy", "paragraph_alignment"],
  linguistic:  ["fluency", "meaning_preservation", "regional_variant"],
} as const;
```

---

## 6. Profile Extraction from Text Samples

Instead of building client profiles manually, the Profile Extraction Agent can analyze source texts (and optionally their human translations) to automatically infer all profile parameters: glossary, tone, brand rules, regional variant, forbidden terms, and compliance patterns.

### How It Works

The extraction agent (Opus) receives the text samples and uses structured output (tool_use) to return a complete `LanguageProfile`. The agent analyzes:

1. **Glossary** -- Identifies recurring financial terms and proposes translations. With source+translation pairs, it extracts exact mappings. With source-only, it infers translations based on observed style.
2. **Tone** -- Measures formality level, sentence length (mean + stddev), passive voice ratio, person preference, and hedging frequency from actual text statistics.
3. **Brand Rules** -- Detects capitalization patterns, untranslated brand names, consistent phrasings, and formatting conventions.
4. **Regional Variant** -- If not specified, detects from vocabulary and grammar markers (e.g. vosotros/ustedes, ordenador/computadora).
5. **Forbidden Terms / Compliance** -- Identifies terms that are consistently avoided and any regulatory disclaimers that appear across samples.

### Recommended Sample Sizes

The quality of extraction depends directly on how many text samples are provided:

| Samples | Confidence | What You Get |
|---------|-----------|--------------|
| 1-4 | **Low** | Basic terminology + rough tone direction. Useful for a quick start, but glossary will have gaps and statistical measures (sentence length, passive %) will have high variance. |
| 5-9 | **Medium** | Reliable glossary for common terms + stable tone statistics. Production-usable with manual review. |
| 10-15 | **Medium-High** | Solid sentence length and passive voice stats. Brand rules well-captured. Glossary covers most domain terms. |
| 15-20+ | **High** | Full style fingerprint with high-confidence glossary coverage. Statistical measures converge. Diminishing returns beyond 20. |

> **Best practice:** Provide **source + human translation pairs** rather than source-only text. Translation pairs give the agent actual glossary mappings instead of inferences, dramatically improving accuracy. Even 5 paired samples outperform 15 source-only samples for glossary extraction.

### API Endpoint

```
POST /profiles/extract
```

**Request body:**

```json
{
  "clientId": "ironfx",
  "clientName": "IronFX",
  "targetLanguage": "es",
  "regionalVariant": "es-ES",
  "samples": [
    {
      "source": "IronFX Viewpoint by Marshall Gittler...",
      "translation": "IronFX Viewpoint por Marshall Gittler..."
    },
    {
      "source": "EUR/USD tested resistance at 1.0850..."
    }
  ],
  "autoSave": false
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `clientId` | Yes | Client identifier |
| `clientName` | Yes | Display name |
| `targetLanguage` | Yes | BCP-47 language code (e.g. `es`, `zh`, `pt`) |
| `regionalVariant` | No | BCP-47 regional tag (e.g. `es-ES`). Auto-detected if omitted. |
| `samples` | Yes | Array of `{ source, translation? }` objects. Min 1, recommended 10+. |
| `autoSave` | No | If `true`, saves the extracted profile to the store. Default `false`. |

**Response:**

```json
{
  "clientId": "ironfx",
  "clientName": "IronFX",
  "targetLanguage": "es",
  "sampleCount": 2,
  "confidence": "low",
  "warnings": [
    "Only 2 sample(s) provided. Minimum 5 recommended for reliable extraction.",
    "Only 1/2 samples have translations. Missing pairs reduce glossary accuracy."
  ],
  "extractedProfile": {
    "regionalVariant": "es-ES",
    "glossary": {
      "foreign exchange market": "mercado de divisas",
      "commodities": "materias primas",
      "trading decisions": "decisiones de trading",
      "...": "..."
    },
    "tone": {
      "formalityLevel": 4,
      "description": "professional, institutional, financial broadcast tone",
      "passiveVoiceTargetPct": 20,
      "avgSentenceLength": 24,
      "sentenceLengthStddev": 7,
      "personPreference": "third",
      "hedgingFrequency": "moderate"
    },
    "brandRules": [
      "IronFX is always written as a single word with capital I and F",
      "Keep program name IronFX Viewpoint untranslated"
    ],
    "forbiddenTerms": [],
    "compliancePatterns": [],
    "scoring": { "..." : "default thresholds applied" }
  },
  "saved": false
}
```

> **Note:** The extraction agent does not override scoring thresholds -- these use the system defaults. Adjust thresholds manually after extraction if needed by updating the profile via `POST /profiles`.

### Workflow: Extract then Translate

A typical new-client onboarding flow:

```
1. Gather 10-15 text samples (source + human translations)
       |
       v
2. POST /profiles/extract  (autoSave: true)
       |
       v
3. GET /profiles/:id  — review extracted profile
       |
       v
4. POST /profiles  — adjust glossary, thresholds, brand rules if needed
       |
       v
5. POST /translate  — run translation pipeline with the profile
```

---

## 7. Running an E2E Test

The engine is accessible via the Hono API running on Bun. Start the dev server with `cd packages/api && bun run dev`. The pipeline is the same: translate, score, quality gate, specialist correction, and audit trail.

### Starting the Server

```bash
cd packages/api && bun run dev
```

### API Commands (curl)

**Check available client profiles:**

```bash
curl http://localhost:3000/profiles
```

**Translate with full scoring pipeline:**

```bash
curl -X POST http://localhost:3000/translate \
  -H "Content-Type: application/json" \
  -d '{
    "sourceText": "EUR/USD Daily Analysis: The pair tested resistance at 1.0850...",
    "clientId": "oanda",
    "language": "es"
  }'
```

**Translate with real-time SSE streaming:**

```bash
curl -N -X POST http://localhost:3000/translate/stream \
  -H "Content-Type: application/json" \
  -d '{
    "sourceText": "EUR/USD Daily Analysis: The pair tested resistance at 1.0850...",
    "clientId": "oanda",
    "language": "es"
  }'
```

**View profile details:**

```bash
curl http://localhost:3000/profiles/oanda
```

**Create or update a client profile:**

```bash
curl -X POST http://localhost:3000/profiles \
  -H "Content-Type: application/json" \
  -d '{ "client_id": "oanda", "client_name": "OANDA", ... }'
```

**Delete a profile:**

```bash
curl -X DELETE http://localhost:3000/profiles/oanda
```

**Extract profile from text samples:**

```bash
curl -X POST http://localhost:3000/profiles/extract \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "oanda",
    "clientName": "OANDA",
    "targetLanguage": "es",
    "regionalVariant": "es-ES",
    "samples": [
      { "source": "EUR/USD tested resistance at 1.0850...", "translation": "EUR/USD probó la resistencia en 1.0850..." },
      { "source": "The pair may consolidate near support...", "translation": "El par podría consolidarse cerca del soporte..." }
    ],
    "autoSave": true
  }'
```

**Health check:**

```bash
curl http://localhost:3000/health
```

### Hono API Endpoints

| Method | Endpoint | Description | Key Parameters |
|--------|----------|-------------|----------------|
| POST | `/translate` | Full pipeline: translate + score + correction loop. Returns full result with scorecard. | `sourceText`, `clientId`, `language` |
| POST | `/translate/stream` | Same pipeline, returns SSE events for real-time pipeline progress. | `sourceText`, `clientId`, `language` |
| GET | `/profiles` | List all client profiles. | -- |
| POST | `/profiles` | Create or update a client profile (Zod-validated body). | ClientProfile JSON |
| POST | `/profiles/extract` | Extract profile parameters from text samples using the Profile Extraction Agent. | `clientId`, `clientName`, `targetLanguage`, `samples[]`, `autoSave?` |
| GET | `/profiles/:id` | Get full profile for a specific client. | `id` (path) |
| DELETE | `/profiles/:id` | Delete a client profile. | `id` (path) |
| GET | `/health` | Health check. | -- |

### API Response Example

```json
// POST /translate Response
{
  "client_id": "oanda",
  "language": "es",
  "passed": true,
  "revision_count": 1,
  "escalated_to_hitl": false,
  "aggregate_score": 93.4,
  "scores": {
    "metrics": { /* all 13 metrics with score, threshold, passed, evidence */ },
    "aggregate_score": 93.4,
    "aggregate_threshold": 88,
    "passed": true,
    "failed_metrics": [],
    "failed_categories": []
  },
  "audit_trail": [ /* timestamped entries for every agent invocation */ ]
}
```

---

## 8. Example Scorecard

A worked example: OANDA EUR/USD Daily Analysis translated from English to Spanish (es-ES). The initial translation fails on two metrics, triggering the correction pipeline.

### Initial Score -- Round 0

**OANDA EUR/USD Analysis -- EN to ES (es-ES) | Round 0 -- Initial Translation**

```
TERMINOLOGY ACCURACY
  glossary_compliance      97 / 95   PASS  [=============================|===]
  term_consistency         92 / 90   PASS  [===========================|=====]
  untranslated_terms       98 / 95   PASS  [==============================|==]

STYLE & VOICE
  formality_level          88 / 85   PASS  [==========================|======]
  sentence_length_ratio    82 / 80   PASS  [========================|========]
  passive_voice_ratio      78 / 80   FAIL  [=======================|=========]  <--
  brand_voice_adherence   100 / 95   PASS  [================================|]

STRUCTURAL FIDELITY
  formatting_preservation  95 / 90   PASS  [============================|====]
  numerical_accuracy       93 /100   FAIL  [=============================|   ]  <--
  paragraph_alignment      90 / 85   PASS  [===========================|=====]

LINGUISTIC QUALITY
  fluency                  91 / 85   PASS  [===========================|=====]
  meaning_preservation     93 / 90   PASS  [============================|====]
  regional_variant         95 / 90   PASS  [============================|====]

AGGREGATE: 92.2 / 88
VERDICT:   FAIL -- 2 metrics below threshold:
           passive_voice_ratio (78 < 80), numerical_accuracy (93 < 100)
           Routing to specialist correction.
```

### Arbiter Routing Decision

The Quality Arbiter analyzes the scorecard and produces a correction plan. Two categories have failures: **Style** (passive_voice_ratio) and **Structural** (numerical_accuracy).

```json
{
  "failed_categories": ["structural", "style"],
  "correction_sequence": ["structural", "style"],
  "rationale": "Fix numerical accuracy first (mechanical/deterministic), then
    adjust passive voice ratio (subjective, won't affect numbers)",
  "conflict_risks": ["Low risk: style changes are unlikely to affect numerical values"],
  "escalate_to_hitl": false
}
```

The Structural Specialist identifies the missing number (a price level "1.0780" was omitted during translation) and restores it. The Style Specialist rewrites 3 sentences from passive to active voice, bringing the passive ratio from 38% down to 26% (target: 25%).

### Re-Score -- Round 1

**OANDA EUR/USD Analysis -- After Specialist Correction | Round 1 -- Post-Correction**

```
TERMINOLOGY ACCURACY
  glossary_compliance      97 / 95   PASS
  term_consistency         92 / 90   PASS
  untranslated_terms       98 / 95   PASS

STYLE & VOICE
  formality_level          88 / 85   PASS
  sentence_length_ratio    84 / 80   PASS
  passive_voice_ratio      87 / 80   PASS  (was 78 -> now 87)
  brand_voice_adherence   100 / 95   PASS

STRUCTURAL FIDELITY
  formatting_preservation  95 / 90   PASS
  numerical_accuracy      100 /100   PASS  (was 93 -> now 100)
  paragraph_alignment      90 / 85   PASS

LINGUISTIC QUALITY
  fluency                  92 / 85   PASS
  meaning_preservation     93 / 90   PASS
  regional_variant         95 / 90   PASS

AGGREGATE: 93.4 / 88
VERDICT:   PASS -- All 13 metrics meet their individual thresholds.
           Aggregate 93.4 exceeds threshold of 88.
           Translation released after 1 correction round.
```

### Audit Trail Summary

Every E2E test produces a timestamped audit trail recording each agent invocation, input/output hashes, reasoning, and scores. This trail is included with HITL escalations and stored for compliance review.

```
[2026-04-02T14:00:01Z]  translation   TranslationAgent (Opus)
  Input hash: a3f8c21b  Output hash: 7e2d4f91
  Glossary compliance: 97.0%

[2026-04-02T14:00:12Z]  scoring       ScoringAgent (Opus)
  Aggregate: 92.2/88  Failed: [passive_voice_ratio, numerical_accuracy]

[2026-04-02T14:00:13Z]  arbiter       QualityArbiter (Haiku)
  Plan: structural -> style  Conflicts: Low risk

[2026-04-02T14:00:18Z]  structural    StructuralSpecialist (Opus)
  Restored missing price level 1.0780 in paragraph 3

[2026-04-02T14:00:25Z]  style         StyleSpecialist (Opus)
  Converted 3 passive constructions to active voice

[2026-04-02T14:00:36Z]  scoring       ScoringAgent (Opus)
  Round 1 re-score. Aggregate: 93.4/88  Failed: []

[2026-04-02T14:00:36Z]  gate          PASSED after 1 correction round
```

---

*FinFlow Translation Engine -- WordwideFX -- Objective Quality Scoring for Financial Translation -- April 2026*
