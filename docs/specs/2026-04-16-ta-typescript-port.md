# Technical Analysis Agent -- TypeScript Port & Pipeline Integration

**Status:** Proposal -- decision pending (depends on archetype model adoption).
**Date:** 2026-04-16
**Author:** Alex + Claude
**Related:**
- `docs/specs/2026-04-16-content-uniqueness-v2.md` -- framework archetype model (defines how TA is consumed)
- `docs/specs/2026-04-07-content-pipeline.md` -- the pipeline TA plugs into (sections 5.7a, 4.1, 7.7)
- `docs/specs/2026-04-07-data-sources.md` -- @wfx/sources (market data dependency)
- `finflow/agents/ta_agent.py` -- legacy Python TA agent (port source)
- `finflow/data/market_data.py` -- legacy Python market data fetcher (port source)
- `finflow/instruments.py` -- legacy Python instrument catalog (port source)

---

## 1. Goal

Port the Technical Analysis (TA) agent from the legacy Python prototype to TypeScript and wire it into the content pipeline as a peer to the existing FA agent. The TA agent produces structured technical analysis -- support/resistance levels, chart patterns, momentum indicators, trend direction, and trade setups -- that framework archetype identity calls consume alongside FA output.

**What this enables:**
- Pipelines with `analyticalMethod: 'ta'` or `analyticalMethod: 'fa+ta'` can produce content grounded in real technical data
- The framework archetype model's per-framework TA timeframe selection works (Conservative Advisor gets weekly+monthly TA; Active Trader Desk gets daily+weekly)
- The demo MVP can show side-by-side FA+TA analysis in the Pipeline Monitor

**What this does NOT do:**
- Real-time chart rendering (TradingView Lightweight Charts integration is post-demo)
- Custom indicator development (fixed indicator set at v1)
- Automated trade signal generation (TA is analytical, not advisory)

---

## 2. Legacy Python Reference

### 2.1 What exists

| File | Size | What it does | Port status |
|---|---|---|---|
| `finflow/agents/ta_agent.py` | ~106 lines | TA agent with market data context builder. JSON-in-text output format. `build_context()` assembles price action + indicators + levels. Accepts `bias_hint` for demo orchestration. | **Port -- rewrite with tool_use** |
| `finflow/data/market_data.py` | ~146 lines | OHLCV fetcher (yfinance) + technical indicator computation (RSI, MACD, Bollinger, Stochastic, ATR, SMAs). CSV caching for offline fallback. | **Port core logic; replace yfinance with @wfx/sources adapter** |
| `finflow/instruments.py` | ~228 lines | Instrument catalog (3 instruments: EURUSD, Gold, Oil). `InstrumentConfig` dataclass with ticker, levels, formatting, scenarios, biases. | **Port to TS; expand catalog** |

### 2.2 What to port

**From `ta_agent.py`:**
- The 7-part analysis framework (price action, trend structure, momentum, volatility, chart patterns, key levels, trade setup)
- The structured output shape (outlook, confidence, narrative, key_points, key_levels, patterns, trade_setup, risk_factors)
- The market data context builder (`build_context`)

**What to change:**
- Replace JSON-in-text output with Anthropic `tool_use` structured output
- Replace `bias_hint` (demo hack) with framework archetype stance directives
- Add timeframe awareness (daily/weekly/monthly are separate TA runs)
- Add instrument catalog grounding from the ported `InstrumentCatalogEntry`

**From `market_data.py`:**
- The indicator computation functions (RSI, MACD, Bollinger, Stochastic, ATR, SMA/EMA)
- The `get_price_summary` function that assembles the concise context for the agent

**What to change:**
- Replace `yfinance` with the `@wfx/sources` market data adapter (when workstream B ships)
- Replace `pandas`/`numpy` with pure TypeScript computation (the math is straightforward)
- Add multi-timeframe support (daily, weekly, monthly OHLCV)
- Add a `MarketDataProvider` interface for dependency injection

**From `instruments.py`:**
- The `InstrumentConfig` shape (ticker, levels, formatting, scenarios)
- The 3 instrument configs (EURUSD, Gold, Oil)

**What to change:**
- Align with the `InstrumentCatalogEntry` type from content-pipeline spec section 6
- Expand from 3 to ~15-20 instruments for production
- Add per-instrument default timeframes and indicator relevance

### 2.3 What to skip

- `bias_hint` system prompt injection (demo-specific, replaced by framework archetypes)
- `compliance_seed_phrase` on instruments (demo orchestration, not production)
- CSV caching for yfinance (replaced by @wfx/sources caching layer)
- `pandas`/`numpy` dependency (rewrite in pure TS)

---

## 3. TA in the Framework Archetype Model

### 3.1 One TA call per (instrument x timeframe)

Under the archetype model (`2026-04-16-content-uniqueness-v2.md` section 4):

```
Per instrument:
  1 TA call per timeframe = up to 3 calls (daily, weekly, monthly)
  Cached per (instrument_id, timeframe) with 24h TTL
  NOT per-tenant or per-framework

Per framework identity call:
  Receives the TA output(s) for only the timeframes it cares about
  Selects which levels/patterns/indicators to foreground
```

