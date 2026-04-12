/**
 * Contradiction detector — compares prior editorial positions against
 * new market evidence via Haiku tool_use.
 *
 * Spec: docs/specs/2026-04-12-editorial-memory.md §8
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EditorialFact, TensionType, ContradictionResolution } from "./types.js";

const DETECTOR_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are comparing a persona's prior editorial positions against new market evidence. Your job is to detect tensions — places where the new evidence challenges, partially invalidates, or makes stale the prior positions.

Be precise and conservative:
- Only flag real contradictions. A prior bullish view is NOT contradicted if the market dipped temporarily but the thesis remains intact.
- "reversed" means the directional view is clearly wrong now.
- "reinforced_but_reframed" means the direction was right but the reasoning needs updating.
- "partially_invalidated" means a specific claim (like a price level) is no longer valid.
- "level_stale" means a price level cited in prior coverage is no longer relevant.

If the new evidence reinforces the prior position, return an empty contradictions array — this is not a contradiction.`;

const CONTRADICTION_DETECTOR_TOOL = {
  name: "detect_contradictions",
  description:
    "Compare prior editorial positions against new market evidence and identify tensions.",
  input_schema: {
    type: "object" as const,
    properties: {
      contradictions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            priorFactId: {
              type: "string" as const,
              description:
                "The ID of the prior fact being contradicted. Must match one of the fact IDs provided in the input.",
            },
            priorFactContent: { type: "string" as const },
            newEvidence: { type: "string" as const },
            tensionType: {
              type: "string" as const,
              enum: [
                "reversed",
                "reinforced_but_reframed",
                "partially_invalidated",
                "level_stale",
              ],
            },
            explanation: { type: "string" as const },
            suggestedResolution: {
              type: "string" as const,
              enum: ["superseded", "acknowledged", "dismissed", "pending"],
              description:
                "Maps directly to ContradictionResolution type: superseded (old fact replaced), acknowledged (shift addressed in next piece), dismissed (false positive), pending (not yet resolved)",
            },
          },
          required: [
            "priorFactId",
            "priorFactContent",
            "newEvidence",
            "tensionType",
            "explanation",
            "suggestedResolution",
          ],
        },
      },
    },
    required: ["contradictions"],
  },
};

const ContradictionItemSchema = z.object({
  priorFactId: z.string().min(1),
  priorFactContent: z.string().min(1),
  newEvidence: z.string().min(1),
  tensionType: z.enum([
    "reversed",
    "reinforced_but_reframed",
    "partially_invalidated",
    "level_stale",
  ]),
  explanation: z.string().min(1),
  suggestedResolution: z.enum([
    "superseded",
    "acknowledged",
    "dismissed",
    "pending",
  ]),
});

const DetectionResultSchema = z.object({
  contradictions: z.array(ContradictionItemSchema),
});

export type DetectedContradiction = z.infer<typeof ContradictionItemSchema>;

/** Approximate cost per token for the detector model (Haiku 4.5, as of 2026-04). */
const INPUT_PER_MILLION = 1;
const OUTPUT_PER_MILLION = 5;

function computeDetectionCost(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens * INPUT_PER_MILLION) / 1_000_000 +
    (outputTokens * OUTPUT_PER_MILLION) / 1_000_000
  );
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export interface ContradictionDetectionOutput {
  contradictions: DetectedContradiction[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Detect contradictions between active editorial facts and new core analysis.
 *
 * Returns empty array (without calling Haiku) if no active position/level
 * facts exist — saves cost when there's nothing to contradict.
 *
 * On Haiku failure, returns empty array and logs a warning — never crashes
 * the pipeline.
 */
export async function detectContradictions(
  activeFacts: EditorialFact[],
  coreAnalysis: string,
): Promise<ContradictionDetectionOutput> {
  // Only check position and level facts — other types can't be contradicted
  const checkableFacts = activeFacts.filter(
    (f) => f.factType === "position" || f.factType === "level",
  );

  // No active position/level facts → nothing to contradict, skip Haiku call
  if (checkableFacts.length === 0) {
    return { contradictions: [], inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const factsBlock = checkableFacts
    .map(
      (f) =>
        `- [id=${f.id}] [${f.factType}] ${f.content} (confidence: ${f.confidence}, established: ${f.validFrom.toISOString().slice(0, 10)})`,
    )
    .join("\n");

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: DETECTOR_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [CONTRADICTION_DETECTOR_TOOL],
      tool_choice: { type: "tool", name: "detect_contradictions" },
      messages: [
        {
          role: "user",
          content: `Compare these prior editorial positions against the new core analysis and identify any tensions via the detect_contradictions tool. Each fact has an ID — return the exact fact ID in your response so we can trace contradictions back to specific facts.

## Prior positions
${factsBlock}

## New core analysis
${coreAnalysis}`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn(
        `[contradiction-detector] Haiku did not return a tool_use block, treating as no contradictions`,
      );
      return {
        contradictions: [],
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: computeDetectionCost(
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
      };
    }

    const result = DetectionResultSchema.parse(toolUse.input);

    return {
      contradictions: result.contradictions,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: computeDetectionCost(
        response.usage.input_tokens,
        response.usage.output_tokens,
      ),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[contradiction-detector] Haiku call failed, returning empty contradictions: ${msg.slice(0, 300)}`,
    );
    return { contradictions: [], inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
}

/**
 * Resolution heuristics: patterns that suggest a piece has acknowledged
 * a prior position shift.
 */
const ACKNOWLEDGMENT_PATTERNS = [
  /\bour prior view\b/i,
  /\bwe previously\b/i,
  /\bas we noted\b/i,
  /\bwe['']ve revised\b/i,
  /\bour earlier (call|view|position|thesis)\b/i,
  /\bcontrary to our (prior|previous|earlier)\b/i,
  /\bwe (had|have) (been|noted|called|flagged)\b/i,
];

/**
 * Check whether an article's text contains language that acknowledges
 * prior position shifts. Used after `recordArticle` to auto-resolve
 * pending contradictions.
 */
export function containsAcknowledgmentLanguage(articleBody: string): boolean {
  return ACKNOWLEDGMENT_PATTERNS.some((pattern) => pattern.test(articleBody));
}
