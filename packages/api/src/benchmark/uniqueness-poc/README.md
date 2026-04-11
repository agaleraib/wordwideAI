# Uniqueness Proof-of-Concept Harness

A standalone, deliberately minimal harness that tests **the load-bearing claim of the FinFlow content architecture**: that one shared core analysis (FA agent) plus N identity adapters (BeginnerBlogger, InHouseJournalist, TradingDesk, NewsletterEditor, Educator, SeniorStrategist) produces genuinely different content products from the same input.

If this works, the two-layer architecture in `docs/specs/2026-04-07-content-pipeline.md` is validated and the build can proceed. If it doesn't, the architecture has a hole and we need to fix it before investing more.

This is **not production code.** It is a focused experiment with real LLM calls, real prompts, and a real measurement gate, but no schemas, no database, no dispatcher, no registry. The patterns used here are deliberately shaped like the eventual production code so the prompts and observations carry over directly.

## What the harness does

1. **Stage 1 — Core analysis.** One Opus call producing a structured fundamental analysis from a hardcoded news event. This is the cached, shared analysis layer in production.
2. **Stage 2 — Identity adaptation.** Six Sonnet calls in parallel, each with a different identity system prompt, all consuming the SAME core analysis from Stage 1.
3. **Stage 3 — Embedding similarity.** Computes `text-embedding-3-small` embeddings for all six outputs and builds the pairwise cosine-similarity matrix.
4. **Stage 3.5 — ROUGE-L overlap.** Word-level n-gram overlap (longest common subsequence-based F1) over the same pairs. Catches synonym-swap paraphrase that fools embeddings but not Google.
5. **Stage 3.6 — LLM judge (only on borderline pairs).** A Haiku call that decides whether borderline pairs are meaningfully different perspectives or just the same article reskinned.
6. **Stage 4 (optional, `--full`) — Reproducibility.** Runs the same identity three times on the same core analysis. Tells us how stable each identity's voice is across independent runs.
7. **Stage 5 (optional, `--full`) — Persona overlay differentiation.** Runs the same identity twice with two different `ContentPersona` overlays (Broker A vs Broker B). Tests whether the persona-as-context layer produces meaningful differentiation between two clients picking the same identity.

## What you need

- `ANTHROPIC_API_KEY` in `.env` at the repo root
- `OPENAI_API_KEY` in `.env` at the repo root (for the embedding stage)
- `bun` available on your PATH

The harness uses the same `.env` file Bun auto-loads when running scripts from the repo root.

## How to run

From the repo root:

```bash
# Default: Iran strike fixture, basic mode (~$0.80-1.10)
bun run packages/api/src/benchmark/uniqueness-poc/index.ts

# Pick a specific fixture
bun run packages/api/src/benchmark/uniqueness-poc/index.ts iran-strike
bun run packages/api/src/benchmark/uniqueness-poc/index.ts fed-rate-decision
bun run packages/api/src/benchmark/uniqueness-poc/index.ts china-tariffs

# Full mode (adds reproducibility + persona differentiation, ~$1.50-2.00)
bun run packages/api/src/benchmark/uniqueness-poc/index.ts iran-strike --full

# All three fixtures, full mode (~$5-6 total)
bun run packages/api/src/benchmark/uniqueness-poc/index.ts --all --full
```

## Where the output lives

Each run creates a directory under `uniqueness-poc-runs/<runId>/` (at the repo root, gitignored):

```
uniqueness-poc-runs/2026-04-07T15-30-00-000Z_iran-strike-2026-04-07/
├── report.md                ← read this first; the headline artifact
├── core-analysis.md         ← the FA agent's output, standalone
├── outputs/
│   ├── beginner-blogger.md
│   ├── in-house-journalist.md
│   ├── trading-desk.md
│   ├── newsletter-editor.md
│   ├── educator.md
│   └── senior-strategist.md
├── similarity-matrix.json   ← machine-readable for cross-run analysis
└── raw-data.json            ← full RunResult including all token counts
```

**Read `report.md` end-to-end** — it contains the verdict, the source event, the full core analysis, every identity output, the similarity matrix, the LLM judge's reasoning on any borderline pairs, and a reading guide. It's the artifact you can share with a partner.

## Cost reference (April 2026 approximate)

