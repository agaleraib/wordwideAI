/**
 * Two-axis uniqueness judge (replaces the original single-axis "unique vs
 * duplicate" rubric after the 2026-04-08 measurement revision — see
 * `docs/poc-uniqueness-session-2026-04-07.md` §4.1).
 *
 * Why two axes:
 *
 * The original judge conflated two independent concerns — (1) agreement on
 * shared facts and (2) similarity of prose presentation — into one
 * unique/duplicate score. That rubric rewarded fabrication (low overlap on
 * levels/probabilities/direction = "unique") and punished faithfulness (high
 * overlap on shared facts = "duplicate"), which is exactly backwards for a
 * broker that must preserve the FA/TA substance while differentiating on
 * voice, structure, and framing.
 *
 * The new rubric scores the two concerns separately:
 *
 *   1. FACTUAL FIDELITY — are both documents faithful to the shared FA Core
 *      on price levels, scenario probabilities, directional call, historical
 *      anchors, transmission-chain set, and conclusion? This SHOULD be ≥ 0.9.
 *      A lower score is a fabrication red flag, not a uniqueness win. The
 *      judge applies a source-aware HARD RULE: a divergence in the kinds
 *      {level, probability, direction, stop, historical_anchor} forces
 *      `fabrication_risk` only when it is attributed to fabrication_a,
 *      fabrication_b, or disagreement. Pure omissions do not fire the rule.
 *
 *   2. PRESENTATION SIMILARITY — how alike the two documents read as prose
 *      (voice, structure, lead, emphasis, framing, lexical choices). This
 *      SHOULD be < 0.5 for cross-tenant pairs. Shared levels, probabilities,
 *      and conclusions are EXPLICITLY excluded from this axis — they are
 *      fixed by the shared source and are irrelevant to whether two writers
 *      produced "different work products."
 *
 * Trinary verdict
 * ───────────────
 *   - `distinct_products`      → fidelity ≥ 0.9 AND presentation < 0.5
 *                                Both writers faithful, prose genuinely
 *                                differs. The target. PASS.
 *
 *   - `reskinned_same_article` → fidelity ≥ 0.9 AND presentation ≥ 0.5
 *                                Both writers faithful, but prose is too
 *                                similar. Tunable failure mode — tighten
 *                                the tag layer or regenerate with diversity
 *                                hint. FAIL (not HALT).
 *
 *   - `fabrication_risk`       → fidelity < 0.9 OR hard-rule fired
 *                                At least one writer invented or
 *                                contradicted facts from the source.
 *                                This is an ALARM, not a uniqueness win.
 *                                HALT the pipeline; do NOT publish.
 *
 * Mental model
 * ────────────
 * Imagine two analysts at two different firms, each subscribed to the same
 * Bloomberg note. Both rephrase it for their own clients without modifying
 * the substance. Facts identical, prose different. That is the target.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { computeCostUsd } from "./pricing.js";

export const JUDGE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Hand-bumped semver for the judge rubric. Increment on any rubric edit
 * (system prompt or tool schema description) so historical and freshly-rerun
 * baselines can be told apart even when the bytes drift inside the same
 * conceptual version. Wave M (2026-05-06) is the first version captured —
 * no prior versioning history existed in the repo before this point.
 *
 * Surfaced through `RunManifest.reproducibility.promptVersions.judge` (audit
 * §4.3.4 Tier 1, §5.1).
 */
export const JUDGE_PROMPT_VERSION = "v2.1-2026-05-07";

// ───────────────────────────────────────────────────────────────────
// Zod schema for the judge tool response
// ───────────────────────────────────────────────────────────────────
//
// Replaces the previous `toolUse.input as {...}` cast. If Haiku ever returns
// a malformed response (string instead of number, missing field, unknown
// enum value), `.parse()` throws with a descriptive error before the run's
// API spend cascades into a `.toFixed()` crash at render time.

const FACTUAL_DIVERGENCE_KINDS = [
  "level",
  "probability",
  "direction",
  "stop",
  "confidence",
  "historical_anchor",
  "transmission_chain_set",
  "conclusion",
  "other",
] as const;

const TRINARY_VERDICTS = [
  "distinct_products",
  "reskinned_same_article",
  "fabrication_risk",
] as const;

