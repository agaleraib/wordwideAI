# FinFlow — How It Works

*A plain-English walkthrough of the platform end-to-end.*

**Audience:** founding team, partners, advisors, prospective clients who want to understand how the system actually works without reading specs.

---

## What we're building, in one paragraph

FinFlow is an AI content engine for financial brokers and trading firms. It watches the world's financial news 24/7, figures out which stories actually move the markets each client cares about, and produces unique, brand-aligned analysis content for every client — automatically. Each broker gets content that sounds like *their* in-house analyst writing in *their* voice for *their* audience, even when the underlying news event is the same as everyone else's. We deliver it to wherever they want to publish: their website, their Telegram channel, their email list, their internal CMS.

The product replaces the work that today either gets done by an in-house analyst team (expensive, slow, inconsistent) or gets bought as syndicated feeds from FXStreet / Reuters / Bloomberg (cheap, but it's the same content as every competitor, and Google penalizes duplicate content).

---

## The problem we solve

A typical broker today has three bad options for market content:

1. **Hire an in-house analyst team.** Real expertise, but $200k+/year for senior people, slow turnaround, inconsistent volume on busy news days, hard to scale across languages and audiences.
2. **Buy syndicated content from FXStreet, Reuters, Bloomberg, or similar.** Cheap and fast, but every broker who buys the same feed publishes essentially the same article. Their audience can read it elsewhere for free. Google sees duplicate content across dozens of broker sites and demotes all of them in search results. Brand differentiation collapses.
3. **Use a generic AI tool like ChatGPT.** Looks easy at first, but the output is generic, doesn't follow the broker's glossary or brand voice, doesn't know the broker's regulatory jurisdiction, doesn't handle multiple languages consistently, and definitely produces near-identical content if two competitors are using the same prompts.

FinFlow is the fourth option: **the speed and cost of syndication, the quality and editorial control of an in-house team, with content that is genuinely unique to each broker.**

---

## The end-to-end pipeline

Here's what happens between a news event landing on the internet and a finished analysis appearing on a broker's blog. We'll follow a real example through the system.

**The example:** at 14:32 UTC, Reuters publishes "U.S. forces strike Iranian Revolutionary Guard positions in Syria." It mentions Iran, the U.S., missile strikes, geopolitical escalation. It does **not** mention EUR/USD, oil, gold, or any specific market.

```
                                    ┌──────────────────────────┐
                                    │   1. INGEST              │
   News, RSS, scrapers         ─►   │   Fetch from anywhere    │
   YouTube, central banks,          │   (Reuters, FT, ECB,     │
   custom client feeds              │    SEC, custom sources)  │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   2. EVENT CLUSTERING    │
                                    │   "Reuters, FT, and      │
                                    │    Bloomberg are all     │
                                    │    talking about the     │
                                    │    SAME event."          │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   3. IMPACT SCORING      │
                                    │   "This event will move  │
                                    │    EUR/USD 85, oil 90,   │
                                    │    gold 75, S&P 60"      │
                                    │   — per client, per      │
                                    │     instrument           │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   4. TRIGGER CHECK       │
                                    │   "Which client          │
                                    │    pipelines care        │
                                    │    enough to fire?"      │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   5. CORE ANALYSIS       │
                                    │   FA / TA / FA+TA        │
                                    │   produces ONE           │
                                    │   authoritative read     │
                                    │   per (event, market).   │
                                    │   Cached & shared.       │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   6. IDENTITY SHAPING    │
                                    │   The same analysis      │
                                    │   becomes a blog post,   │
                                    │   a trader alert, a      │
                                    │   newsletter, a journ-   │
                                    │   alism column, …        │
                                    │   ONE per client pipeline│
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   7. CONFORMANCE         │
                                    │   The client's glossary, │
                                    │   brand voice, regional  │
                                    │   variant, and 13        │
                                    │   quality metrics get    │
                                    │   enforced.              │
                                    │   Translates if needed.  │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   8. UNIQUENESS GATE     │
                                    │   "Is this meaningfully  │
                                    │    different from        │
                                    │    everything else we    │
                                    │    already published     │
                                    │    for any other client  │
                                    │    on the same event?"   │
                                    └────────────┬─────────────┘
                                                 ▼
                                    ┌──────────────────────────┐
                                    │   9. PUBLISH             │
                                    │   Telegram, email,       │
                                    │   WordPress, webhook,    │
                                    │   Discourse, …           │
                                    └──────────────────────────┘
```

Let's walk each stage with the Iran example.

### Stage 1 — Ingest

We monitor a curated pool of financial news sources: Reuters, FT, Bloomberg, the SEC EDGAR filings feed, the European Central Bank's press releases, central bank announcements globally, plus any custom feed a client wants to add (their internal research, a competitor's blog, an industry forum). The Reuters article lands here at 14:32 UTC, a few seconds after Reuters publishes it.

