# FinFlow Deployment Stack & LLM Provider Abstraction

**Date:** 2026-04-07
**Status:** Draft (decision spec — no code yet)
**Branch:** `workstream-b-sources-spec`
**Owners:** Albert Galera (decisions), Claude (drafting)
**Supersedes:** ad-hoc stack notes in `CLAUDE.md` and `docs/architecture.md`

---

## 1. Goal

Lock the production stack and deployment model for FinFlow so that:

1. We can deploy the same codebase as **(a) a shared multi-tenant SaaS** (smaller clients, one VM) *and* **(b) a dedicated single-tenant VM** (larger clients, compliance/scale separation), without forking. **Both modes are operated by us — we never ship self-installable software to clients.**
2. We are **not tied to a single LLM provider**. Adding OpenAI, Google Gemini, or a local model in the future is a config change, not a refactor.
3. Deployment is boring: one VM per environment, one `docker compose up`, automatic HTTPS, no Kubernetes, no managed services. Internal ops tooling, not a client experience.

This spec captures the decisions. Implementation is tracked separately in Second Brain.

---

## 2. Non-goals

| Out of scope | Why |
|---|---|
| Kubernetes / multi-node orchestration | Overkill for our scale; we manage individual VMs, not clusters |
| Managed cloud DBs (RDS, Neon, Supabase) as the *only* option | Dedicated-VM clients may want the DB on the same box; we keep self-managed Postgres as the canonical path |
| **Self-installable / client-operated software** | We always deploy and operate. No `wfx-update` for clients to run, no installer downloads, no client-owned backups. Removing this constraint **simplifies** the design — no installer UX, no client-facing migration tooling, no version-skew handling for unsupervised installs. |
| Air-gapped / fully offline deploys | Not a current customer requirement; revisit if a regulated client asks |
| Replacing the React frontend | `packages/web` is already built and matches the premium-UI brief; no rewrite |
| Migrating away from Bun | Bun stays; Node compatibility is the escape hatch, not the goal |

---

## 3. Deployment modes

Both modes are operated by the WordwideFX team. Clients never SSH into the box, never run `wfx-update`, never own a backup tape. They consume a managed service via the web UI and (optionally) API.

### Mode A — Shared multi-tenant SaaS

- Single VM (Hetzner / DigitalOcean / a real cloud VM) running the standard Docker Compose stack.
- Multi-tenant: clients are rows in `tenants`, isolated by `tenant_id` on every relevant table.
- Used for **smaller clients** who don't need their own infrastructure and are fine sharing a host.
- Caddy terminates HTTPS via Let's Encrypt for `*.wordwidefx.com` and any custom domains we attach.
- Postgres on the same host. We move to managed Postgres only if/when scale demands it; the app code doesn't care.
- Backups: nightly `pg_dump` to S3-compatible storage. **Owned and verified by us.**

### Mode B — Dedicated single-tenant VM

- A separate VM running **the same Docker Compose stack as Mode A**, set to single-tenant mode via env var.
- Used for **larger clients** who need their own box for compliance, scale separation, dedicated resources, or regulatory isolation.
- Provisioned, deployed, monitored, and updated by us. The client may have read-only audit access if compliance requires it; they do not have ops access.
- Caddy provisions HTTPS for the client's brand domain.
- Backups: same `pg_dump` job. **Owned and verified by us**, with retention per the client's contract.
- Updates: pushed by our internal deploy pipeline on the same release cadence as Mode A. No client action required.

### What's the same

**The two modes share the exact same Docker Compose file, the same images, the same release cadence.** Differences are environment variables only:

```
DEPLOY_MODE=saas|dedicated      # affects logging targets, metric labels
TENANT_MODE=multi|single        # affects auth + tenant-scoping middleware
TENANT_ID=<fixed>               # only set in dedicated mode
```

This means:
- One CI pipeline, one image registry, one release process.
- Bug fixes land in both modes simultaneously.
- A dedicated client cannot lag behind on versions — we keep them current as a service guarantee.
- We can promote a Mode-A tenant to Mode B (or split a noisy tenant out of the shared VM) by spinning a new VM and migrating their Postgres rows. No code changes.

