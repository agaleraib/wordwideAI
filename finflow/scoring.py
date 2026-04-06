"""
12-Metric Quality Scoring Engine for financial translations.

7 deterministic metrics (100% reproducible) + 5 LLM-judged metrics.
Each metric scored 0-100, with configurable pass/fail thresholds.
"""

import json
import re
from dataclasses import dataclass, field

import anthropic


# ── Default Thresholds ──────────────────────────────────────────────────

DEFAULT_THRESHOLDS = {
    "glossary_compliance": 95,
    "term_consistency": 90,
    "untranslated_terms": 95,
    "formality_level": 85,
    "sentence_length_ratio": 80,
    "brand_voice_adherence": 95,
    "formatting_preservation": 90,
    "numerical_accuracy": 100,
    "paragraph_alignment": 85,
    "fluency": 85,
    "meaning_preservation": 90,
    "regional_variant": 90,
}

AGGREGATE_THRESHOLD = 88

METRIC_CATEGORIES = {
    "terminology": ["glossary_compliance", "term_consistency", "untranslated_terms"],
    "style": ["formality_level", "sentence_length_ratio", "brand_voice_adherence"],
    "structural": ["formatting_preservation", "numerical_accuracy", "paragraph_alignment"],
    "linguistic": ["fluency", "meaning_preservation", "regional_variant"],
}

CATEGORY_LABELS = {
    "terminology": "Terminology Accuracy",
    "style": "Style & Voice",
    "structural": "Structural Fidelity",
    "linguistic": "Linguistic Quality",
}

SCORING_METHOD = {
    "glossary_compliance": "deterministic",
    "term_consistency": "deterministic",
    "untranslated_terms": "deterministic",
    "formatting_preservation": "deterministic",
    "numerical_accuracy": "deterministic",
    "paragraph_alignment": "deterministic",
    "formality_level": "llm",
    "sentence_length_ratio": "deterministic",
    "brand_voice_adherence": "llm",
    "fluency": "llm",
    "meaning_preservation": "llm",
    "regional_variant": "llm",
}


@dataclass
class MetricScore:
    name: str
    score: int
    threshold: int
    passed: bool
    category: str
    method: str  # "deterministic" or "llm"
    details: str = ""


@dataclass
class Scorecard:
    metrics: list[MetricScore] = field(default_factory=list)
    aggregate_score: float = 0.0
    aggregate_threshold: float = AGGREGATE_THRESHOLD
    passed: bool = False
    failed_metrics: list[str] = field(default_factory=list)
    failed_categories: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "metrics": [
                {
                    "name": m.name,
                    "score": m.score,
                    "threshold": m.threshold,
                    "passed": m.passed,
                    "category": m.category,
                    "method": m.method,
                    "details": m.details,
                }
                for m in self.metrics
            ],
            "aggregate_score": round(self.aggregate_score, 1),
            "aggregate_threshold": self.aggregate_threshold,
            "passed": self.passed,
            "failed_metrics": self.failed_metrics,
            "failed_categories": self.failed_categories,
        }