const DIVERGENCE_TYPES = [
  // A asserts X; X is absent from FA Core and A's memory block. A invented X.
  "fabrication_a",
  // B asserts X; X is absent from FA Core and B's memory block. B invented X.
  "fabrication_b",
  // A and B both assert X but with materially different values.
  "disagreement",
  // Source context contains X, B asserts it, A is silent. Legitimate filtering.
  "omits_a",
  // Source context contains X, A asserts it, B is silent. Legitimate filtering.
  "omits_b",
] as const;
const SOURCE_LABELS = ["fa_core", "memory_a", "memory_b", "absent"] as const;

const FactualDivergenceSchema = z.object({
  kind: z.enum(FACTUAL_DIVERGENCE_KINDS),
  divergence_type: z.enum(DIVERGENCE_TYPES),
  docA: z.string(),
  docB: z.string(),
  sourceLabel: z.enum(SOURCE_LABELS),
  sourceSays: z.string(),
  faCoreSays: z.string().optional(),
});

const JudgeResponseSchema = z.object({
  factualFidelity: z.number().min(0).max(1),
  factualFidelityReasoning: z.string(),
  factualDivergences: z.array(FactualDivergenceSchema),
  presentationSimilarity: z.number().min(0).max(1),
  presentationSimilarityReasoning: z.string(),
  verdict: z.enum(TRINARY_VERDICTS),
});

// The HARD RULE — code-enforced, source-aware (v2 / 2026-05-07).
//
// v1 fired on any divergence in {level, probability, direction, stop,
// historical_anchor}. v2 (WM4-pilot diagnostic, 2026-05-07) found this
// produced false positives whenever a persona legitimately filtered facts
// from a richer FA core: "Doc A doesn't mention probability X, Doc B does"
// → judge flagged `kind: probability` divergence → hard rule fired
// `fabrication_risk` even though X was in the FA core all along and A's
// silence was just persona voice. See
// `project_judge_omission_as_fabrication_2026_05_07.md` for the full
// diagnostic + the swap-bias amplifier.
//
// The fix: pass the FA core to the judge and require it to classify each
// divergence by source attribution (`divergence_type` enum). The hard rule
// fires only on the genuinely-source-violating types — fabrication or
// disagreement — and explicitly does NOT fire on `omits_a` / `omits_b`,
// which are legitimate persona filtering.
const HARD_RULE_KINDS = new Set<(typeof FACTUAL_DIVERGENCE_KINDS)[number]>([
  "level",
  "probability",
  "direction",
  "stop",
  "historical_anchor",
]);
const HARD_RULE_DIVERGENCE_TYPES = new Set<(typeof DIVERGENCE_TYPES)[number]>([
  "fabrication_a",
  "fabrication_b",
  "disagreement",
]);