---

## 4. Stack decisions

| Layer | Choice | Rationale |
|---|---|---|
| **OS** | Ubuntu 24.04 LTS | Universal, long support window, what every client ops team knows |
| **Container runtime** | Docker + Docker Compose v2 | Boring, single-node, no orchestrator. Same compose file for SaaS and appliance. |
| **Reverse proxy / TLS** | **Caddy 2** | Automatic HTTPS, single binary, Caddyfile is one screen. Apache and nginx both lose to Caddy on operator ergonomics for this scale. |
| **Runtime** | **Bun** (latest LTS) | Already in use; Hono runs on Bun and Node, so Node is a one-line escape hatch if a client refuses Bun |
| **API framework** | **Hono + Zod** | Already in use; runtime-portable; tiny |
| **Database** | **Postgres 16 + pgvector** | `jsonb` for `AuditEntry`/scorecard storage. **`pgvector` is required from day one** — the content-uniqueness gate (see `2026-04-07-content-uniqueness.md`) uses cosine-similarity lookups against generated content embeddings to enforce cross-tenant content uniqueness. Originally scoped as "future RAG"; promoted because uniqueness is a launch requirement. MariaDB has no equivalent. |
| **ORM / query layer** | **Drizzle ORM** | TS-native, schema-as-code, fits the existing repository pattern (`ProfileStore` / `TranslationStore` interfaces become Drizzle-backed implementations). Migration tooling is first-class. |
| **LLM access** | **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) | See §5. Unified TS/Zod-first API across all providers. |
| **Frontend** | **React 19 + Vite 8 + Tailwind v4 + framer-motion** | Already built. Matches the premium-UI brief. No rewrite. |
| **Background jobs** | **BullMQ + Redis** (added when needed) | Source ingestion, scheduled benchmarks, retry logic. Redis is one extra container. Not needed day one — add when the scheduler arrives. |
| **Observability** | Structured JSON logs to stdout → Loki (SaaS) / journald (appliance); Prometheus metrics endpoint on the API | Same code, two collection backends |
| **Secrets** | `.env` file on the VM, never in the image, never in git. Provider keys, DB password, JWT secret. | Simple, auditable, works for both modes |

**Explicitly rejected:**

- **Apache** — outdated for reverse-proxying a Bun/Hono app. Caddy wins.
- **MariaDB** — weaker JSON support, no vector story, no Drizzle/Prisma first-class support compared to Postgres. No win for our use case.
- **HTMX + Alpine + Bootstrap 5.3** — would require throwing away `packages/web` and downgrading the UI ceiling. Conflicts with the documented "premium, dark, non-AI-looking, spectacular animations" brief. HTMX's strength is server-rendered CRUD; ours is real-time SSE pipeline visualization with streaming LLM output, which is React's strength.
- **Kubernetes** — operational overhead with no benefit at our scale, hostile to appliance deploys.

---

## 5. LLM provider abstraction

### 5.1 Why multi-provider

Confirmed motivations (in priority order):

1. **No vendor lock-in.** A pricing change, T&C change, or outage at any single provider must not break the product.
2. **Redundancy / failover.** If Anthropic is down, the pipeline must keep working (possibly with degraded quality, but working).
3. **Best-of-breed per task.** Long-context summarization may favor Gemini 2.5 Pro; nuanced translation favors Opus; cheap structured extraction may favor Haiku or 4o-mini.
4. **Local LLMs in the future.** Ollama / vLLM / LM Studio expose OpenAI-compatible APIs. The abstraction must accommodate them with no engine changes.

### 5.2 Choice: Vercel AI SDK

The translation engine moves from direct `@anthropic-ai/sdk` calls to the **Vercel AI SDK** (`ai` package) with provider plugins:

```ts
import { generateObject, generateText, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai }    from '@ai-sdk/openai';
import { google }    from '@ai-sdk/google';
```

Why AI SDK over alternatives:

- **TS-native, Zod-first.** `generateObject({ model, schema: zodSchema })` replaces every existing `tool_use` call with one unified API. The same Zod schemas the codebase already uses (scorecard, correction plan, profile) drop in unchanged.
- **Streaming parity.** `streamText` works identically across providers. The existing SSE pipeline (`pipeline/events.ts`, `useSSE.ts`) keeps working.
- **Tool-calling parity.** AI SDK normalizes Anthropic `tool_use` blocks vs OpenAI function calls vs Gemini function declarations.
- **Local-LLM ready.** `createOpenAI({ baseURL: 'http://localhost:11434/v1' })` points at Ollama, vLLM, or LM Studio with no other code change. This is how requirement #4 is satisfied.
- **Maintained.** Used by Vercel, v0, Cursor, Perplexity. Not a side project.

**Rejected alternatives:**

- **LiteLLM proxy** — sidecar, OpenAI-compatible API to all providers. Loses native tool semantics, adds a Python service to the stack, worse fit for a TS-only codebase.
- **Roll our own provider abstraction** — reinvents the AI SDK with worse test coverage and no community.

### 5.3 Provider as a per-tenant config knob

Multi-provider is **per-tenant**, not per-stage round-robin. A given client's pipeline runs entirely on one provider per stage (translation, scoring, arbiter, specialists, glossary patcher). Mixing providers within a single translation run is **forbidden** because:

- The 13-metric scoring thresholds were calibrated against Opus. LLM-judge metrics on a different model produce a different score distribution.
- The consistency-at-scale value prop was measured on Anthropic. We must be able to tell a client "your variance number is X" with a meaningful number behind it.
- Specialist behavior differs across providers (Opus is surgical, GPT-4.1 rewrites more aggressively, Gemini is more literal). The "minimal correction" contract isn't free across providers.

Concretely, `ClientProfile` gains a `providerBinding` field:

```ts
type ProviderBinding = {
  translation:    { provider: 'anthropic' | 'openai' | 'google' | 'local'; model: string };
  scoring:        { provider: ...; model: string };
  arbiter:        { provider: ...; model: string };
  specialist:     { provider: ...; model: string };
  glossaryPatch:  { provider: ...; model: string };
};
```

`lib/model-router.ts` (which currently picks Opus vs Haiku) is extended to resolve `(stage, profile) → AI SDK model instance`. The engine itself never imports a provider package directly.

### 5.4 Failover policy

Failover is **same-provider tier-down only**, not cross-provider:

- ✅ Opus → Sonnet → Haiku on Anthropic outages
- ✅ GPT-4.1 → GPT-4o → GPT-4o-mini on OpenAI outages
- ❌ Anthropic Opus → OpenAI GPT-4.1 mid-pipeline

Cross-provider failover is forbidden mid-run for the same scoring-coherence reason as §5.3. A tenant can be **manually** re-bound to a different provider via config, but the system never does it silently.

### 5.5 Per-provider quality gating

Before a provider is offered to clients, it must pass the existing benchmark harness:

1. Run `consistency-test.ts` on the provider's model lineup.
2. Run `ab-test.ts` against the Anthropic baseline.
3. Document the per-provider score distribution and known regressions in `docs/specs/`.

Clients pick a provider knowing the trade-off. No silent quality drift.

### 5.6 Local LLM support (future)

When a client requires local-only inference:

- AI SDK's OpenAI provider is pointed at an Ollama/vLLM endpoint via `baseURL`.
- The engine code is unchanged.
- The benchmark harness must be re-run on the local model — we make no quality claims for local providers we haven't measured.

This satisfies requirement #4 with zero architectural change. **No work is needed today**; the abstraction is future-proof by construction.

---

## 6. Repository / runtime layout impact

The stack decisions imply these new packages and changes:

```
packages/
  api/        existing — migrate Anthropic SDK calls to AI SDK
  web/        existing — no changes
  sources/    spec'd separately (2026-04-07-data-sources.md)
  db/         NEW — Drizzle schema, migrations, repository implementations
  llm/        NEW — AI SDK wrapper, model-router, provider bindings
deploy/
  docker/
    Dockerfile.api
    Dockerfile.web
    docker-compose.yml         shared by Mode A (shared SaaS) and Mode B (dedicated VM)
    Caddyfile.template
  scripts/                     INTERNAL ops tooling — not client-facing
    provision.sh               stand up a new VM (shared or dedicated) from a clean Ubuntu
    deploy.sh                  pulls new images, runs migrations, restarts (run by us, not the client)
    backup.sh                  nightly pg_dump to our S3
    promote-tenant.sh          migrate a tenant from Mode A to a new Mode B VM
docs/specs/
  2026-04-07-deployment-stack.md  (this file)
```