We fetch it once, globally — not once per client. **One Reuters article serves all 50 brokers using FinFlow at zero extra cost.** This is one of the things that makes the unit economics work.

### Stage 2 — Event clustering

Within minutes, FT publishes a similar article. Then Bloomberg. Then five other outlets. We recognize that all of these are describing **the same underlying real-world event** ("U.S. strike on Iranian targets in Syria") and group them as a single cluster. From here on, the system treats this as one event, not six articles. This stops us from generating six near-identical analyses.

### Stage 3 — Impact scoring (the value-prop step)

This is where FinFlow does something most AI content tools don't.

Most tools work by **keyword matching**: "if the article mentions 'EUR/USD', flag it." That's useless for the Iran example, because the article doesn't mention any forex pair. A keyword-matching system would miss it entirely.

FinFlow works by **causal-impact reasoning**: it asks an AI agent, grounded in our financial instrument catalog, "given that this happened, which markets will move and by how much, and why?" The agent reasons through transmission chains:

- *Geopolitical risk in the Middle East → flight to safe-haven currencies → USD strength → EUR/USD bearish*
- *Iran is a major oil producer; risk to Strait of Hormuz → oil supply concerns → Brent/WTI bullish*
- *Risk-off sentiment → equities down (S&P, DAX, FTSE)*
- *Safe-haven flows → gold up, JPY up*

For each broker on the platform, the system looks at which markets that broker cares about and produces an impact score per market. Broker A trades majors only — they get scores on EUR/USD, GBP/USD, USD/JPY. Broker B trades commodities — they get scores on Brent, gold, silver. Broker C trades equities — they get scores on S&P 500, DAX, NASDAQ.

**The same event produces different relevance for different brokers.** That's the foundation of the multi-tenant model.

### Stage 4 — Trigger check

Each broker has one or more **content pipelines** configured. Think of a pipeline as a single "content product" — for example:

- Pipeline A: "Daily retail blog, written like a financial journalist, beginner audience, English, post to WordPress"
- Pipeline B: "Pro client newsletter, written like a senior strategist, professional audience, English, sent via email"
- Pipeline C: "Telegram trade alert, written like a trading desk, terse, with entry/exit, sent to broker's Telegram channel"

Each pipeline subscribes to a set of markets and has its own threshold for "this is impactful enough to write about." Broker A's retail blog might trigger at 60+ impact; their pro newsletter might trigger at 75+; their Telegram alert might only trigger at 85+ (to avoid noise).

For the Iran event, all three of Broker A's pipelines might fire — each producing its own piece of content, in its own voice, for its own audience. **One news event → multiple distinct products for one broker.**

### Stage 5 — Core analysis (the cost-saving step)

Here the platform does another thing that's invisible to clients but critical to making the economics work.

When 50 brokers are all interested in EUR/USD analysis of the Iran event, the naive approach is to run an expensive AI reasoning call **50 times** — once per broker. FinFlow does it **once**.