This means:
- **Daily TA for EUR/USD** is computed once and shared by Active Trader Desk (which foregrounds it) and any other framework that includes daily
- **Monthly TA for EUR/USD** is computed once and shared by Conservative Advisor and Contrarian Strategist
- At most 3 TA calls per instrument per event, regardless of tenant count

### 3.2 Framework-to-timeframe mapping

| Framework | Timeframes consumed | TA emphasis |
|-----------|-------------------|-------------|
| Conservative Advisor | weekly, monthly | Macro trend direction, long-term S/R zones, SMA alignment |
| Active Trader Desk | daily, weekly | Intraday momentum, precise levels, patterns, entry/exit zones |
| Retail Educator | daily | Simple: "price is above/below key level", RSI overbought/oversold |
| Contrarian Strategist | weekly, monthly | Divergence signals (RSI divergence, MACD cross), extreme positioning |

### 3.3 FA+TA composition

When a pipeline uses `analyticalMethod: 'fa+ta'`, the identity call receives both:
- FA core analysis (facts-only, shared across all frameworks)
- TA analysis for the framework's selected timeframes

The framework's `compositionStyle` field determines how FA and TA are woven together:

| Composition style | How it works |
|---|---|
| `integrated-narrative` | FA and TA are blended into a single analytical narrative ("fundamentally, ECB policy divergence supports EUR; technically, the pair is testing 1.0850 resistance with bullish MACD crossover...") |
| `split-sections` | Separate "Fundamental View" and "Technical View" sections |
| `fa-with-ta-sidebar` | FA is the primary narrative; TA levels and signals appear as a sidebar/callout |
| `ta-with-fa-context` | TA is the primary analysis; FA provides macro context |

---

## 4. TA Agent Contract

### 4.1 Input type

```ts
type TAAgentInput = {
  instrument: InstrumentCatalogEntry;
  timeframe: 'daily' | 'weekly' | 'monthly';
  marketData: MarketDataSnapshot;
  // No persona, no angle, no framework -- TA is framework-agnostic
  // Framework selection happens at the identity layer
};

type MarketDataSnapshot = {
  instrument: string;            // canonical id, e.g. "eurusd"
  timeframe: 'daily' | 'weekly' | 'monthly';
  snapshotAt: Date;              // when this data was captured

  // OHLCV
  ohlcv: OHLCVBar[];            // most recent N bars (N=50 for daily, 52 for weekly, 24 for monthly)
  lastClose: number;
  previousClose: number;
  dailyChangePct: number;
  high52w: number;
  low52w: number;

  // Computed indicators (pre-computed by the market data provider)
  indicators: TechnicalIndicators;
};

type OHLCVBar = {
  date: string;                  // ISO date
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TechnicalIndicators = {
  // Moving averages
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;

  // Momentum
  rsi14: number | null;          // 0-100
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochK: number | null;
  stochD: number | null;

  // Volatility
  atr14: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPosition: 'near-upper' | 'mid-range' | 'near-lower' | null;

  // Trend
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  sma50AboveSma200: boolean | null;  // golden/death cross
};
```

### 4.2 Output type (via tool_use)

```ts
type TAAgentOutput = {
  instrument: string;
  timeframe: 'daily' | 'weekly' | 'monthly';

  // Directional view
  outlook: 'bullish' | 'bearish' | 'neutral';
  confidence: number;            // 0-100

  // Narrative (the prose the identity agent will consume)
  narrative: string;             // 2-3 paragraphs of analysis

  // Structured data (for identity agent selection and formatting)
  keyLevels: {
    support: Array<{ level: number; description: string; strength: 'strong' | 'moderate' | 'weak' }>;
    resistance: Array<{ level: number; description: string; strength: 'strong' | 'moderate' | 'weak' }>;
  };
  patterns: Array<{
    name: string;                // e.g. "ascending triangle", "head and shoulders"
    type: 'continuation' | 'reversal';
    implication: 'bullish' | 'bearish';
    confidence: 'confirmed' | 'forming' | 'potential';
  }>;
  momentum: {
    rsiSignal: 'overbought' | 'neutral' | 'oversold' | null;
    macdSignal: 'bullish-cross' | 'bearish-cross' | 'bullish' | 'bearish' | null;
    stochSignal: 'overbought' | 'neutral' | 'oversold' | null;
    overallMomentum: 'strong-bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong-bearish';
  };
  trendStructure: {
    primary: 'uptrend' | 'downtrend' | 'sideways';
    secondary: 'uptrend' | 'downtrend' | 'sideways' | null;
    smaAlignment: 'bullish' | 'bearish' | 'mixed';
  };

  // Trade setup (only for frameworks that want explicit levels)
  tradeSetup: {
    bias: 'long' | 'short' | 'neutral';
    entryZone: string | null;    // e.g. "1.0820-1.0840"
    stopLoss: string | null;     // e.g. "1.0780"
    targets: string[];           // e.g. ["1.0920", "1.0960"]
  } | null;

  // Risk factors
  riskFactors: string[];

  // Key points (3-5 bullet points for summary)
  keyPoints: string[];
};
```

