/**
 * TA agent input/output types.
 *
 * Spec: docs/specs/2026-04-16-ta-typescript-port.md §3, §4
 */

import type {
  InstrumentCatalogEntry,
  MarketDataSnapshot,
} from "../data/types.js";

// ── TA Agent Input ─────────────────────────────────────────────────────

export interface TAAgentInput {
  instrument: InstrumentCatalogEntry;
  timeframe: "daily" | "weekly" | "monthly";
  marketData: MarketDataSnapshot;
}

// ── TA Agent Output (matches tool_use schema) ──────────────────────────

export type TAOutlook =
  | "strongly-bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "strongly-bearish";

export type PatternType = "continuation" | "reversal";
export type PatternImplication = "bullish" | "bearish";
export type PatternConfidence = "confirmed" | "forming" | "potential";
export type LevelStrength = "strong" | "moderate" | "weak";
export type TradeBias = "long" | "short" | "neutral";
export type TrendDirection = "uptrend" | "downtrend" | "sideways";
export type SmaAlignment = "bullish" | "bearish" | "mixed";
export type MomentumSignal =
  | "strong-bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "strong-bearish";
export type OscillatorSignal = "overbought" | "neutral" | "oversold";
export type MacdSignalType =
  | "bullish-cross"
  | "bearish-cross"
  | "bullish"
  | "bearish";

export interface TAKeyLevel {
  level: number;
  description: string;
  strength: LevelStrength;
}

export interface TAPattern {
  name: string;
  type: PatternType;
  implication: PatternImplication;
  confidence: PatternConfidence;
}

export interface TAMomentum {
  rsiSignal: OscillatorSignal | null;
  macdSignal: MacdSignalType | null;
  stochSignal: OscillatorSignal | null;
  overallMomentum: MomentumSignal;
}

export interface TATrendStructure {
  primary: TrendDirection;
  secondary: TrendDirection | null;
  smaAlignment: SmaAlignment;
}

export interface TATradeSetup {
  bias: TradeBias;
  entryZone: string | null;
  stopLoss: string | null;
  targets: string[];
}

export interface TAAgentOutput {
  outlook: TAOutlook;
  confidence: number; // 0-100
  narrative: string; // 2-3 paragraph analysis
  keyLevels: {
    support: TAKeyLevel[];
    resistance: TAKeyLevel[];
  };
  patterns: TAPattern[];
  momentum: TAMomentum;
  trendStructure: TATrendStructure;
  tradeSetup: TATradeSetup | null;
  riskFactors: string[];
  keyPoints: string[]; // 3-5 items
}