| Stage | Calls | Model | ~Cost |
|---|---|---|---|
| Core analysis | 1 | Opus | $0.30–0.40 |
| Identity adaptation × 6 | 6 | Sonnet | $0.40–0.60 |
| Embeddings × 6 | 6 | text-embedding-3-small | <$0.01 |
| LLM judge (only on borderline) | 0–3 | Haiku | $0.00–0.06 |
| **Basic mode total** | | | **~$0.80–1.10** |
| Reproducibility (`--full`) | 3 | Sonnet + 3 embeddings | ~$0.30 |
| Persona differentiation (`--full`) | 2 | Sonnet + 2 embeddings | ~$0.20 |
| **Full mode total** | | | **~$1.40–1.80** |

## What this proves and does not prove

**Proves:**
- Same core analysis → meaningfully different outputs across identities (the architectural premise)
- Cross-identity similarity is below the cross-tenant uniqueness threshold (cosine ≥ 0.85)
- The identity prompts produce genuinely different content shapes, not just different vocabulary
- Each identity is reproducible across independent runs (`--full`)
- The persona-overlay mechanism actually differentiates two clients picking the same identity (`--full`)

**Does NOT prove:**
- Uniqueness at scale across many tenants (we run 6 identities, not 50)
- Real conformance engine quality (the 13-metric loop is not invoked)
- Cost economics at production volume (we run 1 event, not 100/day)
- Whether the impact classifier picks the right events
- End-to-end production latency

If the basic mode passes on all three fixtures, the architecture is validated to a level sufficient to start the production build. If any fixture fails, we have early signal that the prompts need work or the architecture needs revision.

## File layout

```
packages/api/src/benchmark/uniqueness-poc/
├── README.md                 (this file)
├── index.ts                  CLI entry point
├── runner.ts                 stage orchestration
├── types.ts                  shared types + thresholds
├── pricing.ts                model pricing for cost computation
├── similarity.ts             OpenAI embedding fetch + cosine + ROUGE-L
├── llm-judge.ts              Haiku stage-3 judge
├── report.ts                 markdown report renderer
├── prompts/
│   ├── fa-agent.ts           the core analytical agent
│   └── identities/           the family of transformer agents
│       ├── index.ts          registry
│       ├── beginner-blogger.ts
│       ├── in-house-journalist.ts
│       ├── trading-desk.ts
│       ├── newsletter-editor.ts
│       ├── educator.ts
│       └── senior-strategist.ts
├── personas/
│   ├── broker-a.json         Premium Capital Markets (institutional voice)
│   └── broker-b.json         FastTrade Pro (energetic retail voice)
└── fixtures/
    ├── iran-strike.json      geopolitical event → EUR/USD
    ├── fed-rate-decision.json  central bank policy → EUR/USD
    └── china-tariffs.json    trade policy → S&P 500
```

## Specs this validates

- `docs/specs/2026-04-07-content-pipeline.md` §5.7 (two-layer generation: core analytical layer + identity adaptation layer)
- `docs/specs/2026-04-07-content-uniqueness.md` §6 (three-stage verification gate: embedding + ROUGE-L + LLM judge)
- `docs/specs/2026-04-07-content-uniqueness.md` §10 (threshold calibration plan — this PoC produces the first real distribution data we have)

## Iterating on the prompts

If a run produces an output that's clearly off (the trading desk is too wordy, the educator is too journalistic, etc.), the fix is in the corresponding `prompts/identities/<identity>.ts` file. The identity prompts are deliberately self-contained and standalone — editing one does not affect the others.

The FA agent prompt in `prompts/fa-agent.ts` is the most load-bearing piece. If the core analysis is weak, every identity output will be weak in the same way. Iterate on it first if outputs feel shallow across the board.

## Caveats

- The uniqueness thresholds in `types.ts` are first-pass values from the spec. Real production thresholds will be tuned in the first week of production using shadow-mode data. Don't read too much into a borderline result here.
- Sonnet's temperature defaults will produce some run-to-run variation. The reproducibility test (Stage 4) measures how much.
- The fixtures are realistic-looking news articles I wrote for this harness, not real Reuters/FT/Bloomberg articles. If you want to test with real news, drop a new JSON into `fixtures/` matching the schema in `types.ts`.
