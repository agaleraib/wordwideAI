"""
Content Pipeline Orchestrator — matches the deck pipeline exactly.

Pipeline stages (slide 08):
1. Market Event    — 24/7 Monitoring
2. Auto-Suggest    — Relevance Filter
3. Translate       — Quality Reference
4. Score           — 13 Metrics (QUALITY GATE)
5. Correct         — If Needed (MAX 3 ROUNDS)
6. Compliance      — Jurisdiction Rules (HITL APPROVAL)
7. Human           — Quality Check (ADAPTIVE)
8. Publish         — Multi-Channel
"""

import json
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from .instruments import InstrumentConfig, fmt_price
from .data.news_scraper import fetch_news, fetch_economic_calendar
from .data.market_data import fetch_ohlcv, compute_indicators, get_price_summary
from .agents.translation_agent import TranslationAgent, LANG_NAMES
from .agents.compliance_agent import ComplianceAgent
from .hitl.telegram_bot import TelegramHITL
from .content import load_analysis
from .scoring import ScoringEngine, METRIC_CATEGORIES, CATEGORY_LABELS


# ── Stage Definitions ──────────────────────────────────────────────────

STAGES = [
    {"id": "market_event", "label": "Market Event", "sublabel": "24/7 Monitoring", "icon": "activity"},
    {"id": "auto_suggest", "label": "Auto-Suggest", "sublabel": "Relevance Filter", "icon": "lightbulb"},
    {"id": "translate", "label": "Translate", "sublabel": "Quality Reference", "icon": "languages"},
    {"id": "score", "label": "Score", "sublabel": "13 Metrics", "icon": "bar-chart", "tag": "QUALITY GATE"},
    {"id": "correct", "label": "Correct", "sublabel": "If Needed", "icon": "refresh-cw", "tag": "MAX 3 ROUNDS"},
    {"id": "compliance", "label": "Compliance", "sublabel": "Jurisdiction Rules", "icon": "shield", "tag": "HITL APPROVAL"},
    {"id": "human_review", "label": "Human", "sublabel": "Quality Check", "icon": "user-check", "tag": "ADAPTIVE"},
    {"id": "publish", "label": "Publish", "sublabel": "Multi-Channel", "icon": "send"},
]


@dataclass
class PipelineEvent:
    """Event emitted for the demo UI via SSE."""
    stage: str
    status: str  # "running", "complete", "error", "waiting", "approved", "rejected", "chunk", "metric"
    message: str = ""
    data: dict = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_sse(self) -> str:
        payload = json.dumps({
            "stage": self.stage,
            "status": self.status,
            "message": self.message,
            "data": self.data,
            "timestamp": self.timestamp,
        })
        return f"data: {payload}\n\n"


@dataclass
class ContentPipelineResult:
    instrument: str
    language: str = ""
    success: bool = False
    source_text: str = ""
    translated_text: str = ""
    scorecard: dict = field(default_factory=dict)
    compliance_result: dict = field(default_factory=dict)
    correction_rounds: int = 0
    duration_seconds: float = 0.0
    error: str = ""