### 4.3 Tool schema

```ts
const TA_ANALYSIS_TOOL = {
  name: "submit_technical_analysis",
  description: "Submit structured technical analysis for the given instrument and timeframe.",
  input_schema: {
    type: "object" as const,
    properties: {
      outlook: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      confidence: { type: "number", minimum: 0, maximum: 100 },
      narrative: { type: "string", description: "2-3 paragraph technical analysis." },
      keyLevels: {
        type: "object",
        properties: {
          support: {
            type: "array",
            items: {
              type: "object",
              properties: {
                level: { type: "number" },
                description: { type: "string" },
                strength: { type: "string", enum: ["strong", "moderate", "weak"] },
              },
              required: ["level", "description", "strength"],
            },
          },
          resistance: {
            type: "array",
            items: {
              type: "object",
              properties: {
                level: { type: "number" },
                description: { type: "string" },
                strength: { type: "string", enum: ["strong", "moderate", "weak"] },
              },
              required: ["level", "description", "strength"],
            },
          },
        },
        required: ["support", "resistance"],
      },
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["continuation", "reversal"] },
            implication: { type: "string", enum: ["bullish", "bearish"] },
            confidence: { type: "string", enum: ["confirmed", "forming", "potential"] },
          },
          required: ["name", "type", "implication", "confidence"],
        },
      },
      momentum: {
        type: "object",
        properties: {
          rsiSignal: { type: "string", enum: ["overbought", "neutral", "oversold"], nullable: true },
          macdSignal: { type: "string", enum: ["bullish-cross", "bearish-cross", "bullish", "bearish"], nullable: true },
          stochSignal: { type: "string", enum: ["overbought", "neutral", "oversold"], nullable: true },
          overallMomentum: { type: "string", enum: ["strong-bullish", "bullish", "neutral", "bearish", "strong-bearish"] },
        },
        required: ["overallMomentum"],
      },
      trendStructure: {
        type: "object",
        properties: {
          primary: { type: "string", enum: ["uptrend", "downtrend", "sideways"] },
          secondary: { type: "string", enum: ["uptrend", "downtrend", "sideways"], nullable: true },
          smaAlignment: { type: "string", enum: ["bullish", "bearish", "mixed"] },
        },
        required: ["primary", "smaAlignment"],
      },
      tradeSetup: {
        type: "object",
        nullable: true,
        properties: {
          bias: { type: "string", enum: ["long", "short", "neutral"] },
          entryZone: { type: "string", nullable: true },
          stopLoss: { type: "string", nullable: true },
          targets: { type: "array", items: { type: "string" } },
        },
        required: ["bias"],
      },
      riskFactors: { type: "array", items: { type: "string" } },
      keyPoints: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
    },
    required: ["outlook", "confidence", "narrative", "keyLevels", "patterns", "momentum", "trendStructure", "riskFactors", "keyPoints"],
  },
};
```

---

## 5. Timeframe Model

### 5.1 Three canonical timeframes

| Timeframe | OHLCV interval | Bar count | Lookback | Typical consumers |
|-----------|---------------|-----------|----------|-------------------|
| **Daily** | 1-day bars | 50 bars | ~2.5 months | Active Trader, Retail Educator |
| **Weekly** | 1-week bars | 52 bars | ~1 year | All frameworks |
| **Monthly** | 1-month bars | 24 bars | ~2 years | Conservative, Contrarian |

### 5.2 Indicator relevance by timeframe

Not all indicators are meaningful at all timeframes. The TA agent's system prompt adjusts emphasis:

| Indicator | Daily | Weekly | Monthly |
|-----------|-------|--------|---------|
| RSI(14) | High | High | Moderate |
| MACD(12,26,9) | High | High | Moderate |
| Stochastic(14,3) | High | Moderate | Low |
| Bollinger Bands(20,2) | High | Moderate | Low |
| ATR(14) | High | Moderate | Low |
| SMA 50/200 | High | High | High |
| Chart patterns | High | High | Moderate |
| Fibonacci levels | Moderate | High | High |

### 5.3 Cache key and TTL

TA output is cached in `domain_analyses` (content-pipeline spec section 7.7) with:

```
cache_key = (instrument_id, timeframe, 'ta')
TTL = timeframe-dependent:
  daily:   8 hours (markets move intraday)
  weekly:  24 hours (same as FA)
  monthly: 48 hours (slow-moving data)
```

The `analytical_method` field stores `'ta-daily'`, `'ta-weekly'`, or `'ta-monthly'` to distinguish from FA entries.

---

## 6. Pipeline Integration

### 6.1 Where TA sits alongside FA

Reference content-pipeline spec section 5.7a. Today:

```
Brief approved --> check domain_analyses cache for (event_id, topic_id, analytical_method)
  cache miss --> invoke core agent (FA or TA or FA+TA)
  cache hit  --> reuse
```

With TA ported, the three core agents become:

| Agent | Cache key suffix | Model | Input | Output |
|---|---|---|---|---|
| `FundamentalAnalystAgent` | `'fa'` | Opus | Event documents, instrument catalog | Authoritative FA prose (facts-only under archetype model) |
| `TechnicalAnalystAgent` | `'ta-{timeframe}'` | Opus | `MarketDataSnapshot` for the specific timeframe | Authoritative TA prose + structured levels/patterns/momentum |
| `IntegratedAnalystAgent` | `'fa+ta'` | Opus | Event docs + market data for all relevant timeframes | Integrated FA+TA analysis |

**Change from current spec:** the `TechnicalAnalystAgent` produces up to 3 cache entries per instrument (one per timeframe), not a single entry. The `IntegratedAnalystAgent` consumes all timeframe entries relevant to the requesting framework.

### 6.2 How the identity agent consumes TA

The identity agent (content-pipeline section 5.7b) currently receives a `DomainAnalysis` blob. With TA:

```ts
type IdentityAgentInput = {
  coreAnalysis: DomainAnalysis;       // FA output (facts-only)
  technicalAnalysis?: {               // TA outputs for framework's timeframes
    daily?: TAAgentOutput;
    weekly?: TAAgentOutput;
    monthly?: TAAgentOutput;
  };
  brief: ContentBrief;
  contentPersona: ContentPersona;
  frameworkArchetype: FrameworkArchetype;  // NEW: defines how to compose FA+TA
};
```

The framework's `compositionStyle` and `taEmphasis` fields tell the identity agent how to weave FA and TA:
- `taEmphasis: 'levels-only'` -- identity agent extracts support/resistance from TA output, weaves into FA narrative
- `taEmphasis: 'patterns-and-levels'` -- includes chart patterns alongside levels
- `taEmphasis: 'full-technical'` -- dedicates a section to full TA analysis
- `taEmphasis: 'none'` -- TA output is not passed to the identity agent (FA-only pipeline)

### 6.3 FA+TA hybrid pipelines

When `analyticalMethod: 'fa+ta'`, the pipeline:

1. Checks FA cache for `(event_id, topic_id, 'fa')`
2. Checks TA cache for each of the framework's timeframes: `(instrument_id, timeframe, 'ta-{timeframe}')`
3. If FA+TA integrated analysis exists: `(event_id, topic_id, 'fa+ta')` -- use cached
4. If not: invoke `IntegratedAnalystAgent` with FA output + relevant TA outputs

**Important:** The `IntegratedAnalystAgent` is a third independent call (per content-pipeline spec section 5.7a), not a concatenation. It receives FA and TA as input context and produces a unified analysis. Under the archetype model, this integrated analysis is still facts-only (direction and emphasis come from the framework archetype).

### 6.4 FA-TA tension handling per archetype

FA and TA will frequently disagree. FA levels come from fundamental analysis (policy pivots, macro thresholds, psychological round numbers). TA levels come from price action (S/R clusters, moving averages, Fibonacci retracements). Both can be correct simultaneously -- they're measuring different things.

**Tension types:**

| Tension | Example |
|---|---|
| **Level divergence** | FA: support at 1.0800 (ECB policy floor). TA: support at 1.0820 (200-day SMA) |
| **Directional conflict** | FA: bearish (rate differential). TA: bullish (breakout forming) |
| **Timing mismatch** | FA: bearish over weeks. TA: bullish intraday momentum |
| **Conviction gap** | FA: high conviction macro thesis. TA: unclear, no pattern confirmation |

Each archetype has a resolution strategy that the identity agent follows. This is **not** "who wins" -- it's how the article frames the tension for its audience:

**Conservative Advisor:**
- **Default:** present both, never resolve -- "the technical and fundamental pictures are telling different stories"
- **Level divergence:** cite both as a "zone" (1.0800-1.0820 support area)
- **Directional conflict:** frame as risk scenario -- "if fundamentals are right... if technicals are right..."
- **Never:** pick a side. The audience wants balanced risk awareness, not a call

**Active Trader Desk:**
- **Default:** TA wins for entry/exit, FA provides context for why the trade could fail
- **Level divergence:** trade the TA level, note FA level as "deeper support if this breaks"
- **Directional conflict:** trade TA direction, FA disagreement becomes the risk factor / stop-loss rationale
- **Never:** let FA override a clean technical setup. The audience trades levels, not macro theses

**Retail Educator:**
- **Default:** explain the disagreement itself -- "here's why analysts sometimes get mixed signals"
- **Level divergence:** teaching moment about different methodologies
- **Directional conflict:** "some signals say up, some say down -- here's what each camp is watching"
- **Never:** pick a side or suggest a trade. The audience is learning, not trading

**Contrarian Strategist:**
- **Default:** the tension IS the thesis -- "consensus is anchored on the fundamental story but the technicals say something else is happening"
- **Level divergence:** whichever level the market ISN'T watching is the interesting one
- **Directional conflict:** the disagreement is the signal -- "when FA and TA diverge, it usually means..."
- **Never:** agree with consensus. If FA and TA both agree and align with consensus, find a different angle

**Implementation:**

The `FrameworkArchetype` type (defined in `content-uniqueness-v2.md` section 2.3) gains a `tensionResolution` field:

```ts
tensionResolution: {
  levelDivergence: 'zone' | 'ta-primary' | 'explain-both' | 'contrarian-pick';
  directionalConflict: 'scenario-tree' | 'ta-wins-fa-risk' | 'explain-both' | 'tension-is-thesis';
  timingMismatch: 'longer-horizon-wins' | 'shorter-horizon-wins' | 'explain-both' | 'exploit-gap';
  convictionGap: 'defer-to-higher' | 'trade-confirmed-only' | 'explain-uncertainty' | 'probe-weakness';
  defaultFraming: string;  // 1-sentence directive for the identity agent
};
```

The identity agent receives this as part of the framework directives. When FA and TA outputs disagree, the resolution strategy prevents Opus from defaulting to "well, on balance, both have merit..." for every archetype -- which would collapse the cross-framework divergence the archetype model depends on.

**Uniqueness implication:** the same FA-TA disagreement produces four genuinely different articles because each archetype frames the tension differently. This is a natural divergence source that requires zero prompt engineering and strengthens the cross-framework uniqueness gate (target cosine < 0.80).

---

## 7. Data Dependencies

### 7.1 Market data provider interface

```ts
// packages/api/src/data/market-data.ts

export interface MarketDataProvider {
  /**
   * Fetch OHLCV data and computed indicators for an instrument at a given timeframe.
   * Returns null if data is unavailable (graceful degradation).
   */
  getSnapshot(
    instrumentId: string,
    timeframe: 'daily' | 'weekly' | 'monthly',
  ): Promise<MarketDataSnapshot | null>;

  /**
   * Fetch snapshots for all timeframes requested.
   * Returns a partial map -- missing timeframes are omitted.
   */
  getSnapshots(
    instrumentId: string,
    timeframes: ('daily' | 'weekly' | 'monthly')[],
  ): Promise<Partial<Record<'daily' | 'weekly' | 'monthly', MarketDataSnapshot>>>;
}
```

### 7.2 Implementations (phased)

**Phase 1 -- Fixture-based provider (demo/PoC):**

Hardcoded market data snapshots for the 3 demo instruments (EURUSD, Gold, Oil). Pre-computed indicators. No live data dependency. Sufficient for demo MVP and initial TA validation.

```ts
class FixtureMarketDataProvider implements MarketDataProvider {
  // Load from JSON fixtures at packages/api/src/data/fixtures/
}
```

**Phase 2 -- @wfx/sources adapter (production):**

When workstream B ships with market data adapters, a `SourcesMarketDataProvider` connects to the `@wfx/sources` market data pipeline. This is the same adapter pattern as document sources.

```ts
class SourcesMarketDataProvider implements MarketDataProvider {
  // Delegates to @wfx/sources market data adapter
  // Caches snapshots per (instrument, timeframe) with configurable TTL
}
```

**Interim option -- direct API provider:**

If @wfx/sources is not ready when TA needs to go live, a `DirectApiMarketDataProvider` fetches from a financial data API (Alpha Vantage, Polygon.io, or Yahoo Finance via a Bun-compatible HTTP client). This is the TS equivalent of the legacy `yfinance` fetcher.

```ts
class DirectApiMarketDataProvider implements MarketDataProvider {
  // HTTP fetch from financial data API
  // Compute indicators in pure TS (port from market_data.py)
  // File-based cache for offline fallback
}
```

### 7.3 Technical indicator computation

Port the indicator computations from `finflow/data/market_data.py` to pure TypeScript. The math is straightforward (rolling averages, exponential moving averages, RSI, MACD, Bollinger Bands, Stochastic, ATR).

```ts
// packages/api/src/data/indicators.ts

export function computeIndicators(bars: OHLCVBar[]): TechnicalIndicators;
export function computeRSI(closes: number[], period: number): number | null;
export function computeMACD(closes: number[], fast: number, slow: number, signal: number): { line: number; signal: number; histogram: number } | null;
export function computeBollingerBands(closes: number[], period: number, stdDev: number): { upper: number; middle: number; lower: number } | null;
export function computeStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number): { k: number; d: number } | null;
export function computeATR(highs: number[], lows: number[], closes: number[], period: number): number | null;
export function computeSMA(values: number[], period: number): number | null;
export function computeEMA(values: number[], period: number): number | null;
```

No external dependencies (no `pandas`, no `numpy`). Pure arithmetic on `number[]` arrays. Each function is independently testable.

### 7.4 Instrument catalog port

Port `finflow/instruments.py` to TypeScript, aligning with the `InstrumentCatalogEntry` type from content-pipeline spec section 6:

```ts
// packages/api/src/data/instrument-catalog.ts

export const INSTRUMENT_CATALOG: Record<string, InstrumentCatalogEntry> = {
  eurusd: {
    id: "eurusd",
    name: "EUR/USD",
    type: "fx",
    description: "Euro vs US Dollar",
    drivers: ["ECB policy", "Fed policy", "EU-US growth differential", "risk sentiment"],
    correlatedWith: ["dxy", "gbpusd", "gold"],
    riskOnRiskOff: "risk-on",
    // TA-specific additions
    ticker: "EURUSD=X",              // for market data API
    priceFormat: "%.4f",
    priceDecimals: 4,
    defaultTimeframes: ["daily", "weekly"],
  },
  // ... gold, oil, and expanded catalog
};
```

