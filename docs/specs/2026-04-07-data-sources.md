# `@wfx/ingest` — Universal Data Ingest Package

**Date:** 2026-04-07
**Status:** Paused (Workstream B — resume by scaffolding packages/sources/ once C unblocks)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (architecture), Claude (drafting)
**SB tracking:** #100 (this spec) → #102–#117 (implementation)

---

## 1. Goal

Build a **domain-neutral, reusable** package that ingests documents from heterogeneous external sources (web pages, RSS feeds, APIs, social platforms, file watchers) and emits them in a normalized form for downstream pipelines to consume.

The package is designed to be the ingest layer for **multiple unrelated projects**:
- **FinFlow** — financial news, central bank announcements, earnings reports → translation pipeline
- **Robuust** (dog crate company) — competitor blogs, YouTube reviews, forum threads → content generation pipeline
- **Future projects** — anything that needs "fetch documents from the internet, normalize them, hand them off"

The package never persists *consumer* state, never knows about FinFlow's instruments or Robuust's product catalog, and never decides what happens to documents after it returns them. It is **plumbing**, not policy.

---

## 2. Non-goals

The following are explicitly **out of scope** — they belong to other layers:

| Out of scope | Lives where |
|---|---|
| Translation, summarization, content generation | FinFlow / Robuust app code |
| Publishing to channels (Telegram, IG, WordPress, email) | Future `@wfx/publishers` package |
| Job scheduling / cron / queueing | Consumer's BullMQ / cron / Hono route |
| Domain knowledge (instruments, product SKUs, brand voice) | Consumer apps |
| Auth / multi-tenancy / billing | Consumer apps |
| Compliance / legal review of fetched content | Consumer apps |

---

## 3. Terminology

- **Source** — a configured ingest endpoint (e.g. "FT Markets RSS", "Reuters US Politics scraper", "Bank of England press releases")
- **Adapter** — the *kind* of source (e.g. `rss`, `html`, `youtube`, `reddit`). One adapter implementation can power many sources via different configs.
- **Document** — a single normalized item produced by a source (one article, one video, one post, one filing)
- **Provenance** — the metadata that proves where, when, and how a document was fetched
- **DocumentStore** — the package's internal persistence layer (SQLite by default), used for cross-run dedup memory and document retention with TTL

---

## 4. Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                   @wfx/ingest                            │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │   RSS    │  │   HTML   │  │  YouTube │  ← adapters  │
│  │ adapter  │  │ adapter  │  │ adapter  │   (plugins)  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       └─────────────┼─────────────┘                     │
│                     ▼                                    │
│            ┌─────────────────┐                          │
│            │  Source runner  │ ← orchestrates adapter   │
│            │                 │   + primitives           │
│            └────────┬────────┘                          │
│                     │                                    │
│       ┌─────────────┼─────────────┐                     │
│       ▼             ▼             ▼                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │  Rate   │  │  Retry  │  │ Robots  │  ← built-in    │
│  │ limiter │  │ /backoff│  │  .txt   │   primitives   │
│  └─────────┘  └─────────┘  └─────────┘                 │
│                                                          │
│            ┌────────────────────────┐                   │
│            │   DocumentStore        │  ← persistence    │
│            │   (SQLite default)     │   + dedup memory  │
│            │   + TTL garbage coll.  │                   │
│            └────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼ AsyncIterable<Document>
              ┌────────────────┐
              │  Consumer app  │  (FinFlow, Robuust, ...)
              │  decides what  │
              │  to do next    │
              └────────────────┘
```

The package exports a single high-level entry point (`runSource(sourceConfig)`) plus low-level building blocks for advanced consumers.

---

## 5. Core types

### 5.1 `Document`

The unit of output. Mandatory fields are minimal so adapters of any shape can produce them.

```ts
export interface Document {
  /** ID of the source that produced this document (e.g. "ft-markets-rss") */
  sourceId: string;

  /**
   * Tenant scope. Two-layer model:
   *
   *   - SHARED-pool documents (e.g. Reuters FX, FT Markets — fetched once
   *     globally and consumed by N tenants): `tenantId` is undefined.
   *     Dedup key = (sourceId, externalId).
   *
   *   - TENANT-PRIVATE documents (e.g. a client's own internal RSS, a
   *     bespoke Apify actor): `tenantId` is set. Dedup key =
   *     (tenantId, sourceId, externalId).
   *
   * The two-layer model exists because the cost of scraping Reuters
   * scales with sources, not with tenants. Per-tenant relevance and
   * impact scoring happen in the consumer (FinFlow content pipeline),
   * not here. See `2026-04-07-content-pipeline.md`.
   */
  tenantId?: string;

  /** Stable identifier within the source — used for dedup. Required. */
  externalId: string;

  /** Canonical URL if available. */
  url?: string;

  /** Human-readable title. Required. */
  title: string;

  /**
   * Plain text or markdown body. Required.
   * This is what the translation engine and content pipelines consume.
   * HTML must be cleaned (e.g. via cheerio) before reaching here.
   */
  body: string;

  /** Body format hint for downstream parsers. */
  bodyFormat: "text" | "markdown";

