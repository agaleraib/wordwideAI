# `@wfx/publishers` — Universal Output Publishing Package

**Date:** 2026-04-07
**Status:** Draft (spec only — no code yet)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (architecture), Claude (drafting)
**Companion specs:**
- `2026-04-07-data-sources.md` — `@wfx/ingest`, the architectural mirror image of this package on the input side
- `2026-04-07-content-pipeline.md` — the FinFlow consumer that will be the first user
- `2026-04-07-content-uniqueness.md` — the gate that runs immediately upstream
- `2026-04-07-deployment-stack.md` — runtime, DB, deploy modes

---

## 1. Goal

Build a **domain-neutral, reusable** package that takes finalized content and publishes it to heterogeneous output channels (Telegram, email, WordPress, Discourse, Instagram, webhooks, …) with idempotency, retry, rate limiting, audit, and delivery confirmation.

The package is the **mirror image of `@wfx/ingest`** — same architectural shape, same registry pattern, same primitives, but in the other direction. It is the output adapter layer for **multiple unrelated projects**:

- **FinFlow** — analyses, market alerts, newsletters → broker websites, Telegram channels, email subscribers
- **Robuust** (dog crate company) — generated blog posts → WordPress, Instagram, email
- **Future projects** — anything that needs "take this content, push it to these channels, give me back receipts"

The package never decides **what** to publish, **whether** to publish, **when** to publish, or **how to creatively re-shape** content for a target channel. It is **plumbing**, not policy.

---

## 2. Non-goals

| Out of scope | Lives where |
|---|---|
| Content generation, conformance, uniqueness gating | FinFlow / Robuust app code |
| **Creative re-shaping of content for a channel** (e.g., re-writing a 2,000-word analysis as a Twitter thread) | Consumer apps. The pipeline that produced the content should have produced it in the right shape via the right identity agent. See §3.3. |
| Job scheduling / cron / "publish at 9am tomorrow" | Consumer's BullMQ / cron / scheduler. Publishers are stateless "publish now" operations. |
| Domain knowledge (which audiences want which content) | Consumer apps |
| Auth UX (OAuth dance, account linking screens) | Consumer apps. The package consumes credentials; it does not collect them. |
| Compliance / legal review of published content | Already done upstream by the FinFlow compliance gate (or equivalent in other consumers) |
| Cross-channel update/delete propagation | v2 — Phase 1 publish is one-shot |
| Analytics (read counts, engagement metrics, click-throughs) | Future `@wfx/analytics` package or external tools (GA, Mixpanel) |
| Inbound message handling (replies, comments, DMs) | Out of scope entirely — publishers are write-only |

---

## 3. Terminology

- **Channel** — a kind of output destination (Telegram, email, WordPress, …)
- **Adapter** — the implementation for a channel kind. One adapter per channel type, similar to `@wfx/ingest` source adapters.
- **PublishTarget** — a configured destination (e.g. "FinFlow Spanish Telegram channel @finflow-es", "client X's WordPress at example.com/blog", "newsletter@brokerage.com SMTP relay"). One adapter can power many targets via different configs/credentials.
- **PublishJob** — one request to publish one `Content` to one `PublishTarget`. The unit of work and the unit of idempotency.
- **PublishReceipt** — the result of a successful publish: channel-specific identifiers (Telegram message_id, WordPress post URL, email Message-ID, webhook response code), timestamps, and provenance.
- **Channel format** — the wire format the channel speaks (Markdown for Telegram and Discourse; HTML/Gutenberg for WordPress; multipart MIME for email; JSON for webhook). Adapters handle the *transport-level* formatting concerns (escaping, length limits, line breaks). They do **not** creatively rewrite content.

### 3.1 The "channel-specific content" question

A common architectural mistake in publisher layers is to put creative content adaptation inside the publisher: "the publisher should be able to take a long blog post and turn it into a Twitter thread." This package **deliberately rejects that responsibility.**

