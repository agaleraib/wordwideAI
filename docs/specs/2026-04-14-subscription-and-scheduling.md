# FinFlow Subscription, Scheduling & Billing — Commercial and operational control plane

**Date:** 2026-04-14
**Status:** Draft
**Owners:** Albert Galera (decisions), Claude (drafting)
**Branch:** TBD

---

## Prior Work

Builds on:
- [Content Pipeline](2026-04-07-content-pipeline.md) — defines `ContentPipeline`, `InterestProfile`, `ImpactClassifier`, the dispatcher / producer split, FA/TA core analysis, identity adaptation, cost-ceilings (v1 stub)
- [Data Sources](2026-04-07-data-sources.md) — `@wfx/sources` ingest package (not yet built)
- [Deployment Stack](2026-04-07-deployment-stack.md) — Ubuntu/Caddy/Bun/Hono/Postgres+pgvector/Drizzle, dual shared-SaaS + dedicated-VM
- [Editorial Memory](2026-04-12-editorial-memory.md) — tenant-scoped memory, `tenant_id = broker`
- [Demo MVP](2026-04-13-demo-mvp.md) — single-tenant E2E demo; this spec generalizes the commercial envelope around it

Assumes:
- `ContentPipeline`, `tenant`, `event_clusters`, `tenant_event_impact`, `content_briefs`, `content_jobs` tables are planned per the content-pipeline spec
- Postgres + Drizzle is the production storage layer
- Stripe is the payment processor (Smart Retries, Customer Portal, webhooks)
- Bun + Hono is the runtime; webhooks are a plain Hono route

Changes / supersedes:
- Replaces the v1 `ContentPipeline.costCeiling` stub (§4.1 in content-pipeline spec) with the three-layer quota model described here. `maxJobsPerDay/Month` are kept but renamed/repurposed as the *pipeline* layer of a three-layer enforcement stack (pipeline → tenant → subscription).
- Introduces `TenantSubscription`, `SubscriptionPlan`, and `TenantSourceConfig` as first-class entities.
- Adds a `schedule` field to `ContentPipeline` and formalizes forward-looking scheduled fan-out.

---

## 1. Overview

FinFlow's content pipeline (workstream C) is technically complete as a factory, but has no commercial envelope and no operational control plane. This spec adds:

1. **Subscriptions** — the monthly commercial contract between FinFlow and a tenant (plan, price, billing cycle, grace period, payment status).
2. **Scheduling** — when pipelines are allowed to fire. Two levels: tenant-wide quiet hours (kill switch) and per-pipeline active windows (positive allow-list).
3. **Source subscriptions** — which sources a tenant has connected, credentials, per-tenant ingest-related operational limits.
4. **Billing** — Stripe integration: monthly pre-charge, dunning, Smart Retries, webhooks driving a state machine, Customer Portal for self-service invoices.
5. **Quotas** — a three-layer model (pipeline → tenant → subscription) enforced in that order, fail-closed.

This is the control plane. It sits **above** the content pipeline and **under** the dashboard. Without it the factory runs unbounded; with it the factory is a product.

---

## 2. Goals

- Every pipeline run has a clear commercial and operational trace: which plan paid for it, which budgets it drew from, which schedule armed it.
- Payment state is the hard gate for execution. Quotas are informational except where explicitly guardrails.
- Scheduling is forward-looking and impact-driven — we do not run digests at window start; we arm, wait for the next qualifying event, fire once.
- In-flight producer jobs are never cancelled mid-flight. A job that started inside the window always finishes.
- Dunning is lenient: 3-day soft grace after period end, hard cutoff day 4.
- Zero card data stored; zero PDFs generated. Stripe Customer Portal handles self-service.
- All of the above is tenant-scoped; a single Postgres cluster hosts many tenants safely.

## 3. Non-goals

| Out of scope | Lives where |
|---|---|
| Content production (FA/TA, identity adaptation, conformance, uniqueness) | `2026-04-07-content-pipeline.md` |
| Source ingest cadence, adapter internals, deduplication | `2026-04-07-data-sources.md` / `@wfx/sources` |
| Editorial memory internals | `2026-04-12-editorial-memory.md` |
| Usage-based / metered billing, tiered overages, annual contracts | v2 |
| Custom in-app invoice UI, PDF generation, tax handling beyond Stripe Tax | v2 |
| Multi-window-per-day schedules, holiday calendars, per-country market hours | v2 (see Open Questions) |
| Credit-card storage, PCI DSS scope | Handled entirely by Stripe |
| Self-serve tenant signup & plan selection (sales-led onboarding at v1) | v2 |

---

## 4. Architecture