The first broker pipeline that triggers on `(Iran event × EUR/USD)` causes the system to invoke a specialized **Fundamental Analysis agent** that produces a single, authoritative analysis: drivers, transmission mechanisms, directional view, scenarios, key levels to watch, catalysts. This analysis is cached and **shared across all 50 brokers** that subscribe to EUR/USD. The 49 other brokers reuse the cached analysis at zero AI cost.

We have three core analysis agents:
- **Fundamental Analyst** — macro, news-driven, geopolitical reasoning
- **Technical Analyst** — chart patterns, support/resistance, momentum, indicators
- **Integrated Analyst** — a third specialist that weaves both fundamental and technical perspectives into one coherent read

The cached analyses live in our database for 24 hours, then expire (markets move on). During that 24-hour window, every new broker pipeline that fires on the same event/market reuses the cache. The result is **at most 3 expensive AI reasoning calls per news event per market, regardless of how many brokers are interested**.

### Stage 6 — Identity shaping (the differentiation step)

Now we have one authoritative analysis. The next step is to turn it into the actual content product each broker wants. This is where uniqueness happens.

We have a family of **identity agents**, each one a specialized "writer" with a fixed editorial style and output format:

- **Beginner Blogger** — produces ~600-word blog posts for retail beginners, simplified explanations, hooks, soft CTAs
- **In-House Journalist** — produces ~800-word journalism-style market columns, narrative arcs, hooks, professional tone
- **Trading Desk** — produces ~150-word terse alerts, extracted signals, urgent tone, immediate trade ideas
- **Newsletter Editor** — produces email-formatted newsletters, conversational, "here's what we're watching" framing
- **Senior Strategist** — produces long-form positioning pieces, scenario analysis, institutional voice
- **Educator** — produces explainer-style content for clients learning how markets work
- **Raw FA / Raw TA / Raw FA+TA** — pass-through identities that ship the institutional analysis as-is, no editorial dressing

Each identity is its own agent. Adding a new identity (say, a "Crypto-Native" voice or a "Quant Researcher" voice) is a self-contained task — the rest of the system doesn't change.

The same Iran-event EUR/USD analysis from Stage 5 becomes:

- **Broker A's retail blog** (Beginner Blogger): a 600-word piece headlined *"How Middle East tensions are quietly moving the dollar"* with a beginner-friendly explanation of safe-haven flows
- **Broker A's pro newsletter** (Senior Strategist): a 1,500-word piece headlined *"USD safe-haven bid: positioning for the EUR/USD reversal"* with scenario analysis and institutional language
- **Broker A's Telegram alert** (Trading Desk): a 150-word terse alert reading *"⚠ EUR/USD bearish — Iran escalation, USD safe-haven flows. Watch 1.0820 support."*
- **Broker B's WordPress blog** (In-House Journalist): an 800-word column with a different angle, different opening hook, different examples

All of these descend from **the same factual analysis**, so the conclusions are consistent. But the *prose, structure, voice, audience, and CTA are completely different.*

A single client can run multiple pipelines simultaneously, getting multiple distinct content products from the same event. And different clients picking the same identity (e.g. two brokers both using "In-House Journalist" for blog content) get content that's still differentiated by the next stage.

### Stage 7 — Conformance (the quality + brand-fit step)

Each broker has a **client profile** that captures their:
- **Glossary** — preferred terminology ("we say 'maximum loss', not 'drawdown'"; "we say 'short sale', not 'short position'")
- **Brand voice** — formal vs casual, urgent vs measured, conservative vs bold
- **Regional variant** — en-GB vs en-US vs en-AU (or es-ES vs es-MX, fr-FR vs fr-CA, etc.)
- **Forbidden claims** — "no 'guaranteed returns' language"; "always include risk warnings"; "compliance constraints for our jurisdiction"
- **Audience sophistication** — beginner / intermediate / professional
- **Length preferences**, formatting conventions, etc.