`packages/llm/` is small but important: it is the **only** place that imports `@ai-sdk/*` packages. The translation engine imports from `@wfx/llm`, never directly from a provider SDK. This is the lock-in firewall.

`packages/db/` provides Drizzle-backed implementations of `ProfileStore` and `TranslationStore`. The engine continues to depend on the interfaces in `packages/api/src/lib/types.ts` — no engine code changes when we swap from in-memory to Postgres.

---

## 7. Migration path

This is a **direction**, not a sprint plan. Order matters; each step is independently shippable.

1. **Wrap Anthropic SDK behind AI SDK** (no behavior change). Migrate all 5 agents one at a time. Re-run the consistency benchmark after each migration to confirm no quality drift. **This is the foundational step — everything else depends on it.**
2. **Stand up `packages/db/` with Drizzle + Postgres.** Implement `ProfileStore` and `TranslationStore` against Postgres. Keep in-memory implementations for tests and dev. Run migrations on startup.
3. **Add `packages/llm/`** as the provider abstraction. Move `model-router.ts` here. Add `providerBinding` to `ClientProfile`. Default everything to Anthropic — no behavior change yet.
4. **Add OpenAI and Google providers.** Run the benchmark harness against each. Document deltas. Ship behind a feature flag until a client explicitly opts in.
5. **Build the Docker Compose deployment.** Caddyfile, Dockerfiles, install/update scripts. Test on a throwaway VM end-to-end.
6. **Write the appliance install guide.** One page, one command, screenshots.
7. **Add BullMQ + Redis** when the source-ingestion scheduler arrives (Workstream B).
8. **Local LLM support** is on hold until a real client asks. The abstraction supports it the day they do.

No work in this list **changes** the translation engine's behavior. Every step is a structural refactor or an additive change behind a flag.

---

## 8. Open questions

| Question | Owner | Needed by |
|---|---|---|
| Tenant data isolation: row-level (`tenant_id` everywhere) vs schema-per-tenant in Postgres? | Albert | Before `packages/db/` schema is written |
| SaaS auth: roll our own JWT vs Clerk vs Auth.js? | Albert | Before Mode A goes live |
| Object storage for uploaded `.docx` files: filesystem-backed (dev) + S3-backed (prod) behind one interface? | Claude to draft | Before file uploads ship |
| Per-tenant secret management: how do we store provider keys for clients who BYO their own Anthropic/OpenAI account? | Albert + Claude | Before second SaaS tenant onboards |

---

## 9. Decision log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-07 | Caddy over Apache/nginx | Auto-HTTPS, single binary, ergonomic for appliance deploys |
| 2026-04-07 | Postgres over MariaDB | `jsonb` for audit trail, `pgvector` for future RAG, better TS ecosystem |
| 2026-04-07 | Keep React frontend, reject HTMX/Alpine/Bootstrap | Already built; matches premium-UI brief; React's strength is real-time SSE visualization |
| 2026-04-07 | Vercel AI SDK over LiteLLM and roll-your-own | TS-native, Zod-first, local-LLM-ready via OpenAI-compatible baseURL |
| 2026-04-07 | Multi-provider is per-tenant, not per-stage | Scoring coherence; benchmark numbers must be meaningful |
| 2026-04-07 | Failover is same-provider tier-down only | Same scoring-coherence reason |
| 2026-04-07 | Same Docker Compose file for shared SaaS and dedicated VM | One artifact, two modes via env vars |
| 2026-04-07 | We always operate the deploy; no self-installable software | Removes installer UX, client-owned backups, version skew, support burden |
| 2026-04-07 | pgvector required from day one (not "future RAG") | Content-uniqueness gate uses cosine similarity over embeddings to enforce per-event deduplication across tenants |