```
             ┌────────────────────────────────────────────────┐
             │  Stripe                                         │
             │  Prices, Subscriptions, Invoices, Customer      │
             │  Portal, Smart Retries                          │
             └───────┬─────────────────────────┬──────────────┘
                     │ webhooks                 │ hosted links
                     ▼                          │ (billing portal)
┌──────────────────────────────────────┐        │
│  FinFlow Billing Webhook Handler     │        │
│  (POST /billing/webhook)             │        │
│  - invoice.paid                      │        │
│  - invoice.payment_failed            │        │
│  - customer.subscription.deleted     │        │
└───────┬──────────────────────────────┘        │
        │ state transitions                     │
        ▼                                       │
┌──────────────────────────────────────┐        │
│  TenantSubscription state machine    │        │
│  active → pending_renewal →          │        │
│    renewed | past_due → suspended    │        │
└───────┬──────────────────────────────┘        │
        │ read: current plan + status           │
        ▼                                       │
┌──────────────────────────────────────┐        │
│  Scheduler / Dispatcher              │        │
│  - tenant quiet-hours gate           │        │
│  - pipeline active-window arming     │        │
│  - cooldown / dedup                  │◄───────┘ (signed portal sessions)
│  - 3-layer quota enforcement         │
│    (pipeline → tenant → subscription)│
└───────┬──────────────────────────────┘
        │ fires ContentBriefs →
        ▼
    content pipeline (§ 2026-04-07-content-pipeline.md)
```

**Separation of concerns.**
- **Stripe** owns money, cards, retries, receipts.
- **Webhook handler** translates Stripe events into FinFlow state changes.
- **State machine** is the single read-point for "can this tenant run work right now."
- **Scheduler** is the only code that arms/disarms windows and checks quotas. The content pipeline itself never reads billing state.

**Fail-closed principle.** When the billing state is unknown, when a webhook is delayed, when quotas can't be counted — the default answer is "do not dispatch." Ingest and caching continue; only fan-out is suppressed.

---

## 5. Data Model

All tables `tenant_id`-scoped where applicable. Timestamps are `timestamptz`. Primary keys are UUIDv7.

### 5.1 `subscription_plans`

The catalog of plans FinFlow sells. Data-driven; adding a plan is an INSERT, not a deploy.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | |
| slug | text | UNIQUE, NOT NULL | e.g. `"starter"`, `"pro"`, `"scale"` |
| name | text | NOT NULL | Display name |
| stripe_price_id | text | NOT NULL | `price_…` in Stripe |
| monthly_price_cents | int | NOT NULL | For display; Stripe is source of truth |
| currency | text | NOT NULL, DEFAULT `'EUR'` | ISO 4217 |
| articles_per_month | int | NOT NULL | Soft indicator (alerts only) |
| max_pipelines | int | NOT NULL | Hard limit |
| max_concurrent_runs | int | NOT NULL | Hard limit |
| max_daily_budget_cents | int | NOT NULL | Tenant-layer hard ceiling on LLM spend |
| included_sources | int | NOT NULL | How many source subscriptions allowed |
| features | jsonb | NOT NULL, DEFAULT `'{}'` | Flags: `hitl_required`, `custom_identities_allowed`, etc. |
| active | boolean | NOT NULL, DEFAULT true | Whether the plan is sellable today |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:** `UNIQUE(slug)`, `UNIQUE(stripe_price_id)`.

### 5.2 `tenant_subscriptions`

One row per tenant. The operational source of truth for payment status.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | |
| tenant_id | UUID | FK → tenants.id, UNIQUE, NOT NULL | One subscription per tenant (v1) |
| plan_id | UUID | FK → subscription_plans.id, NOT NULL | Current plan |
| stripe_customer_id | text | NOT NULL | `cus_…` |
| stripe_subscription_id | text | NOT NULL, UNIQUE | `sub_…` |
| status | text | NOT NULL, CHECK IN (`'active'`, `'pending_renewal'`, `'past_due'`, `'suspended'`, `'cancelled'`) | State machine |
| current_period_start | timestamptz | NOT NULL | From Stripe |
| current_period_end | timestamptz | NOT NULL | From Stripe |
| grace_deadline | timestamptz | NULL | Set on `past_due`; `current_period_end + 3 days` |
| cancel_at_period_end | boolean | NOT NULL, DEFAULT false | Mirrors Stripe |
| last_invoice_id | text | NULL | `in_…` |
| last_webhook_event_id | text | NULL | For idempotent webhook processing |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

**Indexes:** `UNIQUE(tenant_id)`, `UNIQUE(stripe_subscription_id)`, `INDEX(status)`.

**State machine:**

```
           Stripe.invoice.paid
active ───────────────────────► active (period advanced)
   │
   │ period_end - 7d
   ▼
pending_renewal
   │
   ├── invoice.paid ──────────► active
   │
   └── invoice.payment_failed ► past_due
                                   │
                                   ├── invoice.paid (Smart Retry) ─► active
                                   │
                                   └── now > grace_deadline ───────► suspended
                                                                        │
                                                                        └── invoice.paid ─► active
cancelled  (customer.subscription.deleted; terminal at v1)
```