  /** ISO publication date from the source. */
  publishedAt: Date;

  /** ISO-639-1 language code if known (e.g. "en", "es"). */
  language?: string;

  /** Author names if available. */
  authors?: string[];

  /** Free-form tags (categories, sections). Used by consumers for filtering. */
  tags?: string[];

  /**
   * Provenance — non-negotiable. Proves where this came from and how.
   * Required for legal/audit and for the FinFlow translation engine's
   * audit trail.
   */
  provenance: Provenance;

  /**
   * Source-specific extras. Free-form, never typed by the package.
   * Examples: video duration, RSS guid, scraping selector path used.
   */
  meta?: Record<string, unknown>;
}

export interface Provenance {
  /** When the document was fetched (UTC). */
  fetchedAt: Date;

  /** Adapter kind that fetched it. */
  adapter: "rss" | "html" | "youtube" | "reddit" | "playwright" | "apify" | string;

  /** HTTP method or "stream" / "api". */
  method: string;

  /** ETag/Last-Modified used for conditional GET, if any. */
  etag?: string;
  lastModified?: string;

  /** HTTP status code from the fetch. */
  status?: number;

  /** Raw payload (HTML, JSON, XML) — optional, can be large. */
  raw?: string;

  /** Hash of the raw payload, always computed. */
  rawHash?: string;
}
```

### 5.2 `Source` interface

Adapters implement this. The interface is intentionally narrow.

```ts
export interface Source<TConfig = unknown> {
  /** Stable identifier — set by the source config, not the adapter. */
  readonly id: string;

  /** Adapter kind. */
  readonly adapter: string;

  /**
   * Source scope:
   *   - "shared" — fetched once globally, dedup key omits tenantId,
   *                consumed by any/all tenants subscribed to it
   *   - "tenant" — fetched per tenant, dedup key includes tenantId,
   *                visible only to its owning tenant
   *
   * Standalone consumers (Robuust) can ignore this; it defaults to
   * "shared" and behaves the way a single-tenant ingest used to.
   */
  readonly scope: 'shared' | 'tenant';

  /** Owning tenant. Required when scope === "tenant", forbidden otherwise. */
  readonly tenantId?: string;

  /** Resolved adapter config (parsed JSON). */
  readonly config: TConfig;

  /**
   * Fetch documents from the source.
   *
   * AsyncIterable so adapters can stream/paginate without buffering
   * everything in memory.
   *
   * The runner wraps this with rate limiting, retry, dedup, and
   * persistence — adapters do not implement those concerns themselves.
   */
  fetch(ctx: FetchContext): AsyncIterable<Document>;

  /** Optional health check (used by orchestration tooling). */
  healthCheck?(): Promise<HealthStatus>;
}

export interface FetchContext {
  /**
   * Documents already seen by the dedup store.
   * Adapters MAY use this to skip work (e.g. stop pagination
   * when a known externalId is encountered) but are not required to.
   */
  alreadySeen(externalId: string): boolean;

  /**
   * Logger — debug/info/warn/error.
   * Never use console.* in adapters.
   */
  log: Logger;

  /**
   * Abort signal — adapters must check periodically.
   */
  signal: AbortSignal;
}

export interface HealthStatus {
  ok: boolean;
  message?: string;
  checkedAt: Date;
}
```

### 5.3 `SourceConfig` (the JSON unit)

Sources are configured via JSON. The JSON structure is shared (`id`, `adapter`, `config`, primitives) and the `config` field is adapter-specific.

```json
{
  "id": "ft-markets-rss",
  "adapter": "rss",
  "description": "Financial Times — Markets section RSS feed",
  "enabled": true,

  "config": {
    "url": "https://www.ft.com/markets?format=rss",
    "minBodyLength": 200,
    "extractFullArticle": true
  },

  "rateLimit": {
    "requestsPerMinute": 10,
    "concurrent": 1
  },

  "retry": {
    "maxAttempts": 3,
    "backoffMs": 1000,
    "backoffMultiplier": 2
  },

  "retention": {
    "ttlDays": 60
  },

  "robotsTxt": {
    "respect": true,
    "userAgent": "wfx-ingest/1.0 (+https://wordwidefx.com/bot)"
  }
}
```

The shared envelope (`id`, `adapter`, `enabled`, `rateLimit`, `retry`, `retention`, `robotsTxt`) is validated by the package via Zod. The `config` field is validated by the adapter via its own Zod schema.

### 5.4 `SourceConfigStore`

Source configs are not loaded from disk by the runner directly. They live behind a `SourceConfigStore` interface — same pattern as `ProfileStore` / `TranslationStore` in the existing translation engine. This is the abstraction that lets us ship a CRUD UI without refactoring the runner later.

```ts
export interface SourceConfigStore {
  /** List sources, optionally filtered. */
  list(filter?: {
    tenantId?: string;          // for tenant-private sources
    scope?: 'shared' | 'tenant';
    enabled?: boolean;
  }): Promise<SourceConfig[]>;

  /** Get a single source by id. tenantId is required for tenant-scoped sources. */
  get(id: string, tenantId?: string): Promise<SourceConfig | null>;