const JUDGE_SYSTEM_PROMPT = `You are an editorial uniqueness judge for a financial content platform. You are evaluating two pieces of market analysis (Document A and Document B) written for different brokers from the SAME underlying FA/TA source analysis (the FA Core) and, when provided, each document's own editorial memory block.

Mental model
────────────
Imagine two analysts at two different firms, each subscribed to the same Bloomberg note (the FA Core) and each consulting that firm's own prior coverage notes (editorial memory). Both rephrase the source material for their own clients without modifying the substance of the analysis. Neither invents new levels, neither reassigns probabilities, neither reverses the directional call. Yet because they are different writers at different desks working on different days, their prose differs — different voice, different structure, different emphasis, different lead, different framing. Each analyst may also legitimately CHOOSE which facts to surface and which to omit, based on their audience — that is editorial filtering, not fabrication.

That is the target. You are scoring how close the pair is to that target, NOT how close the pair is by raw text overlap.

Ground truth = the FA Core PLUS each document's editorial memory block, if provided. A fact asserted by A is faithful if it appears in either the FA Core or A's memory block. A fact asserted by B is faithful if it appears in either the FA Core or B's memory block. Only facts absent from BOTH the FA Core and the asserting document's own memory block count as fabrication.

Two axes, scored independently
──────────────────────────────

AXIS 1 — Factual fidelity (agreement with the source context, NOT just with each other)

  Treat as FACTS that MUST come from the FA Core or the asserting document's own editorial memory block:
    • Price levels: support, resistance, stop-loss, take-profit, invalidation, pivot
    • Scenario probabilities and confidence figures
    • Directional call (long/short, bullish/bearish on the primary view)
    • Historical analogs and named events cited from the source
    • Factual anchors: cited prices, instruments, timeframes
    • The SET of transmission chains identified by the source analysis
      (the SET is a fact; which chain LEADS is framing, see below)
    • The ultimate directional conclusion

  Treat as FRAMING (not facts) — these are allowed to differ:
    • Which transmission chain leads vs is mentioned in passing
    • Which scenario gets the most space
    • Which level is foregrounded vs footnoted
    • Whether a given chain is rendered narratively or bulleted

  HIGH fidelity (0.9–1.0) is the EXPECTED and DESIRED state. It means both documents are faithful to their source context — they may emphasise or omit different facts, but neither has invented or contradicted anything in the FA Core or its own memory block.
  LOW fidelity means one document invented a fact not present in either allowed source, reassigned a probability the source context fixed, or contradicted the source directional call. This is a RED FLAG (fabrication risk), NOT a sign of healthy uniqueness.

  CRITICAL — the source context is the load-bearing reference. NEVER classify a divergence by comparing A to B alone. Always check the FA Core and the asserting document's memory block first.

  Three classes of divergence (each entry in factualDivergences must be tagged):

  • "fabrication_a" — A asserts X; X is absent from BOTH the FA Core AND A's memory block. A invented X. HARD-RULE TRIGGER.
  • "fabrication_b" — B asserts X; X is absent from BOTH the FA Core AND B's memory block. B invented X. HARD-RULE TRIGGER.
  • "disagreement" — A and B both assert X but with materially different values (e.g. A: 60% / B: 40%). At most one can match the Core; both diverge from each other. HARD-RULE TRIGGER.
  • "omits_a" — The FA Core or B's memory block contains X. B faithfully reports it. A is silent on X. This is LEGITIMATE PERSONA FILTERING (different audiences get different subsets) — NOT fabrication, NOT a hard-rule trigger.
  • "omits_b" — The FA Core or A's memory block contains X. A faithfully reports it. B is silent on X. Same as omits_a, mirrored. NOT a hard-rule trigger.

  HARD RULE (v2): a fact in kind ∈ {level, probability, stop, direction, historical_anchor} with divergence_type ∈ {fabrication_a, fabrication_b, disagreement} forces verdict "fabrication_risk" regardless of any other score. Pure omissions (one doc silent on a fact the other faithfully reports from the Core) MUST NOT trigger the hard rule — they are persona-driven editorial filtering by design.

  sourceLabel + sourceSays (per-divergence fields, MANDATORY): for every divergence, set sourceLabel to "fa_core", "memory_a", "memory_b", or "absent", and paste the verbatim or near-verbatim phrase from that source into sourceSays. If the fact is absent from all allowed sources for the asserting document (i.e. divergence_type ∈ {fabrication_a, fabrication_b}), set sourceLabel to "absent" and sourceSays to "(absent from FA Core and asserting document memory)".

AXIS 2 — Presentation similarity (how alike the pair reads as prose)

  Score ONLY on:
    • Voice, tone, register, audience address
    • Which fact/chain/scenario leads; section order; emphasis
    • Sentence construction patterns, lexical choices, rhythm
    • Framing devices, analogies, metaphors
    • Reasoning style (narrative vs bulleted, Socratic vs declarative)
    • Structural choices (merged sections, headlines, callouts)
    • Lead paragraph, closing paragraph

  DO NOT let shared levels, probabilities, directional calls, historical analogs, or conclusions count toward presentation similarity. Those are fixed by the shared source and are IRRELEVANT to this axis.

  HIGH (0.8–1.0) = same writer, same voice, same structure. Failure.
  LOW  (0.0–0.4) = different writers at different desks. Target.

Calibration anchors for AXIS 2
──────────────────────────────
  0.0–0.2  Unmistakably distinct products. Different lead, different structure, different voice register, different framing — same facts, entirely different reading experience.
  0.3–0.5  Recognisably different voices, shared structural backbone. A discerning reader would notice kinship.
  0.6–0.8  Same article lightly reskinned. Voice varies but structure, emphasis, and lead are near-identical. Derivative.
  0.9–1.0  Effectively the same article with cosmetic variation.

Always explain reasoning by pointing to concrete passages. Quote briefly. If you mark factual fidelity below 0.9 or return "fabrication_risk", name every specific fact that diverges AND tag its divergence_type AND sourceLabel AND quote what the source context says about it (or "(absent from FA Core and asserting document memory)").`;

