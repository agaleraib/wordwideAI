/**
 * Pure TypeScript technical indicator computation.
 * Ported from finflow/data/market_data.py — no pandas, no numpy.
 *
 * Each function returns null if the input array is shorter than the required period.
 *
 * Spec: docs/specs/2026-04-16-ta-typescript-port.md §7.3
 */

import type { BollingerPosition, OHLCVBar, TechnicalIndicators } from "./types.js";

/** Safe array access — returns 0 for out-of-bounds (use after length checks). */
function at(arr: number[], i: number): number {
  return arr[i] ?? 0;
}

// ── Simple Moving Average ──────────────────────────────────────────────

export function computeSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

// ── Exponential Moving Average ─────────────────────────────────────────

export function computeEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = at(values, i) * k + ema * (1 - k);
  }
  return ema;
}

// ── RSI (Relative Strength Index) ──────────────────────────────────────

export function computeRSI(
  closes: number[],
  period: number = 14,
): number | null {
  if (closes.length < period + 1) return null;

  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(at(closes, i) - at(closes, i - 1));
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const d = at(deltas, i);
    if (d > 0) avgGain += d;
    else avgLoss += Math.abs(d);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < deltas.length; i++) {
    const d = at(deltas, i);
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD (Moving Average Convergence Divergence) ───────────────────────

export function computeMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9,
): { line: number; signal: number; histogram: number } | null {
  if (closes.length < slow + signal) return null;

  const macdSeries: number[] = [];
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);

  // Seed both EMAs from their respective SMA windows
  let emaF = closes.slice(0, fast).reduce((s, v) => s + v, 0) / fast;
  let emaS = closes.slice(0, slow).reduce((s, v) => s + v, 0) / slow;

  // Walk emaF forward from `fast` to `slow-1` so it doesn't skip bars
  for (let i = fast; i < slow; i++) {
    emaF = at(closes, i) * kFast + emaF * (1 - kFast);
  }

  // Now both EMAs are current at index `slow`. Walk them together.
  for (let i = slow; i < closes.length; i++) {
    const c = at(closes, i);
    emaF = c * kFast + emaF * (1 - kFast);
    emaS = c * kSlow + emaS * (1 - kSlow);
    macdSeries.push(emaF - emaS);
  }

  if (macdSeries.length < signal) return null;

  const signalEma = computeEMA(macdSeries, signal);
  if (signalEma === null) return null;

  const macdLine = at(macdSeries, macdSeries.length - 1);
  return {
    line: macdLine,
    signal: signalEma,
    histogram: macdLine - signalEma,
  };
}

// ── Bollinger Bands ────────────────────────────────────────────────────

export function computeBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2,
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: mean + stdDev * std,
    middle: mean,
    lower: mean - stdDev * std,
  };
}

// ── Stochastic Oscillator ──────────────────────────────────────────────

export function computeStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3,
): { k: number; d: number } | null {
  const minLen = kPeriod + dPeriod - 1;
  if (closes.length < minLen || highs.length < minLen || lows.length < minLen) {
    return null;
  }

  const kValues: number[] = [];
  const startIdx = closes.length - kPeriod - dPeriod + 1;

  for (let i = startIdx; i <= closes.length - kPeriod; i++) {
    const highSlice = highs.slice(i, i + kPeriod);
    const lowSlice = lows.slice(i, i + kPeriod);
    const highMax = Math.max(...highSlice);
    const lowMin = Math.min(...lowSlice);
    const close = at(closes, i + kPeriod - 1);

    const range = highMax - lowMin;
    kValues.push(range === 0 ? 50 : ((close - lowMin) / range) * 100);
  }

  const k = at(kValues, kValues.length - 1);
  const d = kValues.slice(-dPeriod).reduce((s, v) => s + v, 0) / dPeriod;

  return { k, d };
}

// ── Average True Range ─────────────────────────────────────────────────

export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number | null {
  if (closes.length < period + 1) return null;

  const trValues: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const hl = at(highs, i) - at(lows, i);
    const hc = Math.abs(at(highs, i) - at(closes, i - 1));
    const lc = Math.abs(at(lows, i) - at(closes, i - 1));
    trValues.push(Math.max(hl, hc, lc));
  }

  if (trValues.length < period) return null;

  // Wilder's smoothing: seed with SMA, then iterate
  let atr = trValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + at(trValues, i)) / period;
  }
  return atr;
}

// ── Bollinger Band Position ────────────────────────────────────────────

function bbPosition(
  price: number,
  bb: { upper: number; lower: number } | null,
): BollingerPosition | null {
  if (!bb) return null;
  const range = bb.upper - bb.lower;
  if (range <= 0) return null;
  const pct = (price - bb.lower) / range;
  if (pct > 0.8) return "near upper band (overbought zone)";
  if (pct < 0.2) return "near lower band (oversold zone)";
  return "mid-range";
}

// ── Compute All Indicators ─────────────────────────────────────────────

export function computeIndicators(bars: OHLCVBar[]): TechnicalIndicators {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  const lastClose = closes.length > 0 ? at(closes, closes.length - 1) : 0;

  const bb = computeBollingerBands(closes, 20, 2);
  const stoch = computeStochastic(highs, lows, closes, 14, 3);
  const macd = computeMACD(closes, 12, 26, 9);

  const sma50 = computeSMA(closes, 50);
  const sma200 = computeSMA(closes, 200);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);

  return {
    rsi14: computeRSI(closes, 14),

    macdLine: macd?.line ?? null,
    macdSignal: macd?.signal ?? null,
    macdHistogram: macd?.histogram ?? null,

    stochK: stoch?.k ?? null,
    stochD: stoch?.d ?? null,

    bbUpper: bb?.upper ?? null,
    bbMiddle: bb?.middle ?? null,
    bbLower: bb?.lower ?? null,
    bbPosition: bbPosition(lastClose, bb),

    sma50,
    sma200,
    ema20,
    ema50,

    aboveSma50: sma50 !== null ? lastClose > sma50 : null,
    aboveSma200: sma200 !== null ? lastClose > sma200 : null,
    sma50AboveSma200:
      sma50 !== null && sma200 !== null ? sma50 > sma200 : null,

    atr14: computeATR(highs, lows, closes, 14),
  };
}
