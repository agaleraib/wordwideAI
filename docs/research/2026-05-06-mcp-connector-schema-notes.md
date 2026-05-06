# MCP Connector Schema Notes — input to `@wfx/ingest` resume

**Date:** 2026-05-06
**Status:** Reference (not a spec)
**Source material:** `docs/research/anthropic-finance-2026-05-06/` + `/tmp/anthropic-financial-services` clone @ `bb4a2b3e`
**Anchors:**
- `docs/specs/2026-04-07-data-sources.md` — `@wfx/ingest` Draft (paused Workstream B)
- Memory: `project_workstream_b_branches.md` (B is paused, sources-spec is frozen ancestor)

---

## 1. Why this doc exists

Anthropic's finance-agents repo includes MCP wiring for ~11 vendors (FactSet, S&P, Daloopa, Morningstar, LSEG, Moody's, PitchBook, Aiera, MT Newswires, Egnyte, Chronograph). The wiring lives in `.mcp.json` files inside plugin directories, plus partner-built plugins from LSEG and S&P Global with documented tool inventories.

This doc captures what's mineable for `@wfx/ingest` when Workstream B resumes — schema shapes, naming conventions, plugin-manifest layout, and tool-domain decomposition — and **explicitly notes where MCP and `@wfx/ingest` solve different problems** so the resume doesn't accidentally collapse them.

This is **not a spec amendment**. When `@wfx/ingest` resumes, this doc becomes input to the spec author.

---

## 2. Critical framing — MCP and `@wfx/ingest` are complementary, not competing

Different problems, different runtime model:

| Concern | `@wfx/ingest` | MCP (per Anthropic finance repo) |
|---|---|---|
| **Input shape** | URL endpoints, HTML, RSS feeds, YouTube, scraped pages | Typed remote function calls over HTTP |
| **Output shape** | `Document` (title, body, provenance, tenant scope) | Tool result (typed JSON, e.g. `{ price, yield, dv01 }`) |
| **Consumer** | Editorial pipeline (FA prompt input as text) | LLM agent runtime (TA structured-data input, FA citation lookups) |
| **Failure mode** | Network fetch fails → retry/backoff | Tool call fails → agent reasoning loop handles |
| **Persistence** | DocumentStore (SQLite, dedup memory, TTL) | Stateless — every call hits the vendor |
| **Auth model** | Per-source HTTP creds, optional API keys | MCP server handles auth (often OAuth with credential vault) |
| **Use case in FinFlow** | News → FA agent prose context | Computed market data → TA agent indicator inputs |

**Implication:** when `@wfx/ingest` resumes, do not add MCP as just another adapter alongside `rss` / `html` / `youtube`. MCP belongs in a different layer — closer to the agent runtime than the document ingest pipeline. Treat as **two distinct integration surfaces**.

---

## 3. Anthropic MCP wiring — observed shapes

### 3.1 The `.mcp.json` file (vertical-plugin level)

Located at `plugins/vertical-plugins/<vertical>/.mcp.json`. Verbatim shape (from `financial-analysis/.mcp.json`):

```json
{
  "mcpServers": {
    "daloopa":     { "type": "http", "url": "https://mcp.daloopa.com/server/mcp" },
    "morningstar": { "type": "http", "url": "https://mcp.morningstar.com/mcp" },
    "sp-global":   { "type": "http", "url": "https://kfinance.kensho.com/integrations/mcp" },
    "factset":     { "type": "http", "url": "https://mcp.factset.com/mcp" },
    "moodys":      { "type": "http", "url": "https://api.moodys.com/genai-ready-data/m1/mcp" },
    "mtnewswire":  { "type": "http", "url": "https://vast-mcp.blueskyapi.com/mtnewswires" },
    "aiera":       { "type": "http", "url": "https://mcp-pub.aiera.com" },
    "lseg":        { "type": "http", "url": "https://api.analytics.lseg.com/lfa/mcp" },
    "pitchbook":   { "type": "http", "url": "https://premium.mcp.pitchbook.com/mcp" },
    "chronograph": { "type": "http", "url": "https://ai.chronograph.pe/mcp" },
    "egnyte":      { "type": "http", "url": "https://mcp-server.egnyte.com/mcp" }
  }
}
```