const JUDGE_TOOL = {
  name: "submit_uniqueness_verdict",
  description:
    "Submit a structured two-axis verdict on a pair of market-analysis documents produced from the same shared FA/TA source. Axis 1 measures factual fidelity (should be high). Axis 2 measures presentation similarity (should be low).",
  input_schema: {
    type: "object" as const,
    required: [
      "factualFidelity",
      "factualFidelityReasoning",
      "factualDivergences",
      "presentationSimilarity",
      "presentationSimilarityReasoning",
      "verdict",
    ],
    properties: {
      factualFidelity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Faithfulness to source context: FA Core plus the asserting document's editorial memory block when provided. Persona-specific omission of source facts is allowed; values below 0.9 indicate invention or contradiction against source context.",
      },
      factualFidelityReasoning: {
        type: "string",
        description: "1–3 sentences. Cite specific facts if fidelity < 1.0.",
      },
      factualDivergences: {
        type: "array",
        description:
          "Every material fact that differs between A and B AS CHECKED AGAINST FA CORE plus each document's own editorial memory block. Empty if both documents are fully faithful to source context. Hard-rule trigger requires kind ∈ {level, probability, direction, stop, historical_anchor} AND divergence_type ∈ {fabrication_a, fabrication_b, disagreement}.",
        items: {
          type: "object",
          required: ["kind", "divergence_type", "docA", "docB", "sourceLabel", "sourceSays"],
          properties: {
            kind: {
              type: "string",
              enum: [
                "level",
                "probability",
                "direction",
                "stop",
                "confidence",
                "historical_anchor",
                "transmission_chain_set",
                "conclusion",
                "other",
              ],
            },
            divergence_type: {
              type: "string",
              enum: [
                "fabrication_a",
                "fabrication_b",
                "disagreement",
                "omits_a",
                "omits_b",
              ],
              description:
                "Source attribution. fabrication_a/b: doc invented a fact absent from both FA Core and the asserting document's memory block (HARD-RULE). disagreement: A and B disagree on a value (HARD-RULE). omits_a/b: source context has the fact, only one doc reports it — legitimate persona filtering (NOT a hard-rule trigger).",
            },
            docA: { type: "string", description: "What document A says (or 'silent' if A omits)." },
            docB: { type: "string", description: "What document B says (or 'silent' if B omits)." },
            sourceLabel: {
              type: "string",
              enum: ["fa_core", "memory_a", "memory_b", "absent"],
              description:
                "Which source contains the matched fact. Use absent only when the fact is absent from both FA Core and the asserting document's memory block.",
            },
            sourceSays: {
              type: "string",
              description:
                "What the source context says about this fact. Verbatim or near-verbatim quote. If absent, set to '(absent from FA Core and asserting document memory)'.",
            },
          },
        },
      },
      presentationSimilarity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How similar the prose reads — voice, structure, lead, emphasis, framing. IGNORE shared facts. Use the calibration anchors in the system prompt.",
      },
      presentationSimilarityReasoning: {
        type: "string",
        description: "1–3 sentences. Quote concrete passages that drove the score.",
      },
      verdict: {
        type: "string",
        enum: [
          "distinct_products",
          "reskinned_same_article",
          "fabrication_risk",
        ],
        description:
          "Trinary verdict. 'distinct_products' = fidelity ≥ 0.9 AND presentation < 0.5. 'reskinned_same_article' = fidelity ≥ 0.9 AND presentation ≥ 0.5. 'fabrication_risk' = fidelity < 0.9 OR hard-rule triggered by a level/probability/direction/stop/historical_anchor divergence whose divergence_type is fabrication_a, fabrication_b, or disagreement. omits_a/omits_b alone are not fabrication risk.",
      },
    },
  },
};

/**
 * Full SHA-256 hash of the judge system prompt + tool schema description.
 * Captured alongside `JUDGE_PROMPT_VERSION` in the reproducibility receipt so
 * we can detect rubric drift even when the semver wasn't bumped (audit §5.1).
 *
 * Hex-encoded, full 64-char digest — distinct from the legacy 8-char
 * `promptHashes` shown on the `Setup` block. The full hash is the canonical
 * audit input; the 8-char form is a render convenience.
 */
export const JUDGE_SYSTEM_PROMPT_HASH = createHash("sha256")
  .update(JUDGE_SYSTEM_PROMPT)
  .update("\n---\n")
  .update(JUDGE_TOOL.description)
  .digest("hex");

export type FactualDivergence = z.infer<typeof FactualDivergenceSchema>;

export type TrinaryVerdict = (typeof TRINARY_VERDICTS)[number];