  /** Create or update a source. */
  put(config: SourceConfig): Promise<void>;

  /** Delete a source. */
  delete(id: string, tenantId?: string): Promise<void>;

  /**
   * Optional: notify the runner when a config changes (add, edit, enable/disable).
   * Used by hot-reload in dev and by the live SaaS dashboard. Returns a disposer.
   */
  watch?(handler: (event: SourceConfigEvent) => void): () => void;
}
```

Two implementations ship in Phase 1:

| Implementation | Use case |
|---|---|
| `FileSourceConfigStore` | Standalone consumers (Robuust, local dev), tests, single-tenant dev rigs. Reads JSON files from a directory; hot-reloads on change. |
| `PostgresSourceConfigStore` | FinFlow Mode A (shared SaaS) **and** Mode B (dedicated VM). Stores configs in a `sources` table keyed by `(tenant_id, source_id)` (with `tenant_id = NULL` for shared sources). Same Postgres instance as the rest of the FinFlow app. |

The `PostgresSourceConfigStore` is required because FinFlow ships a **mandatory source-management UI** (see §18) — clients must be able to see, audit, and (in some cases) modify their connected sources from the dashboard. JSON files on disk cannot satisfy this.

The runner takes a `SourceConfigStore` instead of a directory path. `loadSourceConfig(path)` becomes a thin helper that wraps a single-config in-memory store, kept for tests and one-off scripts.

---

## 6. Built-in primitives

These wrap every adapter automatically. Adapters do not implement them.

### 6.1 Rate limiter
- Token-bucket per `sourceId`
- `requestsPerMinute` and `concurrent` from source config
- Defaults: 10 rpm, 1 concurrent
- Polite by default, override per source

### 6.2 Retry / backoff
- Exponential backoff on transient errors (5xx, network, timeout)
- Never retry on 4xx except 408 / 429 (with `Retry-After` honored)
- Defaults: 3 attempts, 1s base, 2x multiplier

### 6.3 robots.txt
- Fetched once per host per process, cached for 24h
- Respected by default; consumer can opt out per source via `respect: false`
- If a fetch is blocked by robots.txt, the runner emits a `blocked` event and skips the document — never crashes

### 6.4 ETag / Last-Modified caching
- The DocumentStore tracks `etag` + `lastModified` per `(sourceId, url)`
- Conditional GETs (`If-None-Match`, `If-Modified-Since`) sent on subsequent fetches
- 304 responses skip dedup work entirely

### 6.5 Dedup
- Every document's `externalId` is checked against the DocumentStore before being yielded
- Already-seen documents are dropped silently (counted in metrics, not yielded)
- The check happens *after* the adapter yields, so adapters can be naive — but adapters can also call `ctx.alreadySeen(id)` for early termination during pagination

### 6.6 Provenance enrichment
- Runner stamps `fetchedAt`, `rawHash`, HTTP `status`, `etag`, `lastModified` on every Document before yielding
- Adapters supply `adapter`, `method`, and optionally `raw`

---

## 7. DocumentStore

The package's internal persistence layer. **First-class concept** — not just a dedup cache.

### 7.1 Responsibilities
1. Persist fetched documents (full payload + metadata)
2. Provide cross-run dedup lookup by `externalId`
3. Cache ETag / Last-Modified per `(sourceId, url)` for conditional GETs
4. Enforce TTL retention via background garbage collection
5. Allow consumers to query/replay historical documents

### 7.2 Schema (default SQLite backend)

```sql
-- Default backend is SQLite. The PostgresStore backend (see §7.4) uses
-- the same logical schema with these additions:
--   - `tenant_id TEXT` column (nullable; NULL = shared-pool document)
--   - `tenant_id` included in the primary key as the first column,
--     so dedup is correct for both shared and tenant-private sources:
--     - shared:         (NULL,      source_id, external_id)
--     - tenant-private: (tenant_id, source_id, external_id)
--   - reserved nullable `embedding vector(1536)` column for future
--     pgvector-backed RAG over the news corpus
-- See deployment-stack spec §4 and content-pipeline spec for the
-- per-tenant impact-scoring tables that join against this one.
CREATE TABLE documents (
  source_id     TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  url           TEXT,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_format   TEXT NOT NULL,
  published_at  INTEGER NOT NULL,    -- unix ms
  language      TEXT,
  authors_json  TEXT,
  tags_json     TEXT,
  meta_json     TEXT,
  raw           TEXT,                -- nullable, can be large
  raw_hash      TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,    -- unix ms
  expires_at    INTEGER,             -- unix ms, NULL = never
  PRIMARY KEY (source_id, external_id)
);

CREATE INDEX idx_documents_expires ON documents(expires_at);
CREATE INDEX idx_documents_published ON documents(source_id, published_at);