Observations:
- All entries use `"type": "http"`. Stdio MCP servers don't appear in the finance suite — vendors run hosted SaaS.
- Vendor-key naming is short, lowercase, kebab-case (`sp-global`, `mtnewswire`).
- No auth fields in `.mcp.json` — credentials are managed by the MCP host (Claude Cowork / Code / Managed Agents), not declared here.

### 3.2 The `.claude-plugin/plugin.json` manifest (partner-built example)

Verbatim from `partner-built/lseg/.claude-plugin/plugin.json`:

```json
{
  "name": "lseg",
  "version": "1.0.0",
  "description": "Price bonds, analyze yield curves, evaluate FX carry trades, value options, and build macro dashboards using LSEG financial data and analytics.",
  "author": { "name": "LSEG" }
}
```

Observations:
- Plugin manifest is independent of MCP wiring — `.mcp.json` lives one directory up.
- Plugin folder co-locates `.mcp.json` + `commands/` + `skills/` + `CONNECTORS.md`.

### 3.3 Tool-domain decomposition (LSEG example)

`partner-built/lseg/CONNECTORS.md` documents tools by domain. Verbatim categories:

| Category | Placeholder | Tool names |
|---|---|---|
| Bond Pricing | `~~bond-pricing` | `bond_price`, `bond_future_price` |
| FX Pricing | `~~fx-pricing` | `fx_spot_price`, `fx_forward_price` |
| Interest Rate Curves | `~~ir-curves` | `interest_rate_curve`, `inflation_curve` |
| Credit Curves | `~~credit-curves` | `credit_curve` |
| FX Curves | `~~fx-curves` | `fx_forward_curve` |
| Options | `~~options` | `option_value`, `option_template_list` |
| Swaps | `~~swaps` | `ir_swap` |
| Volatility Surfaces | `~~volatility` | `fx_vol_surface`, `equity_vol_surface` |
| Quantitative Analytics | `~~qa` | `qa_ibes_consensus`, `qa_company_fundamentals`, `qa_historical_equity_price`, `qa_macroeconomic` |
| Time Series | `~~time-series` | `tscc_historical_pricing_summaries` |
| Fixed Income Analytics | `~~yieldbook` | `yieldbook_bond_reference`, `yieldbook_cashflow`, `yieldbook_scenario`, `fixed_income_risk_analytics` |

Observations:
- One MCP server, ~25 tools, 11 documented categories. Categories are hand-curated; no auto-grouping.
- Tool names are lowercase snake_case + domain prefix (`bond_*`, `fx_*`, `qa_*`). Convention is helpful for agent discovery — the agent can grep tool names by prefix.
- `~~placeholder` syntax in CONNECTORS.md is for Claude Code's plugin system and does not apply to FinFlow.

---

## 4. What to LIFT for `@wfx/ingest`

### 4.1 None of the MCP wiring directly

The MCP wiring is for tool-call agents inside the Claude runtime. `@wfx/ingest` is a TypeScript document-fetching package consumed by FinFlow / Robuust apps — different runtime, different shape. **Do not add an `mcp` adapter to `@wfx/ingest`.**

### 4.2 Patterns that DO transfer

| Pattern | Source | Apply to `@wfx/ingest` |
|---|---|---|
| **Vendor-key naming** — short, lowercase, kebab-case | `.mcp.json` | Use the same convention for `sourceId` in `Document.sourceId`. The spec already implies this (`"ft-markets-rss"`); the Anthropic convention validates the choice. |
| **Manifest separation** — `.mcp.json` (wiring) ≠ `plugin.json` (metadata) | `partner-built/lseg/` | When `@wfx/ingest` ships a "tenant adds a custom source" UX, separate **wiring** (URL, auth) from **metadata** (display name, description, vendor). |
| **Domain-grouped tool inventory** | `CONNECTORS.md` | When sources accumulate, group them by domain (e.g. `news/`, `central-banks/`, `broker-research/`, `social/`) in a `CONNECTORS.md`-style table for tenant onboarding. |
| **No-auth-in-config** model | `.mcp.json` | `@wfx/ingest` already does this — the spec's `Provenance` doesn't expose creds. The Anthropic pattern reinforces "config is public; secrets are runtime-injected." |