The Conformance Engine takes the content from Stage 6 and runs it through a **13-metric quality enforcement loop**:
- Glossary compliance (every preferred term substituted)
- Brand voice adherence (matches the client's documented voice)
- Formality level (matches the client's target)
- Sentence length (matches the client's preferences)
- Passive voice ratio (matches the client's target)
- Regional variant correctness (en-GB vs en-US, etc.)
- Numerical accuracy (all numbers preserved correctly)
- Meaning preservation (no factual drift)
- Fluency, paragraph alignment, term consistency, formatting preservation
- Plus translation, if the client wants the content in a different language

When something fails, specialized "specialist agents" surgically correct the issue and re-score. The loop runs until the content meets all the client's thresholds, or escalates to human review if it can't.

**This is the same enforcement engine we built and benchmarked for the translation pipeline.** What we just realized in this round of architecture work is: it's not really a "translation engine," it's a **client-conformance engine that translates as one of its steps**. 12 of the 13 metrics apply to any content regardless of language. So even when a client wants English content (no translation needed), this stage still runs and enforces their glossary, brand voice, regional variant, and quality standards. It's the layer that makes the content actually feel like *their* writing, not generic AI output.

### Stage 8 — Uniqueness gate (the differentiator gate)

Now we have brand-aligned content for one broker. But we need to make sure it's not too similar to what we already published for some other broker on the same event.

This matters for two reasons:

1. **Product credibility.** If two brokers can compare their content side by side and see it's basically the same article with different logos, the value prop collapses. They could buy that from FXStreet for less.
2. **SEO survival.** Google's duplicate-content detection penalizes all sites that publish near-identical content. One bad call wipes out organic traffic for every affected broker simultaneously.

The Uniqueness Gate runs a three-stage check on the conformed content:

1. **Embedding similarity.** Does this piece's vector representation come too close to any other piece we've published for the same event/market in the last 90 days? (Different threshold for cross-broker vs intra-broker comparisons.)
2. **Word-level overlap.** Does the actual prose share too many phrases with prior pieces? (Catches the "synonym swap" trick that fools embeddings but not Google.)
3. **AI judge.** For borderline cases, an AI agent reads both pieces and decides: are these meaningfully different perspectives, or essentially the same article reskinned?

If a piece fails, the system tries to regenerate it once with a "diversification hint" telling the identity agent which dimensions need to differ from the colliding piece. If it still fails, it escalates to human review — never silently publishes a duplicate.

The first week of production runs the gate in **shadow mode** — it computes verdicts but always lets content through. We use that week to gather real similarity-distribution data and tune the thresholds before they start blocking content.

### Stage 9 — Publish

The conformed, uniqueness-checked content gets handed to the **publishers package**, which delivers it to wherever the broker wants: their WordPress blog, their Telegram channel, their email list, their internal CMS, a custom webhook to their backend.

Each publish target is configured per pipeline. One pipeline can publish to multiple targets — the same blog post lands on both WordPress and as a Telegram link. The publishers package handles the channel-specific mechanics: authentication, rate limiting, format conversion, retry on transient failures, idempotency (so we never accidentally double-publish), and delivery confirmation.

**Adding a new channel is a self-contained task** — Instagram, Twitter/X, LinkedIn, Discourse, Slack, Discord all get added by writing one new adapter, no changes to the rest of the system.

---

## The five things that make FinFlow different

If you only remember five things about how this works:

### 1. Causal-impact reasoning, not keyword matching

We don't look for news that *mentions* a market. We look for news that *moves* it. The Iran example — a geopolitics story with no forex keywords in it — still triggers EUR/USD content because the system reasons through the causal chain. **This is the entire reason we can charge premium pricing.** Anyone can build a keyword-matcher. Building an instrument-grounded causal reasoner is hard and it's our moat.

### 2. Two-layer generation: shared reasoning, unique shaping

The expensive thinking happens once per event/market and is shared across all clients who care. The cheap shaping happens per pipeline and produces genuinely different products. This gives us:

- **Cost economics that scale with events, not with tenants.** Adding the 50th broker is essentially free at the analysis layer.
- **Factual consistency across clients.** Two brokers analyzing the same event get the same underlying facts and direction — they can't accidentally contradict each other.
- **True content uniqueness.** Different identity agents produce structurally different products from the same shared analysis.

### 3. Each client runs as many pipelines as they want

A single broker can run a "retail blog + pro newsletter + Telegram alerts + email digest" simultaneously, each in a different voice for a different audience, each with its own threshold for "what's impactful enough." Same source pool, different products. **Pricing scales with pipelines** — we can charge per pipeline per month, with bigger clients running 5-10 pipelines.

### 4. Brand conformance is enforced deterministically, not asked for politely

Most AI content tools "try" to follow brand guidelines via prompting. We measure compliance with 13 hard metrics, run specialist correction agents on anything that fails, and only ship when the content passes the client's thresholds. The same enforcement loop also handles translation, glossary substitution, and regional variant correctness. **A piece that doesn't meet the client's editorial standard literally cannot be published** — it gets sent to human review instead.

### 5. Uniqueness is enforced, not assumed

Every piece is checked against every other piece we've published for the same event in the last 90 days. Failures regenerate once, then escalate to human review. We never silently ship near-duplicates. **This is the gate that protects our clients' SEO and our own credibility** — and it's the gate FXStreet-style syndication services structurally cannot have, because they're shipping the same content to everyone by design.

---

## What clients see

From a broker's perspective, the experience is:

1. **Onboarding.** We sit with them, capture their brand voice (we have an extraction agent for this — feed it sample documents from their existing content team and it builds a profile), define their glossary and regional variant, set up their interest profile (which markets they care about), and configure their first one or two pipelines. Initial setup is a few hours.
2. **Pipeline configuration in the dashboard.** They pick from our library of identity agents, set their thresholds, choose their publishing targets, decide whether they want human approval before each piece goes live (HITL — the default) or fully automated publishing (autopilot — opt-in).
3. **Daily activity view.** The dashboard shows them, in real time: which news events came in today, which ones triggered their pipelines, why each one was scored as relevant to their markets, what content was generated, and where it was published. Full audit trail.
4. **HITL queue.** For pipelines in HITL mode, they get a queue of pending pieces with "approve / edit / reject" buttons. Most clients run HITL for the first few weeks then move to autopilot once they trust the output.
5. **Cost dashboard.** They see how many pieces they've consumed this month against their plan limits, with options to upgrade or adjust thresholds.

The dashboard is **mandatory at launch** — every client, big or small, sees their sources, their pipelines, their generated content, and their publish history through the same web UI.

---

## How we deploy and operate

Two deployment modes, both operated entirely by us:

### Mode A — Shared SaaS

A single cloud VM running our standard stack, multi-tenant. Smaller clients sit here together, isolated by tenant ID at the database level. We own the box, the backups, the monitoring, the deploys. They get a `client.wordwidefx.com` subdomain (or a custom domain).

### Mode B — Dedicated VM

A separate VM for one larger client that needs their own infrastructure for compliance, scale, or jurisdictional reasons. Same software, same release cadence, just isolated. We still operate it — the client never SSHs into the box, never runs an installer, never owns a backup tape. They consume a managed service.

**Both modes run the exact same software** — same containers, same configuration system, same release pipeline. The only differences are environment variables. We can promote a Mode A tenant to a new dedicated Mode B box without code changes — just spin a new VM and migrate their database rows.

We never sell self-installable software. We always operate the deployment.

---

## The technical foundation

For the technically-curious:

- **Backend:** TypeScript on Bun + Hono, strict typing, no `any`. Postgres + pgvector for storage and similarity search. Drizzle ORM. Caddy for TLS. Docker Compose for orchestration. No Kubernetes — single-node deployments at the scale we operate at.
- **AI:** Anthropic Claude (Opus for the expensive reasoning, Sonnet for the cheaper shaping, Haiku for small classification tasks) via the Vercel AI SDK, which gives us provider-agnostic access. We can swap to OpenAI or Google or run local LLMs via Ollama with no engine code changes — provider is a per-tenant config knob.
- **Embedding model:** OpenAI's `text-embedding-3-small` for the uniqueness gate's similarity checks. Cheap, fast, well-supported.
- **Frontend:** React 19 + Vite + Tailwind v4 + framer-motion. Premium dark UI with rich animations — explicitly *not* the sterile "AI tool" look.
- **Architecture:** four packages — `@wfx/ingest` for news/source fetching, the FinFlow content pipeline for the dispatcher and producer logic, `@wfx/publishers` for output channels, and the existing translation engine (now reframed as the conformance engine) for quality enforcement. The content pipeline is FinFlow-specific; the ingest and publishers packages are domain-neutral and reusable across other projects we may build (e.g. Robuust, the dog crate company project).

**No vendor lock-in.** The AI provider is swappable, the database is self-managed, the deployment is on commodity Linux. If Anthropic doubles their pricing tomorrow, we point the system at OpenAI and our content pipeline keeps running.

---

## Where we are and what's next

### What's done
- Translation engine fully built, benchmarked, and validated. 13-metric quality scoring proven consistent at temperature=0 (variance of 0.2 points across 5 runs on the same content). Specialist correction loop working. Glossary enforcement working. The hardest piece — making AI quality reproducible and measurable — is solved.
- Frontend dashboard built (React, dark premium UI, pipeline monitor, login, profile management).
- Architecture for the full content pipeline locked in: four detailed specs covering ingest, content pipeline, uniqueness gate, deployment stack, and publishers — all internally consistent and cross-referenced.

### What's next (the build queue)
1. **Port the instrument catalog from the old Python prototype to TypeScript** (~50 instruments with their drivers, correlations, and risk profiles). This is the grounding the impact classifier needs.
2. **Build the database layer** (`packages/db/` with Drizzle, all the new tables specified in the architecture).
3. **Build `@wfx/ingest`** with adapters for RSS and HTML scraping, the `SourceConfigStore` interface, and the document store.
4. **Refactor the translation engine** behind the AI SDK (no behavioral change, just the abstraction layer that lets us swap providers).
5. **Build the content pipeline** — event clustering, impact classification, trigger evaluation, two-layer generation (FA/TA/FA+TA core agents plus the identity agent registry).
6. **Build the conformance engine reframe** — same-language pass-through path so English-only clients get full editorial enforcement.
7. **Build the uniqueness gate** with shadow-mode rollout for the first week of production.
8. **Build `@wfx/publishers`** with adapters for Telegram, email, WordPress, and webhook.
9. **Wire it all together** through the existing dashboard, add the new views (pipelines, sources, generated content, HITL queue, cost/quota), launch with a small set of friendly clients.

### What's deferred to v2
- More identity agents (more "writers" in the stable)
- More publishing channels (Instagram, Twitter, LinkedIn, Discourse, Slack)
- Pipeline chaining (output of one pipeline feeds another — needed for "publish to WordPress, then post the URL to Telegram as a teaser")
- Cross-tenant cost optimization at the impact-classification layer (one classification call per canonical market shared across tenants)
- Local LLM support for clients who require fully on-prem inference
- Real entity-extraction-based event clustering (v1 uses a cheap hash-based approximation that will be good enough for the first 6-12 months)

### The honest unknown
The thresholds for the uniqueness gate are first-pass guesses. We'll tune them in the first week of production using shadow-mode data. If they're wrong we'll rebuild them, and the architecture supports that without touching anything else.

The market data layer (live prices, snapshots) for the Technical Analysis agent is sketched but not specced — it's a small fetcher module that connects to whichever market data provider the client has access to. We'll spec it when we hit it.

---

## The pitch in one sentence

**FinFlow gives every broker their own in-house analyst team that runs 24/7, writes in their voice, never publishes the same article twice across competitors, and costs less per month than one junior analyst's salary.**

That's the product. Everything in this document is how we make it work.
