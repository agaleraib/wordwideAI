# FinFlow — AI Financial Translation Platform

## Build & Run
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m finflow.demo            # CLI demo
python -m finflow.demo_server     # Flask dev server
```

## Stack
- Python 3.14 + Flask
- Anthropic Claude API (agents reasoning)
- PostgreSQL/Supabase (planned)
- pgvector for semantic search (planned)

## Conventions
- Multi-agent architecture: Translation, Compliance, TA, FA agents
- HITL checkpoints via Telegram for async approvals
- Client profiles define: tone, glossary, compliance rules, brand voice
- Correction Analysis Agent extracts learning from every human edit

## Key Reference
- `docs/finflow-personalization-engine.html` in finflow-deck repo — full technical spec
- `plan.md` — implementation roadmap
