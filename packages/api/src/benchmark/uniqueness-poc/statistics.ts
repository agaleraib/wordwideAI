/**
 * Wave M — stratified clustered bootstrap statistics module.
 *
 * Audit references: §5.2 (statistics — stratified clustered uncertainty
 * estimation), §4.9.4 (Recommendation: small statistics module),
 * `feedback_pair_iid_bootstrap_forbidden.md` (memory).
 *
 * Why this exists
 * ───────────────
 * The uniqueness PoC reports pair-derived metrics (cosine, ROUGE-L, judge
 * verdicts, factual fidelity, presentation similarity). Pairs are NOT iid
 * because they share documents — every output cell participates in K-1
 * cross-tenant pairs within its event. Treating the pair as the resampling
 * unit fabricates precision and inverts decision verdicts in the worst case.
 *
 * The fix per audit §5.2: resample at the **event** level (the genuine
 * top-level cluster), preserve the within-event cell block, and reconstruct
 * pair-level statistics ONLY from cells that share an event in each
 * bootstrap draw. This is the load-bearing primitive
 * `stratifiedClusteredBootstrapCi` below.
 *
 * Variant-vs-baseline comparisons use `pairedStratifiedBootstrap` — same
 * event multiset in both arms each iteration so per-event ∆ is well-defined
 * and within-event variance cancels.
 *
 * The plain iid `bootstrapCi` is exposed for cases where the unit is
 * genuinely independent (e.g. one statistic per event averaged across
 * events). Calling code MUST justify independence in a comment per the
 * audit's recommendation.
 *
 * `proportionCi` is the Wilson interval — appropriate for cluster-level
 * binomial proportions (e.g. "events on which the wave shipped a SHIP-grade
 * verdict"), NOT for pair-level success rates.
 *
 * `effectSize` returns Cohen's d (continuous) or Cohen's h (proportions)
 * with bootstrap CIs on the effect.
 *
 * Decision-grade contract
 * ───────────────────────
 * Every CI-returning function in this module returns a `BootstrapCiResult`
 * with the fields:
 *
 *   - `ci: [lo, hi]`           95th percentile CI on the statistic
 *   - `nClusters: number`      events that fed the bootstrap
 *   - `descriptiveOnly: bool`  true when N_events < 3 (audit §5.2 floor)
 *   - `estimand: string`       caller-supplied free-text label, surfaced in
 *                              writeups so readers see WHAT POPULATION the
 *                              CI is estimating
 *
 * The caller is expected to surface every field. Hiding `descriptiveOnly` or
 * `estimand` in a writeup defeats the whole purpose of this module.
 */

// ───────────────────────────────────────────────────────────────────
// PRNG — Mulberry32
// ───────────────────────────────────────────────────────────────────
//
// Math.random() is non-reproducible, which would defeat the receipt-driven
// reproducibility contract from WM1. Mulberry32 is a 32-bit-state generator
// with adequate quality for bootstrap resampling — we are not doing
// cryptography. ~30 lines, no dependency, deterministic given a seed.

/**
 * Construct a 32-bit Mulberry32 PRNG seeded by `seed`. Returns a closure
 * that yields a uniform float in [0, 1) on each call. Same seed → same
 * sequence, on every platform.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw an integer in [0, n) using the supplied PRNG. */
function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

// ───────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────

/**
 * One event's frozen cell block — every output produced under that event,
 * across personas / identities / variants. The bootstrap resamples events
 * with replacement and reconstructs pair-level statistics ONLY from the
 * within-event `cells` array.
 *
 * `Cell` is a generic placeholder — the caller defines the shape. The
 * statistic functions take a `cells` array and return a number; they never
 * inspect what's inside.
 */
export interface EventBlock<Cell> {
  eventId: string;
  cells: Cell[];
}

/**
 * Decision-grade CI return shape. Every CI-bearing claim must surface every
 * field: hiding `descriptiveOnly` or `estimand` erases the methodology
 * surface this module exists to enforce.
 */
export interface BootstrapCiResult {
  /** 95% percentile CI on the statistic. */
  ci: [number, number];
  /** Number of clusters (events) that fed the resampling. */
  nClusters: number;
  /**
   * True when N_clusters < 3 — the audit's floor for inferential CIs. The
   * `ci` field still carries the empirical min/max of the raw statistic for
   * consistency, but the value is NOT a decision gate. Surface as
   * "descriptive only" in writeups.
   */
  descriptiveOnly: boolean;
  /**
   * Free-text label naming the population the CI is estimating. Prepended
   * with "Population estimand: " when surfaced in a writeup. The caller is
   * responsible for picking a meaningful statement.
   */
  estimand: string;
  /**
   * The point estimate (statistic computed on the original, un-resampled
   * cells). Useful for writeups that pair the CI with the headline figure.
   */
  pointEstimate: number;
}