### 4.3 Patterns that do NOT transfer

| Pattern | Source | Why not |
|---|---|---|
| HTTP MCP server URL as the integration surface | `.mcp.json` | `@wfx/ingest` adapters fetch and parse documents directly. They don't proxy to a remote tool. |
| Stateless tool-call model | All MCP | `@wfx/ingest` requires DocumentStore for dedup and TTL — stateful by design. |
| LLM-discoverable tool prefix naming (`qa_*`, `bond_*`) | LSEG CONNECTORS.md | Adapter names in `@wfx/ingest` are typed in TS, not LLM-discovered. |

---

## 5. The MCP-shaped opportunity for FinFlow that ISN'T in `@wfx/ingest`

There's a separate, real opportunity that this research surfaces — **MCP at the agent layer, not the ingest layer**.

The TA agent's input is computed market data (OHLCV + indicators). Today the TA port spec (`docs/specs/2026-04-16-ta-typescript-port.md` §2.2) plans a `MarketDataProvider` interface with a `@wfx/sources` adapter when B ships. **An alternative / additional shape**: expose the same data behind an MCP server inside FinFlow itself (e.g. `mcp://localhost/finflow-marketdata`), so:

1. The TA agent invokes it via tool_use rather than receiving pre-computed data baked into the prompt.
2. The same MCP server can be exposed to a tenant's own analyst (Claude Cowork / Code) — same data, same tool surface — as a future B2B value-add.
3. Authoring is decoupled: market-data team owns the MCP server; agent prompt-engineers consume it as a tool. Mirrors how Anthropic itself structures `bond_price` etc. as tools rather than prompt context.

**This is not a recommendation to do this now.** It's a possibility surfaced by the research worth keeping in the back pocket when:
- The TA port reaches Phase 3 (prompt design).
- Workstream D (publishers) thinks about exposing FinFlow data to tenants programmatically.
- A design-partner conversation asks "can our analyst connect to your data?" — the MCP answer is more general than building bespoke exports.

Decision deferred. Logged as a research finding only.

---

## 6. Suggested delta vs. `2026-04-07-data-sources.md`

When the `@wfx/ingest` spec resumes, three small clarifying additions, all derived from the Anthropic patterns above:

1. **§3 (Terminology):** add a one-paragraph delineation "MCP servers (vendor data tools) are NOT `@wfx/ingest` adapters; they live at the agent runtime layer. Cross-reference: §X of the agent layer doc (TBD)."
2. **§5.2 (`Source` interface):** keep the typed-TS shape; cite the Anthropic `.mcp.json` pattern as a counter-example showing why HTTP-MCP-over-`Source` would force the package to leak agent-runtime concerns.
3. **§ new — Tenant-extensible sources catalog:** lift the manifest separation (wiring vs. metadata) when designing the tenant-onboarding UX for adding custom sources.

These are clarifying notes, not architectural changes. The original `@wfx/ingest` design is sound; this material confirms it rather than redirects it.

---

## 7. What this doc does NOT do

- It does not amend `2026-04-07-data-sources.md`. (Suggested deltas land when B resumes, not now.)
- It does not propose adding MCP to `@wfx/ingest`. (See §4.1.)
- It does not commit to building an MCP server for FinFlow market data. (See §5 — research finding only.)
- It does not address auth, billing, or the Apache-2.0 reuse boundary (no Anthropic code is being copied — only patterns are being noted).

---

## 8. Suggested next step (if/when prioritized)

When Workstream B resumes (gated on Workstream C reaching first-tenant-shipping per `plan.md`):
- Spec author reads this doc as input to §3, §5.2, and the new tenant-extensible-sources section.
- Decide whether the §5 MCP-at-agent-layer opportunity warrants its own short brief (~`docs/specs/2026-XX-XX-finflow-marketdata-mcp.md`) — this is a separate decision, not coupled to `@wfx/ingest` resume.
