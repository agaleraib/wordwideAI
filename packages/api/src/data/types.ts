/**
 * Market data types for the TA pipeline.
 *
 * Spec: docs/specs/2026-04-16-ta-typescript-port.md §3, §7
 */

// ── OHLCV ──────────────────────────────────────────────────────────────

export interface OHLCVBar {
  date: string; // ISO date string (YYYY-MM-DD)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Technical Indicators ───────────────────────────────────────────────

export type BollingerPosition =
  | "near upper band (overbought zone)"
  | "mid-range"
  | "near lower band (oversold zone)";

export interface TechnicalIndicators {
  // RSI
  rsi14: number | null;

  // MACD (12, 26, 9)
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;

  // Stochastic (14, 3)
  stochK: number | null;
  stochD: number | null;

  // Bollinger Bands (20, 2)
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPosition: BollingerPosition | null;

  // Moving averages
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;

  // Derived
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  sma50AboveSma200: boolean | null; // Golden Cross / Death Cross

  // Volatility
  atr14: number | null;
}

// ── Market Data Snapshot ───────────────────────────────────────────────

export interface MarketDataSnapshot {
  instrumentId: string;
  timeframe: "daily" | "weekly" | "monthly";
  lastClose: number;
  dailyChangePct: number;
  high52w: number;
  low52w: number;
  indicators: TechnicalIndicators;
  ohlcv: OHLCVBar[]; // most recent bars for the timeframe
  fetchedAt: string; // ISO timestamp
}

// ── Market Data Provider ───────────────────────────────────────────────

export interface MarketDataProvider {
  /**
   * Fetch OHLCV data and computed indicators for an instrument at a given timeframe.
   * Returns null if data is unavailable (graceful degradation).
   */
  getSnapshot(
    instrumentId: string,
    timeframe: "daily" | "weekly" | "monthly",
  ): Promise<MarketDataSnapshot | null>;

  /**
   * Fetch snapshots for all timeframes requested.
   * Returns a partial map — missing timeframes are omitted.
   */
  getSnapshots(
    instrumentId: string,
    timeframes: ("daily" | "weekly" | "monthly")[],
  ): Promise<
    Partial<Record<"daily" | "weekly" | "monthly", MarketDataSnapshot>>
  >;
}

// ── Instrument Catalog ─────────────────────────────────────────────────

export type AssetClass = "fx" | "commodity" | "index" | "crypto";

export type RiskSentiment = "risk-on" | "risk-off" | "mixed";

export interface InstrumentCatalogEntry {
  id: string; // e.g. "eurusd"
  name: string; // e.g. "EUR/USD"
  type: AssetClass;
  description: string;
  drivers: string[]; // e.g. ["ECB policy", "Fed policy"]
  correlatedWith: string[]; // other instrument IDs
  riskOnRiskOff: RiskSentiment;

  // TA-specific
  ticker: string; // for market data API (e.g. "EURUSD=X")
  priceFormat: string; // e.g. "%.4f" or "$%,.2f"
  priceDecimals: number;
  defaultTimeframes: ("daily" | "weekly" | "monthly")[];
}