/** Default bootstrap iteration count per audit §5.2. */
export const DEFAULT_ITERS = 10_000;

/** Floor below which CIs are descriptive-only per audit §5.2. */
export const MIN_CLUSTERS_FOR_INFERENCE = 3;

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Sort ascending and return the percentile `p` ∈ [0, 1] using linear
 * interpolation. Mirrors numpy's `np.percentile` default behaviour, which
 * is what most users compare against.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    throw new Error("percentile: empty array");
  }
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

function ciFromSamples(samples: number[]): [number, number] {
  const sorted = [...samples].sort((a, b) => a - b);
  return [percentile(sorted, 0.025), percentile(sorted, 0.975)];
}

/** Empirical min/max as a degenerate CI for the descriptive-only branch. */
function descriptiveCi(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  let lo = values[0]!;
  let hi = values[0]!;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

// ───────────────────────────────────────────────────────────────────
// Stratified clustered bootstrap — load-bearing primitive
// ───────────────────────────────────────────────────────────────────

/**
 * Resample events with replacement; for each sampled event, take the frozen
 * within-event cell block and pass it to `statistic`; aggregate by averaging
 * the per-event statistic; compute 95% percentile CI from the bootstrap
 * sample. Refuses to run inferentially when N_events < 3 (returns empirical
 * min/max + `descriptiveOnly: true`).
 *
 * ## Why per-event aggregation
 *
 * The pair-iid alternative — pool every pair across all events, then
 * resample pairs — fabricates precision because pairs share documents. The
 * cluster-level alternative — resample events but compute the statistic
 * over the **union** of within-event cells — over-weights events with more
 * cells. Per-event averaging is the audit's recommended default: each event
 * contributes equal weight, and within-event pair structure is preserved.
 *
 * If your statistic is naturally a sum (e.g. count of `fabrication_risk`
 * verdicts across all pairs in the wave), pre-aggregate it to a per-event
 * count before passing it as `statistic` and the math works out: bootstrap
 * resamples events, averages the per-event counts, and the CI is on the
 * mean count per event. To get a CI on the **total** scale, multiply both
 * endpoints by `nClusters`.
 */
export function stratifiedClusteredBootstrapCi<Cell>(args: {
  eventBlocks: EventBlock<Cell>[];
  /** Statistic computed on a single event's frozen cell block. */
  statistic: (cells: Cell[]) => number;
  estimand: string;
  iters?: number;
  /** PRNG seed; defaults to `Date.now()` (caller should pin for tests). */
  seed?: number;
}): BootstrapCiResult {
  const iters = args.iters ?? DEFAULT_ITERS;
  const n = args.eventBlocks.length;

  // Point estimate on the original event multiset
  const perEventPoint = args.eventBlocks.map((b) => args.statistic(b.cells));
  const pointEstimate =
    perEventPoint.reduce((a, b) => a + b, 0) / Math.max(1, perEventPoint.length);

  if (n < MIN_CLUSTERS_FOR_INFERENCE) {
    return {
      ci: descriptiveCi(perEventPoint),
      nClusters: n,
      descriptiveOnly: true,
      estimand: args.estimand,
      pointEstimate,
    };
  }

  const rng = mulberry32(args.seed ?? Date.now() >>> 0);
  const bootstrap: number[] = new Array(iters);

  for (let i = 0; i < iters; i++) {
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const idx = randInt(rng, n);
      const block = args.eventBlocks[idx]!;
      acc += args.statistic(block.cells);
    }
    bootstrap[i] = acc / n;
  }

  return {
    ci: ciFromSamples(bootstrap),
    nClusters: n,
    descriptiveOnly: false,
    estimand: args.estimand,
    pointEstimate,
  };
}

// ───────────────────────────────────────────────────────────────────
// Paired stratified bootstrap — variant vs baseline
// ───────────────────────────────────────────────────────────────────

/**
 * Variant-vs-baseline comparison with paired event blocks. Both arms must
 * share the same event multiset (matched by `eventId` after sort). On each
 * iteration: resample event INDICES once, take the matched control + treatment
 * blocks, compute per-event ∆ = treatment_stat − control_stat, average across
 * sampled events. CI is on the difference.
 *
 * Why pair them: matched-by-event design cancels event-level variance and
 * dramatically reduces the variance of the bootstrap, which means tighter
 * CIs and smaller required N to detect a real effect.
 */