**Gating rule (fail-closed):** the dispatcher executes work only when `status ∈ { 'active', 'pending_renewal' }`. `past_due` with `now <= grace_deadline` is treated as `active` (lenient grace); `past_due` past grace is effectively `suspended`. `suspended` and `cancelled` block all fan-out; ingest and cache continue.

### 5.3 `tenant_source_configs`

Per-tenant source subscriptions plus tenant-wide operational guardrails.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | |
| tenant_id | UUID | FK → tenants.id, NOT NULL | |
| source_id | text | NOT NULL | e.g. `"reuters-rss"`, `"client-telegram-xyz"` |
| enabled | boolean | NOT NULL, DEFAULT true | |
| credentials_encrypted | bytea | NULL | KMS-wrapped secret blob |
| adapter_config | jsonb | NOT NULL, DEFAULT `'{}'` | RSS URL, API keys ref, channel ids, etc. |
| private | boolean | NOT NULL | True = tenant-private; false = shared pool |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

**Unique:** `(tenant_id, source_id)`.

Tenant-wide operational limits live in a sibling `tenant_operational_configs` row (1:1 with tenant):

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| tenant_id | UUID | PK, FK → tenants.id | |
| global_quiet_hours | jsonb | NOT NULL, DEFAULT `'[]'` | Array of `{ tz, daysOfWeek, start, end }` |
| global_weekly_mask | jsonb | NOT NULL, DEFAULT `'{}'` | `{ tz, days: [0..6] }` whitelist |
| max_concurrent_runs_override | int | NULL | Optional override beneath plan ceiling |
| daily_budget_cents_override | int | NULL | Optional override beneath plan ceiling |

**Semantics.**
- **Quiet hours and weekly mask are a kill switch.** Events still ingest and cache during quiet hours. Only dispatch is suppressed. When the window opens, **catch-up is bounded** by `maxCatchupMinutes` (default 30) on each pipeline.
- Tenant config = default for pipelines; pipeline `schedule` can override (§5.4).

### 5.4 `ContentPipeline.schedule` (added field)

Extends the `ContentPipeline` type from `2026-04-07-content-pipeline.md` §4.1:

```ts
type PipelineSchedule = {
  tz: string;                            // IANA, e.g. "Europe/Madrid"
  daysOfWeek: number[];                  // 0..6 (Sun..Sat)
  activeWindow: { start: string; end: string }; // "HH:mm", same tz
  maxCatchupMinutes: number;             // default 30
  cooldownMinutes: number;               // default 60, prevents burst re-fire
  // Inheritance: if null, falls back to tenant operational config quiet-hours/mask
};

type ContentPipeline = {
  // ... existing fields ...
  schedule: PipelineSchedule | null;     // null = inherit tenant defaults
};
```

**No cron strings.** Active windows only. One contiguous window per day at v1 (see Open Questions for multi-window).

**Firing semantics (locked, re-stating for the data contract):**
1. At `activeWindow.start` (in `tz`), the scheduler **arms** the pipeline. Arming is cheap; it records `(pipelineId, armedAt)` in `pipeline_arms` with `firedAt = NULL`.
2. The next qualifying `tenant_event_impact` row — one where the pipeline's trigger evaluation would produce a `ContentBrief`, passing `minImpact` per the content-pipeline spec — causes the pipeline to **fire**: brief is created, job is queued, `firedAt` is stamped, arm is disarmed.
3. `cooldownMinutes` after firing, the pipeline re-arms if the window is still open.
4. At `activeWindow.end`, if armed (never fired or cooldown lapsed past close), the arm is disarmed without firing.
5. **The window is checked at arm-time only.** A producer job started at `17:55` with window closing `18:00` runs to completion even if it finishes at `18:20`. In-flight jobs are never cancelled mid-flight. Ever.
6. If the scheduler was down and missed an arming, it catches up at most `maxCatchupMinutes` worth of missed window. Windows older than that are not retroactively armed.

**Arms table:**

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| pipeline_id | UUID | FK → content_pipelines.id, NOT NULL |
| armed_at | timestamptz | NOT NULL |
| window_ends_at | timestamptz | NOT NULL |
| fired_at | timestamptz | NULL |
| fired_brief_id | UUID | NULL, FK → content_briefs.id |
| disarmed_at | timestamptz | NULL |
| disarm_reason | text | NULL, CHECK IN (`'fired'`, `'window_closed'`, `'tenant_suspended'`, `'quota_exhausted'`, `'manual'`) |

**Indexes:** `INDEX(pipeline_id, armed_at DESC)`, partial `INDEX(pipeline_id) WHERE fired_at IS NULL AND disarmed_at IS NULL` for "currently armed" lookups.

### 5.5 Quota counters

A single `tenant_usage_counters` table, rolled up by day and month for cheap reads.