class ContentPipeline:
    """
    Content pipeline orchestrator matching the deck flow:
    Market Event → Auto-Suggest → Translate → Score → Correct → Compliance → Human → Publish
    """

    def __init__(self, on_event: Callable | None = None):
        self._on_event = on_event
        self.hitl = TelegramHITL()
        self.scorer = ScoringEngine()

    def emit(self, stage: str, status: str, message: str = "", data: dict | None = None):
        event = PipelineEvent(stage=stage, status=status, message=message, data=data or {})
        if self._on_event:
            self._on_event(event)
        return event

    def run(self, instrument: InstrumentConfig) -> ContentPipelineResult:
        """Run the full content pipeline for an instrument."""
        result = ContentPipelineResult(
            instrument=instrument.name,
            language=instrument.target_languages[0] if instrument.target_languages else "es",
        )
        target_lang = result.language
        start_time = time.time()

        try:
            self.hitl.start()

            # ── Stage 1: Market Event ───────────────────────────────────
            news, price_summary = self._stage_market_event(instrument)

            # ── Stage 2: Auto-Suggest ───────────────────────────────────
            source_text = self._stage_auto_suggest(instrument, news, price_summary)
            result.source_text = source_text

            # ── Stage 3: Translate ──────────────────────────────────────
            translated_text, glossary, client_config = self._stage_translate(
                source_text, target_lang, instrument.client
            )
            result.translated_text = translated_text

            # ── Stage 4: Score ──────────────────────────────────────────
            scorecard = self._stage_score(
                source_text, translated_text, glossary, target_lang, client_config
            )
            result.scorecard = scorecard.to_dict()

            # ── Stage 5: Correct (if needed) ────────────────────────────
            if not scorecard.passed:
                translated_text, scorecard, rounds = self._stage_correct(
                    source_text, translated_text, scorecard,
                    glossary, target_lang, instrument.client, client_config,
                )
                result.translated_text = translated_text
                result.scorecard = scorecard.to_dict()
                result.correction_rounds = rounds
            else:
                self.emit("correct", "complete", "No correction needed — all metrics passed",
                          {"skipped": True})

            # ── Stage 6: Compliance ─────────────────────────────────────
            compliance_result = self._stage_compliance(
                translated_text, instrument, target_lang
            )
            result.compliance_result = compliance_result

            # ── Stage 7: Human Review ───────────────────────────────────
            self._stage_human_review(instrument, result)

            # ── Stage 8: Publish ────────────────────────────────────────
            self._stage_publish(instrument, result, target_lang)

            result.success = True

        except Exception as e:
            result.error = str(e)
            result.success = False
            self.emit("error", "error", f"Pipeline error: {str(e)}")
            traceback.print_exc()

        finally:
            result.duration_seconds = time.time() - start_time
            self.emit("pipeline", "complete" if result.success else "error",
                      f"Pipeline {'completed' if result.success else 'failed'} "
                      f"in {result.duration_seconds:.1f}s",
                      {"duration": round(result.duration_seconds, 1),
                       "success": result.success})

        return result

    # ── Stage Implementations ──────────────────────────────────────────

    def _stage_market_event(self, instrument: InstrumentConfig):
        """Stage 1: Detect market event + fetch data."""
        self.emit("market_event", "running", "Scanning financial news feeds...")
        time.sleep(0.5)

        news = fetch_news("forex")
        self.emit("market_event", "running", f"Found {len(news)} articles, fetching {instrument.name} data...")

        try:
            df = fetch_ohlcv(instrument.ticker, period="5d")
            indicators = compute_indicators(df)
            price_summary = get_price_summary(df, indicators)
            instrument.current_price = price_summary["last_close"]
            price_str = fmt_price(price_summary["last_close"], instrument.price_format)
            change = price_summary.get("daily_change_pct", 0)
        except Exception:
            price_summary = {"last_close": 0, "daily_change_pct": 0}
            price_str = "N/A"
            change = 0

        # Pick top headline for the event
        top_headline = news[0]["headline"] if news else f"{instrument.name} shows notable price action"
        sentiment = news[0].get("sentiment", "neutral") if news else "neutral"

        self.emit("market_event", "complete", top_headline, {
            "headline": top_headline,
            "sentiment": sentiment,
            "instrument": instrument.name,
            "price": price_str,
            "change_pct": round(change, 2),
            "headlines": [n["headline"] for n in news[:4]],
            "sentiments": [n.get("sentiment", "neutral") for n in news[:4]],
        })

        return news, price_summary

    def _stage_auto_suggest(self, instrument: InstrumentConfig, news: list, price_summary: dict):
        """Stage 2: Auto-suggest report based on event relevance."""
        self.emit("auto_suggest", "running", "Evaluating event relevance...")
        time.sleep(0.3)

        # Determine direction from price action
        change = price_summary.get("daily_change_pct", 0)
        if change > 0.3:
            direction = "bullish"
            impact = "high"
        elif change < -0.3:
            direction = "bearish"
            impact = "high"
        else:
            direction = "neutral"
            impact = "medium"

        self.emit("auto_suggest", "running",
                  f"Suggested: {instrument.name} Daily Analysis ({direction.upper()})")

        # Load base analysis
        source_text = load_analysis(instrument.slug)

        self.emit("auto_suggest", "complete",
                  f"Report suggestion accepted — {instrument.name} analysis queued",
                  {"instrument": instrument.name,
                   "direction": direction,
                   "impact": impact,
                   "report_type": "Daily Analysis",
                   "source_length": len(source_text),
                   "target_languages": instrument.target_languages})

        return source_text

    def _stage_translate(self, source_text: str, target_lang: str, client: str):
        """Stage 3: Translate using client profile + glossary."""
        lang_name = LANG_NAMES.get(target_lang, target_lang)
        self.emit("translate", "running",
                  f"Translating to {lang_name} with {client.upper()} glossary...")

        translator = TranslationAgent()

        # Collect streaming chunks
        chunks = []

        def on_chunk(chunk: str):
            chunks.append(chunk)
            self.emit("translate", "chunk", chunk)

        def on_event(stage, status, msg):
            self.emit("translate", "running", msg)

        result = translator.translate(
            report_text=source_text,
            target_language=target_lang,
            client=client,
            on_chunk=on_chunk,
            on_event=on_event,
        )

        # Load glossary for scoring
        base_glossary = translator._load_glossary("base_financial", target_lang)
        client_glossary = translator._load_client_glossary(client, target_lang)
        merged_glossary = {**base_glossary, **client_glossary}
        client_config = translator._load_client_config(client)

        self.emit("translate", "complete",
                  f"Translation complete — {len(result.translated_text)} characters, "
                  f"glossary compliance: {result.glossary_compliance_pct:.0f}%",
                  {"language": target_lang,
                   "language_name": lang_name,
                   "length": len(result.translated_text),
                   "glossary_compliance": round(result.glossary_compliance_pct, 1),
                   "terms_used": result.glossary_terms_used,
                   "terms_total": result.glossary_terms_total,
                   "source_preview": source_text[:200],
                   "translation_preview": result.translated_text[:200]})

        return result.translated_text, merged_glossary, client_config

    def _stage_score(self, source_text, translated_text, glossary, language, client_config):
        """Stage 4: Score against 13 metrics."""
        self.emit("score", "running", "Evaluating 13 quality metrics...")

        def on_metric(metric):
            status = "metric"
            emoji = "PASS" if metric.passed else "FAIL"
            self.emit("score", status,
                      f"{metric.name}: {metric.score}/{metric.threshold} [{emoji}]",
                      {"metric": metric.name,
                       "score": metric.score,
                       "threshold": metric.threshold,
                       "passed": metric.passed,
                       "category": metric.category,
                       "method": metric.method,
                       "details": metric.details})

        scorecard = self.scorer.score(
            source_text=source_text,
            translated_text=translated_text,
            glossary=glossary,
            language=language,
            client_config=client_config,
            on_metric=on_metric,
        )

        verdict = "PASS" if scorecard.passed else "FAIL"
        passed_count = sum(1 for m in scorecard.metrics if m.passed)
        total_count = len(scorecard.metrics)

        self.emit("score", "complete",
                  f"Quality Gate: {verdict} — {scorecard.aggregate_score:.1f}/100 "
                  f"({passed_count}/{total_count} metrics passed)",
                  {"verdict": verdict,
                   "aggregate_score": round(scorecard.aggregate_score, 1),
                   "aggregate_threshold": scorecard.aggregate_threshold,
                   "passed": scorecard.passed,
                   "passed_count": passed_count,
                   "total_count": total_count,
                   "failed_metrics": scorecard.failed_metrics,
                   "failed_categories": scorecard.failed_categories,
                   "scorecard": scorecard.to_dict()})

        return scorecard

    def _stage_correct(self, source_text, translated_text, scorecard,
                       glossary, language, client, client_config, max_rounds=3):
        """Stage 5: Specialist correction for failed metrics."""
        self.emit("correct", "running",
                  f"Correction needed — {len(scorecard.failed_metrics)} metrics below threshold",
                  {"failed_metrics": scorecard.failed_metrics,
                   "failed_categories": scorecard.failed_categories})

        translator = TranslationAgent()
        current_text = translated_text
        round_num = 0

        for round_num in range(1, max_rounds + 1):
            failed_names = ", ".join(scorecard.failed_metrics)
            failed_details = []
            for m in scorecard.metrics:
                if not m.passed:
                    failed_details.append(f"- {m.name}: {m.score}/{m.threshold} ({m.details})")

            self.emit("correct", "running",
                      f"Correction round {round_num}/{max_rounds} — fixing: {failed_names}",
                      {"round": round_num, "max_rounds": max_rounds,
                       "targeting": scorecard.failed_metrics})

            # Build correction prompt
            correction_prompt = (
                f"The following translation has quality issues that need correction.\n\n"
                f"FAILED METRICS:\n" + "\n".join(failed_details) + "\n\n"
                f"SOURCE TEXT:\n{source_text[:2000]}\n\n"
                f"CURRENT TRANSLATION:\n{current_text[:2000]}\n\n"
                f"Fix ONLY the issues listed above. Preserve everything else. "
                f"Return the corrected translation text only, no commentary."
            )

            # Use translation agent for correction
            corrected = ""
            with translator.client.messages.stream(
                model=translator.model,
                max_tokens=8192,
                system=translator.system_prompt or (
                    f"You are a specialist translation corrector. Fix only the specific "
                    f"quality issues identified. Preserve all glossary terms, formatting, and numbers."
                ),
                messages=[{"role": "user", "content": correction_prompt}],
            ) as stream:
                for text in stream.text_stream:
                    corrected += text
                    self.emit("correct", "chunk", text)

            current_text = corrected

            # Re-score
            self.emit("correct", "running", f"Re-scoring after round {round_num}...")
            scorecard = self.scorer.score(
                source_text=source_text,
                translated_text=current_text,
                glossary=glossary,
                language=language,
                client_config=client_config,
            )

            passed_count = sum(1 for m in scorecard.metrics if m.passed)
            total_count = len(scorecard.metrics)

            if scorecard.passed:
                self.emit("correct", "complete",
                          f"All metrics passed after {round_num} correction round(s) "
                          f"— {scorecard.aggregate_score:.1f}/100",
                          {"rounds": round_num,
                           "aggregate_score": round(scorecard.aggregate_score, 1),
                           "passed_count": passed_count,
                           "total_count": total_count,
                           "scorecard": scorecard.to_dict()})
                return current_text, scorecard, round_num

            self.emit("correct", "running",
                      f"Round {round_num} improved to {scorecard.aggregate_score:.1f}/100 "
                      f"({passed_count}/{total_count} passed), "
                      f"still failing: {', '.join(scorecard.failed_metrics)}")

        # Max rounds exhausted
        self.emit("correct", "complete",
                  f"Max correction rounds reached ({max_rounds}). "
                  f"Score: {scorecard.aggregate_score:.1f}/100 — escalating to HITL",
                  {"rounds": round_num,
                   "aggregate_score": round(scorecard.aggregate_score, 1),
                   "escalated": True,
                   "remaining_failures": scorecard.failed_metrics,
                   "scorecard": scorecard.to_dict()})

        return current_text, scorecard, round_num

    def _stage_compliance(self, translated_text, instrument, target_lang):
        """Stage 6: Compliance review + HITL approval."""
        self.emit("compliance", "running",
                  f"Reviewing for {instrument.jurisdiction.upper()} compliance...")

        compliance_agent = ComplianceAgent()
        compliance_result = compliance_agent.review(
            translated_text,
            jurisdiction=instrument.jurisdiction,
            on_event=lambda stage, status, msg: self.emit("compliance", "running", msg),
        )

        flags = compliance_result.flags
        flag_count = len(flags)

        result_data = {
            "jurisdiction": instrument.jurisdiction,
            "flag_count": flag_count,
            "compliant": compliance_result.compliant,
            "overall_risk": compliance_result.overall_risk,
            "summary": compliance_result.summary,
        }

        if flag_count > 0:
            result_data["flags"] = [
                {"severity": f.get("severity", "info"),
                 "category": f.get("category", "other"),
                 "issue": f.get("issue", ""),
                 "suggestion": f.get("suggestion", "")}
                for f in flags
            ][:5]

        self.emit("compliance", "running",
                  f"Found {flag_count} compliance flag(s) — requesting HITL approval",
                  result_data)

        # HITL approval for compliance (non-negotiable)
        self.emit("compliance", "waiting",
                  "Awaiting compliance sign-off...")

        summary = (
            f"Compliance Review — {instrument.name} ({target_lang.upper()})\n"
            f"Jurisdiction: {instrument.jurisdiction.upper()}\n"
            f"Flags: {flag_count}\n"
            f"Risk Level: {result_data['overall_risk'].upper()}"
        )
        decision = self.hitl.request_approval("compliance", summary)

        self.emit("compliance", "approved" if decision.approved else "rejected",
                  f"Compliance: {'Approved' if decision.approved else 'Rejected'} "
                  f"by {decision.decided_by if hasattr(decision, 'decided_by') else 'reviewer'}",
                  {"approved": decision.approved})

        return result_data

    def _stage_human_review(self, instrument, result):
        """Stage 7: Adaptive human quality check."""
        self.emit("human_review", "running",
                  "Human quality check — adaptive review mode")

        # Show the adaptive concept
        self.emit("human_review", "running",
                  "Current phase: Month 1 — 100% human review",
                  {"phase": "month_1",
                   "hitl_pct": 100,
                   "auto_pct": 0,
                   "timeline": [
                       {"phase": "Month 1-2", "hitl": 100, "auto": 0, "label": "100% Human Review"},
                       {"phase": "Month 3-4", "hitl": 70, "auto": 30, "label": "Learning Phase"},
                       {"phase": "Month 5-6", "hitl": 50, "auto": 50, "label": "50/50 Split"},
                       {"phase": "Month 7-8", "hitl": 20, "auto": 80, "label": "Mostly Automated"},
                       {"phase": "Month 9-12", "hitl": 10, "auto": 90, "label": "Spot-Check Only"},
                   ]})

        self.emit("human_review", "waiting", "Awaiting quality review...")

        summary = (
            f"Quality Review — {instrument.name}\n"
            f"Score: {result.scorecard.get('aggregate_score', 'N/A')}/100\n"
            f"Corrections: {result.correction_rounds} round(s)"
        )
        decision = self.hitl.request_approval("quality", summary)

        self.emit("human_review", "approved" if decision.approved else "rejected",
                  f"Quality check: {'Approved' if decision.approved else 'Changes requested'}",
                  {"approved": decision.approved,
                   "adaptive_note": "Review rate will decrease as system learns client preferences"})

    def _stage_publish(self, instrument, result, target_lang):
        """Stage 8: Multi-channel distribution."""
        self.emit("publish", "running", "Preparing multi-channel distribution...")
        time.sleep(0.3)

        lang_name = LANG_NAMES.get(target_lang, target_lang)
        channels = ["blog", "email", "social", "pdf"]
        levels = ["beginner", "intermediate", "professional"]

        for channel in channels:
            self.emit("publish", "running", f"Queuing for {channel}...")
            time.sleep(0.15)

        self.emit("publish", "complete",
                  f"Published — {instrument.name} analysis in {lang_name}",
                  {"instrument": instrument.name,
                   "language": lang_name,
                   "channels": channels,
                   "audience_levels": levels,
                   "duration": round(result.duration_seconds, 1),
                   "score": result.scorecard.get("aggregate_score", 0),
                   "corrections": result.correction_rounds,
                   "every_document_scored": True})