export function pairedStratifiedBootstrap<Cell>(args: {
  controlBlocks: EventBlock<Cell>[];
  treatmentBlocks: EventBlock<Cell>[];
  statistic: (cells: Cell[]) => number;
  estimand: string;
  iters?: number;
  seed?: number;
}): BootstrapCiResult {
  if (args.controlBlocks.length !== args.treatmentBlocks.length) {
    throw new Error(
      `pairedStratifiedBootstrap: control (${args.controlBlocks.length}) and treatment (${args.treatmentBlocks.length}) must share the same event count`,
    );
  }

  // Match by eventId — paired contract. Mismatched event sets are a hard
  // bug in the caller (e.g. forgetting to align the freshly-rerun baseline)
  // and we surface it loudly rather than silently returning a noise CI.
  const ctrlById = new Map(args.controlBlocks.map((b) => [b.eventId, b]));
  const trtById = new Map(args.treatmentBlocks.map((b) => [b.eventId, b]));
  for (const id of ctrlById.keys()) {
    if (!trtById.has(id)) {
      throw new Error(
        `pairedStratifiedBootstrap: event "${id}" present in control but missing from treatment`,
      );
    }
  }
  for (const id of trtById.keys()) {
    if (!ctrlById.has(id)) {
      throw new Error(
        `pairedStratifiedBootstrap: event "${id}" present in treatment but missing from control`,
      );
    }
  }

  const eventIds = [...ctrlById.keys()].sort();
  const n = eventIds.length;

  // Point estimate on the original event multiset
  const perEventDelta = eventIds.map((id) => {
    const cStat = args.statistic(ctrlById.get(id)!.cells);
    const tStat = args.statistic(trtById.get(id)!.cells);
    return tStat - cStat;
  });
  const pointEstimate =
    perEventDelta.reduce((a, b) => a + b, 0) / Math.max(1, perEventDelta.length);

  if (n < MIN_CLUSTERS_FOR_INFERENCE) {
    return {
      ci: descriptiveCi(perEventDelta),
      nClusters: n,
      descriptiveOnly: true,
      estimand: args.estimand,
      pointEstimate,
    };
  }

  const iters = args.iters ?? DEFAULT_ITERS;
  const rng = mulberry32(args.seed ?? Date.now() >>> 0);
  const bootstrap: number[] = new Array(iters);

  for (let i = 0; i < iters; i++) {
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const eid = eventIds[randInt(rng, n)]!;
      const cStat = args.statistic(ctrlById.get(eid)!.cells);
      const tStat = args.statistic(trtById.get(eid)!.cells);
      acc += tStat - cStat;
    }
    bootstrap[i] = acc / n;
  }

  return {
    ci: ciFromSamples(bootstrap),
    nClusters: n,
    descriptiveOnly: false,
    estimand: args.estimand,
    pointEstimate,
  };
}

// ───────────────────────────────────────────────────────────────────
// Plain iid bootstrap — only for genuinely-independent samples
// ───────────────────────────────────────────────────────────────────

/**
 * Standard iid bootstrap. Use ONLY when the unit is genuinely independent
 * (e.g. one statistic per event used as the resampling unit). Calling code
 * MUST justify independence in a comment per audit §4.9.4. Calling this
 * with pair-derived samples is forbidden and is the bug
 * `feedback_pair_iid_bootstrap_forbidden.md` was filed against.
 */
export function bootstrapCi(args: {
  samples: number[];
  statistic: (samples: number[]) => number;
  estimand: string;
  iters?: number;
  seed?: number;
}): BootstrapCiResult {
  const n = args.samples.length;
  const pointEstimate = args.statistic(args.samples);

  if (n < MIN_CLUSTERS_FOR_INFERENCE) {
    return {
      ci: descriptiveCi(args.samples),
      nClusters: n,
      descriptiveOnly: true,
      estimand: args.estimand,
      pointEstimate,
    };
  }

  const iters = args.iters ?? DEFAULT_ITERS;
  const rng = mulberry32(args.seed ?? Date.now() >>> 0);
  const bootstrap: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const draw = new Array<number>(n);
    for (let k = 0; k < n; k++) {
      draw[k] = args.samples[randInt(rng, n)]!;
    }
    bootstrap[i] = args.statistic(draw);
  }

  return {
    ci: ciFromSamples(bootstrap),
    nClusters: n,
    descriptiveOnly: false,
    estimand: args.estimand,
    pointEstimate,
  };
}

// ───────────────────────────────────────────────────────────────────
// Wilson interval — for cluster-level binomial proportions
// ───────────────────────────────────────────────────────────────────

/**
 * Wilson 95% CI for a binomial proportion. Use for cluster-level success
 * counts (events where the wave shipped a SHIP-grade verdict, etc.), NOT
 * for pair-level success rates (those need the stratified bootstrap above).
 *
 * Returns the same `BootstrapCiResult` shape so callers can render every
 * stat through the same pipeline.
 */