| Field | Type | Constraints |
|-------|------|-------------|
| tenant_id | UUID | FK, NOT NULL |
| pipeline_id | UUID | FK, NULL (NULL = tenant aggregate) |
| bucket | text | NOT NULL, CHECK IN (`'day'`, `'month'`) |
| bucket_key | text | NOT NULL (`'YYYY-MM-DD'` or `'YYYY-MM'`, in `UTC`) |
| articles_count | int | NOT NULL, DEFAULT 0 |
| llm_cost_cents | int | NOT NULL, DEFAULT 0 |
| concurrent_runs_peak | int | NOT NULL, DEFAULT 0 |

**PK:** `(tenant_id, pipeline_id, bucket, bucket_key)` (treating NULL pipeline as a sentinel).
**Indexes:** `INDEX(tenant_id, bucket_key)`.

Counters are updated atomically on job transitions (`queued → running → completed|failed`).

### 5.6 `billing_webhook_events`

Idempotent log of every processed Stripe event.

| Field | Type | Constraints |
|-------|------|-------------|
| id | text | PK (Stripe event id, `evt_…`) |
| type | text | NOT NULL |
| payload | jsonb | NOT NULL |
| received_at | timestamptz | NOT NULL |
| processed_at | timestamptz | NULL |
| error | text | NULL |

---

## 6. API Surface

All authenticated routes require tenant-scoped session (existing auth). Webhook route is public but signature-verified.

### 6.1 Subscriptions & billing

| Method | Path | Request | Response (200) | Errors | Auth | Purpose |
|--------|------|---------|----------------|--------|------|---------|
| GET | /billing/subscription | — | `{ plan, status, currentPeriodEnd, graceDeadline?, cancelAtPeriodEnd }` | 401, 404 | tenant | Current subscription snapshot |
| POST | /billing/portal-session | — | `{ url }` | 401, 502 | tenant-admin | Create a Stripe Customer Portal session; user redirected to `url` for invoice/receipt self-service |
| POST | /billing/webhook | Stripe event | `{ received: true }` | 400 (invalid sig), 409 (duplicate) | Stripe signature | Process `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated` |
| GET | /billing/usage | — | `{ month: { articles, budgetCents }, today: { articles, budgetCents }, limits }` | 401 | tenant | Dashboard meter |

**Webhook idempotency.** Every event id is inserted into `billing_webhook_events` under a unique constraint. Duplicate → 409, no state change. Processing is wrapped in a transaction per event.

**Dunning cadence (Stripe-driven, FinFlow only sends the email).** Stripe Smart Retries fire automatically; FinFlow queues emails at T-7 (pending_renewal start), T-3, T-0 (period end), and on each payment_failed event.

### 6.2 Subscription plans (admin)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /admin/plans | List catalog |
| POST | /admin/plans | Create plan (also creates Stripe Product+Price) |
| PATCH | /admin/plans/:id | Toggle active, update display fields (price change = new plan, not mutation) |

### 6.3 Tenant source configs

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | /tenant/sources | — | `TenantSourceConfig[]` | List subscribed sources |
| POST | /tenant/sources | `{ sourceId, adapterConfig, credentials?, private }` | `TenantSourceConfig` | Subscribe to a source |
| PATCH | /tenant/sources/:id | partial | `TenantSourceConfig` | Update config / rotate creds |
| DELETE | /tenant/sources/:id | — | 204 | Unsubscribe |
| GET | /tenant/operational-config | — | `TenantOperationalConfig` | Quiet hours, weekly mask, overrides |
| PUT | /tenant/operational-config | full object | `TenantOperationalConfig` | Update tenant-wide schedule / guardrails |

### 6.4 Pipeline schedule

Extends existing `ContentPipeline` CRUD (content-pipeline spec). No new routes; `schedule` is a field on the existing POST/PATCH `/pipelines/:id` body, validated with Zod.

---

## 7. Quota enforcement (three-layer)

Enforcement order is **pipeline → tenant → subscription**. Fail-closed at first hit. Evaluated at two points: brief-creation (§5.3/5.4 of the content-pipeline spec, before queuing) and job-start (immediately before a producer worker picks up a job, to catch races).

| Layer | Scope | Limits enforced | Source |
|-------|-------|-----------------|--------|
| Pipeline | Per pipeline | `maxArticlesPerDay`, `cooldownMinutes` | `ContentPipeline.limits` |
| Tenant | Per tenant (sum over all pipelines) | `maxConcurrentRuns`, `dailyBudgetCents` | `tenant_operational_configs` + plan ceilings |
| Subscription | Per tenant (monthly) | `articlesPerMonth` (SOFT — alerts only, not a hard gate), `maxPipelines` (hard, at create-time) | `subscription_plans` + `tenant_subscriptions.status` |

**Why `articlesPerMonth` is soft.** The commercial contract is "you pay for N articles/month." If the tenant bursts to 1.2× N, the right business move is to keep publishing and either upsell or just eat it on month one — not to choke off the workflow. Alerts fire at 80% and 100%. The real hard gate for execution is payment status.

