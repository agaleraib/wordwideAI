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
 *   1. FACTUAL FIDELITY — do both documents agree on the facts that must be
 *      shared (price levels, scenario probabilities, directional call,
 *      historical anchors, transmission-chain set, conclusion)? This SHOULD
 *      be ≥ 0.9. A lower score is a fabrication red flag, not a uniqueness
 *      win. The judge applies a HARD RULE: any divergence in the kinds
 *      {level, probability, direction, stop, historical_anchor} forces the
 *      trinary verdict to `fabrication_risk` regardless of the overall
 *      numeric score.
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
export const JUDGE_PROMPT_VERSION = "v1-2026-05-06";

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

const FactualDivergenceSchema = z.object({
  kind: z.enum(FACTUAL_DIVERGENCE_KINDS),
  docA: z.string(),
  docB: z.string(),
});

const JudgeResponseSchema = z.object({
  factualFidelity: z.number().min(0).max(1),
  factualFidelityReasoning: z.string(),
  factualDivergences: z.array(FactualDivergenceSchema),
  presentationSimilarity: z.number().min(0).max(1),
  presentationSimilarityReasoning: z.string(),
  verdict: z.enum(TRINARY_VERDICTS),
});

// The HARD RULE — code-enforced, not prompt-only.
//
// The rubric says: any divergence in {level, probability, direction, stop,
// historical_anchor} forces `fabrication_risk` regardless of the model's
// returned verdict. This rule is stated in the system prompt and in the
// tool-schema description, but the model does not always apply it (Haiku
// has been observed returning `distinct_products` alongside a
// `{kind: "level"}` divergence). The 2026-04-08 measurement retraction
// rests on this rule being reliable, so we enforce it here rather than
// trusting the model.
const HARD_RULE_KINDS = new Set<(typeof FACTUAL_DIVERGENCE_KINDS)[number]>([
  "level",
  "probability",
  "direction",
  "stop",
  "historical_anchor",
]);

const JUDGE_SYSTEM_PROMPT = `You are an editorial uniqueness judge for a financial content platform. You are evaluating two pieces of market analysis written for different brokers from the SAME underlying FA/TA source analysis.

Mental model
────────────
Imagine two analysts at two different firms, each subscribed to the same Bloomberg note. Both rephrase it for their own clients without modifying the substance of the analysis. Neither invents new levels, neither reassigns probabilities, neither reverses the directional call. Yet because they are different writers at different desks working on different days, their prose differs — different voice, different structure, different emphasis, different lead, different framing.

That is the target. You are scoring how close the pair is to that target, NOT how close the pair is by raw text overlap.

Two axes, scored independently
──────────────────────────────

AXIS 1 — Factual fidelity (agreement on shared facts)

  Treat as FACTS that MUST MATCH across both documents:
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

  HIGH fidelity (0.9–1.0) is the EXPECTED and DESIRED state.
  LOW fidelity means one document invented, reassigned, or contradicted facts relative to the other. This is a RED FLAG (fabrication risk), NOT a sign of healthy uniqueness.

  HARD RULE: if either document contains a level, probability, stop, direction, or named historical analog that is contradicted or materially altered by the other, you MUST return verdict "fabrication_risk" regardless of any other score. A single invented level is not outweighed by good writing.

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

Always explain reasoning by pointing to concrete passages. Quote briefly. If you mark factual fidelity below 0.9 or return "fabrication_risk", name every specific fact that diverges.`;

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
          "Agreement on facts that must be shared: levels, probabilities, direction, anchors, set of transmission chains, conclusion. Expected near 1.0. Values below 0.9 indicate fabrication risk.",
      },
      factualFidelityReasoning: {
        type: "string",
        description: "1–3 sentences. Cite specific facts if fidelity < 1.0.",
      },
      factualDivergences: {
        type: "array",
        description:
          "Every material fact that differs between A and B. Empty if both documents are fully faithful. NON-EMPTY with kind ∈ {level, probability, direction, stop, historical_anchor} forces verdict = 'fabrication_risk'.",
        items: {
          type: "object",
          required: ["kind", "docA", "docB"],
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
            docA: { type: "string", description: "What document A says." },
            docB: { type: "string", description: "What document B says." },
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
          "Trinary verdict. 'distinct_products' = fidelity ≥ 0.9 AND presentation < 0.5. 'reskinned_same_article' = fidelity ≥ 0.9 AND presentation ≥ 0.5. 'fabrication_risk' = fidelity < 0.9 OR hard-rule triggered by any level/probability/direction/stop/historical_anchor divergence.",
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
   * `HARD_RULE_KINDS` set for the rationale.
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
   * True when the hard-rule override flipped the verdict to
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
  /** Unmasked cosine similarity, informational only — the judge should not defer to it. */
  cosineSimilarity: number;
  /** ROUGE-L F1, informational only. */
  rougeL: number;
}): Promise<JudgeVerdict> {
  const client = getClient();

  const userMessage = `Pair under review.

Both documents were written from the SAME underlying FA/TA source analysis, for two different brokers. Apply the two-axis rubric.

# Document A — ${args.identityA}

\`\`\`
${args.contentA}
\`\`\`

# Document B — ${args.identityB}

\`\`\`
${args.contentB}
\`\`\`

# Measured similarity (informational only, do not defer to it)
- Cosine similarity (text-embedding-3-small, unmasked): ${args.cosineSimilarity.toFixed(4)}
- ROUGE-L F1: ${args.rougeL.toFixed(4)}

These numbers are computed over the raw text and will be inflated by shared facts (levels, probabilities, named events). The whole reason for the two-axis rubric is that these numbers over-penalize faithful pairs. Score the prose yourself using the rubric.

Submit your verdict via the submit_uniqueness_verdict tool.`;

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

      // Code-enforce the HARD RULE. See the HARD_RULE_KINDS comment above
      // for why the model's own verdict is not trusted on this point.
      const hardRuleFired = parsed.factualDivergences.some((d) =>
        HARD_RULE_KINDS.has(d.kind),
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