export interface JudgeVerdict {
  factualFidelity: number;
  factualFidelityReasoning: string;
  factualDivergences: FactualDivergence[];
  presentationSimilarity: number;
  presentationSimilarityReasoning: string;
  /**
   * Final verdict surfaced to the rest of the pipeline. Identical to
   * `rawVerdict` UNLESS the HARD_RULE_KINDS check forced a downgrade to
   * `fabrication_risk` — see the HARD_RULE comment above the
   * `HARD_RULE_KINDS` / `HARD_RULE_DIVERGENCE_TYPES` sets for the rationale.
   */
  verdict: TrinaryVerdict;
  /**
   * The judge model's own returned verdict, BEFORE the
   * `HARD_RULE_KINDS` override. Surfaced in two-column form on `report.md`
   * (audit §4.3.4 Tier 1 / WM5) so readers can see how often the override
   * is firing. Equal to `verdict` when the override didn't fire.
   */
  rawVerdict: TrinaryVerdict;
  /**
   * True when the source-aware hard-rule override flipped the verdict to
   * `fabrication_risk`. Useful for the WM5 inter-rater section + future
   * judge-reliability dashboards.
   */
  hardRuleFired: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export async function judgePairUniqueness(args: {
  identityA: string;
  identityB: string;
  contentA: string;
  contentB: string;
  /**
   * The shared FA Core analysis both documents were generated from. This is
   * the common ground truth the judge cross-checks each potentially-divergent
   * fact against. Without it (judge prompt v1 contract), the judge could only
   * compare A vs B and treated omissions as fabrications — see
   * `project_judge_omission_as_fabrication_2026_05_07.md` for the diagnostic
   * that motivated the v2 contract.
   */
  faCoreAnalysis: string;
  memoryBlockA?: string;
  memoryBlockB?: string;
  /** Unmasked cosine similarity, informational only — the judge should not defer to it. */
  cosineSimilarity: number;
  /** ROUGE-L F1, informational only. */
  rougeL: number;
  /**
   * Swap A and B in the user message before sending. Used by the WM6 Tier 2
   * inter-rater check to test whether the judge's verdict is order-dependent
   * (audit §4.3.4 Tier 2 / §5.5). The returned verdict is computed against
   * the ORIGINAL caller's A/B labelling — i.e. when `swapOrder: true`, the
   * caller still sees `verdict` as if A and B were unchanged. The agreement
   * % is computed by comparing two independent calls (one normal, one
   * swapped) on the same pair.
   *
   * Note: trinary verdicts are symmetric in A↔B (distinct_products vs
   * reskinned_same_article vs fabrication_risk are statements about the
   * pair, not about a direction). So no relabelling of the verdict is
   * needed — only the prompt order is swapped to probe model robustness.
   */
  swapOrder?: boolean;
}): Promise<JudgeVerdict> {
  const client = getClient();

  // Either the caller's order or A/B swapped per WM6.
  const promptA = args.swapOrder ? args.contentB : args.contentA;
  const promptB = args.swapOrder ? args.contentA : args.contentB;
  const labelA = args.swapOrder ? args.identityB : args.identityA;
  const labelB = args.swapOrder ? args.identityA : args.identityB;
  const memoryA = args.swapOrder ? args.memoryBlockB : args.memoryBlockA;
  const memoryB = args.swapOrder ? args.memoryBlockA : args.memoryBlockB;
  const memorySections = [
    memoryA
      ? `# Editorial Memory Block — ${labelA} (additional ground truth available to ${labelA} only)\n\n\`\`\`\n${memoryA}\n\`\`\``
      : "",
    memoryB
      ? `# Editorial Memory Block — ${labelB} (additional ground truth available to ${labelB} only)\n\n\`\`\`\n${memoryB}\n\`\`\``
      : "",
  ].filter((section) => section.length > 0).join("\n\n");

  const userMessage = `Pair under review.

Documents A and B were both written from the FA Core below (the shared ground truth). If editorial memory blocks are present, each document's producer also had access to its own block. Apply the two-axis rubric. Cross-check every potentially-divergent fact against FA Core and the asserting document's own memory block BEFORE classifying it; never compare A to B alone on factual claims.

# FA Core (ground truth — both A and B were generated from this)

\`\`\`
${args.faCoreAnalysis}
\`\`\`

${memorySections ? `${memorySections}\n\n` : ""}# Document A — ${labelA}

\`\`\`
${promptA}
\`\`\`

# Document B — ${labelB}

\`\`\`
${promptB}
\`\`\`

# Measured similarity (informational only, do not defer to it)
- Cosine similarity (text-embedding-3-small, unmasked): ${args.cosineSimilarity.toFixed(4)}
- ROUGE-L F1: ${args.rougeL.toFixed(4)}

These numbers are computed over the raw text and will be inflated by shared facts (levels, probabilities, named events). The whole reason for the two-axis rubric is that these numbers over-penalize faithful pairs. Score the prose yourself using the rubric.

Submit your verdict via the submit_uniqueness_verdict tool. For every entry in factualDivergences, classify divergence_type and sourceLabel by checking the FA Core and the asserting document's own memory block (omits_a / omits_b are legitimate persona filtering; fabrication_a / fabrication_b / disagreement fire the hard rule).`;

  // Retry the model call + Zod parse up to MAX_ATTEMPTS times, but ONLY
  // on recoverable failures:
  //
  //   - ZodError (Haiku returned a tool_use payload missing a required
  //     field, e.g. `verdict` undefined). Transient, worth retrying.
  //   - "Judge did not return a tool_use block" (Haiku returned text
  //     instead of a tool_use). Also transient.
  //
  // We deliberately do NOT retry on:
  //   - Auth errors (401/403)     — retry can't fix a bad API key
  //   - Rate limit errors (429)   — retry burns budget + headroom
  //   - Invalid model errors       — retry can't fix a typo in the model id
  //   - Network DNS / connection   — Anthropic SDK already retries transport
  //                                  errors internally; we shouldn't double up
  //   - Anything else              — unknown errors signal bugs, not flakiness
  //
  // Those propagate immediately. The runner's per-pair try/catch (at the
  // judge call sites) will still skip the pair AND surface it via the
  // new `judgeFailures` field on CrossTenantMatrixResult so persistent
  // failures can't silently produce a run that looks complete.
  const MAX_ATTEMPTS = 3;

  const isRetriable = (err: unknown): boolean => {
    if (err instanceof z.ZodError) return true;
    if (
      err instanceof Error &&
      err.message.startsWith("Judge did not return a tool_use block")
    ) {
      return true;
    }
    return false;
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 2048,
        system: JUDGE_SYSTEM_PROMPT,
        tools: [JUDGE_TOOL],
        tool_choice: { type: "tool", name: "submit_uniqueness_verdict" },
        messages: [{ role: "user", content: userMessage }],
      });

