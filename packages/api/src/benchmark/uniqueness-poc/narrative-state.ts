/**
 * Narrative state — the temporal-continuity layer.
 *
 * This module owns:
 *   1. Extracting structured narrative state from a previously-published piece
 *      (Haiku call via tool_use)
 *   2. Building a TenantTopicNarrativeState from a list of extracted entries
 *   3. Rendering a narrative-state context block for injection into the
 *      identity agent's user message
 *
 * In production, narrative state would be persisted per (tenant, topic) and
 * grow over time as each tenant publishes more content. For the PoC we build
 * a fresh state from the prior piece in memory.
 */

import Anthropic from "@anthropic-ai/sdk";

import type {
  IdentityOutput,
  ContentPersona,
  NarrativeStateEntry,
  TenantTopicNarrativeState,
} from "./types.js";
import { computeCostUsd } from "./pricing.js";

const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";

const EXTRACTOR_SYSTEM_PROMPT = `You are extracting structured narrative state from a piece of financial market content. Your output will be used as "writer memory" — the same writer (or the same client's content engine) will reference this state when covering related events in the future, to maintain continuity of voice and view across pieces.

Be precise and faithful to what the piece actually says. Do not invent details that are not in the text. Capture:

- A one-sentence summary of what the piece argued
- The directional view it took (bullish, bearish, neutral, mixed)
- The confidence level conveyed by the prose (low, moderate, high)
- The key thesis statements (1-3 short factual claims the piece centered on)
- The specific price levels mentioned (e.g., "1.0820 support", "1.0920 resistance")
- The calls to action or recommendations the piece offered (could be empty)`;

const EXTRACTOR_TOOL = {
  name: "submit_narrative_state",
  description:
    "Submit structured narrative state extracted from a piece of content. Used as memory for future related coverage.",
  input_schema: {
    type: "object" as const,
    properties: {
      oneSentenceSummary: {
        type: "string",
        description:
          "One sentence (max 30 words) capturing the main argument of the piece.",
      },
      directionalView: {
        type: "string",
        enum: ["bullish", "bearish", "neutral", "mixed"],
        description: "The directional view the piece took on the market.",
      },
      directionalViewConfidence: {
        type: "string",
        enum: ["low", "moderate", "high"],
        description:
          "How confidently the piece conveyed its directional view (based on the language used).",
      },
      keyThesisStatements: {
        type: "array",
        items: { type: "string" },
        description:
          "1-3 short thesis statements the piece centered on. Each should be a single sentence.",
      },
      keyLevelsMentioned: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific price levels mentioned in the piece, with their role (e.g., '1.0820 support', '1.0920 resistance', '1.0720 next downside target'). Empty array if none.",
      },
      callsToActionUsed: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific recommendations or calls to action made in the piece. Empty array if the piece avoided trade recommendations.",
      },
    },
    required: [
      "oneSentenceSummary",
      "directionalView",
      "directionalViewConfidence",
      "keyThesisStatements",
      "keyLevelsMentioned",
      "callsToActionUsed",
    ],
  },
};

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

/**
 * Extract structured narrative state from a previously-published piece.
 * One Haiku call per piece. Cheap (~$0.005 per piece).
 */