Instead, the principle is: **the upstream content pipeline produces content in the shape its target channel needs, by picking the right identity agent.** A pipeline that wants Twitter-thread output uses a `TwitterThreadIdentity` agent (a future addition to the FinFlow content pipeline's identity registry); a pipeline that wants a Telegram alert uses `TradingDesk`; a pipeline that wants a WordPress blog post uses `BeginnerBlogger` or `InHouseJournalist`. The publisher then performs only **transport-level** transformation:

| Transformation | In scope? | Notes |
|---|---|---|
| Length truncation to channel maximum | ✓ | Telegram 4096 chars, Twitter 280 chars per post, etc. Truncation strategy is configurable per target (truncate / split / reject). |
| Markdown ↔ HTML ↔ plain-text conversion | ✓ | Mechanical, bounded, no creative judgment |
| Line break normalization | ✓ | Channel-specific (Telegram vs email vs Discourse) |
| Image/attachment handling (when supplied with the content) | ✓ | Pass through, basic encoding |
| Adding channel-required boilerplate (footers, unsubscribe links) | ✓ | Configured per target, deterministic |
| **Re-writing the content body** | ✗ | Belongs in the upstream content pipeline |
| **Choosing what to leave out** | ✗ | Belongs in the upstream content pipeline |
| **Auto-generating a "Twitter thread version" of a long article** | ✗ | This is creative re-shaping; the upstream pipeline should have produced a thread directly via a thread-shaped identity agent |

This rule keeps the package small and the responsibility split clean. If a client wants the same idea published to both their WordPress blog AND their Telegram channel, that is **two pipelines, two identity agents, two PublishJobs** — not one pipeline whose publisher creatively forks it.

(Pipeline chaining — output of pipeline A becomes input to pipeline B for "publish the WordPress URL to Telegram as a teaser" — is the v2 workflow that solves the cross-channel use case cleanly. v1 ships without it; clients duplicate pipelines.)

---

## 4. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      @wfx/publishers                             │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Telegram │  │  Email   │  │WordPress │  │ Webhook  │ ← adapt │
│  │ adapter  │  │ adapter  │  │ adapter  │  │ adapter  │   (regis│
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   try)  │
│       └─────────────┼─────────────┼─────────────┘                │
│                     ▼             ▼                              │
│            ┌────────────────────────────┐                        │
│            │      Publisher runner      │ ← orchestrates adapter│
│            │                            │   + primitives         │
│            └─────────────┬──────────────┘                        │
│                          │                                       │
│       ┌──────────────────┼──────────────────┬──────────┐         │
│       ▼                  ▼                  ▼          ▼         │
│  ┌─────────┐      ┌─────────────┐      ┌────────┐ ┌─────────┐   │
│  │  Idem-  │      │  Retry /    │      │  Rate  │ │ Channel │   │
│  │ potency │      │  backoff    │      │ limit  │ │ format  │   │
│  └─────────┘      └─────────────┘      └────────┘ └─────────┘   │
│                                                                  │
│            ┌────────────────────────────┐                        │
│            │   PublishJobStore          │ ← persistence          │
│            │   (Postgres / SQLite)      │   + receipts           │
│            └────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘
                       │
                       ▼ PublishReceipt
              ┌────────────────┐
              │  Consumer app  │  (FinFlow, Robuust, ...)
              │  records       │
              │  receipt,      │
              │  dispatches    │
              │  next job, etc │
              └────────────────┘
```

The package exports a single high-level entry point (`runPublishJob(content, target)`) plus the registry, the store interface, and the type contracts. Same architectural shape as `runSource` in `@wfx/ingest`.

---

## 5. Core types

### 5.1 `Content`

The unit of input to the publisher. Mandatory fields are minimal so any consumer can produce them.

```ts
export interface Content {
  /** Stable identifier from the consumer. Used for idempotency. Required. */
  contentId: string;

  /** Optional tenant scope. FinFlow always sets it; standalone consumers may leave undefined. */
  tenantId?: string;

  /** Human-readable title. Required for most channels. */
  title: string;

  /** The body. Already in the shape the target channel expects (see §3.1). */
  body: string;

  /** Wire format hint for the body — drives transport-level conversion. */
  bodyFormat: 'text' | 'markdown' | 'html';

  /** ISO-639-1 language code. */
  language: string;

  /** Optional attachments. Adapters that don't support them ignore (or reject). */
  attachments?: Attachment[];

  /** Channel-agnostic call-to-action — adapters insert per target config. */
  cta?: {
    text: string;
    url?: string;
  };

  /**
   * Provenance — non-negotiable. Proves which upstream content this came from.
   * For FinFlow, points back to (event_id, brief_id, generated_content_id).
   */
  provenance: ContentProvenance;

  /**
   * Channel hints — optional metadata the consumer can pass through to specific
   * adapters. The package never types or validates this. Examples:
   *   { telegram: { silentNotification: true, replyToMessageId: 12345 } }
   *   { wordpress: { categoryIds: [4, 7], featuredImageId: 42 } }
   *   { email:     { listId: 'newsletter-en', segmentTag: 'pro-traders' } }
   */
  channelHints?: Record<string, Record<string, unknown>>;
}

export interface Attachment {
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'file';
  /** Either a URL the adapter can fetch, or inline base64 data. */
  source: { type: 'url'; url: string } | { type: 'inline'; mimeType: string; data: string };
  alt?: string;
  caption?: string;
}

export interface ContentProvenance {
  /** Free-form consumer-defined origin id (e.g. FinFlow's generated_content_id). */
  contentSystemId: string;
  /** Consumer system name (e.g. "finflow", "robuust"). */
  source: string;
  /** Generation timestamp from the upstream system. */
  generatedAt: Date;
  /** Optional upstream chain — events, briefs, etc. Free-form. */
  upstreamRefs?: Record<string, string>;
}
```

### 5.2 `PublishTarget`

A configured destination. Adapters consume this. Same envelope shape as `SourceConfig` from `@wfx/ingest`.

```ts
export interface PublishTarget<TConfig = unknown> {
  /** Stable identifier. */
  readonly id: string;

  /** Adapter kind. */
  readonly adapter: string;

  /** Owning tenant. Always set for FinFlow; optional for standalone consumers. */
  readonly tenantId?: string;

  /** Resolved adapter config (parsed JSON). */
  readonly config: TConfig;

  /** Credentials, decrypted at the boundary, never logged. */
  readonly credentials: CredentialBundle;

  /** Per-target rate limit override. */
  readonly rateLimit?: RateLimitConfig;

  /** Per-target retry policy override. */
  readonly retry?: RetryConfig;

  /** Whether this target is enabled. Disabled targets are skipped silently. */
  readonly enabled: boolean;

  /** Human-readable label, shown in the dashboard. */
  readonly label?: string;

  /** Optional description. */
  readonly description?: string;
}
```

`CredentialBundle` is a discriminated-union sealed envelope:

```ts
export type CredentialBundle =
  | { kind: 'bearer-token'; token: string }
  | { kind: 'api-key'; key: string; secret?: string }
  | { kind: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt?: Date }
  | { kind: 'smtp'; host: string; port: number; user: string; pass: string }
  | { kind: 'webhook-hmac'; secret: string }
  | { kind: 'none' };
```

The package **never** persists credentials in plaintext. Stores must encrypt credential blobs at rest (see §7). The package's runtime sees decrypted credentials only inside the adapter call boundary; logging is sanitized so credentials never reach stdout, audit entries, or error messages.

### 5.3 `PublishJob` and `PublishReceipt`

```ts
export interface PublishJob {
  /** Generated by the runner. UUID. */
  jobId: string;

  /** What to publish. */
  content: Content;

  /** Where to publish. */
  target: PublishTarget;

  /**
   * Idempotency key — stable for a logical "publish this content to this target"
   * intent. Default: sha256(contentId + targetId). The runner refuses to publish
   * twice with the same key; a duplicate request returns the existing receipt.
   */
  idempotencyKey: string;

  /** When the job was queued. */
  enqueuedAt: Date;

  /** When the job was actually executed (set on completion). */
  executedAt?: Date;

  /** Lifecycle state. */
  state: 'queued' | 'in-flight' | 'succeeded' | 'failed-transient' | 'failed-permanent' | 'duplicate';

  /** Set on success. */
  receipt?: PublishReceipt;

  /** Set on failure. */
  error?: PublishError;

  /** Number of attempts so far (1 = first try). */
  attempts: number;
}

export interface PublishReceipt {
  /** Channel-assigned identifier — message_id, post_id, Message-ID, webhook 200, etc. */
  channelId: string;

  /** Public URL if applicable. */
  url?: string;

  /** When the channel acknowledged the publish. */
  publishedAt: Date;

  /** Adapter kind. */
  adapter: string;

  /** Free-form channel-specific extras (Telegram chat info, WordPress permalink, …). */
  meta?: Record<string, unknown>;
}

export interface PublishError {
  /** Categorization for the runner's retry policy. */
  category:
    | 'auth'              // permanent — credentials invalid; do not retry
    | 'rate-limit'        // transient — back off and retry, honor Retry-After
    | 'transient-network' // transient — backoff/retry
    | 'channel-rejected'  // permanent — content rejected by the channel; escalate
    | 'config'            // permanent — target misconfigured
    | 'unknown';          // transient by default
  message: string;
  channelStatus?: number;       // HTTP status if applicable
  channelResponse?: string;     // raw channel response, sanitized
  retryAfterSeconds?: number;   // for rate-limit category
}
```

### 5.4 `Adapter` interface

Adapters implement this. Intentionally narrow.

```ts
export interface Adapter<TConfig = unknown> {
  /** Adapter kind id. Must match `PublishTarget.adapter`. */
  readonly kind: string;

  /** Zod schema for the adapter's `config` field. The runner validates with this. */
  readonly configSchema: ZodSchema<TConfig>;

  /** Allowed credential kinds. Used for compile-time + runtime validation. */
  readonly credentialKinds: ReadonlyArray<CredentialBundle['kind']>;

  /**
   * Publish one piece of content to the configured target.
   * The runner wraps this with idempotency, rate limit, retry, format conversion,
   * audit, and receipt persistence — adapters do not implement those concerns.
   */
  publish(content: Content, target: PublishTarget<TConfig>, ctx: PublishContext): Promise<PublishReceipt>;

  /** Optional health check (used by the dashboard). */
  healthCheck?(target: PublishTarget<TConfig>): Promise<HealthStatus>;

  /**
   * Optional pre-flight validation. Runs before `publish` to catch obvious problems
   * (content too long, missing required field, image format unsupported) without
   * burning a real API call. Returns `null` if OK, or a list of issues.
   */
  preflightValidate?(content: Content, target: PublishTarget<TConfig>): PublishIssue[] | null;
}

export interface PublishContext {
  log: Logger;
  signal: AbortSignal;
  /**
   * Helper to fetch attachments. Wraps `undici` with retry and timeout. Adapters
   * use this instead of raw fetch so attachments inherit the runner's policy.
   */
  fetchAttachment(source: Attachment['source']): Promise<{ mimeType: string; bytes: Uint8Array }>;
}

export interface PublishIssue {
  severity: 'warn' | 'error';
  field: string;
  message: string;
}
```

### 5.5 `PublishTargetStore`

Targets live behind an interface — same pattern as `SourceConfigStore`. This is what enables the FinFlow dashboard's "manage publishing destinations" UI.

```ts
export interface PublishTargetStore {
  list(filter?: { tenantId?: string; adapter?: string; enabled?: boolean }): Promise<PublishTarget[]>;
  get(id: string, tenantId?: string): Promise<PublishTarget | null>;
  put(target: PublishTarget): Promise<void>;
  delete(id: string, tenantId?: string): Promise<void>;
  watch?(handler: (event: PublishTargetEvent) => void): () => void;
}
```

Two implementations ship in Phase 1:

| Implementation | Use case |
|---|---|
| `FilePublishTargetStore` | Standalone consumers, dev rigs, tests. JSON files on disk; credentials are read from a sibling `.env` file referenced by name (never inlined). |
| `PostgresPublishTargetStore` | FinFlow Mode A and Mode B. Stores targets in a `publish_targets` table with credential blobs encrypted at rest using a tenant-scoped key. |

The `PostgresPublishTargetStore` is the production backend for FinFlow because the dashboard's CRUD UI is mandatory at launch — clients must be able to add, edit, test, and remove their publishing destinations from the web UI without operator involvement.

---

## 6. Built-in primitives

These wrap every adapter automatically. Adapters do not implement them.

### 6.1 Idempotency

- `idempotencyKey = sha256(contentId + targetId)` by default; consumer can override.
- Before invoking the adapter, the runner checks `publish_jobs` for an existing row with the same key.
- **Hit (succeeded)** — return the cached receipt, mark the new job `state: 'duplicate'`. Adapter is not called.
- **Hit (in-flight)** — wait briefly, then return `'duplicate'`; the original in-flight job will produce the receipt.
- **Hit (failed-permanent)** — return the failed result; the consumer must explicitly mint a new idempotency key (e.g., after fixing the content) to retry.
- **Miss** — proceed to adapter call; persist the new row.

This is the most important primitive in the package. **Double-publishing is the worst possible failure mode** — clients see duplicate alerts in their channels and trust evaporates. The idempotency layer is non-bypassable.

### 6.2 Rate limiting

- Token bucket per `(targetId, channel)` tuple.
- Per-target `rateLimit.requestsPerMinute` and `concurrent` from target config; per-adapter sane defaults.
- Defaults are conservative — Telegram bot API allows 30/sec but we default to 20/min per target to leave headroom for the bot's other uses.
- On 429 from a channel, the runner honors `Retry-After` and updates its bucket dynamically.

### 6.3 Retry / backoff

- Categorized retry: **transient** errors (network, 5xx, rate-limit-with-Retry-After) retry with exponential backoff. **Permanent** errors (auth invalid, content rejected, config error) **do not retry** and escalate to consumer immediately.
- Defaults: 5 attempts, 2s base, 2× multiplier, 5min cap, jittered.
- After max attempts, the job goes to `state: 'failed-transient'` and the consumer can manually retry it from the dashboard (which mints a fresh idempotency key fragment to bypass the cached failed row).

### 6.4 Channel format conversion

- Each adapter declares which body formats it accepts (`'markdown' | 'html' | 'text'`).
- The runner converts the content body if needed: HTML→Markdown via `turndown`, Markdown→HTML via `markdown-it`, anything→plain text by stripping tags.
- Conversion happens **before** the adapter's `publish` call. Adapters always see the body in their preferred format.
- **No creative re-shaping ever happens at this layer.** Conversion is mechanical and bounded.

### 6.5 Length truncation

- Each adapter declares its channel's hard length limit (Telegram 4096, Twitter 280, etc.).
- Per-target `truncationStrategy: 'reject' | 'truncate' | 'split'`. Default: `'reject'` for v1 — fail loudly rather than silently shipping a half-truncated post.
- `'split'` is reserved for future thread-aware adapters (Twitter, Bluesky); not implemented in Phase 1.

### 6.6 Audit and event emission

- Every job emits events on a Node `EventEmitter`: `job.queued`, `job.in-flight`, `job.succeeded`, `job.failed-transient`, `job.failed-permanent`, `job.duplicate`, `adapter.attempt`, `rate-limit.waited`, `auth.refresh-needed`.
- Every job persists to `publish_jobs` (§7) with: state, attempts, error category, sanitized response, receipt, timestamps.
- Events are what the FinFlow dashboard's "publishing activity" view consumes.

---

## 7. PublishJobStore

The package's persistence layer. **First-class concept**, not just a job queue.

### 7.1 Responsibilities

1. Persist publish jobs (input + state + receipt + error)
2. Provide idempotency lookup by `idempotencyKey`
3. Power the dashboard's "publishing activity" view (history, retries, failures)
4. Support manual retry of failed jobs from the dashboard
5. Encrypt credential blobs at rest (when paired with `PublishTargetStore`)

### 7.2 Schema (default Postgres backend; SQLite backend mirrors with adjustments)

```sql
CREATE TABLE publish_jobs (
  job_id              TEXT PRIMARY KEY,
  tenant_id           TEXT,                    -- nullable for standalone consumers
  target_id           TEXT NOT NULL,
  content_id          TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  state               TEXT NOT NULL,           -- queued|in-flight|succeeded|failed-transient|failed-permanent|duplicate
  attempts            INTEGER NOT NULL DEFAULT 0,
  enqueued_at         TIMESTAMPTZ NOT NULL,
  executed_at         TIMESTAMPTZ,
  -- Receipt (set on success)
  receipt             JSONB,
  -- Error (set on failure)
  error               JSONB,
  -- Provenance for audit
  content_provenance  JSONB NOT NULL,
  adapter             TEXT NOT NULL,
  CONSTRAINT publish_jobs_idempotency
    UNIQUE (idempotency_key)
);

CREATE INDEX idx_pj_tenant_state ON publish_jobs(tenant_id, state);
CREATE INDEX idx_pj_target_state ON publish_jobs(target_id, state);
CREATE INDEX idx_pj_content ON publish_jobs(content_id);
CREATE INDEX idx_pj_enqueued ON publish_jobs(enqueued_at DESC);

CREATE TABLE publish_targets (
  target_id           TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  adapter             TEXT NOT NULL,
  label               TEXT NOT NULL,
  description         TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  config              JSONB NOT NULL,           -- non-secret configuration
  credentials_enc     BYTEA NOT NULL,           -- encrypted CredentialBundle
  credentials_kind    TEXT NOT NULL,            -- discriminator without exposing data
  rate_limit          JSONB,
  retry_policy        JSONB,
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  last_health_check   TIMESTAMPTZ,
  last_health_status  TEXT
);

CREATE INDEX idx_pt_tenant_enabled ON publish_targets(tenant_id, enabled);
CREATE INDEX idx_pt_adapter ON publish_targets(adapter);
```

### 7.3 Credential encryption

- **At rest**: `credentials_enc` is encrypted with AES-256-GCM. The encryption key is **per-tenant** and derived from a master key (held in env / secrets manager) plus the `tenant_id` via HKDF.
- **In transit (process memory)**: decrypted at the boundary of the runner, passed by reference to the adapter, never logged.
- **Rotation**: rotating the master key requires re-encrypting all tenant rows. Rotation procedure is documented in `docs/runbooks/credential-rotation.md` (to be written when the first credential rotation is needed).
- **Sanitization**: a `redact()` helper strips known credential patterns from any string before it can reach logs, audit blobs, or error messages.

### 7.4 Pluggable backend

- Default: `PostgresPublishStore` (production).
- Test/dev: `MemoryPublishStore` for unit tests; `SQLitePublishStore` for standalone consumers.
- Interface: `PublishJobStoreBackend` — `enqueue`, `update`, `getByIdempotencyKey`, `getByJobId`, `listByTarget`, `listByTenant`.

---

## 8. Publisher runner

The high-level entry point.

```ts
import { runPublishJob, openStore } from "@wfx/publishers";

const store = await openStore({ kind: 'postgres', connectionString: process.env.DATABASE_URL! });
const target = await store.targets.get('finflow-es-telegram', tenantId);

const job = await runPublishJob({
  content,           // shaped upstream by FinFlow's content pipeline
  target,
  store,
});

if (job.state === 'succeeded') {
  console.log(`Published to ${job.receipt!.url}`);
} else if (job.state === 'duplicate') {
  console.log(`Already published; receipt: ${job.receipt!.url}`);
} else {
  console.error(`Publish failed: ${job.error!.category}`);
}
```

Internally `runPublishJob` does:

1. Validate `content` (Zod) and `target` (Zod for the adapter's config schema)
2. Compute `idempotencyKey` (default = `sha256(content.contentId + target.id)`)
3. Look up by idempotency key — return early on hit
4. Look up the adapter implementation in the registry
5. Run the adapter's optional `preflightValidate`; abort with `failed-permanent` on errors
6. Decrypt credentials at the boundary
7. Convert body format if needed (§6.4)
8. Apply length truncation per target policy (§6.5)
9. Acquire rate-limit token (§6.2)
10. Call `adapter.publish` inside a try/catch with retry wrapper (§6.3)
11. On success: persist receipt, emit `job.succeeded`, return job
12. On failure: categorize, persist error, emit appropriate event, return job
13. **Never logs credentials.** Every log line passes through `redact()`.

The runner is **stateless and re-entrant** — calling `runPublishJob` twice with the same content+target is safe (the second call returns `'duplicate'`). This is what makes the package usable from any consumer architecture (queue worker, Hono route handler, cron job, etc.) without coordination.

---

## 9. Adapter registry

Same pattern as `@wfx/ingest`. Built-in registry plus runtime extension.

```ts
import { registerAdapter } from "@wfx/publishers";
import { MyChannelAdapter } from "./my-channel-adapter";

registerAdapter(new MyChannelAdapter());
```

Adding a new channel:
1. Implement the `Adapter` interface
2. Define a Zod schema for the adapter's `config` field
3. Declare allowed credential kinds
4. Call `registerAdapter(instance)`

No core changes. No other adapters affected. No consumer code changes beyond the new target config.

---

## 10. Phase 1 adapters

Four adapters in v0.1, fully battle-tested before adding more. These cover ~95% of FinFlow's expected client needs.

### 10.1 Telegram adapter (`adapter: "telegram"`)

**Why first:** Telegram is the dominant channel in financial trading communities. Most FinFlow brokers already operate Telegram channels for client alerts.

**Config:**
```ts
interface TelegramConfig {
  /** Numeric chat id or @channelusername. */
  chatId: string | number;
  /** Bot username (informational, surfaced in dashboard). */
  botUsername?: string;
  /** Disable notification (silent message). */
  disableNotification?: boolean;
  /** Disable web preview for links in the body. */
  disableWebPagePreview?: boolean;
  /** Wire format. */
  parseMode?: 'MarkdownV2' | 'HTML';
  /** Maximum body length before the truncation strategy kicks in. Default 4000 (leaves headroom under the 4096 hard cap). */
  maxBodyLength?: number;
}
```

**Credentials:** `bearer-token` (the Bot API token from BotFather).

**Behavior:**
- Posts via the Telegram Bot API `sendMessage` endpoint.
- For attachments: uses `sendPhoto` / `sendDocument` / `sendMediaGroup` as appropriate; the body becomes the caption.
- Honors `disableNotification` for silent CTA-free pieces.
- Returns `PublishReceipt.channelId = message_id`, `url = https://t.me/{chat_username}/{message_id}` if the chat is public.

**Rate limit defaults:** 20 messages/minute per target (Telegram allows 30/sec but we leave headroom).

### 10.2 Email adapter (`adapter: "email"`)

**Why first:** newsletters and HITL escalations both need email. Critical for client comms.

**Config:**
```ts
interface EmailConfig {
  /** From: header. Must match the SMTP relay's authorized senders. */
  fromAddress: string;
  fromName: string;
  /** Reply-To if different from From. */
  replyTo?: string;
  /** Subject template — uses {{title}}, {{language}}, etc. from Content. */
  subjectTemplate: string;
  /** Recipient resolution: a fixed list, a list id (resolved by the consumer), or both. */
  recipients:
    | { kind: 'fixed'; addresses: string[] }
    | { kind: 'list-id'; listId: string }   // consumer must resolve before publishing
    | { kind: 'segment'; segmentTag: string };
  /** Optional HTML template wrapper (header/footer). Body is injected. */
  htmlTemplate?: string;
  /** Plain-text template wrapper (multipart fallback). */
  textTemplate?: string;
  /** Default tracking pixels and unsubscribe link injection. */
  unsubscribeUrlTemplate?: string;
}
```

**Credentials:** `smtp` for direct SMTP; `bearer-token` for SaaS providers (Postmark, SendGrid, Resend, AWS SES via API).

**Behavior:**
- Multipart MIME: HTML primary, plain-text fallback.
- Attachments inline as MIME parts.
- Returns `PublishReceipt.channelId = Message-ID`, `url` is omitted (email has no public URL).
- `recipients.kind: 'list-id'` requires the consumer to expand the list before calling — Phase 1 does not include list management.

**Rate limit defaults:** 100/minute per target (well below most SMTP relay limits).

### 10.3 WordPress adapter (`adapter: "wordpress"`)

**Why first:** the most common blog platform among FinFlow brokers. Without WordPress support we can't publish analyses to most clients' websites.

**Config:**
```ts
interface WordPressConfig {
  /** Site URL (e.g. https://broker.example.com). */
  siteUrl: string;
  /** Post status on publish: draft for HITL workflows, publish for autopilot. */
  postStatus: 'draft' | 'publish' | 'pending';
  /** Default category ids. */
  categoryIds?: number[];
  /** Default tag ids. */
  tagIds?: number[];
  /** Author user id (must exist on the WP site). */
  authorId?: number;
  /** Whether to convert markdown body to Gutenberg blocks (true) or post raw HTML (false). */
  useGutenbergBlocks?: boolean;
  /** Featured image: 'first-attachment' picks attachments[0] if present. */
  featuredImageStrategy?: 'none' | 'first-attachment' | 'specified-id';
  featuredImageId?: number;
}
```

**Credentials:** `api-key` (WordPress application password).

**Behavior:**
- Uses the WP REST API `/wp-json/wp/v2/posts` endpoint.
- HTML body or Gutenberg block JSON depending on config.
- Featured image upload (when needed) is a separate `/media` POST first; the returned media id becomes `featured_media` on the post.
- Returns `PublishReceipt.channelId = post id`, `url = the post permalink`.

**Rate limit defaults:** 10/minute per target. WP shared hosting is often resource-constrained.

### 10.4 Webhook adapter (`adapter: "webhook"`)

**Why first:** the escape hatch. Lets clients integrate with any custom system (internal CMS, push-notification service, in-house Slack bot, custom analytics) without us writing a bespoke adapter. Should ship in Phase 1 because it unblocks all "we have this weird in-house thing" client cases.

**Config:**
```ts
interface WebhookConfig {
  /** POST endpoint. */
  url: string;
  /** Static headers. Auth headers come from credentials. */
  headers?: Record<string, string>;
  /** Body shape: passes through the Content as JSON, or wraps in a custom envelope. */
  bodyShape: 'content-as-json' | 'custom-envelope';
  /** When bodyShape = 'custom-envelope', a JMESPath-style template. */
  envelopeTemplate?: Record<string, unknown>;
  /** Content-Type header. Default 'application/json'. */
  contentType?: string;
  /** Timeout in seconds. Default 30. */
  timeoutSeconds?: number;
}
```

**Credentials:** `bearer-token`, `api-key`, `webhook-hmac` (signs the body with HMAC-SHA256), or `none`.

**Behavior:**
- POSTs the configured payload to the URL.
- For `webhook-hmac`, adds `X-WFX-Signature: sha256=<hex>` header computed over the raw body.
- Considers any 2xx response a success; 4xx is `failed-permanent` (channel rejected); 5xx is `failed-transient`.
- Returns `PublishReceipt.channelId = sha256(body)[0..16]` (synthetic id), `url` omitted.

**Rate limit defaults:** 60/minute per target (consumer's webhook server should be tolerant).

### 10.5 Sample target configs (Phase 1 deliverables)

To prove the abstraction, Phase 1 ships with example target configs covering all four adapters:

- `examples/finflow-es-telegram.json` — Telegram broker channel (uses env var for token)
- `examples/finflow-newsletter-email.json` — SES-backed newsletter
- `examples/broker-blog-wordpress.json` — WordPress with REST API
- `examples/internal-webhook.json` — generic JSON webhook

These double as integration test fixtures (see §13).

---

## 11. Phase 2 adapters (planned, not specced here)

| Adapter | Notes |
|---|---|
| `instagram` | Instagram Graph API. Requires image (no text-only posts). Carousel support via `mediaGroup`. Only for Business accounts the consumer owns. |
| `twitter-x` | Twitter/X API v2. Thread support via `'split'` truncation strategy. Tight rate limits. Bring-your-own-developer-account required. |
| `linkedin` | LinkedIn Pages API. Long-form articles via UGC posts. |
| `discourse` | Discourse forum API. Categories, tags, topic vs reply distinction. |
| `bluesky` | AT Protocol. Similar shape to Twitter but more open. |
| `slack-channel` | Slack Web API `chat.postMessage`. Block Kit format support. |
| `discord-channel` | Discord webhooks first, full bot API later. |
| `mastodon` | ActivityPub via the Mastodon REST API. |

Phase 2 adapters get their own spec at `docs/specs/YYYY-MM-DD-publishers-phase-2.md` once Phase 1 is solid.

---

## 12. Operational stance

Three principles, baked into the design:

1. **Idempotency is non-bypassable.** A double-published alert in a client's Telegram channel is the worst possible failure mode. Every job has an idempotency key; every adapter goes through the runner; the runner refuses to call an adapter twice for the same key.
2. **Credentials are radioactive.** Stored encrypted, decrypted at the boundary, never logged, redacted from every error path. Rotation is documented.
3. **Permanent failures fail loud, transient failures retry quietly.** The retry policy is categorized: auth/config/rejection errors stop immediately and surface to HITL. Network/rate-limit/5xx errors retry with backoff. **No silent fallbacks** — if something can't be published, the consumer knows about it.

The package never bypasses channel-side rate limits, never spoofs identities, never sends from credentials it doesn't own. Channels can ban us for misbehavior; the package's defaults are conservative to make that nearly impossible.

---

## 13. Testing strategy

Two layers, both required.

### 13.1 Unit tests — mocked transports
- Every adapter has fixture tests using `undici` `MockAgent` for HTTP, `nodemailer-mock` for SMTP.
- Tests cover: success, auth failure, rate-limit response, 5xx retry, content rejection, attachment upload, format conversion edge cases.
- Idempotency tests: re-publishing the same content+target returns the cached receipt and does not call the adapter.
- Fast (< 2s per adapter), runs on every commit, no network.

### 13.2 Live integration tests — real channels
- Separate suite at `tests/live/` against real test channels (a private Telegram channel, a sandbox Postmark account, a throwaway WordPress site, a `httpbin.org`-style webhook receiver).
- Validates: actual API still works, credentials still valid, rate limits roughly correct.
- Runs on a nightly CI schedule and on demand. Failures are warnings, not blockers.

### 13.3 What we don't test
- We don't test encryption correctness (trust AES-256-GCM and the standard library).
- We don't fuzz channel APIs (we trust their docs).
- We don't run end-to-end "post to a real public Twitter account" tests in CI — that requires real follower accounts and is brittle.

---

## 14. Package layout

```
packages/publishers/                       (folder name; npm name = @wfx/publishers)
├── package.json                          name: "@wfx/publishers"
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                          public API exports
│   ├── core/
│   │   ├── types.ts                      Content, PublishTarget, PublishJob, PublishReceipt
│   │   ├── runner.ts                     runPublishJob() orchestrator
│   │   ├── registry.ts                   adapter registry
│   │   ├── target-config.ts              JSON loading + Zod validation
│   │   ├── credentials.ts                CredentialBundle, encryption, redact()
│   │   └── primitives/
│   │       ├── idempotency.ts
│   │       ├── rate-limit.ts
│   │       ├── retry.ts
│   │       ├── format-convert.ts
│   │       └── truncate.ts
│   ├── store/
│   │   ├── types.ts                      PublishJobStoreBackend, PublishTargetStore
│   │   ├── postgres-store.ts             production backend
│   │   ├── sqlite-store.ts               standalone consumers
│   │   ├── memory-store.ts               tests
│   │   └── encryption.ts                 per-tenant key derivation, HKDF, AES-GCM
│   └── adapters/
│       ├── telegram/
│       │   ├── adapter.ts
│       │   ├── config.ts                 Zod schema
│       │   └── format.ts                 MarkdownV2 escaping, attachment helpers
│       ├── email/
│       │   ├── adapter.ts
│       │   ├── config.ts
│       │   └── multipart.ts
│       ├── wordpress/
│       │   ├── adapter.ts
│       │   ├── config.ts
│       │   ├── gutenberg.ts              markdown → block JSON
│       │   └── media.ts                  attachment upload
│       └── webhook/
│           ├── adapter.ts
│           ├── config.ts
│           └── hmac.ts
├── examples/                             sample target configs
│   ├── finflow-es-telegram.json
│   ├── finflow-newsletter-email.json
│   ├── broker-blog-wordpress.json
│   └── internal-webhook.json
└── tests/
    ├── unit/
    │   ├── telegram.test.ts
    │   ├── email.test.ts
    │   ├── wordpress.test.ts
    │   ├── webhook.test.ts
    │   ├── runner.test.ts
    │   ├── idempotency.test.ts
    │   ├── store.test.ts
    │   └── primitives/
    │       ├── rate-limit.test.ts
    │       ├── retry.test.ts
    │       └── format-convert.test.ts
    └── live/
        └── examples.live.test.ts         runs against real test channels nightly
```

### Dependencies (kept minimal)
- `zod` — config validation
- `undici` — HTTP for Telegram, WordPress, webhook
- `nodemailer` — SMTP for the email adapter
- `markdown-it` + `turndown` — bidirectional format conversion
- `better-sqlite3` — SQLite backend (synchronous, fastest)
- `pg` — Postgres backend (only the production adapter; not loaded for SQLite consumers)
- `p-queue` — concurrency / rate limit primitives

No `playwright`, no headless browsers — every adapter uses the channel's official API.

---

## 15. Public API surface

```ts
// High-level
export { runPublishJob, openStore, registerAdapter } from "@wfx/publishers";

// Types
export type {
  Content,
  ContentProvenance,
  Attachment,
  PublishTarget,
  PublishJob,
  PublishReceipt,
  PublishError,
  CredentialBundle,
  Adapter,
  PublishContext,
  PublishIssue,
  HealthStatus,
  PublishTargetStore,
  PublishJobStoreBackend,
} from "@wfx/publishers";

// Built-in adapters (re-exported for advanced use)
export { TelegramAdapter } from "@wfx/publishers/adapters/telegram";
export { EmailAdapter } from "@wfx/publishers/adapters/email";
export { WordPressAdapter } from "@wfx/publishers/adapters/wordpress";
export { WebhookAdapter } from "@wfx/publishers/adapters/webhook";
```

That's the entire surface. ~15 exports.

---

## 16. Consumer usage examples

### 16.1 FinFlow content pipeline

```ts
// packages/api/src/content-pipeline/publish-stage.ts
import { runPublishJob, openStore } from "@wfx/publishers";

const publishStore = await openStore({ kind: 'postgres', connectionString: process.env.DATABASE_URL! });

async function publishGeneratedContent(generatedContent: GeneratedContent, brief: ContentBrief) {
  const pipeline = await pipelineStore.get(brief.pipelineId);

  // A pipeline can have multiple publish targets (e.g. WordPress + Telegram teaser).
  // Each target gets its own PublishJob with its own idempotency key.
  for (const targetId of pipeline.publishTargets) {
    const target = await publishStore.targets.get(targetId, brief.tenantId);
    if (!target?.enabled) continue;

    const content: Content = {
      contentId: generatedContent.contentId,
      tenantId: brief.tenantId,
      title: generatedContent.title,
      body: generatedContent.body,
      bodyFormat: 'markdown',
      language: pipeline.language,
      provenance: {
        contentSystemId: generatedContent.contentId,
        source: 'finflow',
        generatedAt: generatedContent.createdAt,
        upstreamRefs: {
          briefId: brief.briefId,
          eventId: brief.eventId,
          coreAnalysisId: brief.coreAnalysisId ?? '',
        },
      },
    };

    const job = await runPublishJob({ content, target, store: publishStore });

    if (job.state === 'succeeded') {
      // Update generated_content.published_at via consumer storage
      await markPublished(generatedContent.contentId, target.id, job.receipt!);
    } else if (job.state === 'failed-permanent') {
      // Escalate to HITL — credentials invalid, content rejected, etc.
      await escalateToHitl(brief, target, job.error!);
    }
    // Transient failures are silently retried by the runner; we just record state.
  }
}
```

The publish stage is the **last stage of the content pipeline** (content-pipeline.md §5.11). It is dumb on purpose — it just pipes conformance-checked, uniqueness-gated content to the configured targets via the package.

### 16.2 Robuust content pipeline

```ts
// robuust/src/publish-loop.ts
import { runPublishJob, openStore } from "@wfx/publishers";

const store = await openStore({ kind: 'sqlite', path: '.robuust/publish.db' });

async function publishBlogPost(post: BlogPost, targets: string[]) {
  for (const targetId of targets) {
    const target = await store.targets.get(targetId);
    if (!target) continue;

    const content: Content = {
      contentId: post.id,
      title: post.title,
      body: post.body,
      bodyFormat: 'markdown',
      language: post.language,
      attachments: post.heroImage ? [{ kind: 'image', source: { type: 'url', url: post.heroImage }, alt: post.title }] : undefined,
      provenance: {
        contentSystemId: post.id,
        source: 'robuust',
        generatedAt: post.createdAt,
      },
    };

    await runPublishJob({ content, target, store });
  }
}
```

Same package, completely different domain. Zero shared knowledge with FinFlow.

### 16.3 Idempotent re-trigger after a transient outage

```ts
// Telegram was down for an hour; the original job went to failed-transient state.
// Manually retry from the dashboard — same content, same target, fresh idempotency
// fragment so the cached failed row doesn't short-circuit.
const newJob = await runPublishJob({
  content,
  target,
  store: publishStore,
  idempotencyKeyOverride: `${content.contentId}:${target.id}:retry-${Date.now()}`,
});
```

This is the only case where overriding the idempotency key is OK. The dashboard UI surfaces a "Retry" button on failed jobs that mints a fresh fragment.

---

## 17. Open questions / decisions deferred

These don't block writing the spec but should be answered before writing code, OR can be answered as the code reveals the right answer:

1. **Monorepo vs separate repo** — Phase 1 lives in `wordwideAI/packages/publishers/` (decided 2026-04-07 by analogy with `@wfx/ingest`). Extraction trigger: when Robuust kicks off as its own repo, or when a third consumer appears.
2. **npm publishing** — defer until extraction. Until then, consumers in this monorepo import via Bun workspace path.
3. **Logging integration** — Phase 1 uses a simple `Logger` interface. Defer pino/winston/etc. integration to consumers.
4. **Metrics emission** — Phase 1 emits events via Node `EventEmitter`. Defer Prometheus/OTel integration to consumers.
5. **Scheduled publishing** — Phase 1 publishers are stateless "publish now". Scheduling lives in the consumer's BullMQ delayed jobs (FinFlow content pipeline owns its scheduler). v2 may add a thin built-in scheduler for standalone consumers.
6. **Update / delete propagation** — Phase 1 publish is one-shot. v2 may add `updatePublishedContent(jobId, newContent)` and `unpublishContent(jobId)` for channels that support edit/delete (WordPress yes, Telegram limited, email no).
7. **Cross-channel chaining** — "publish the WordPress URL to Telegram once the WordPress publish succeeds" — is a content-pipeline-level concern (pipeline chaining, deferred to v2 in content-pipeline.md). The publisher package only sees individual jobs.
8. **Encryption key management** — Phase 1 uses a master key from env. A future iteration may integrate with AWS KMS / GCP KMS / HashiCorp Vault. Out of scope for v1.
9. **Bring-your-own-credentials clients** — for clients who want FinFlow to publish from credentials they own (their Telegram bot, their WordPress site), the credential collection UX lives in the FinFlow dashboard. The publisher package just consumes whatever credentials are in `PublishTarget`. Phase 1 ships the credential storage; Phase 1 dashboard ships a credential entry form.
10. **Batch publishing** — currently each call publishes one content to one target. For "send this newsletter to a 50,000-address list", does the email adapter receive one job with 50k recipients, or 50k jobs? Phase 1 = one job, the adapter handles the per-recipient loop internally with its own rate-limit budget. Per-recipient idempotency is the consumer's responsibility (use `contentId + recipientHash` as idempotency key if needed).

---

## 18. What's NOT in this spec (and why)

- **Inbound message handling** (replies to alerts, comments on blog posts, DMs to bot) — entirely out of scope. Publishers are write-only. A future `@wfx/listeners` package might handle inbound, but it's a different shape.
- **Analytics** (read counts, engagement, click-throughs) — different package, different concerns. Future `@wfx/analytics` if needed.
- **A web UI for managing publish targets** — not a `@wfx/publishers` concern; consumer's job. **However, FinFlow ships a mandatory publish-target management dashboard** built on `PublishTargetStore` plus the runner's metric events. Clients must see/edit their targets, see publishing activity, retry failed jobs, and (for high-trust scenarios) toggle autopilot. This is a launch requirement for FinFlow Mode A and Mode B.
- **A "preview before publish" mode** — useful for HITL workflows. Could be added as `dryRun: true` option to `runPublishJob` that returns the rendered payload without sending. v1.5 if there's demand.
- **Publishing to private API endpoints behind VPN / tunnels** — escape hatch is the webhook adapter pointing at an internal URL the FinFlow VM can reach.
- **Content feeds** (RSS, Atom) — clients consume their own published content via the channel-native feed; we don't generate feeds.

---

## 19. Implementation order (Phase 1)

Mapped to SB tasks (tracked in workstream D):

1. **D1 Scaffold** — `packages/publishers/` skeleton, `package.json`, `tsconfig.json`, README
2. **D2 Core types** — `core/types.ts` with `Content`, `PublishTarget`, `PublishJob`, `PublishReceipt`, `Adapter`, `CredentialBundle`
3. **D3 Credentials + encryption** — `core/credentials.ts`, AES-256-GCM, HKDF key derivation, `redact()` helper
4. **D4 Idempotency primitive** — depends on store
5. **D5 Rate limit primitive**
6. **D6 Retry primitive**
7. **D7 Format conversion primitive** — markdown ↔ HTML ↔ text
8. **D8 Truncation primitive**
9. **D9 PublishJobStore + Postgres backend + SQLite backend**
10. **D10 PublishTargetStore + Postgres backend + SQLite backend**
11. **D11 Publisher runner + adapter registry**
12. **D12 Telegram adapter**
13. **D13 Email adapter (SMTP via nodemailer + bearer-token via Postmark/SES)**
14. **D14 WordPress adapter (REST API, app password auth)**
15. **D15 Webhook adapter (with HMAC signing)**
16. **D16 Adapter unit tests + fixtures**
17. **D17 README + 4 example target configs**
18. **D18 FinFlow integration: wire `runPublishJob` into content-pipeline §5.11**
19. **D19 Dashboard wiring: `PublishTargetStore` CRUD UI, publishing activity view, retry button**
20. **D20 Live integration test suite (nightly)**

---

## 20. Acceptance criteria (Phase 1 done = these all pass)

1. ✅ `packages/publishers/` builds with `bun run typecheck` (zero `any`, strict mode)
2. ✅ Unit test suite runs in < 5s, all green
3. ✅ Live integration suite runs successfully against all 4 example targets (≥ 1 successful publish each)
4. ✅ Republishing the same content+target returns the cached receipt (idempotency works)
5. ✅ A 4xx response from a channel produces `failed-permanent` and does not retry
6. ✅ A 5xx response retries with exponential backoff and eventually succeeds (or surfaces `failed-transient`)
7. ✅ A 429 with `Retry-After` honors the header value
8. ✅ Credentials are never logged anywhere — verified by grep on all log output during the live test suite
9. ✅ Credentials at rest in `publish_targets.credentials_enc` are unreadable without the master key
10. ✅ A new adapter can be added without modifying any file in `core/`
11. ✅ The package has zero imports from `@finflow/api`, `finflow/`, or any FinFlow-specific module
12. ✅ FinFlow content pipeline can publish a generated piece of content end-to-end through Telegram and WordPress and record the receipt against the `generated_content` row

---

## 21. Reconciliation with companion specs

| Companion | Touchpoint | Resolution |
|---|---|---|
| `2026-04-07-data-sources.md` | Architectural mirror image (input vs output adapter package). Same patterns: Source/Target interface, registry, primitives, JobStore, dual SQLite/Postgres backends, mandatory consumer UI on top. | Patterns are deliberately mirrored so a developer who knows one knows the other. Naming conventions match (`runSource` ↔ `runPublishJob`, `SourceConfigStore` ↔ `PublishTargetStore`). |
| `2026-04-07-content-pipeline.md` §5.11 | The content pipeline's "publish dispatch" stage hands off to this package. Each pipeline declares its `publishTargets` (target IDs); the dispatch stage iterates and calls `runPublishJob` per target. | Spec'd in §16.1 above. Content pipeline §5.11 is updated separately to reference this spec by name. |
| `2026-04-07-content-uniqueness.md` | The uniqueness gate runs immediately upstream — content reaches the publisher only after passing both compliance and uniqueness. | No direct dependency. Publishers receive `Content` with provenance pointing back to `generated_content.content_id`; the uniqueness gate's verdict is on that row. |
| `2026-04-07-deployment-stack.md` | Postgres + Drizzle backend for the production stores. Per-tenant credential encryption uses a master key from env (deployment-stack §4 secrets management). | New tables (`publish_jobs`, `publish_targets`) live in `packages/db/`. Credential master key listed as a deployment secret in the stack spec (added next pass). |
| `feedback_two_layer_generation.md` (memory) | Reinforces the principle: publishers do **not** creatively re-shape content. Channel-specific content shape is the upstream pipeline's responsibility (identity agent owns native format). | Documented explicitly in §3.1 and §3 non-goals. Anti-pattern called out. |

---

## 22. Sign-off

| Role | Name | Status |
|---|---|---|
| Product / direction | Albert Galera | Pending review |
| Architecture | Albert Galera + Claude | Drafted 2026-04-07 |
| Implementation lead | TBD | — |

Once this spec is approved, work proceeds against the SB tasks in §19 order on dedicated branches off master. The first useful FinFlow milestone is **D12 + D14 + D18** — once Telegram and WordPress adapters exist and the content pipeline can call them, Mode A SaaS can demonstrate end-to-end publish for the most common client setup.