Expand from the legacy 3 instruments to ~15-20 for production. The instrument catalog is also a hard dependency for the content pipeline's impact classifier (section 6 of the content-pipeline spec).

---

## 8. System Prompt

The TA agent's system prompt is a TypeScript port of the legacy Python prompt, updated for tool_use and timeframe awareness:

```ts
function buildTASystemPrompt(timeframe: 'daily' | 'weekly' | 'monthly'): string {
  const horizonMap = {
    daily: "intraday to 1-week",
    weekly: "1-4 weeks",
    monthly: "1-6 months",
  };

  return `You are a Senior Technical Analyst at a top-tier financial institution with 20 years of experience in forex, commodity, and index markets.

Your analysis is data-driven, precise, and follows institutional standards. You analyze price action, indicators, and chart patterns for the ${timeframe} timeframe (${horizonMap[timeframe]} horizon).

ANALYSIS FRAMEWORK:
1. Price Action: Current price relative to key levels (support, resistance, moving averages)
2. Trend Structure: Primary and secondary trends (higher highs/lows or lower)
3. Momentum Indicators: RSI(14), MACD(12,26,9), Stochastic(14,3)
4. Volatility: Bollinger Bands(20,2), ATR(14)
5. Chart Patterns: Identifiable patterns (triangles, flags, head & shoulders, double tops/bottoms)
6. Key Levels: Support/resistance zones, Fibonacci retracements, psychological levels
7. Trade Setup: Entry zone, stop-loss, and target levels (if a clear setup exists)

RULES:
- Base your analysis ONLY on the technical data provided. Do not invent data points.
- If an indicator is missing or null, note it and work with what you have.
- Be specific about levels — use exact numbers from the data, not approximations.
- Distinguish between CONFIRMED patterns and FORMING/POTENTIAL patterns.
- Your narrative should be 2-3 paragraphs of analytical prose, not a bullet list.
- Risk factors must be specific to the technical setup, not generic disclaimers.

Use the submit_technical_analysis tool to return your analysis.`;
}
```

The user message is assembled by `buildTAUserMessage(input: TAAgentInput)`:

```ts
function buildTAUserMessage(input: TAAgentInput): string {
  const { instrument, timeframe, marketData } = input;
  const ind = marketData.indicators;

  const parts = [
    `# Technical Analysis Request: ${instrument.name} (${timeframe})`,
    `\n## Current Market Data`,
    `- Last Close: ${formatPrice(marketData.lastClose, instrument.priceFormat)}`,
    `- Daily Change: ${marketData.dailyChangePct > 0 ? '+' : ''}${marketData.dailyChangePct.toFixed(2)}%`,
    `- 52-Week High: ${formatPrice(marketData.high52w, instrument.priceFormat)}`,
    `- 52-Week Low: ${formatPrice(marketData.low52w, instrument.priceFormat)}`,
    `\n## Technical Indicators`,
    `- RSI(14): ${ind.rsi14?.toFixed(1) ?? 'N/A'}`,
    `- MACD Line: ${ind.macdLine?.toFixed(4) ?? 'N/A'}`,
    `- MACD Signal: ${ind.macdSignal?.toFixed(4) ?? 'N/A'}`,
    `- MACD Histogram: ${ind.macdHistogram?.toFixed(4) ?? 'N/A'}`,
    `- Stochastic %K: ${ind.stochK?.toFixed(1) ?? 'N/A'}`,
    `- ATR(14): ${ind.atr14?.toFixed(4) ?? 'N/A'}`,
    `- SMA 50: ${ind.sma50?.toFixed(4) ?? 'N/A'}`,
    `- SMA 200: ${ind.sma200?.toFixed(4) ?? 'N/A'}`,
    `- Above SMA 50: ${ind.aboveSma50 ?? 'N/A'}`,
    `- Above SMA 200: ${ind.aboveSma200 ?? 'N/A'}`,
    `- Bollinger Position: ${ind.bbPosition ?? 'N/A'}`,
    `- SMA 50 vs 200: ${ind.sma50AboveSma200 === true ? 'Golden Cross' : ind.sma50AboveSma200 === false ? 'Death Cross' : 'N/A'}`,
  ];

  // Recent price action
  if (marketData.ohlcv.length > 0) {
    const recent = marketData.ohlcv.slice(-10);
    parts.push(`\n## Recent Price Action (Last ${recent.length} ${timeframe} bars)`);
    for (const bar of recent) {
      parts.push(`  ${bar.date}: O=${formatPrice(bar.open, instrument.priceFormat)} H=${formatPrice(bar.high, instrument.priceFormat)} L=${formatPrice(bar.low, instrument.priceFormat)} C=${formatPrice(bar.close, instrument.priceFormat)} V=${bar.volume}`);
    }
  }

  parts.push(`\nProvide your ${timeframe} technical analysis using the submit_technical_analysis tool.`);
  return parts.join('\n');
}
```

---

## 9. Implementation Plan

### Phase 1: Foundation -- Types, Indicators, Fixtures

- [x] **Task 1: TA types and interfaces** (done in 60a89bd)
  - **Files:** `packages/api/src/data/types.ts`, `packages/api/src/agents/ta-types.ts`
  - **Depends on:** Nothing
  - **Verify:** `bun run typecheck` passes. `MarketDataSnapshot`, `TAAgentOutput`, `TechnicalIndicators`, `MarketDataProvider` types are importable.

- [x] **Task 2: Technical indicator computation (pure TS)** (done in 60a89bd)
  - **Files:** `packages/api/src/data/indicators.ts`
  - **Depends on:** Task 1
  - **Verify:** Unit tests pass: `computeRSI([known values])` returns expected RSI. `computeMACD`, `computeBollingerBands`, `computeStochastic`, `computeATR`, `computeSMA`, `computeEMA` all return correct values for known inputs. Edge case: arrays shorter than period return `null`. `bun run typecheck` passes.

- [x] **Task 3: Instrument catalog port** (done in 60a89bd)
  - **Files:** `packages/api/src/data/instrument-catalog.ts`
  - **Depends on:** Task 1
  - **Verify:** `INSTRUMENT_CATALOG` exports at least 3 instruments (EURUSD, Gold, Oil) with correct field values matching the legacy Python. `InstrumentCatalogEntry` type aligns with content-pipeline spec section 6. `bun run typecheck` passes.

- [x] **Task 4: Fixture market data provider** (done in 60a89bd)
  - **Files:** `packages/api/src/data/fixture-market-data.ts`, `packages/api/src/data/fixtures/*.json`
  - **Depends on:** Tasks 1, 2, 3
  - **Verify:** `FixtureMarketDataProvider.getSnapshot("eurusd", "daily")` returns a valid `MarketDataSnapshot` with non-null indicators. `getSnapshots("eurusd", ["daily", "weekly"])` returns both timeframes. `bun run typecheck` passes.

### Phase 2: TA Agent Core

- [ ] **Task 5: TA agent implementation**
  - **Files:** `packages/api/src/agents/technical-analyst.ts`
  - **Depends on:** Tasks 1, 4
  - **Verify:** Given a `MarketDataSnapshot` for EURUSD daily, the agent returns a valid `TAAgentOutput` via `tool_use` with: `outlook` in enum, `confidence` 0-100, non-empty `narrative`, at least 1 support and 1 resistance level, `keyPoints` with 3-5 items. Cost per call < $0.30 (Opus). `bun run typecheck` passes.

- [ ] **Task 6: Multi-timeframe TA runner**
  - **Files:** `packages/api/src/pipeline/ta-runner.ts`
  - **Depends on:** Tasks 4, 5
  - **Verify:** `runTA("eurusd", ["daily", "weekly"])` returns TA outputs for both timeframes. Each output has correct `timeframe` field. Results are cacheable (returned shape matches `DomainAnalysis` storage requirements). `bun run typecheck` passes.

### Phase 3: Pipeline Integration

- [ ] **Task 7: Wire TA into content pipeline dispatcher**
  - **Files:** `packages/api/src/pipeline/translation-engine.ts` or equivalent content pipeline orchestrator (when it exists)
  - **Depends on:** Tasks 5, 6, and content pipeline stage 7a being built
  - **Verify:** A `ContentBrief` with `analyticalMethod: 'ta'` invokes the TA runner. A brief with `analyticalMethod: 'fa+ta'` invokes both FA and TA runners. TA results are cached in `domain_analyses` with correct cache keys. Cache hits work on subsequent briefs. `bun run typecheck` passes.
  - **Blocked on:** Content pipeline production orchestrator (stage 7a). Can be unblocked for demo by wiring into `packages/api/src/demo/pipeline-runner.ts` instead.

- [ ] **Task 8: Integrate TA into demo pipeline runner**
  - **Files:** `packages/api/src/demo/pipeline-runner.ts` (modification)
  - **Depends on:** Tasks 5, 6, demo-mvp Task 7
  - **Verify:** Demo pipeline runs with TA stage visible in SSE events. Pipeline Monitor shows TA analysis output alongside FA. `bun run typecheck` passes.

### Phase 4: Production Data Provider (deferred)

- [ ] **Task 9: Direct API market data provider**
  - **Files:** `packages/api/src/data/api-market-data.ts`
  - **Depends on:** Tasks 1, 2
  - **Verify:** `DirectApiMarketDataProvider.getSnapshot("eurusd", "daily")` returns live data with computed indicators. Handles API failures gracefully (returns null, does not throw). File-based cache works for offline fallback. `bun run typecheck` passes.
  - **Blocked on:** Deciding which market data API to use (Alpha Vantage, Polygon.io, or Yahoo Finance via HTTP). Open question.

- [ ] **Task 10: @wfx/sources market data adapter**
  - **Files:** `packages/sources/src/adapters/market-data.ts` (when package exists)
  - **Depends on:** Task 1, workstream B (@wfx/sources)
  - **Verify:** `SourcesMarketDataProvider` implements `MarketDataProvider`. Data flows from @wfx/sources adapter through to TA agent. `bun run typecheck` passes.
  - **Blocked on:** Workstream B.

---

## 10. Cost and Latency Budget

### 10.1 Per-instrument TA cost

| Timeframe | Model | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Daily | Opus | ~2,500 (indicators + 10 bars) | ~1,500 (narrative + structured) | ~$0.20 |
| Weekly | Opus | ~2,500 | ~1,500 | ~$0.20 |
| Monthly | Opus | ~2,000 | ~1,200 | ~$0.16 |

**Per-instrument total (3 timeframes):** ~$0.56

**Comparison to FA:** FA core analysis costs ~$0.15-0.21 per event. TA is more expensive per call because it processes numerical data. At 3 timeframes per instrument, TA costs ~2.5x more than FA per instrument.

**Under the archetype model:** TA calls are shared across all tenants. 3 instruments x 3 timeframes = 9 TA calls per event = ~$1.68. This is independent of tenant count. At N=50 tenants, TA adds $0.034 per tenant per event.

### 10.2 Latency

| Operation | Expected latency |
|---|---|
| Market data fetch (fixture) | <10ms |
| Market data fetch (API) | 200-500ms |
| Indicator computation | <50ms |
| TA agent call (Opus) | 10-25s |
| Cache lookup | <50ms |

**Critical path for a new TA analysis:** 10-25s (the Opus call dominates). Cached TA is <50ms.

**Pipeline impact:** For an FA+TA pipeline, the TA calls can run in parallel with the FA call (they are independent). Total analytical layer latency = max(FA_latency, max(TA_timeframe_latencies)) rather than sum.

### 10.3 Model selection

**v1: Opus for TA agent.** The TA agent needs to interpret technical data accurately, identify chart patterns from OHLCV bars, and produce coherent narrative. This is a reasoning-heavy task similar to the FA agent. Opus is the right choice.

**Future: Sonnet for TA if quality validates.** After collecting production data, if Sonnet produces acceptable TA quality (measured by: correct level identification, pattern recognition accuracy, narrative coherence), downgrade to Sonnet for ~3x cost reduction. This is the same pathway as the FA agent.

---

## 11. Constraints

- **Strict TypeScript, no `any`.** All tool_use responses parsed through Zod schemas.
- **All structured output via Anthropic `tool_use`.** No JSON-in-text parsing (the legacy Python TA agent used JSON-in-text; this is explicitly not ported).
- **Repository pattern for market data.** `MarketDataProvider` interface with fixture/API/sources implementations.
- **No external Python dependencies.** All indicator computation in pure TypeScript. No `numpy`, `pandas`, `yfinance`.
- **Market data snapshots are frozen at brief time.** Once a TA analysis is cached, it uses the snapshot from compute time. No live-updating mid-pipeline.
- **TA does not take positions.** Under the archetype model, TA produces analytical observations (levels, patterns, momentum signals). The framework archetype's identity call interprets these as bullish/bearish/neutral based on the archetype's analytical stance.

---

## 12. Out of Scope

| Item | Why not now |
|---|---|
| Real-time chart rendering | Post-demo; depends on TradingView Lightweight Charts integration |
| Custom indicator configuration per tenant | v1 uses a fixed indicator set; custom indicators are a v2 feature |
| Automated trade signal generation | TA is analytical, not advisory; trade setups are suggestions, not signals |
| Multi-asset correlation analysis | Requires cross-instrument TA, which is a separate analytical method |
| Intraday timeframes (1h, 4h, 15m) | Start with daily/weekly/monthly; intraday adds real-time data dependency complexity |
| Backtesting framework for TA calls | Would validate historical TA accuracy; valuable but not MVP |
| Sentiment indicators (put/call ratio, COT data) | Additional data source dependency; add when @wfx/sources supports it |

---

## 13. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | **Which market data API for the interim provider?** Alpha Vantage (free tier, rate-limited), Polygon.io (paid, real-time), Yahoo Finance via HTTP (unofficial, fragile). Need to decide before Task 9. | Blocks production TA data | Before Phase 4 |
| 2 | **Should TA outputs include chart image generation?** The legacy Python prototype had `generate_charts.py` (matplotlib). A text-based LLM cannot produce chart images, but we could generate ASCII-art level descriptions or TradingView widget configuration. | Affects demo visual impact | Before Phase 3 |
| 3 | **TA model downgrade path.** At what quality threshold do we switch from Opus to Sonnet for TA? Need to define the acceptance test corpus and pass criteria. | $0.56 -> ~$0.19 per instrument cost reduction | After Phase 2 validation |
| 4 | **How does the IntegratedAnalystAgent compose FA+TA?** Is it a single Opus call that receives both FA prose and TA structured output? Or does it receive FA prose + raw market data and produce its own TA? The content-pipeline spec says "third independent run" but doesn't specify input shape for the TA dimension. | Affects cache key design and cost model | Before Phase 3 |
| 5 | **Instrument catalog expansion scope.** The legacy catalog has 3 instruments. Production needs ~15-20. Who curates the expanded catalog, and does it need per-instrument TA tuning (e.g., different indicator relevance for commodities vs FX)? | Affects Task 3 scope | Before production launch |