export async function extractNarrativeState(
  piece: { pieceId: string; publishedAt: string; body: string },
): Promise<NarrativeStateEntry> {
  const client = getClient();

  const response = await client.messages.create({
    model: EXTRACTOR_MODEL,
    max_tokens: 1024,
    system: EXTRACTOR_SYSTEM_PROMPT,
    tools: [EXTRACTOR_TOOL],
    tool_choice: { type: "tool", name: "submit_narrative_state" },
    messages: [
      {
        role: "user",
        content: `Extract narrative state from this published piece via the submit_narrative_state tool.\n\n\`\`\`\n${piece.body}\n\`\`\``,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Narrative-state extractor did not return a tool_use block: ${JSON.stringify(response.content)}`,
    );
  }

  const input = toolUse.input as {
    oneSentenceSummary: string;
    directionalView: NarrativeStateEntry["directionalView"];
    directionalViewConfidence: NarrativeStateEntry["directionalViewConfidence"];
    keyThesisStatements: string[];
    keyLevelsMentioned: string[];
    callsToActionUsed: string[];
  };

  return {
    pieceId: piece.pieceId,
    publishedAt: piece.publishedAt,
    oneSentenceSummary: input.oneSentenceSummary,
    directionalView: input.directionalView,
    directionalViewConfidence: input.directionalViewConfidence,
    keyThesisStatements: input.keyThesisStatements,
    keyLevelsMentioned: input.keyLevelsMentioned,
    callsToActionUsed: input.callsToActionUsed,
    extractionInputTokens: response.usage.input_tokens,
    extractionOutputTokens: response.usage.output_tokens,
    extractionCostUsd: computeCostUsd(
      EXTRACTOR_MODEL,
      response.usage.input_tokens,
      response.usage.output_tokens,
    ),
  };
}

/**
 * Build a TenantTopicNarrativeState from a Stage 6 output for one persona.
 * For the PoC we always have exactly one prior piece per persona; production
 * would maintain a longer history with garbage collection.
 */
export async function buildNarrativeStateFromPriorOutput(
  persona: ContentPersona,
  topicId: string,
  priorOutput: IdentityOutput,
  priorPublishedAt: string,
): Promise<TenantTopicNarrativeState> {
  const entry = await extractNarrativeState({
    pieceId: `${persona.id}-prior`,
    publishedAt: priorPublishedAt,
    body: priorOutput.body,
  });

  return {
    tenantId: persona.id,
    topicId,
    recentEntries: [entry],
    currentHouseView: entry.directionalView,
    currentHouseViewConfidence: entry.directionalViewConfidence,
    lastUpdatedAt: priorPublishedAt,
  };
}

/**
 * Render a narrative-state context block for injection into the identity
 * agent's user message. Returns "" if state is empty.
 */
export function renderNarrativeStateDirective(
  state: TenantTopicNarrativeState | undefined,
  topicName: string,
): string {
  if (!state || state.recentEntries.length === 0) return "";

  const entries = state.recentEntries
    .map((entry, idx) => {
      const lines: string[] = [];
      lines.push(`### Prior piece ${idx + 1} — published ${entry.publishedAt}`);
      lines.push("");
      lines.push(`- **Summary**: ${entry.oneSentenceSummary}`);
      lines.push(`- **Directional view**: ${entry.directionalView} (${entry.directionalViewConfidence} confidence)`);
      if (entry.keyThesisStatements.length > 0) {
        lines.push(`- **Key thesis statements you made**:`);
        for (const t of entry.keyThesisStatements) {
          lines.push(`  - ${t}`);
        }
      }
      if (entry.keyLevelsMentioned.length > 0) {
        lines.push(`- **Specific levels you mentioned**: ${entry.keyLevelsMentioned.join("; ")}`);
      }
      if (entry.callsToActionUsed.length > 0) {
        lines.push(`- **Calls to action you made**: ${entry.callsToActionUsed.join("; ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `# YOUR PRIOR COVERAGE OF ${topicName.toUpperCase()} (CRITICAL CONTEXT — READ BEFORE WRITING)

You have written about ${topicName} before. The reader of this client's content expects continuity: the same writer covering the same market over time, building on prior takes, referencing prior calls, evolving the view as new information arrives. **You must write this piece as a continuation of your prior coverage, not as a fresh start.**

Your current house view going into this piece: **${state.currentHouseView}** (${state.currentHouseViewConfidence} confidence).

${entries}

## How to use this prior coverage in the new piece

- **Reference your prior coverage explicitly where it fits naturally**, using phrases like "as we noted on ${state.recentEntries[0]!.publishedAt.slice(0, 10)}", "consistent with our view from earlier this week", "our thesis from Tuesday's note", etc. The reader expects to feel the continuity.
- **Maintain consistency with your prior directional view (${state.currentHouseView}) UNLESS the new evidence demands a flip.** If the new event reinforces your prior view, lean in and say so explicitly. If the new event contradicts your prior view, explicitly acknowledge the shift — do not silently change positions.
- **Build on the framing you established** in the prior piece. If you anchored on a specific transmission chain, scenario, or metaphor, reuse that language and develop it further. Do not restart from scratch.
- **Reference the specific levels you mentioned before** (${state.recentEntries[0]!.keyLevelsMentioned.join(", ") || "if any"}). The reader is tracking those levels because you told them to.
- **The goal is for the reader to feel like the same human writer has been covering this story over time.** Generic AI tools produce isolated pieces with no memory. Your competitive edge as a writer is that you have a track record and you remember it.

`;
}
