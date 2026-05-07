/**
 * Unit tests for the Wave M stratified-clustered-bootstrap statistics module.
 *
 * Run with: `bun test src/benchmark/uniqueness-poc/statistics.test.ts` from
 * packages/api/.
 *
 * The synthetic fixture is 3 events × 4 cells per event with a known
 * population mean — the bootstrap should recover it within tolerance.
 * Descriptive-only floor is verified at N_events = 2 per audit §5.2.
 */

import { describe, expect, test } from "bun:test";

import {
  bootstrapCi,
  effectSize,
  mulberry32,
  pairedStratifiedBootstrap,
  proportionCi,
  stratifiedClusteredBootstrapCi,
  type EventBlock,
} from "./statistics.js";

// ───────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────

interface Cell {
  /** A pair-level metric (cosine, ROUGE-L, judge fidelity, …). */
  metric: number;
}

/** 3 events × 4 cells per event, mean = 0.50 across all cells. */
function fixture3x4(): EventBlock<Cell>[] {
  return [
    {
      eventId: "fed-rate-decision",
      cells: [{ metric: 0.40 }, { metric: 0.45 }, { metric: 0.50 }, { metric: 0.55 }],
    },
    {
      eventId: "bitcoin-etf-approval",
      cells: [{ metric: 0.45 }, { metric: 0.50 }, { metric: 0.55 }, { metric: 0.60 }],
    },
    {
      eventId: "oil-supply-shock",
      cells: [{ metric: 0.40 }, { metric: 0.50 }, { metric: 0.50 }, { metric: 0.60 }],
    },
  ];
}

const meanMetric = (cells: Cell[]): number =>
  cells.reduce((acc, c) => acc + c.metric, 0) / cells.length;

// ───────────────────────────────────────────────────────────────────
// Mulberry32 — determinism
// ───────────────────────────────────────────────────────────────────

