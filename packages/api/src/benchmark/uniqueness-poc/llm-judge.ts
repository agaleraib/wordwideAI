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
import { computeCostUsd } from "./pricing.js";

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

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

export interface FactualDivergence {
  kind:
    | "level"
    | "probability"
    | "direction"
    | "stop"
    | "confidence"
    | "historical_anchor"
    | "transmission_chain_set"
    | "conclusion"
    | "other";
  docA: string;
  docB: string;
}

export type TrinaryVerdict =
  | "distinct_products"
  | "reskinned_same_article"
  | "fabrication_risk";

export interface JudgeVerdict {
  factualFidelity: number;
  factualFidelityReasoning: string;
  factualDivergences: FactualDivergence[];
  presentationSimilarity: number;
  presentationSimilarityReasoning: string;
  verdict: TrinaryVerdict;
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

  const input = toolUse.input as {
    factualFidelity: number;
    factualFidelityReasoning: string;
    factualDivergences: FactualDivergence[];
    presentationSimilarity: number;
    presentationSimilarityReasoning: string;
    verdict: TrinaryVerdict;
  };

  return {
    ...input,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: computeCostUsd(
      JUDGE_MODEL,
      response.usage.input_tokens,
      response.usage.output_tokens,
    ),
  };
}