**Subscription status gate (hard).** Regardless of quotas, if `tenant_subscriptions.status ∉ { 'active', 'pending_renewal' }` and `now > grace_deadline`, no briefs are created and no jobs start. Ingest and cache continue.

**Alerting.**
- 80% of `articlesPerMonth` → in-app banner + email to billing contact.
- 100% of `articlesPerMonth` → second email, no service change.
- `past_due` entry → email + banner; dashboard shows `grace_deadline`.
- `suspended` → email + banner; dashboard locks content CRUD routes to read-only.

---

## 8. Design Principles

Though this is primarily backend, the tenant-facing dashboard surfaces these decisions. The UX tone for billing/scheduling screens:

- **Plain-spoken trust.** Billing language is the single place a prospect decides whether we're adults. Use concrete numbers, no legalese, no euphemisms for failure. "Your last payment failed on April 9. We'll retry April 12 and April 15. Service continues until April 17." Not "action required."
- **Show the budget, not the fear.** Quota meters are present and honest, but framed as operational context, not as a threat. 80% looks calm, 100% looks calm, alerts are email not modals.
- **No surprises on money.** Any plan change previews the prorated invoice before confirmation. Cancellation is one click and always reversible until the period actually ends.

---

## 9. Requirements

### Phase 1: Subscription state + Stripe wiring

#### 1.1 Plan catalog & tenant subscription schema

**Acceptance criteria:**
- [ ] `subscription_plans`, `tenant_subscriptions`, `billing_webhook_events` tables created via Drizzle migration; migration is reversible and verified with `migration-check` skill.
- [ ] Seed migration inserts at least 3 plans (`starter`, `pro`, `scale`) mirroring Stripe test-mode prices.
- [ ] `getTenantSubscription(tenantId)` returns the current row joined to the plan; returns `null` if absent.
- [ ] `isTenantExecutable(tenantId): boolean` returns true iff `status ∈ { 'active', 'pending_renewal' }` OR (`status === 'past_due'` AND `now <= grace_deadline`).
- [ ] Error case: tenant with no subscription row → `isTenantExecutable === false`, never throws.

#### 1.2 Stripe webhook handler

**Acceptance criteria:**
- [ ] `POST /billing/webhook` validates Stripe signature via `stripe.webhooks.constructEvent`; invalid signature → 400, no DB writes.
- [ ] Event id inserted into `billing_webhook_events` inside the same transaction as state change; duplicate event id → 409, no-op, idempotent.
- [ ] Handles `invoice.paid` → advances `current_period_start/end`, clears `grace_deadline`, sets status to `active`.
- [ ] Handles `invoice.payment_failed` → sets status to `past_due`, sets `grace_deadline = current_period_end + INTERVAL '3 days'`.
- [ ] Handles `customer.subscription.deleted` → sets status to `cancelled`.
- [ ] Handles `customer.subscription.updated` → mirrors `cancel_at_period_end`, plan changes.
- [ ] Unknown event type → 200, logged, no state change.
- [ ] Webhook endpoint returns within 5s P99 (Stripe requirement).

#### 1.3 Customer Portal session

**Acceptance criteria:**
- [ ] `POST /billing/portal-session` creates a Stripe billing portal session scoped to the tenant's `stripe_customer_id`, returns `{ url }`.
- [ ] Only tenant-admin role can call; non-admin → 403.
- [ ] Portal session URL is one-time and expires per Stripe default.
- [ ] If tenant has no `stripe_customer_id` → 409 with `{ code: 'no_customer' }`.

#### 1.4 Grace period & suspension cron

**Acceptance criteria:**
- [ ] A scheduled job runs hourly: for every `past_due` row where `now > grace_deadline`, transitions to `suspended` (or semantically treated as suspended via `isTenantExecutable`).
- [ ] Transition emits an audit event and sends one (and only one) suspension email per transition.
- [ ] Manual re-activation via successful `invoice.paid` moves `suspended → active`.

### Phase 2: Scheduling primitives

#### 2.1 Tenant operational config

**Acceptance criteria:**
- [ ] `tenant_operational_configs` table + Drizzle migration; 1:1 with tenant.
- [ ] `GET/PUT /tenant/operational-config` validates `globalQuietHours` and `globalWeeklyMask` with Zod (tz is a valid IANA zone, `HH:mm` format, days ∈ 0..6).
- [ ] Saving sends a `tenant.operational_config.changed` event to the scheduler so armed windows recompute within 60s.
- [ ] Edge case: setting quiet hours covering the whole week → all pipelines disarmed until config changes (fail-closed, no error).

#### 2.2 Pipeline schedule field