describe("mulberry32", () => {
  test("same seed yields the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test("different seeds yield different sequences", () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) differences++;
    }
    // Vanishingly unlikely to overlap on >95/100 draws.
    expect(differences).toBeGreaterThan(95);
  });

  test("output is in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// stratifiedClusteredBootstrapCi
// ───────────────────────────────────────────────────────────────────

describe("stratifiedClusteredBootstrapCi", () => {
  test("recovers the known population mean within tolerance on 3 events × 4 cells", () => {
    const result = stratifiedClusteredBootstrapCi({
      eventBlocks: fixture3x4(),
      statistic: meanMetric,
      estimand: "Mean of pair-level metric across the bench",
      iters: 5000,
      seed: 42,
    });
    // Per-event means: 0.475, 0.525, 0.500. Population mean of per-event
    // means = 0.500. CI should bracket it tightly.
    expect(result.pointEstimate).toBeCloseTo(0.5, 2);
    expect(result.ci[0]).toBeLessThan(0.5);
    expect(result.ci[1]).toBeGreaterThan(0.5);
    expect(result.ci[1] - result.ci[0]).toBeLessThan(0.1); // tight enough
    expect(result.descriptiveOnly).toBe(false);
    expect(result.nClusters).toBe(3);
    expect(result.estimand).toBe("Mean of pair-level metric across the bench");
  });

  test("descriptive-only floor triggers at N_events = 2", () => {
    const result = stratifiedClusteredBootstrapCi({
      eventBlocks: fixture3x4().slice(0, 2),
      statistic: meanMetric,
      estimand: "Mean across two events",
      iters: 5000,
      seed: 42,
    });
    expect(result.descriptiveOnly).toBe(true);
    expect(result.nClusters).toBe(2);
    // Descriptive CI is empirical min/max of per-event statistic.
    expect(result.ci[0]).toBeCloseTo(0.475, 3);
    expect(result.ci[1]).toBeCloseTo(0.525, 3);
  });

  test("descriptive-only at N_events = 1", () => {
    const result = stratifiedClusteredBootstrapCi({
      eventBlocks: fixture3x4().slice(0, 1),
      statistic: meanMetric,
      estimand: "Single-event run",
      iters: 5000,
      seed: 42,
    });
    expect(result.descriptiveOnly).toBe(true);
    expect(result.nClusters).toBe(1);
    expect(result.pointEstimate).toBeCloseTo(0.475, 3);
  });

  test("same seed produces deterministic CIs", () => {
    const a = stratifiedClusteredBootstrapCi({
      eventBlocks: fixture3x4(),
      statistic: meanMetric,
      estimand: "deterministic",
      iters: 1000,
      seed: 100,
    });
    const b = stratifiedClusteredBootstrapCi({
      eventBlocks: fixture3x4(),
      statistic: meanMetric,
      estimand: "deterministic",
      iters: 1000,
      seed: 100,
    });
    expect(a.ci[0]).toBe(b.ci[0]);
    expect(a.ci[1]).toBe(b.ci[1]);
  });
});

// ───────────────────────────────────────────────────────────────────
// pairedStratifiedBootstrap
// ───────────────────────────────────────────────────────────────────

describe("pairedStratifiedBootstrap", () => {
  test("recovers a known positive ∆ with CI not crossing zero", () => {
    const control = fixture3x4();
    // Treatment is control + 0.1 on every cell — known true ∆ = +0.1.
    const treatment: EventBlock<Cell>[] = control.map((b) => ({
      eventId: b.eventId,
      cells: b.cells.map((c) => ({ metric: c.metric + 0.1 })),
    }));

    const result = pairedStratifiedBootstrap({
      controlBlocks: control,
      treatmentBlocks: treatment,
      statistic: meanMetric,
      estimand: "treatment − control mean metric",
      iters: 5000,
      seed: 42,
    });
    expect(result.pointEstimate).toBeCloseTo(0.1, 5);
    expect(result.ci[0]).toBeGreaterThan(0);
    expect(result.ci[1]).toBeGreaterThan(0);
    expect(result.descriptiveOnly).toBe(false);
  });

  test("recovers zero ∆ when arms are identical", () => {
    const control = fixture3x4();
    const result = pairedStratifiedBootstrap({
      controlBlocks: control,
      treatmentBlocks: control,
      statistic: meanMetric,
      estimand: "identical arms",
      iters: 2000,
      seed: 7,
    });
    expect(result.pointEstimate).toBe(0);
    expect(result.ci[0]).toBe(0);
    expect(result.ci[1]).toBe(0);
  });

  test("throws when control and treatment have different event sets", () => {
    const control = fixture3x4();
    const treatment = control.map((b, i) =>
      i === 0 ? { ...b, eventId: "different-event" } : b,
    );
    expect(() =>
      pairedStratifiedBootstrap({
        controlBlocks: control,
        treatmentBlocks: treatment,
        statistic: meanMetric,
        estimand: "mismatched",
        iters: 100,
        seed: 1,
      }),
    ).toThrow(/missing from/);
  });

  test("descriptive-only at N_events = 2", () => {
    const control = fixture3x4().slice(0, 2);
    const treatment = control.map((b) => ({
      eventId: b.eventId,
      cells: b.cells.map((c) => ({ metric: c.metric + 0.05 })),
    }));
    const result = pairedStratifiedBootstrap({
      controlBlocks: control,
      treatmentBlocks: treatment,
      statistic: meanMetric,
      estimand: "two-event paired",
      iters: 1000,
      seed: 42,
    });
    expect(result.descriptiveOnly).toBe(true);
    expect(result.nClusters).toBe(2);
    expect(result.pointEstimate).toBeCloseTo(0.05, 3);
  });
});

// ───────────────────────────────────────────────────────────────────
// bootstrapCi (iid)
// ───────────────────────────────────────────────────────────────────

describe("bootstrapCi", () => {
  test("recovers the mean of an iid sample", () => {
    // Per-event averaged statistics (one per event) — independence is
    // genuine here because the resampling unit IS the event.
    const eventLevelMeans = [0.475, 0.525, 0.5, 0.49, 0.52, 0.48, 0.51];
    const result = bootstrapCi({
      samples: eventLevelMeans,
      statistic: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
      estimand: "mean of per-event statistic across the bench",
      iters: 5000,
      seed: 1,
    });
    expect(result.pointEstimate).toBeCloseTo(0.5, 2);
    expect(result.ci[0]).toBeLessThan(0.5);
    expect(result.ci[1]).toBeGreaterThan(0.5);
    expect(result.descriptiveOnly).toBe(false);
  });

  test("descriptive-only at n=2", () => {
    const result = bootstrapCi({
      samples: [0.4, 0.6],
      statistic: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
      estimand: "n=2",
      iters: 1000,
      seed: 1,
    });
    expect(result.descriptiveOnly).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// proportionCi (Wilson)
// ───────────────────────────────────────────────────────────────────

describe("proportionCi", () => {
  test("Wilson CI brackets the point estimate", () => {
    const result = proportionCi({ k: 7, n: 10, estimand: "SHIP rate" });
    expect(result.pointEstimate).toBe(0.7);
    expect(result.ci[0]).toBeLessThan(0.7);
    expect(result.ci[1]).toBeGreaterThan(0.7);
    expect(result.ci[0]).toBeGreaterThanOrEqual(0);
    expect(result.ci[1]).toBeLessThanOrEqual(1);
  });

  test("zero successes → CI is non-trivial", () => {
    const result = proportionCi({ k: 0, n: 10, estimand: "ZERO" });
    expect(result.pointEstimate).toBe(0);
    expect(result.ci[0]).toBeGreaterThanOrEqual(0);
    expect(result.ci[1]).toBeGreaterThan(0);
  });

  test("n=0 returns descriptive-only [0, 1] CI", () => {
    const result = proportionCi({ k: 0, n: 0, estimand: "no data" });
    expect(result.descriptiveOnly).toBe(true);
    expect(result.ci).toEqual([0, 1]);
  });

  test("invalid inputs throw", () => {
    expect(() => proportionCi({ k: -1, n: 10, estimand: "x" })).toThrow();
    expect(() => proportionCi({ k: 11, n: 10, estimand: "x" })).toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────
// effectSize — Cohen's d / Cohen's h
// ───────────────────────────────────────────────────────────────────

describe("effectSize", () => {
  test("Cohen's d on a clear shift recovers a positive effect", () => {
    const control = [0.40, 0.45, 0.50, 0.55, 0.50, 0.45];
    const treatment = [0.50, 0.55, 0.60, 0.65, 0.60, 0.55];
    const result = effectSize({
      control,
      treatment,
      kind: "cohens_d",
      estimand: "treatment vs control mean metric",
      iters: 2000,
      seed: 42,
    });
    expect(result.effect).toBeGreaterThan(0);
    expect(result.kind).toBe("cohens_d");
  });

  test("Cohen's h on identical proportions yields ~0", () => {
    const control = [1, 1, 0, 0, 1, 0];
    const treatment = [1, 1, 0, 0, 1, 0];
    const result = effectSize({
      control,
      treatment,
      kind: "cohens_h",
      estimand: "identical proportions",
      iters: 500,
      seed: 1,
    });
    expect(result.effect).toBe(0);
  });

  test("descriptive-only when n < 3 in either arm", () => {
    const result = effectSize({
      control: [0.5, 0.6],
      treatment: [0.6, 0.7],
      kind: "cohens_d",
      estimand: "tiny",
      iters: 100,
      seed: 1,
    });
    expect(result.descriptiveOnly).toBe(true);
  });
});
