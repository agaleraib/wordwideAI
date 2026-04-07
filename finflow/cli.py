"""
CLI interface for the Translation Engine.

Usage:
  python -m finflow.cli translate --input report.md --client oanda --language es
  python -m finflow.cli score --source report.md --translation translated.md --client oanda --language es
  python -m finflow.cli profiles list
  python -m finflow.cli profiles show oanda
  python -m finflow.cli profiles migrate
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .engine.translation_engine import TranslationEngine
from .profiles.store import ProfileStore


def _event_handler(stage: str, status: str, message: str) -> None:
    """Print engine events to stderr for real-time feedback."""
    print(f"  [{stage}:{status}] {message}", file=sys.stderr)


def cmd_translate(args: argparse.Namespace) -> None:
    """Translate a document with full quality scoring."""
    source_text = Path(args.input).read_text(encoding="utf-8")
    store = ProfileStore(args.db) if args.db else ProfileStore()
    engine = TranslationEngine(store=store, on_event=_event_handler)

    print(f"Translating for {args.client} → {args.language}...", file=sys.stderr)
    result = engine.translate(
        source_text=source_text,
        client_id=args.client,
        language=args.language,
    )

    # Write translation
    if args.output:
        Path(args.output).write_text(result.translated_text, encoding="utf-8")
        print(f"\nTranslation written to {args.output}", file=sys.stderr)
    else:
        print(result.translated_text)

    # Write score report
    if args.score_report:
        Path(args.score_report).write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Score report written to {args.score_report}", file=sys.stderr)

    # Print summary
    print("\n" + result.summary(), file=sys.stderr)


def cmd_score(args: argparse.Namespace) -> None:
    """Score an existing translation."""
    source_text = Path(args.source).read_text(encoding="utf-8")
    translated_text = Path(args.translation).read_text(encoding="utf-8")
    store = ProfileStore(args.db) if args.db else ProfileStore()
    engine = TranslationEngine(store=store, on_event=_event_handler)

    print(f"Scoring {args.translation} for {args.client} ({args.language})...", file=sys.stderr)
    scorecard = engine.score_only(
        source_text=source_text,
        translated_text=translated_text,
        client_id=args.client,
        language=args.language,
    )

    print(scorecard.summary())

    if args.output:
        Path(args.output).write_text(
            json.dumps(scorecard.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\nScore report written to {args.output}", file=sys.stderr)


def cmd_profiles_list(args: argparse.Namespace) -> None:
    """List all client profiles."""
    store = ProfileStore(args.db) if args.db else ProfileStore()
    profiles = store.list_profiles()

    if not profiles:
        print("No profiles found. Run 'profiles migrate' to import from glossary JSONs.")
        return

    for p in profiles:
        source = f" ({p['source']})" if "source" in p else ""
        langs = ", ".join(p["languages"])
        print(f"  {p['client_id']}: {p['client_name']} — languages: [{langs}]{source}")


def cmd_profiles_show(args: argparse.Namespace) -> None:
    """Show a client profile."""
    store = ProfileStore(args.db) if args.db else ProfileStore()
    profile = store.load(args.client_id)

    if not profile:
        print(f"Profile not found: {args.client_id}")
        sys.exit(1)

    print(json.dumps(profile.to_dict(), ensure_ascii=False, indent=2))


def cmd_profiles_migrate(args: argparse.Namespace) -> None:
    """Migrate all legacy glossary JSONs to SQLite profiles."""
    store = ProfileStore(args.db) if args.db else ProfileStore()
    profiles = store.list_profiles()

    migrated = 0
    for p in profiles:
        if p.get("source") == "legacy_json":
            profile = store.load(p["client_id"])  # This triggers migration
            if profile:
                print(f"  Migrated: {p['client_id']} ({', '.join(p['languages'])})")
                migrated += 1

    if migrated == 0:
        print("  All profiles already migrated (or none found).")
    else:
        print(f"\n  Migrated {migrated} profile(s) to {store.db_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="finflow",
        description="FinFlow Translation Engine CLI",
    )
    parser.add_argument("--db", help="Path to SQLite database", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)

    # translate
    p_translate = subparsers.add_parser("translate", help="Translate a document with quality scoring")
    p_translate.add_argument("--input", "-i", required=True, help="Source document path")
    p_translate.add_argument("--client", "-c", required=True, help="Client ID (e.g., oanda)")
    p_translate.add_argument("--language", "-l", required=True, help="Target language (e.g., es)")
    p_translate.add_argument("--output", "-o", help="Output file for translation")
    p_translate.add_argument("--score-report", "-s", help="Output file for score report JSON")

    # score
    p_score = subparsers.add_parser("score", help="Score an existing translation")
    p_score.add_argument("--source", required=True, help="Source document path")
    p_score.add_argument("--translation", required=True, help="Translation document path")
    p_score.add_argument("--client", "-c", required=True, help="Client ID")
    p_score.add_argument("--language", "-l", required=True, help="Target language")
    p_score.add_argument("--output", "-o", help="Output file for score JSON")

    # profiles
    p_profiles = subparsers.add_parser("profiles", help="Manage client profiles")
    profiles_sub = p_profiles.add_subparsers(dest="profiles_command", required=True)

    profiles_sub.add_parser("list", help="List all profiles")

    p_show = profiles_sub.add_parser("show", help="Show a profile")
    p_show.add_argument("client_id", help="Client ID to show")

    profiles_sub.add_parser("migrate", help="Migrate legacy glossary JSONs to SQLite")

    args = parser.parse_args()

    match args.command:
        case "translate":
            cmd_translate(args)
        case "score":
            cmd_score(args)
        case "profiles":
            match args.profiles_command:
                case "list":
                    cmd_profiles_list(args)
                case "show":
                    cmd_profiles_show(args)
                case "migrate":
                    cmd_profiles_migrate(args)


if __name__ == "__main__":
    main()