**Acceptance criteria:**
- [ ] `content_pipelines.schedule` column (`jsonb`) added via migration, nullable.
- [ ] Zod schema validates `tz`, `daysOfWeek[]`, `activeWindow.start < activeWindow.end`, `maxCatchupMinutes ∈ [0, 180]`, `cooldownMinutes ∈ [0, 1440]`.
- [ ] `null` schedule means "inherit tenant operational config"; effective schedule is computed by a pure function `resolveSchedule(pipeline, tenantConfig)` with a unit test fixture suite.

#### 2.3 Arming engine

**Acceptance criteria:**
- [ ] A scheduler worker wakes at most once per minute, evaluates every enabled pipeline's effective schedule, and inserts `pipeline_arms` rows at window start.
- [ ] If the scheduler missed a window start (crash, deploy), it arms windows whose start ≥ `now - maxCatchupMinutes`. Older missed windows are skipped.
- [ ] An already-armed pipeline (row with `fired_at IS NULL AND disarmed_at IS NULL`) is not re-armed.
- [ ] At `window_ends_at`, any still-armed row is disarmed with `disarm_reason = 'window_closed'`.
- [ ] Concurrency: two scheduler replicas do not double-arm; enforced via partial unique index `UNIQUE(pipeline_id) WHERE fired_at IS NULL AND disarmed_at IS NULL`.

#### 2.4 Event-driven firing

**Acceptance criteria:**
- [ ] When a new `tenant_event_impact` row matches a pipeline's trigger criteria AND that pipeline is currently armed, the brief is created, the `pipeline_arms` row is stamped with `fired_at` and `disarm_reason = 'fired'`.
- [ ] An unarmed pipeline never creates a brief on new impact, regardless of score.
- [ ] `cooldownMinutes` after `fired_at`, if the window is still open, a new `pipeline_arms` row is inserted.
- [ ] Edge case: brief creation fails (quota) → `disarm_reason = 'quota_exhausted'`, no retry this window.
- [ ] Edge case: tenant transitions to `suspended` while armed → all arms disarmed with `disarm_reason = 'tenant_suspended'` within 60s.

#### 2.5 In-flight completion guarantee

**Acceptance criteria:**
- [ ] Producer job fires at `17:55` with window ending `18:00`; job completes at `18:20`; job status is `completed`, not `cancelled`.
- [ ] No code path exists that cancels a `running` job because of a scheduling window. Grep-level assertion: only `status IN ('queued')` is eligible for schedule-based cancellation.
- [ ] A suspended tenant's `queued` jobs are cancelled; `running` jobs complete.

### Phase 3: Quota enforcement

#### 3.1 Counter updates

**Acceptance criteria:**
- [ ] `tenant_usage_counters` incremented atomically on job lifecycle transitions.
- [ ] Counters reset implicitly by bucket key (no delete job); `GET /billing/usage` reads current bucket only.
- [ ] Concurrent increment safe under `SELECT … FOR UPDATE` or `INSERT … ON CONFLICT DO UPDATE`.

#### 3.2 Three-layer check

**Acceptance criteria:**
- [ ] Single function `checkQuotas(tenantId, pipelineId): { ok: true } | { ok: false, layer, limit, current, reason }` used at both brief-creation and job-start.
- [ ] Evaluation order pipeline → tenant → subscription; first failure short-circuits.
- [ ] `maxPipelines` check happens at `POST /pipelines`, not at runtime.
- [ ] `articlesPerMonth` is soft: `checkQuotas` returns `ok: true` even at 100%+, but fires a single alert per threshold crossing.
- [ ] `dailyBudgetCents` is hard: `ok: false` at or above limit.

#### 3.3 Usage meter API

**Acceptance criteria:**
- [ ] `GET /billing/usage` returns counts for current day + current month + limits from plan & tenant config in one round trip.
- [ ] Response P99 < 200ms under typical load (single indexed lookup).

### Phase 4: Polish & observability

- [ ] Dunning email templates (T-7, T-3, T-0, failed) in the existing mailer; copy matches §8 "plain-spoken trust."
- [ ] Admin dashboard page `/admin/billing` lists tenants, status, grace deadlines, MRR.
- [ ] Metrics: `finflow.billing.webhook.{received,processed,failed}`, `finflow.scheduling.arms.{created,fired,expired}`, `finflow.quota.hits.{pipeline,tenant,subscription}`.
- [ ] Runbook: "Stripe webhook backlog" and "tenant suspended by mistake."

---

## 10. Implementation Plan (Sprint Contracts)

### Phase 1

- [ ] **Task 1:** Drizzle schema for `subscription_plans`, `tenant_subscriptions`, `billing_webhook_events`.
  - **Files:** `packages/api/src/db/schema/billing.ts`, `packages/api/drizzle/NNNN_billing.sql`
  - **Depends on:** existing tenant schema
  - **Verify:** `bun run typecheck` passes; migration-check skill reports reversible + safe; `drizzle-kit push` against local DB succeeds.

