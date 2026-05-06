# Anthropic Finance Agents — Research Snapshot (2026-05-06)

## What this is

Reference material lifted from Anthropic's open-source finance-agents cookbook for FinFlow's review. **Not active codebase.** Apache-2.0 licensed (see `LICENSE-Apache-2.0`).

## Source

- Repo: https://github.com/anthropics/financial-services
- Announcement: https://www.anthropic.com/news/finance-agents
- Snapshot date: 2026-05-06
- Upstream commit: `bb4a2b3e53cf27f8900b33ed6a2d95ed32e57f1d`

## Why this is here

See memory `project_anthropic_finance_agents.md`. Direct integration verdict was **no** (audience, runtime, and cost-shape mismatch with FinFlow). These files are kept as:
1. Prompt-engineering benchmarks for the FA agent — compare structure and skill decomposition before next FA-prompt iteration.
2. Reference shape for `@wfx/sources` MCP-style connector specs (Workstream B, paused).
3. Sanity-check input when picking the next structural-variants iteration layer (Wave 4 successor).

## Files

| File | What it is |
|------|------------|
| `agent-system-prompt.md` | The Market Researcher agent's top-level system prompt (`plugins/agent-plugins/market-researcher/agents/market-researcher.md`) |
| `skills/sector-overview.md` | Bundled `sector-overview` skill — industry landscape report structure |
| `skills/competitive-analysis.md` | Bundled `competitive-analysis` skill — peer/positioning analysis |
| `skills/competitive-analysis-references/` | Reference frameworks & schemas attached to competitive-analysis |
| `skills/idea-generation.md` | Bundled `idea-generation` skill — stock screening workflow |
| `LICENSE-Apache-2.0` | License under which the upstream content is reusable |

## How to use

- Treat as read-only reference. Do **not** import or `require()` from runtime code.
- Quote-and-adapt is fine under Apache-2.0 (preserve attribution + LICENSE).
- If reused inside a FinFlow prompt, mark the lifted block with a comment `// adapted from anthropics/financial-services (Apache-2.0)`.

## Audience-divergence reminder

These prompts target **institutional sell-side / buy-side analyst desks**. FinFlow targets **retail FX broker end-customers**. Direct copy-paste of phrasing will inherit the wrong audience register — use for *structure* and *skill decomposition*, not voice or tone.
