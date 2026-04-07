"""
Flask API for the Translation Engine.

Endpoints:
  POST /api/translate      — Translate a document with quality scoring
  POST /api/score          — Score an existing translation
  GET  /api/profiles       — List all client profiles
  GET  /api/profiles/<id>  — Show a client profile
  PUT  /api/profiles/<id>/thresholds — Update scoring thresholds
"""

from __future__ import annotations

import json

from flask import Flask, Response, jsonify, request, stream_with_context

from .engine.translation_engine import TranslationEngine
from .profiles.store import ProfileStore


def create_app(db_path: str | None = None) -> Flask:
    app = Flask(__name__)
    store = ProfileStore(db_path) if db_path else ProfileStore()

    @app.post("/api/translate")
    def translate():
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        document = data.get("document", "")
        client_id = data.get("client_id", "")
        language = data.get("language", "")

        if not all([document, client_id, language]):
            return jsonify({"error": "document, client_id, and language are required"}), 400

        stream = data.get("stream", False)

        if stream:
            return _translate_streaming(document, client_id, language, store)

        engine = TranslationEngine(store=store)
        try:
            result = engine.translate(
                source_text=document,
                client_id=client_id,
                language=language,
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

        return jsonify({
            "translation": result.translated_text,
            "passed": result.passed,
            "revision_count": result.revision_count,
            "escalated_to_hitl": result.escalated_to_hitl,
            "scores": result.scorecard.to_dict(),
            "audit_trail": [a.to_dict() for a in result.audit_trail],
        })

    @app.post("/api/score")
    def score():
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        source = data.get("source", "")
        translation = data.get("translation", "")
        client_id = data.get("client_id", "")
        language = data.get("language", "")

        if not all([source, translation, client_id, language]):
            return jsonify({"error": "source, translation, client_id, and language are required"}), 400

        engine = TranslationEngine(store=store)
        try:
            scorecard = engine.score_only(
                source_text=source,
                translated_text=translation,
                client_id=client_id,
                language=language,
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

        return jsonify({
            "scores": scorecard.to_dict(),
            "passed": scorecard.passed,
        })

    @app.get("/api/profiles")
    def list_profiles():
        profiles = store.list_profiles()
        return jsonify(profiles)

    @app.get("/api/profiles/<client_id>")
    def get_profile(client_id: str):
        profile = store.load(client_id)
        if not profile:
            return jsonify({"error": f"Profile not found: {client_id}"}), 404
        return jsonify(profile.to_dict())

    @app.put("/api/profiles/<client_id>/thresholds")
    def update_thresholds(client_id: str):
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        profile = store.load(client_id)
        if not profile:
            return jsonify({"error": f"Profile not found: {client_id}"}), 404

        language = data.get("language")
        if not language:
            return jsonify({"error": "language is required"}), 400

        lang_profile = profile.get_language(language)

        if "metric_thresholds" in data:
            lang_profile.scoring.metric_thresholds.update(data["metric_thresholds"])
        if "aggregate_threshold" in data:
            lang_profile.scoring.aggregate_threshold = data["aggregate_threshold"]
        if "metric_weights" in data:
            lang_profile.scoring.metric_weights = data["metric_weights"]

        store.save(profile)
        return jsonify(profile.to_dict())

    return app


def _translate_streaming(
    document: str,
    client_id: str,
    language: str,
    store: ProfileStore,
) -> Response:
    """SSE streaming endpoint for real-time translation progress."""

    def generate():
        events: list[dict] = []

        def on_event(stage: str, status: str, message: str) -> None:
            event = {"stage": stage, "status": status, "message": message}
            events.append(event)
            # SSE format
            yield f"data: {json.dumps(event)}\n\n"

        engine = TranslationEngine(store=store, on_event=on_event)
        try:
            result = engine.translate(
                source_text=document,
                client_id=client_id,
                language=language,
            )
            final = {
                "stage": "complete",
                "status": "done",
                "result": result.to_dict(),
                "translation": result.translated_text,
            }
            yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
        except ValueError as e:
            yield f"data: {json.dumps({'stage': 'error', 'message': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