- [ ] **Task 2:** Stripe client + env wiring.
  - **Files:** `packages/api/src/billing/stripe.ts`, `packages/api/.env.example`
  - **Depends on:** Task 1
  - **Verify:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` documented in env.example; `stripe.prices.list()` works in test mode.

- [ ] **Task 3:** Webhook route `POST /billing/webhook` with signature verify + idempotency.
  - **Files:** `packages/api/src/routes/billing-webhook.ts`, `packages/api/src/billing/webhook-handlers.ts`
  - **Depends on:** Tasks 1, 2
  - **Verify:** Stripe CLI `stripe trigger invoice.paid` flips a test tenant to `active`; duplicate delivery is a no-op; invalid signature → 400.

- [ ] **Task 4:** `getTenantSubscription` + `isTenantExecutable` + status accessor used by dispatcher.
  - **Files:** `packages/api/src/billing/subscription.ts`, import site in dispatcher
  - **Depends on:** Task 1
  - **Verify:** Unit test matrix for every `(status × now vs grace_deadline)` cell.

- [ ] **Task 5:** `POST /billing/portal-session`.
  - **Files:** `packages/api/src/routes/billing.ts`
  - **Depends on:** Task 2
  - **Verify:** Returns a valid `https://billing.stripe.com/p/session/…` URL for a seeded test customer.

- [ ] **Task 6:** Grace-period cron (hourly) + suspension email.
  - **Files:** `packages/api/src/billing/grace-cron.ts`, `packages/api/src/billing/emails.ts`
  - **Depends on:** Tasks 1, 4
  - **Verify:** With clock-shim, a `past_due` row past grace transitions correctly; email sent exactly once.

### Phase 2

- [ ] **Task 7:** `tenant_operational_configs` schema + CRUD routes.
  - **Files:** `packages/api/src/db/schema/tenant-config.ts`, `packages/api/src/routes/tenant-config.ts`
  - **Depends on:** Task 1
  - **Verify:** Zod roundtrip on all fields; invalid tz → 400.

- [ ] **Task 8:** `ContentPipeline.schedule` field + migration + Zod.
  - **Files:** `packages/api/src/db/schema/pipelines.ts`, `packages/api/src/routes/pipelines.ts`
  - **Depends on:** Task 7
  - **Verify:** Round-trip test: create pipeline with schedule, read it back equal.

- [ ] **Task 9:** `resolveSchedule(pipeline, tenantConfig)` pure function + unit suite.
  - **Files:** `packages/api/src/scheduling/resolve.ts`, `packages/api/src/scheduling/resolve.test.ts`
  - **Depends on:** Tasks 7, 8
  - **Verify:** At least 10 fixture cases (inherit, override, empty, DST boundaries, weekly mask).

- [ ] **Task 10:** Arming engine worker.
  - **Files:** `packages/api/src/scheduling/armer.ts`, `packages/api/src/db/schema/arms.ts`
  - **Depends on:** Task 9
  - **Verify:** With a fake clock, step through 48h; assertions on arms table match expected sequence.

- [ ] **Task 11:** Hook arming check into dispatcher's brief-creation path.
  - **Files:** `packages/api/src/pipeline/dispatcher.ts` (content-pipeline spec §5.3)
  - **Depends on:** Task 10
  - **Verify:** Event with impact ≥ threshold against an un-armed pipeline does NOT create a brief; same event against armed pipeline DOES; arm row is stamped `fired`.

- [ ] **Task 12:** In-flight completion guarantee + suspended-tenant handling.
  - **Files:** `packages/api/src/pipeline/worker.ts`
  - **Depends on:** Tasks 4, 11
  - **Verify:** Integration test: start a long-running job inside window, close window, job completes. Suspend tenant mid-run, running job completes, queued jobs cancel.

### Phase 3

- [ ] **Task 13:** `tenant_usage_counters` schema + atomic increment helpers.
  - **Files:** `packages/api/src/db/schema/usage.ts`, `packages/api/src/billing/counters.ts`
  - **Depends on:** Task 1
  - **Verify:** Concurrent increment test (100 parallel) lands exactly 100.

- [ ] **Task 14:** `checkQuotas(tenantId, pipelineId)` with three-layer logic.
  - **Files:** `packages/api/src/billing/quota.ts`
  - **Depends on:** Tasks 4, 13
  - **Verify:** Fixture matrix covers hit at each layer; soft limit returns `ok: true` above 100% and fires one alert.

- [ ] **Task 15:** Wire `checkQuotas` into dispatcher (brief-creation) and worker (job-start).
  - **Files:** dispatcher, worker
  - **Depends on:** Task 14
  - **Verify:** Integration: seed tenant at 99% of `dailyBudgetCents`, next high-cost job is blocked.

- [ ] **Task 16:** `GET /billing/usage` endpoint.
  - **Files:** `packages/api/src/routes/billing.ts`
  - **Depends on:** Tasks 13, 14
  - **Verify:** P99 < 200ms on seeded dataset.

