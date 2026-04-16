/**
 * Fixture-based market data provider for demo/PoC use.
 *
 * Reads pre-generated OHLCV data from JSON fixture files and computes
 * indicators on the fly. No network calls, fully deterministic.
 *
 * Spec: docs/specs/2026-04-16-ta-typescript-port.md §7.2
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type {
  MarketDataProvider,
  MarketDataSnapshot,
  OHLCVBar,
} from "./types.js";
import { computeIndicators } from "./indicators.js";
import { INSTRUMENT_CATALOG } from "./instrument-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

/** Max bars to consider for 52-week high/low per timeframe. */
const BARS_52W: Record<string, number> = {
  daily: 252,
  weekly: 52,
  monthly: 12,
};

/** Cache loaded fixtures to avoid re-reading files. */
const fixtureCache = new Map<string, OHLCVBar[]>();

function isValidBar(bar: unknown): bar is OHLCVBar {
  if (typeof bar !== "object" || bar === null) return false;
  const b = bar as Record<string, unknown>;
  return (
    typeof b["date"] === "string" &&
    typeof b["open"] === "number" &&
    typeof b["high"] === "number" &&
    typeof b["low"] === "number" &&
    typeof b["close"] === "number" &&
    typeof b["volume"] === "number"
  );
}

function loadFixture(
  instrumentId: string,
  timeframe: "daily" | "weekly" | "monthly",
): OHLCVBar[] | null {
  const key = `${instrumentId}-${timeframe}`;
  const cached = fixtureCache.get(key);
  if (cached) return cached;

  try {
    const filePath = join(FIXTURES_DIR, `${key}.json`);
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Validate first bar shape
    if (!isValidBar(parsed[0])) {
      console.warn(
        `[fixture-market-data] Invalid bar shape in ${key}.json, skipping`,
      );
      return null;
    }

    const bars = parsed as OHLCVBar[];
    fixtureCache.set(key, bars);
    return bars;
  } catch {
    return null;
  }
}

/** Safe max/min over a number array without stack-overflow risk. */
function arrayMax(arr: number[]): number {
  let max = -Infinity;
  for (const v of arr) if (v > max) max = v;
  return max;
}

function arrayMin(arr: number[]): number {
  let min = Infinity;
  for (const v of arr) if (v < min) min = v;
  return min;
}

function buildSnapshot(
  instrumentId: string,
  timeframe: "daily" | "weekly" | "monthly",
  bars: OHLCVBar[],
): MarketDataSnapshot {
  // Slice to 52-week equivalent for high/low
  const lookback = BARS_52W[timeframe] ?? bars.length;
  const recentBars = bars.slice(-lookback);

  const closes = bars.map((b) => b.close);
  const highs52w = recentBars.map((b) => b.high);
  const lows52w = recentBars.map((b) => b.low);

  const lastClose = closes.length > 0 ? (closes[closes.length - 1] ?? 0) : 0;
  const prevClose = closes.length > 1 ? (closes[closes.length - 2] ?? 0) : 0;
  const changePct =
    prevClose !== 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

  return {
    instrumentId,
    timeframe,
    lastClose,
    dailyChangePct: Math.round(changePct * 100) / 100,
    high52w: arrayMax(highs52w),
    low52w: arrayMin(lows52w),
    indicators: computeIndicators(bars),
    ohlcv: bars.slice(-10), // last 10 bars for the agent
    fetchedAt: new Date().toISOString(),
  };
}

export class FixtureMarketDataProvider implements MarketDataProvider {
  async getSnapshot(
    instrumentId: string,
    timeframe: "daily" | "weekly" | "monthly",
  ): Promise<MarketDataSnapshot | null> {
    // Return null for unknown instruments (graceful degradation per interface contract)
    if (!INSTRUMENT_CATALOG[instrumentId]) return null;

    const bars = loadFixture(instrumentId, timeframe);
    if (!bars || bars.length === 0) return null;

    return buildSnapshot(instrumentId, timeframe, bars);
  }

  async getSnapshots(
    instrumentId: string,
    timeframes: ("daily" | "weekly" | "monthly")[],
  ): Promise<
    Partial<Record<"daily" | "weekly" | "monthly", MarketDataSnapshot>>
  > {
    const result: Partial<
      Record<"daily" | "weekly" | "monthly", MarketDataSnapshot>
    > = {};

    for (const tf of timeframes) {
      const snapshot = await this.getSnapshot(instrumentId, tf);
      if (snapshot) {
        result[tf] = snapshot;
      }
    }

    return result;
  }
}
