"""Base English analyses for the content translation pipeline."""

import os

CONTENT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_analysis(slug: str) -> str:
    """Load base English analysis for an instrument."""
    path = os.path.join(CONTENT_DIR, f"{slug}_analysis.md")
    if not os.path.exists(path):
        raise FileNotFoundError(f"No base analysis found for '{slug}' at {path}")
    with open(path) as f:
        return f.read()