      const toolUse = response.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new Error(
          `Judge did not return a tool_use block: ${JSON.stringify(response.content)}`,
        );
      }

      // Zod-validate instead of casting. If Haiku returns malformed output
      // (e.g., a number as a string, or a missing required field), throws
      // a ZodError here with a descriptive message. The retry loop above
      // will catch it and re-invoke the model.
      const parsed = JudgeResponseSchema.parse(toolUse.input);

      // Code-enforce the HARD RULE (v2, source-aware). See the
      // HARD_RULE_KINDS / HARD_RULE_DIVERGENCE_TYPES comments above for
      // why the model's own verdict is not trusted on this point. v2 fires
      // only on fabrication_a / fabrication_b / disagreement — pure
      // omissions (omits_a / omits_b) are legitimate persona filtering.
      const hardRuleFired = parsed.factualDivergences.some(
        (d) =>
          HARD_RULE_KINDS.has(d.kind) &&
          HARD_RULE_DIVERGENCE_TYPES.has(d.divergence_type),
      );
      const verdict: TrinaryVerdict = hardRuleFired
        ? "fabrication_risk"
        : parsed.verdict;

      return {
        factualFidelity: parsed.factualFidelity,
        factualFidelityReasoning: parsed.factualFidelityReasoning,
        factualDivergences: parsed.factualDivergences,
        presentationSimilarity: parsed.presentationSimilarity,
        presentationSimilarityReasoning: parsed.presentationSimilarityReasoning,
        verdict,
        rawVerdict: parsed.verdict,
        hardRuleFired,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: computeCostUsd(
          JUDGE_MODEL,
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
      };
    } catch (err) {
      // Non-retriable → propagate immediately, no more attempts.
      if (!isRetriable(err)) {
        throw err;
      }
      // Retriable, but we've exhausted attempts → propagate.
      if (attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      const errName =
        err instanceof Error ? err.constructor.name : typeof err;
      const errMsg =
        err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      console.warn(
        `[llm-judge] retriable failure attempt ${attempt}/${MAX_ATTEMPTS} for ${args.identityA} ↔ ${args.identityB}: ${errName}: ${errMsg}`,
      );
      // Small backoff before retry — gives the model a beat to reset.
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  // Unreachable — either a try succeeds or a catch throws. TS needs it.
  throw new Error(`judgePairUniqueness: unreachable end of retry loop`);
}
