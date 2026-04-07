#!/usr/bin/env python3
"""
FinFlow Demo Server — Flask app with SSE for live pipeline visualization.
"""

import json
import os
import queue
import sys
import threading
import time
from datetime import datetime

from flask import Flask, Response, jsonify, request, send_from_directory

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from finflow.instruments import get_instrument, INSTRUMENTS
from finflow.pipeline import FinFlowPipeline, PipelineEvent
from finflow.content_pipeline import ContentPipeline, PipelineEvent as ContentEvent, STAGES as CONTENT_STAGES
from finflow.data.market_data import fetch_ohlcv, compute_indicators, get_price_summary

app = Flask(__name__,
            static_folder=os.path.dirname(os.path.abspath(__file__)),
            static_url_path="/static")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def format_price(price, fmt):
    """Format price handling comma thousands separator."""
    if "%," in fmt:
        return f"${price:,.2f}"
    return fmt % price

# SSE event queues per client
_event_queues: dict[str, queue.Queue] = {}


@app.route("/")
def index():
    return send_from_directory(os.path.dirname(__file__), "demo_hub.html")


@app.route("/api/instruments")
def api_instruments():
    """Return instrument list with live prices."""
    instruments = []
    for slug, inst in INSTRUMENTS.items():
        try:
            df = fetch_ohlcv(inst.ticker, period="5d")
            last = float(df["Close"].iloc[-1])
            prev = float(df["Close"].iloc[-2])
            change = ((last - prev) / prev) * 100
        except Exception:
            last = 0
            change = 0

        instruments.append({
            "slug": slug,
            "name": inst.name,
            "asset_class": inst.asset_class,
            "price": last,
            "price_formatted": format_price(last, inst.price_format) if last else "N/A",
            "change_pct": round(change, 2),
            "support": inst.support,
            "resistance": inst.resistance,
            "languages": inst.target_languages,
        })

    return jsonify(instruments)


@app.route("/api/pipeline/run/<slug>")
def api_pipeline_run(slug):
    """SSE endpoint — triggers pipeline and streams events."""
    try:
        instrument = get_instrument(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404

    client_id = f"{slug}_{int(time.time())}"
    q = queue.Queue()
    _event_queues[client_id] = q

    def on_event(event: PipelineEvent):
        q.put(event.to_sse())

    def run_pipeline():
        try:
            pipeline = FinFlowPipeline(on_event=on_event)
            pipeline.run(instrument)
        except Exception as e:
            q.put(f"data: {json.dumps({'stage': 'error', 'status': 'error', 'message': str(e)})}\n\n")
        finally:
            q.put("data: {\"stage\": \"done\", \"status\": \"done\"}\n\n")
            q.put(None)  # Signal end

    thread = threading.Thread(target=run_pipeline, daemon=True)
    thread.start()

    def event_stream():
        while True:
            data = q.get()
            if data is None:
                break
            yield data
        _event_queues.pop(client_id, None)

    return Response(event_stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/content-pipeline/stages")
def api_content_pipeline_stages():
    """Return stage metadata for the content pipeline UI."""
    return jsonify(CONTENT_STAGES)


@app.route("/api/content-pipeline/run/<slug>")
def api_content_pipeline_run(slug):
    """SSE endpoint — triggers content pipeline and streams events."""
    try:
        instrument = get_instrument(slug)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404

    client_id = f"content_{slug}_{int(time.time())}"
    q = queue.Queue()
    _event_queues[client_id] = q

    def on_event(event: ContentEvent):
        q.put(event.to_sse())

    def run_pipeline():
        try:
            pipeline = ContentPipeline(on_event=on_event)
            pipeline.run(instrument)
        except Exception as e:
            q.put(f"data: {json.dumps({'stage': 'error', 'status': 'error', 'message': str(e)})}\n\n")
        finally:
            q.put("data: {\"stage\": \"done\", \"status\": \"done\"}\n\n")
            q.put(None)

    thread = threading.Thread(target=run_pipeline, daemon=True)
    thread.start()

    def event_stream():
        while True:
            data = q.get()
            if data is None:
                break
            yield data
        _event_queues.pop(client_id, None)

    return Response(event_stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/reports/<path:filename>")
def serve_report(filename):
    return send_from_directory(os.path.join(PROJECT_ROOT, "reports"), filename)


@app.route("/charts/<path:filename>")
def serve_chart(filename):
    return send_from_directory(os.path.join(PROJECT_ROOT, "charts"), filename)


if __name__ == "__main__":
    port = int(os.environ.get("FINFLOW_PORT", 5050))
    print(f"\n  FinFlow Demo Server")
    print(f"  http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