CREATE TABLE conditional_get_cache (
  source_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  etag          TEXT,
  last_modified TEXT,
  cached_at     INTEGER NOT NULL,
  PRIMARY KEY (source_id, url)
);
```

### 7.3 Retention / TTL
- Per-source `retention.ttlDays` (from source config)
- `expires_at = fetched_at + ttlDays * 86400000`
- TTL of `null` (or `ttlDays: 0`) means **keep forever** (use case: earnings reports, regulatory filings)
- Garbage collector runs on a configurable interval (default: every 6 hours) and on package startup
- Deletion is hard delete by default; soft-delete mode available via `retention.softDelete: true` (sets a flag, doesn't free space — useful for audit)

### 7.4 Pluggable backend
- Default: `SQLiteStore` (zero-config, file at `.wfx-ingest/store.db`) — keeps the package zero-config for standalone consumers (Robuust, future projects, local dev).
- Interface: `DocumentStoreBackend` — `get`, `put`, `has`, `delete`, `gc`, `getCachedHeaders`, `setCachedHeaders`
- **`PostgresStore` is required for FinFlow integration** (promoted from "planned" — see `2026-04-07-deployment-stack.md` §4). FinFlow's SaaS and appliance deploys both run Postgres as the app DB; running SQLite for ingest alongside it would mean two databases, two backup paths, and no joins between documents and translations. The Postgres backend must land before the FinFlow content pipeline wires `@wfx/ingest` into `runTranslationEngine`. SQLite remains the default for standalone consumers.
- `MemoryStore` (for tests) remains a Phase 1 deliverable.

### 7.5 Query API (consumer-facing)

Consumers can query the store for replay / re-processing:

```ts
import { openStore } from "@wfx/ingest";

const store = await openStore(); // SQLite default, or pass config
const recent = await store.query({
  sourceId: "ft-markets-rss",
  publishedAfter: new Date("2026-04-01"),
  limit: 100,
});
```

This is what enables a consumer to **re-translate** a batch of documents without re-fetching them, or to feed multiple downstream pipelines from one ingest run.

---

## 8. Source runner

The high-level entry point.

```ts
import { runSource, loadSourceConfig } from "@wfx/ingest";

const source = await loadSourceConfig("./sources/ft-markets-rss.json");

for await (const doc of runSource(source)) {
  // doc is a Document with provenance fully populated and dedup applied
  await translateAndPublish(doc);
}
```

Internally `runSource` does:
1. Validate the source config (Zod)
2. Look up the adapter implementation in the registry
3. Construct the adapter instance with its config
4. Fetch robots.txt if `respect: true`
5. Open the DocumentStore
6. Call `adapter.fetch(ctx)` and wrap the iterator with: rate limit → retry → robots check → dedup → provenance enrichment → store persistence → yield to consumer
7. Emit metrics events (`fetched`, `deduped`, `blocked`, `error`) via an `EventEmitter` for observability

---

## 9. Adapter registry

Adapters are registered at package load time. The package ships with a built-in registry but consumers can add custom adapters at runtime.

```ts
import { registerAdapter } from "@wfx/ingest";
import { MyCustomAdapter } from "./my-custom-adapter";