### Phase 4

- [ ] **Task 17:** Dunning email templates + schedule (T-7/T-3/T-0/failed).
  - **Files:** `packages/api/src/billing/emails.ts`, templates under `packages/api/src/billing/templates/`
  - **Depends on:** Task 6
  - **Verify:** Render fixtures match copy spec; `stripe trigger invoice.upcoming` produces a T-7 email in the outbox.

- [ ] **Task 18:** Admin dashboard `/admin/billing` minimal view.
  - **Files:** `packages/web/src/routes/admin/billing.tsx`
  - **Depends on:** Tasks 1, 14
  - **Verify:** Loads in <1s; shows status, grace deadlines, MRR.

- [ ] **Task 19:** Metrics + runbook.
  - **Files:** `packages/api/src/metrics.ts`, `docs/runbooks/billing.md`
  - **Depends on:** Tasks 3, 10, 14
  - **Verify:** Metrics emit in dev; runbook covers the two named scenarios.

---

## 11. Constraints

- **No card data or PII beyond Stripe ids is stored in FinFlow DB.** The `tenant_subscriptions` row holds only Stripe handles + derived state.
- **No PDF generation.** Invoices/receipts live in Stripe; users reach them via Customer Portal.
- **Webhook response P99 < 5s.** Heavy work is queued, not done inline.
- **Single Postgres instance at v1.** All tables in the main DB. Tenancy is row-level via `tenant_id`.
- **Fail-closed everywhere.** Unknown billing state, missing schedule, webhook backlog → do not dispatch. Ingest continues.
- **Scheduler must be idempotent across replicas.** Partial unique index on active arm row enforces this.
- **No mid-flight cancellation of running jobs.** Ever. This is a hard rule and a grep-level invariant.

## 12. Out of Scope

- Usage-based billing, metered pricing, overage invoices.
- Annual contracts, custom pricing, enterprise POs.
- Multi-subscription-per-tenant (v2 if product mix ever demands it).
- Multi-window-per-day schedules, holiday/market-hours calendars.
- Custom in-app invoice UI, downloadable PDF receipts.
- Self-serve tenant signup + plan picker (v1 onboarding is sales-led; admin provisions the `tenant_subscriptions` row after a Stripe Checkout).
- Tax handling beyond Stripe Tax defaults.
- Proration UX flows beyond Stripe's built-in behavior.
- VAT invoicing beyond what Stripe Tax provides.
- Refunds workflow (handled manually via Stripe dashboard at v1).

---

## 13. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Onboarding: is plan selection sales-led (admin provisions) or does the tenant go through Stripe Checkout during signup? Spec assumes sales-led at v1. | Shapes signup flow + whether we ship a plan-picker UI | Before Phase 1 ships, but not before it starts |
| 2 | Source-adapter auth model: do adapters accept raw API keys only, or OAuth flows (e.g. Telegram, WordPress)? | Determines shape of `tenant_source_configs.credentials_encrypted` + whether we need an OAuth callback route | Before `@wfx/sources` adapters beyond RSS are built |
| 3 | Multi-window-per-day schedules (e.g. London open + NY open)? Spec enforces one contiguous window at v1. | Data-model impact: `activeWindow` becomes `activeWindows[]`. Defer is cheap if we pick a forward-compatible JSON shape | Before first client that trades two sessions |
| 4 | Should suspended tenants keep their editorial memory writes visible on reactivation, or is there a data-retention policy on lapse > 30 days? | Tenancy policy, GDPR-adjacent | Before first `cancelled` transition in production |
| 5 | Is `maxPipelines` plan-derived only, or are per-tenant overrides allowed (sales exception)? Spec has plan-only. | Affects `tenant_operational_configs` shape | Before sales start negotiating exceptions |
| 6 | Plan changes mid-period: proration via Stripe's default, or FinFlow-side credit model? Spec assumes Stripe default. | UX expectations + finance reporting | Before first upgrade/downgrade |
| 7 | Does "concurrent runs" count queued jobs or only running jobs? Spec treats only `running` as concurrent; queued is bounded implicitly by `dailyBudgetCents`. | Quota semantics clarity | Before Task 14 ships |
| 8 | Email delivery provider: existing mailer (if any) or new SES/Resend integration? | Task 17 scope | Before Phase 4 starts |
| 9 | Demo MVP (`2026-04-13-demo-mvp.md`) currently runs single-tenant without a `tenant_subscriptions` row; does the demo get a bypass flag, or do we seed a `demo` plan that's always `active`? | Demo stability + one path instead of two | Before this spec's Task 4 lands |
| 10 | Editorial memory is tenant-scoped (per 2026-04-12 memory note). On plan downgrade that drops `max_pipelines`, do excess pipelines get archived or deleted? | Tenancy + data retention | Before first downgrade in production |