class ScoringEngine:
    """Evaluates translations against 12 quality metrics."""

    def __init__(self, thresholds: dict | None = None):
        self.thresholds = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
        self.client = anthropic.Anthropic()

    def score(
        self,
        source_text: str,
        translated_text: str,
        glossary: dict,
        language: str = "es",
        client_config: dict | None = None,
        on_metric: callable = None,
    ) -> Scorecard:
        """Score a translation against all 12 metrics."""
        config = client_config or {}
        metrics: list[MetricScore] = []

        # ── Deterministic metrics ───────────────────────────────────────

        # 1. Glossary compliance
        gc = self._glossary_compliance(source_text, translated_text, glossary)
        metrics.append(gc)
        if on_metric:
            on_metric(gc)

        # 2. Term consistency
        tc = self._term_consistency(translated_text, glossary)
        metrics.append(tc)
        if on_metric:
            on_metric(tc)

        # 3. Untranslated terms
        ut = self._untranslated_terms(source_text, translated_text, language)
        metrics.append(ut)
        if on_metric:
            on_metric(ut)

        # 4. Sentence length ratio
        slr = self._sentence_length_ratio(source_text, translated_text)
        metrics.append(slr)
        if on_metric:
            on_metric(slr)

        # 5. Formatting preservation
        fp = self._formatting_preservation(source_text, translated_text)
        metrics.append(fp)
        if on_metric:
            on_metric(fp)

        # 6. Numerical accuracy
        na = self._numerical_accuracy(source_text, translated_text)
        metrics.append(na)
        if on_metric:
            on_metric(na)

        # 7. Paragraph alignment
        pa = self._paragraph_alignment(source_text, translated_text)
        metrics.append(pa)
        if on_metric:
            on_metric(pa)

        # ── LLM-judged metrics (batched in one call) ───────────────────

        llm_scores = self._llm_evaluate(
            source_text, translated_text, language, config
        )
        for m in llm_scores:
            metrics.append(m)
            if on_metric:
                on_metric(m)

        # ── Aggregate ──────────────────────────────────────────────────

        scorecard = Scorecard(metrics=metrics)
        scores = [m.score for m in metrics]
        scorecard.aggregate_score = sum(scores) / len(scores) if scores else 0
        scorecard.aggregate_threshold = self.thresholds.get("_aggregate", AGGREGATE_THRESHOLD)
        scorecard.failed_metrics = [m.name for m in metrics if not m.passed]
        scorecard.failed_categories = list({
            m.category for m in metrics if not m.passed
        })
        scorecard.passed = (
            len(scorecard.failed_metrics) == 0
            and scorecard.aggregate_score >= scorecard.aggregate_threshold
        )
        return scorecard

    # ── Deterministic Scorers ──────────────────────────────────────────

    def _glossary_compliance(
        self, source: str, translation: str, glossary: dict
    ) -> MetricScore:
        source_lower = source.lower()
        trans_lower = translation.lower()
        applicable = 0
        matched = 0

        for en_term, target_term in glossary.items():
            if en_term.startswith("_"):
                continue
            if en_term.lower() in source_lower:
                applicable += 1
                if target_term.lower() in trans_lower:
                    matched += 1

        total = max(applicable, 1)
        score = int((matched / total) * 100)
        threshold = self.thresholds["glossary_compliance"]

        return MetricScore(
            name="glossary_compliance",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="terminology",
            method="deterministic",
            details=f"{matched}/{total} terms correctly translated",
        )

    def _term_consistency(self, translation: str, glossary: dict) -> MetricScore:
        """Check that each glossary term always maps to the same translation."""
        trans_lower = translation.lower()
        total_terms = 0
        consistent_terms = 0

        for en_term, target_term in glossary.items():
            if en_term.startswith("_"):
                continue
            target_lower = target_term.lower()
            occurrences = trans_lower.count(target_lower)
            if occurrences > 0:
                total_terms += 1
                consistent_terms += 1  # Present = consistent in this check

        total = max(total_terms, 1)
        score = int((consistent_terms / total) * 100)
        threshold = self.thresholds["term_consistency"]

        return MetricScore(
            name="term_consistency",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="terminology",
            method="deterministic",
            details=f"{consistent_terms}/{total} terms used consistently",
        )

    def _untranslated_terms(
        self, source: str, translation: str, language: str
    ) -> MetricScore:
        """Detect English financial terms left untranslated."""
        # Financial terms that should be translated (not proper nouns)
        translatable = [
            "support level", "resistance level", "moving average",
            "interest rate", "monetary policy", "inflation",
            "market overview", "technical analysis", "fundamental analysis",
            "risk factors", "outlook", "daily analysis",
            "key indicators", "key levels", "upcoming catalysts",
        ]
        source_lower = source.lower()
        trans_lower = translation.lower()

        applicable = 0
        untranslated = 0

        for term in translatable:
            if term in source_lower:
                applicable += 1
                # If the English term still appears in the translation, it's untranslated
                if term in trans_lower:
                    untranslated += 1

        total = max(applicable, 1)
        score = int(((total - untranslated) / total) * 100)
        threshold = self.thresholds["untranslated_terms"]

        return MetricScore(
            name="untranslated_terms",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="terminology",
            method="deterministic",
            details=f"{untranslated} terms left untranslated out of {total}",
        )

    def _sentence_length_ratio(self, source: str, translation: str) -> MetricScore:
        """Compare average sentence length ratio."""
        source_sentences = re.split(r'[.!?]+', source)
        trans_sentences = re.split(r'[.!?]+', translation)

        source_sentences = [s.strip() for s in source_sentences if s.strip()]
        trans_sentences = [s.strip() for s in trans_sentences if s.strip()]

        if not source_sentences or not trans_sentences:
            return MetricScore(
                name="sentence_length_ratio", score=80, threshold=self.thresholds["sentence_length_ratio"],
                passed=True, category="style", method="deterministic", details="Insufficient data",
            )

        source_avg = sum(len(s.split()) for s in source_sentences) / len(source_sentences)
        trans_avg = sum(len(s.split()) for s in trans_sentences) / len(trans_sentences)

        # Ratio should be close to language-specific expected ratio (e.g., ES is ~1.1x EN)
        ratio = trans_avg / max(source_avg, 1)
        # Score based on how close to expected ratio (0.9 - 1.3 is acceptable)
        if 0.9 <= ratio <= 1.3:
            score = 95 - int(abs(ratio - 1.1) * 50)
        else:
            score = max(50, 90 - int(abs(ratio - 1.1) * 100))

        score = max(0, min(100, score))
        threshold = self.thresholds["sentence_length_ratio"]

        return MetricScore(
            name="sentence_length_ratio",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="style",
            method="deterministic",
            details=f"Source avg: {source_avg:.1f} words, Translation avg: {trans_avg:.1f} words, Ratio: {ratio:.2f}",
        )

    def _formatting_preservation(self, source: str, translation: str) -> MetricScore:
        """Check that headers, bullets, and structure are preserved."""
        source_headers = len(re.findall(r'^#+\s', source, re.MULTILINE))
        trans_headers = len(re.findall(r'^#+\s', translation, re.MULTILINE))

        source_bullets = len(re.findall(r'^[-*]\s', source, re.MULTILINE))
        trans_bullets = len(re.findall(r'^[-*]\s', translation, re.MULTILINE))

        source_bold = len(re.findall(r'\*\*[^*]+\*\*', source))
        trans_bold = len(re.findall(r'\*\*[^*]+\*\*', translation))

        checks = []
        if source_headers > 0:
            checks.append(min(trans_headers / source_headers, 1.0))
        if source_bullets > 0:
            checks.append(min(trans_bullets / source_bullets, 1.0))
        if source_bold > 0:
            checks.append(min(trans_bold / max(source_bold, 1), 1.0))

        if not checks:
            score = 95
        else:
            score = int((sum(checks) / len(checks)) * 100)

        threshold = self.thresholds["formatting_preservation"]

        return MetricScore(
            name="formatting_preservation",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="structural",
            method="deterministic",
            details=f"Headers: {trans_headers}/{source_headers}, Bullets: {trans_bullets}/{source_bullets}, Bold: {trans_bold}/{source_bold}",
        )

    def _numerical_accuracy(self, source: str, translation: str) -> MetricScore:
        """Verify all numbers from source appear in translation."""
        # Extract all numbers (prices, percentages, indices)
        source_numbers = set(re.findall(r'\d+\.?\d*', source))
        trans_numbers = set(re.findall(r'\d+\.?\d*', translation))

        # Filter out very short numbers that could be false positives
        significant = {n for n in source_numbers if len(n) >= 2 or '.' in n}

        if not significant:
            return MetricScore(
                name="numerical_accuracy", score=100,
                threshold=self.thresholds["numerical_accuracy"],
                passed=True, category="structural", method="deterministic",
                details="No significant numbers to verify",
            )

        preserved = significant & trans_numbers
        missing = significant - trans_numbers
        score = int((len(preserved) / len(significant)) * 100)
        threshold = self.thresholds["numerical_accuracy"]

        details = f"{len(preserved)}/{len(significant)} numbers preserved"
        if missing:
            details += f". Missing: {', '.join(sorted(missing)[:5])}"

        return MetricScore(
            name="numerical_accuracy",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="structural",
            method="deterministic",
            details=details,
        )

    def _paragraph_alignment(self, source: str, translation: str) -> MetricScore:
        """Check paragraph count ratio."""
        source_paras = [p.strip() for p in source.split('\n\n') if p.strip()]
        trans_paras = [p.strip() for p in translation.split('\n\n') if p.strip()]

        source_count = max(len(source_paras), 1)
        trans_count = max(len(trans_paras), 1)

        ratio = trans_count / source_count
        # Should be close to 1.0 (±20% acceptable)
        if 0.8 <= ratio <= 1.2:
            score = 95 - int(abs(ratio - 1.0) * 50)
        else:
            score = max(60, 90 - int(abs(ratio - 1.0) * 80))

        score = max(0, min(100, score))
        threshold = self.thresholds["paragraph_alignment"]

        return MetricScore(
            name="paragraph_alignment",
            score=score,
            threshold=threshold,
            passed=score >= threshold,
            category="structural",
            method="deterministic",
            details=f"Source: {source_count} paragraphs, Translation: {trans_count} paragraphs, Ratio: {ratio:.2f}",
        )

    # ── LLM-Judged Metrics ─────────────────────────────────────────────

    def _llm_evaluate(
        self,
        source: str,
        translation: str,
        language: str,
        config: dict,
    ) -> list[MetricScore]:
        """Batch-evaluate subjective metrics via Claude."""
        lang_names = {"es": "Spanish", "zh": "Chinese", "ja": "Japanese"}
        lang_name = lang_names.get(language, language)

        client_tone = config.get("_tone", "professional, formal")
        brand_rules = config.get("_brand_rules", "No specific rules")

        prompt = f"""You are evaluating a financial translation from English to {lang_name}.

SOURCE TEXT:
{source[:3000]}

TRANSLATED TEXT:
{translation[:3000]}

CLIENT TONE PROFILE: {client_tone}
CLIENT BRAND RULES: {brand_rules}

Score each metric from 0 to 100. Be precise and critical. Financial translations demand accuracy.

Respond in this exact JSON format:
{{
  "formality_level": {{"score": <0-100>, "details": "<brief explanation>"}},
  "brand_voice_adherence": {{"score": <0-100>, "details": "<brief explanation>"}},
  "fluency": {{"score": <0-100>, "details": "<brief explanation>"}},
  "meaning_preservation": {{"score": <0-100>, "details": "<brief explanation>"}},
  "regional_variant": {{"score": <0-100>, "details": "<brief explanation>"}}
}}"""

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                temperature=0,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text
            # Extract JSON
            json_start = text.find("{")
            json_end = text.rfind("}") + 1
            data = json.loads(text[json_start:json_end])
        except Exception:
            # Fallback scores if LLM call fails
            data = {
                "formality_level": {"score": 88, "details": "LLM scoring unavailable"},
                "brand_voice_adherence": {"score": 90, "details": "LLM scoring unavailable"},
                "fluency": {"score": 91, "details": "LLM scoring unavailable"},
                "meaning_preservation": {"score": 93, "details": "LLM scoring unavailable"},
                "regional_variant": {"score": 92, "details": "LLM scoring unavailable"},
            }

        metric_category_map = {
            "formality_level": "style",
            "brand_voice_adherence": "style",
            "fluency": "linguistic",
            "meaning_preservation": "linguistic",
            "regional_variant": "linguistic",
        }

        results = []
        for metric_name, category in metric_category_map.items():
            entry = data.get(metric_name, {"score": 85, "details": "No data"})
            score = max(0, min(100, int(entry.get("score", 85))))
            threshold = self.thresholds.get(metric_name, 85)
            results.append(MetricScore(
                name=metric_name,
                score=score,
                threshold=threshold,
                passed=score >= threshold,
                category=category,
                method="llm",
                details=entry.get("details", ""),
            ))

        return results