export function proportionCi(args: {
  k: number;
  n: number;
  estimand: string;
}): BootstrapCiResult {
  const { k, n } = args;
  if (n < 0 || k < 0 || k > n) {
    throw new Error(`proportionCi: invalid k=${k} n=${n}`);
  }

  const point = n === 0 ? 0 : k / n;

  if (n === 0) {
    return {
      ci: [0, 1],
      nClusters: 0,
      descriptiveOnly: true,
      estimand: args.estimand,
      pointEstimate: 0,
    };
  }

  // Wilson — closed-form, no resampling needed
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (point + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((point * (1 - point)) / n + (z * z) / (4 * n * n))) / denom;
  const lo = Math.max(0, center - margin);
  const hi = Math.min(1, center + margin);

  return {
    ci: [lo, hi],
    nClusters: n,
    descriptiveOnly: n < MIN_CLUSTERS_FOR_INFERENCE,
    estimand: args.estimand,
    pointEstimate: point,
  };
}

// ───────────────────────────────────────────────────────────────────
// Effect sizes — Cohen's d / Cohen's h with bootstrap CIs
// ───────────────────────────────────────────────────────────────────

/**
 * Effect-size return shape — point estimate + bootstrap CI on the effect.
 * Surface every field in writeups (audit §6 post-run checklist).
 */
export interface EffectSizeResult {
  /** Cohen's d (continuous) or Cohen's h (proportions). */
  effect: number;
  /** Bootstrap CI on the effect. */
  ci: [number, number];
  /** Effect-size kind, for writeup labelling. */
  kind: "cohens_d" | "cohens_h";
  /** Number of resampling units used per arm. */
  nControl: number;
  nTreatment: number;
  /** Free-text estimand, prepended with "Population estimand: " in writeups. */
  estimand: string;
  /** True when N_per_arm < 3 — descriptive only. */
  descriptiveOnly: boolean;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[], xbar: number): number {
  if (xs.length < 2) return 0;
  return (
    xs.reduce((acc, x) => acc + (x - xbar) * (x - xbar), 0) / (xs.length - 1)
  );
}

function pooledStdDev(control: number[], treatment: number[]): number {
  const cVar = variance(control, mean(control));
  const tVar = variance(treatment, mean(treatment));
  const num = (control.length - 1) * cVar + (treatment.length - 1) * tVar;
  const denom = control.length + treatment.length - 2;
  if (denom <= 0) return 0;
  const v = num / denom;
  return v > 0 ? Math.sqrt(v) : 0;
}

function cohensD(control: number[], treatment: number[]): number {
  const sd = pooledStdDev(control, treatment);
  if (sd === 0) return 0;
  return (mean(treatment) - mean(control)) / sd;
}

function cohensH(pControl: number, pTreatment: number): number {
  // Bound the inputs to avoid asin domain errors on rounding noise.
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  return (
    2 * Math.asin(Math.sqrt(clamp(pTreatment))) -
    2 * Math.asin(Math.sqrt(clamp(pControl)))
  );
}

/**
 * Cohen's d for continuous samples or Cohen's h for proportion samples,
 * with a bootstrap CI on the effect. Resampling treats each arm as iid;
 * passing pair-derived samples here is the same forbidden pattern as
 * `bootstrapCi` and the caller must justify independence.
 */
export function effectSize(args: {
  control: number[];
  treatment: number[];
  kind: "cohens_d" | "cohens_h";
  estimand: string;
  iters?: number;
  seed?: number;
}): EffectSizeResult {
  const { control, treatment, kind } = args;
  const nControl = control.length;
  const nTreatment = treatment.length;

  const point =
    kind === "cohens_d"
      ? cohensD(control, treatment)
      : cohensH(mean(control), mean(treatment));

  const descriptiveOnly =
    Math.min(nControl, nTreatment) < MIN_CLUSTERS_FOR_INFERENCE;

  if (descriptiveOnly) {
    return {
      effect: point,
      ci: [point, point],
      kind,
      nControl,
      nTreatment,
      estimand: args.estimand,
      descriptiveOnly: true,
    };
  }

  const iters = args.iters ?? DEFAULT_ITERS;
  const rng = mulberry32(args.seed ?? Date.now() >>> 0);
  const bootstrap: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const cDraw = new Array<number>(nControl);
    for (let k = 0; k < nControl; k++) {
      cDraw[k] = control[randInt(rng, nControl)]!;
    }
    const tDraw = new Array<number>(nTreatment);
    for (let k = 0; k < nTreatment; k++) {
      tDraw[k] = treatment[randInt(rng, nTreatment)]!;
    }
    bootstrap[i] =
      kind === "cohens_d"
        ? cohensD(cDraw, tDraw)
        : cohensH(mean(cDraw), mean(tDraw));
  }

  return {
    effect: point,
    ci: ciFromSamples(bootstrap),
    kind,
    nControl,
    nTreatment,
    estimand: args.estimand,
    descriptiveOnly: false,
  };
}
