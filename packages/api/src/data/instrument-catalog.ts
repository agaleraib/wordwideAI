/**
 * Instrument catalog — ported from finflow/instruments.py.
 *
 * Central registry of tradeable instruments with TA-specific metadata.
 * Production: expand to ~15-20 instruments.
 *
 * Spec: docs/specs/2026-04-16-ta-typescript-port.md §7.4
 */

import type { InstrumentCatalogEntry } from "./types.js";

export const INSTRUMENT_CATALOG: Record<string, InstrumentCatalogEntry> = {
  eurusd: {
    id: "eurusd",
    name: "EUR/USD",
    type: "fx",
    description: "Euro vs US Dollar",
    drivers: [
      "ECB policy",
      "Fed policy",
      "EU-US growth differential",
      "risk sentiment",
    ],
    correlatedWith: ["dxy", "gbpusd", "gold"],
    riskOnRiskOff: "risk-on",
    ticker: "EURUSD=X",
    priceFormat: "%.4f",
    priceDecimals: 4,
    defaultTimeframes: ["daily", "weekly"],
  },

  gold: {
    id: "gold",
    name: "Gold (XAU/USD)",
    type: "commodity",
    description: "Gold spot price in USD",
    drivers: [
      "real yields",
      "USD strength",
      "geopolitical risk",
      "central bank demand",
    ],
    correlatedWith: ["silver", "dxy", "eurusd"],
    riskOnRiskOff: "risk-off",
    ticker: "GC=F",
    priceFormat: "$%,.2f",
    priceDecimals: 2,
    defaultTimeframes: ["daily", "weekly", "monthly"],
  },

  oil: {
    id: "oil",
    name: "Brent Crude Oil",
    type: "commodity",
    description: "Brent crude oil futures",
    drivers: [
      "OPEC+ policy",
      "global demand",
      "geopolitical supply risk",
      "inventory levels",
    ],
    correlatedWith: ["wti", "natgas", "usdcad"],
    riskOnRiskOff: "risk-on",
    ticker: "BZ=F",
    priceFormat: "$%,.2f",
    priceDecimals: 2,
    defaultTimeframes: ["daily", "weekly"],
  },
};

export function getInstrument(id: string): InstrumentCatalogEntry {
  const entry = INSTRUMENT_CATALOG[id];
  if (!entry) {
    const available = Object.keys(INSTRUMENT_CATALOG).join(", ");
    throw new Error(`Unknown instrument '${id}'. Available: ${available}`);
  }
  return entry;
}

export function formatPrice(price: number, instrument: InstrumentCatalogEntry): string {
  const formatted = price.toFixed(instrument.priceDecimals);
  // Apply prefix from format string (e.g. "$" from "$%,.2f")
  const prefix = instrument.priceFormat.replace(/%.*/, "");
  return prefix + formatted;
}