registerAdapter("my-custom", MyCustomAdapter);
```

This is the **scalability point**. Adding a new adapter (Bloomberg API, BLPAPI, an Instagram Graph adapter, a Refinitiv adapter, a custom company-internal feed) requires:
1. Implementing the `Source` interface
2. Defining a Zod schema for the adapter's `config` field
3. Calling `registerAdapter("name", AdapterClass)`

No changes to the core. No changes to other adapters. No changes to consumer code beyond writing a new JSON config.

---

## 10. Phase 1 adapters

Two adapters in v0.1, fully battle-tested before adding more.

### 10.1 RSS adapter (`adapter: "rss"`)

**Config:**
```ts
interface RssConfig {
  url: string;
  /** Skip items with body shorter than this (filters out stub feeds). */
  minBodyLength?: number;
  /**
   * If true, fetch the linked article URL and extract the full body
   * via cheerio + readability. If false, use only the RSS description.
   */
  extractFullArticle?: boolean;
  /** Selectors to use when extracting full articles. Optional override. */
  articleSelectors?: {
    title?: string;
    body?: string;
    publishedAt?: { selector: string; attr?: string };
    authors?: string;
  };
}
```

**Behavior:**
- Fetches the RSS/Atom feed via HTTP
- Parses with `fast-xml-parser` (small, no jsdom dep)
- Maps each item to a Document:
  - `externalId` ← RSS `<guid>` or `<link>`
  - `title` ← `<title>`
  - `body` ← `<description>` or `<content:encoded>`, converted to markdown via `turndown`
  - `publishedAt` ← `<pubDate>`
  - `authors` ← `<author>` or `<dc:creator>`
- If `extractFullArticle: true`, follow `<link>` and use cheerio + readability to extract the full body, replacing the stub description
- Honors `minBodyLength` to filter out stub items

### 10.2 Generic HTML scraper adapter (`adapter: "html"`)

**Config:**
```ts
interface HtmlConfig {
  /** URL of the listing page (e.g. a news index). */
  listUrl: string;
  /** Selectors used to find article links on the listing page. */
  list: {
    selector: string;        // CSS selector for <a> elements
    urlAttr?: string;        // default: "href"
    /** Optional pagination — follow next-page links up to N pages. */
    pagination?: {
      nextSelector: string;
      maxPages: number;
    };
  };
  /** Selectors used to extract the article from each linked page. */
  article: {
    title: string;
    body: string;
    publishedAt?: { selector: string; attr?: string; format?: string };
    authors?: string;
    /** Selectors to remove from the body before extraction (ads, nav, etc.). */
    strip?: string[];
  };
  /**
   * Transport tier:
   * - "http": fast path, plain HTTP + cheerio. Default.
   * - "playwright": JS-heavy sites. Phase 2.
   */
  transport?: "http" | "playwright";
  /** Convert extracted HTML body to markdown via turndown. Default: true. */
  toMarkdown?: boolean;
  /** Base URL for resolving relative links. Defaults to listUrl origin. */
  baseUrl?: string;
}
```

**Behavior:**
- Fetches the listing page with the configured transport
- Parses with cheerio
- Walks the listing selector to find article URLs
- For each URL, fetches the article page, extracts via the configured selectors, strips noise, converts to markdown
- `externalId` defaults to a sha256 of the canonical article URL
- Pagination: follow `nextSelector` links up to `maxPages` (default 1 = no pagination)

**Phase 1 transport = `http` only.** Playwright transport ships in Phase 2.

### 10.3 Sample source configs (Phase 1 deliverables)

To prove the abstraction, Phase 1 ships with 3–5 working source configs covering both adapters:

- `examples/ft-markets-rss.json` — FT Markets RSS
- `examples/reuters-business-rss.json` — Reuters Business RSS
- `examples/bloomberg-press-html.json` — Bloomberg press releases (static HTML, RSS-less)
- `examples/sec-edgar-rss.json` — SEC EDGAR filings RSS
- `examples/ecb-press-html.json` — European Central Bank press releases (static HTML)

These double as integration test fixtures (see §13).

---

## 11. Phase 2 adapters (planned, not specced here)

| Adapter | Notes |
|---|---|
| `youtube` | YouTube Data API v3 — official, free quota, no scraping |
| `reddit` | Reddit API — paid, low cost, official |
| `playwright` | HTML transport tier for JS-heavy sites |
| `apify` | Wraps Apify actors for legally-hairy social platforms (Instagram, Facebook). Apify handles ToS / anti-bot / rotating proxies as a service |
| `meta-graph` | Official Instagram / Facebook Graph API — only for accounts you own |

Phase 2 will get its own spec at `docs/specs/YYYY-MM-DD-data-sources-phase-2.md` once Phase 1 is solid.

---

## 12. Legal stance

Three principles, baked into the design:

1. **Respect robots.txt by default.** Opt-out is per-source, not global. Visible in the source config.
2. **Identify the bot.** Default user-agent is `wfx-ingest/1.0 (+https://wordwidefx.com/bot)`. Hosts can block us if they want.
3. **Prefer official feeds and APIs.** RSS first, official API second, scraping third, third-party providers (Apify, Bright Data) last. The package ships configs for the first three; for the fourth, the consumer integrates Apify themselves via the `apify` adapter (Phase 2).

The package **does not** ship with adapters that aggressively bypass anti-bot systems or violate clear ToS. For sources that require those techniques, the consumer chooses to integrate Apify (or similar) at their own legal risk.

---

## 13. Testing strategy

Two layers, both required.

### 13.1 Unit tests — canned fixtures
- Every adapter has fixture files at `tests/fixtures/<adapter>/<scenario>.{html,xml,json}`
- Tests load fixtures, run the adapter against a stub HTTP server (`undici` `MockAgent`), assert on the resulting Documents
- Fast (< 1s per adapter), runs on every commit, no network
- Validates: parsing, schema correctness, edge cases (missing fields, malformed inputs, pagination boundaries)

### 13.2 Live integration tests — real network
- A separate test suite at `tests/live/` that runs against real source URLs from the `examples/` configs
- Validates: actually-still-works, selectors haven't drifted, source not blocking us
- Runs on a nightly CI schedule (not per-commit) and on demand
- Failures here are warnings (not blocking) — they trigger investigation but don't break the build, because external sites change without notice

### 13.3 What we don't test
- We don't test the adapter registry mechanism beyond a basic smoke test
- We don't test the SQLite backend's correctness (trust SQLite)
- We don't fuzz the body extraction (trust cheerio/readability)

---

## 14. Package layout

```
packages/sources/                       (folder name; npm name = @wfx/ingest)
├── package.json                        name: "@wfx/ingest"
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                        public API exports
│   ├── core/
│   │   ├── types.ts                    Document, Source, FetchContext, etc.
│   │   ├── runner.ts                   runSource() orchestrator
│   │   ├── registry.ts                 adapter registry
│   │   ├── source-config.ts            JSON loading + Zod validation
│   │   └── primitives/
│   │       ├── rate-limit.ts
│   │       ├── retry.ts
│   │       ├── robots.ts
│   │       ├── etag-cache.ts           (uses the store)
│   │       └── dedup.ts                (uses the store)
│   ├── store/
│   │   ├── types.ts                    DocumentStoreBackend interface
│   │   ├── sqlite-store.ts             default backend
│   │   ├── gc.ts                       garbage collector
│   │   └── query.ts                    consumer-facing query API
│   └── adapters/
│       ├── rss/
│       │   ├── adapter.ts
│       │   ├── config.ts               Zod schema
│       │   └── extract.ts              article extraction helper
│       └── html/
│           ├── adapter.ts
│           ├── config.ts               Zod schema
│           └── extract.ts              cheerio + selector helpers
├── examples/                           sample source configs (also test fixtures)
│   ├── ft-markets-rss.json
│   ├── reuters-business-rss.json
│   ├── bloomberg-press-html.json
│   ├── sec-edgar-rss.json
│   └── ecb-press-html.json
└── tests/
    ├── unit/
    │   ├── rss.test.ts
    │   ├── html.test.ts
    │   ├── runner.test.ts
    │   ├── store.test.ts
    │   └── primitives/
    │       ├── rate-limit.test.ts
    │       ├── retry.test.ts
    │       └── robots.test.ts
    ├── fixtures/
    │   ├── rss/
    │   │   ├── ft-markets-sample.xml
    │   │   └── reuters-sample.xml
    │   └── html/
    │       ├── bloomberg-listing.html
    │       └── bloomberg-article.html
    └── live/
        └── examples.live.test.ts       runs against real URLs nightly
```

### Dependencies (kept minimal)
- `zod` — config validation
- `fast-xml-parser` — RSS parsing (no jsdom)
- `cheerio` — HTML parsing
- `turndown` — HTML → markdown
- `undici` — HTTP client (Node-native, fast)
- `better-sqlite3` — SQLite backend (synchronous, fastest)
- `p-queue` — concurrency / rate limit primitives

No `playwright`, no `puppeteer`, no `jsdom` in Phase 1.

---

## 15. Public API surface (what consumers import)

```ts
// High-level
export { runSource, loadSourceConfig, openStore } from "@wfx/ingest";

// Types
export type { Document, Source, SourceConfig, Provenance, FetchContext } from "@wfx/ingest";

// Adapter authoring
export { registerAdapter } from "@wfx/ingest";
export type { DocumentStoreBackend } from "@wfx/ingest";

// Built-in adapters (re-exported for advanced use)
export { RssAdapter } from "@wfx/ingest/adapters/rss";
export { HtmlAdapter } from "@wfx/ingest/adapters/html";
```

That's the entire surface. ~10 exports. No god objects.

---

## 16. Consumer usage examples

### 16.1 FinFlow content pipeline

```ts
// packages/api/src/content-pipeline/ingest-stage.ts
import { runSource, loadSourceConfig } from "@wfx/ingest";
import { runTranslationEngine } from "../pipeline/translation-engine.js";

const sources = [
  await loadSourceConfig("./sources/reuters-fx.json"),
  await loadSourceConfig("./sources/ecb-press.json"),
  await loadSourceConfig("./sources/sec-edgar.json"),
];

for (const source of sources) {
  for await (const doc of runSource(source)) {
    if (!isRelevantToInstruments(doc, profile.instruments)) continue;
    const translated = await runTranslationEngine(doc.body, clientId, "es", { profileStore });
    await persistReport(doc, translated);
  }
}
```

The translation engine sees `doc.body` (markdown) the same way it sees a `.docx` file's extracted text — no engine changes needed.

### 16.2 Robuust content pipeline

```ts
// robuust/src/ingest-loop.ts
import { runSource, loadSourceConfig, openStore } from "@wfx/ingest";

const blogSources = await Promise.all([
  loadSourceConfig("./sources/dog-crate-pro-blog.json"),
  loadSourceConfig("./sources/k9-magazine-rss.json"),
  // YouTube source added in phase 2
]);

for (const source of blogSources) {
  for await (const doc of runSource(source)) {
    const ideas = await brainstormContentFrom(doc, robuustBrandVoice);
    const draft = await generateBlogPost(ideas);
    const translatedVersions = await translateToAll(draft, ["en", "nl", "de", "es"]);
    await schedulePublishing(translatedVersions);
  }
}
```

Same package, completely different domain. Zero shared knowledge with FinFlow.

### 16.3 Re-processing without re-fetching

```ts
// Batch re-translate everything from the last 7 days
const store = await openStore();
const recent = await store.query({
  sourceId: "reuters-fx",
  publishedAfter: new Date(Date.now() - 7 * 86400_000),
});

for (const doc of recent) {
  await runTranslationEngine(doc.body, clientId, "es", { profileStore });
}
```

This is what makes the persistence layer worth its complexity — replay is free.

---

## 17. Open questions / decisions deferred

These don't block writing the spec but should be answered before writing code, OR can be answered as the code reveals the right answer:

1. **Monorepo vs separate repo** — Phase 1 lives in `wordwideAI/packages/sources/` (decided 2026-04-07). Extraction trigger: when Robuust kicks off as its own repo, or when a third consumer appears.
2. **npm publishing** — defer until extraction. Until then, consumers in this monorepo import via Bun workspace path.
3. **Logging integration** — Phase 1 uses a simple `Logger` interface. Defer pino/winston/etc. integration to consumers.
4. **Metrics emission** — Phase 1 emits events via Node `EventEmitter`. Defer Prometheus/OTel integration to consumers.
5. **Source config storage** — Configs live behind the `SourceConfigStore` interface (§5.4). Two backends ship in Phase 1: `FileSourceConfigStore` (standalone consumers, dev) and `PostgresSourceConfigStore` (FinFlow). The CRUD UI is a feature on top of `PostgresSourceConfigStore` and is mandatory for FinFlow's launch (see §18).
6. **Multi-tenant isolation** — Two-layer model. See `2026-04-07-deployment-stack.md` §3 for the deploy modes.
   - **Standalone consumers** (Robuust, dev rigs, tests): `tenantId` and `scope` can be ignored. All sources behave as `scope: 'shared'` with `tenantId` undefined. Phase 1 supports this fully.
   - **FinFlow** (both Mode A shared SaaS and Mode B dedicated VM): every `Source` carries `scope: 'shared' | 'tenant'` (§5.2). Shared sources (the vast majority — Reuters, FT, Bloomberg, ECB, SEC) are fetched once globally and stored with `tenant_id = NULL`; the FinFlow content pipeline filters them per-tenant via the impact classifier (see `2026-04-07-content-pipeline.md`). Tenant-private sources (a client's own RSS, a bespoke Apify actor) are fetched per tenant and stored with `tenant_id = <id>`. Both classes coexist in the same `documents` table; the dedup key includes `tenant_id` so the two cases are correct simultaneously.
   - **Why two layers**: cost. Scraping Reuters scales with sources, not with tenants. If 50 tenants all want Reuters FX, we fetch it once and let the impact classifier decide per-tenant relevance — paying for 50 cheap Haiku classifications instead of 50 expensive scrapes.
7. **Body normalization edge cases** — what to do with PDFs linked from RSS items? Phase 1 skips them; Phase 2 may add a `pdf` body extractor.
8. **Should the package ship a CLI?** (e.g. `wfx-ingest run ./sources/ft.json`). Useful for ops/debugging. Defer to Phase 1.5 if there's demand.

---

## 18. What's NOT in this spec (and why)

- **Specific HTTP retry logic for individual hosts** — handled by the generic retry primitive
- **A web UI for managing sources** — not a `@wfx/ingest` concern. The package exposes the `SourceConfigStore` interface and the runner's metric events; it does not ship a UI. **However, FinFlow (the consumer) ships a mandatory source-management dashboard** built on top of those primitives. Clients must be able to: see which sources are connected (per tenant), see scraping activity and recent documents, see which incoming documents triggered which content generation jobs, pause/enable individual sources, and (for tenant-private sources) add or edit their own. This is a **launch requirement** for FinFlow Mode A and Mode B, not a "Phase 2 if anyone asks" item. See the FinFlow content-pipeline spec for the full UI surface.
- **Webhook ingest** (push instead of pull) — Phase 3+; the Source interface assumes pull
- **Real-time streaming sources** (FIX feeds, WebSocket market data) — different shape, may need a separate `@wfx/streams` package
- **Authentication** for sources requiring API keys — Phase 1 supports `headers` via the source config; full credential management deferred
- **Idempotency guarantees** beyond dedup — if the consumer crashes mid-pipeline, the document is in the store but the consumer's downstream state may be inconsistent. The consumer owns transactional integrity.

---

## 19. Implementation order (Phase 1)

Mapped to SB tasks #102–#117:

1. **#102 Scaffold** — `packages/sources/` skeleton, `package.json`, `tsconfig.json`, README
2. **#103 Core types** — `core/types.ts` with `Document`, `Source`, `SourceConfig`, `FetchContext`
3. **#104 Document type with provenance** — same as #103, called out as a separate task in the SB roadmap
4. **#107 Rate limiter primitive**
5. **#108 Retry/backoff primitive**
6. **#109 robots.txt primitive**
7. **#111 Dedup primitive** — depends on store
8. **#110 ETag caching** — depends on store
9. **(implicit) DocumentStore + SQLite backend** — *not in the original SB task list, needs adding*
10. **(implicit) Source runner + adapter registry** — *not in the original SB task list, needs adding*
11. **#105 RSS adapter**
12. **#106 HTML scraper adapter (cheerio)**
13. **#112 Adapter tests** — fixtures for both adapters
14. **#113 README**
15. **(implicit) Example source configs** — 5 sample JSON configs

**Note for SB roadmap update:** the existing #102–#113 list is missing two non-trivial work items:
- **DocumentStore + SQLite backend + GC** (substantial — should be 2–3 SB tasks)
- **Source runner + adapter registry** (the orchestration layer that ties primitives + adapters together)

These need to be added before the implementation phase starts. Listed in §20.

---

## 20. SB roadmap delta (proposed)

Add to workstream B (`workstream:sources`):

- **B-NEW-1** DocumentStore interface + SQLite backend
- **B-NEW-2** TTL garbage collector
- **B-NEW-3** DocumentStore consumer query API
- **B-NEW-4** Source runner (runSource orchestrator)
- **B-NEW-5** Adapter registry + JSON config loader
- **B-NEW-6** 5 example source configs (FT, Reuters, Bloomberg press, SEC, ECB)
- **B-NEW-7** Live integration test suite (nightly)

That brings Phase 1 to ~23 tasks (16 existing + 7 new). Realistic for a focused single-developer sprint.

---

## 21. Acceptance criteria (Phase 1 done = these all pass)

1. ✅ `packages/sources/` builds with `bun run typecheck` (zero `any`, strict mode)
2. ✅ Unit test suite runs in < 5s, all green
3. ✅ Live integration suite runs successfully against all 5 example sources (≥ 1 doc each)
4. ✅ FinFlow content pipeline can ingest from at least 1 RSS + 1 HTML source and feed translated docs through `runTranslationEngine`
5. ✅ Re-running a source on the same data produces zero new documents (dedup works)
6. ✅ DocumentStore size after a 24h run with 5 sources is bounded by configured TTLs
7. ✅ A robots.txt-blocked URL is skipped, not crashed
8. ✅ A 429 response triggers retry with the host's `Retry-After` value honored
9. ✅ A new adapter can be added without modifying any file in `core/`
10. ✅ The package has zero imports from `@finflow/api`, `finflow/`, or any FinFlow-specific module

---

## 22. Sign-off

| Role | Name | Status |
|---|---|---|
| Product / direction | Albert Galera | Pending review |
| Architecture | Albert Galera + Claude | Drafted 2026-04-07 |
| Implementation lead | TBD | — |

Once this spec is approved, work proceeds against the SB tasks in §19 order on dedicated branches off master.

---

## 23. Reconciliation with `2026-04-07-deployment-stack.md`

The deployment-stack spec was written **after** this one and locked four decisions that touch ingest. This section records the reconciliation so the two specs do not drift.

| # | Deployment-stack decision | Impact on this spec | Resolved by |
|---|---|---|---|
| 1 | **Postgres is the canonical app DB** for both SaaS and appliance deploys (§4 of stack spec) | Running SQLite for ingest alongside Postgres for the app means two databases, two backup paths, and no doc↔translation joins | §7.4 — `PostgresStore` promoted from "planned" to "required for FinFlow integration." Must land before the FinFlow content pipeline wires `@wfx/ingest` into `runTranslationEngine`. SQLite stays as the default for standalone consumers. |
| 2 | **SaaS is multi-tenant from launch** (§3 of stack spec) | Phase 1 originally punted multi-tenancy to "Phase 3+" (old §17.6) | §5.1 — `tenantId?: string` added to `Document` from day one. §17.6 — split answer: appliance = single-tenant (unchanged), SaaS = `tenantId` mandatory on `Document`/`Source`/store schema, hard prerequisite for SaaS launch. Backend + runner work, not a type change. |
| 3 | **`pgvector` reserved for future RAG over translation memory and news corpora** (§4 of stack spec) | The news corpus *is* the ingest DocumentStore; the Postgres backend should be RAG-ready when it lands | §7.2 — schema comment notes the Postgres backend reserves a nullable `embedding vector(1536)` column. No work today; future RAG attaches without a migration. |
| 4 | **Background jobs use BullMQ + Redis when the scheduler arrives** (§4 of stack spec) | Already consistent with §2 ("Job scheduling lives in the consumer's BullMQ / cron / Hono route") | No change — both specs agree. |
| 5 | **We always operate the deploy; no self-installable software** (stack spec §2/§3) | The previous "appliance" wording in §17.6 was wrong — there is no client-installed mode | §17.6 rewritten in terms of standalone consumers vs FinFlow, not "appliance vs SaaS." Both FinFlow modes are us-operated. |
| 6 | **Sources are filtered per-tenant by causal impact, not by topic match** (content-pipeline spec) | The package fetches once globally for shared sources; relevance is the consumer's job. The two-layer dedup model (`scope: 'shared' \| 'tenant'`) is what makes this work. | §5.1, §5.2, §7.2, §17.6 — all updated for the shared/tenant-private split. Per-tenant impact scoring stays in `2026-04-07-content-pipeline.md`. |
| 7 | **Mandatory consumer UI for source management and scraping visibility** (this conversation, 2026-04-07) | Configs cannot live in JSON files on disk for FinFlow; clients must see and audit their sources via the dashboard | §5.4 added (`SourceConfigStore` interface), §17.5 superseded, §18 updated to call out the consumer-side UI as a launch requirement. The package itself still ships no UI. |

**Things that look like conflicts but are not:**

- LLM provider abstraction (Vercel AI SDK over Anthropic/OpenAI/Google) — `@wfx/ingest` does not call LLMs at all. Untouched.
- Frontend stack (React/Vite/Tailwind) — ingest is server-only. Untouched.
- Bun runtime — `better-sqlite3` and all listed dependencies work on Bun. Untouched.
- Folder name `packages/sources/` vs npm name `@wfx/ingest` — both specs agree.

**If the deployment-stack spec changes**, this section must be updated. Treat it as the integration contract between the two documents.
