/**
 * Context assembler — builds the editorial memory block injected into
 * the identity agent's user message.
 *
 * Spec: docs/specs/2026-04-12-editorial-memory.md §9
 */

import type {
  EditorialContradiction,
  EditorialFact,
  EditorialMemoryContext,
  EditorialPieceLog,
} from "./types.js";

const DEFAULT_MAX_TOKENS = 600;

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export interface AssemblerInput {
  tenantId: string;
  tenantName?: string;
  topicId: string;
  topicName?: string;
  activeFacts: EditorialFact[];
  recentPieces: EditorialPieceLog[];
  contradictions: EditorialContradiction[];
  maxTokens?: number;
  usedVectorSearch: boolean;
  /** Whether contradiction detection has been run for this context.
   *  When false, reinforcement language is suppressed (can't confirm
   *  reinforcement without having checked for contradictions). */
  contradictionDetectionRan?: boolean;
}

/**
 * Assemble the editorial memory context block from facts, pieces, and
 * contradictions. Returns the rendered markdown and metadata.
 */
export function assembleEditorialContext(
  input: AssemblerInput,
): EditorialMemoryContext {
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (input.activeFacts.length === 0 && input.recentPieces.length === 0) {
    return {
      renderedBlock: "",
      tokenCount: 0,
      includedFacts: [],
      contradictions: [],
      usedVectorSearch: input.usedVectorSearch,
    };
  }

  const sections: string[] = [];
  const tenantLabel = input.tenantName ?? input.tenantId;
  const topicLabel = input.topicName ?? input.topicId;

  sections.push(
    `## Editorial Memory — ${tenantLabel} on ${topicLabel}`,
  );

  // Active position
  const positionFacts = input.activeFacts.filter(
    (f) => f.factType === "position" && f.validTo === null,
  );
  const latestPosition = positionFacts[positionFacts.length - 1];
  if (latestPosition) {
    sections.push(
      `### Your active position`,
      `You are ${latestPosition.content} (${latestPosition.confidence} confidence, established ${formatDate(latestPosition.validFrom)}).`,
    );
  }

  // Contradiction alerts or reinforcement signal
  const pending = input.contradictions.filter(
    (c) => c.resolution === "pending",
  );
  if (pending.length > 0) {
    sections.push(`### Contradiction alerts`);
    for (const c of pending) {
      sections.push(`- ${c.explanation}`);
    }
  } else if (
    latestPosition &&
    input.recentPieces.length > 0 &&
    input.contradictionDetectionRan === true
  ) {
    // Detection ran and found no contradictions — prior position is reinforced
    sections.push(
      `### What happened since your last piece`,
      `Your thesis has been validated by new market evidence. Lean in and say so explicitly.`,
    );
  }

  // Prior coverage (most recent first, max 3)
  if (input.recentPieces.length > 0) {
    sections.push(`### Prior coverage (most recent first)`);
    const pieces = input.recentPieces
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, 3);

    for (const piece of pieces) {
      const pieceFacts = input.activeFacts.filter(
        (f) => f.pieceId === piece.pieceId,
      );
      const analogies = pieceFacts.filter((f) => f.factType === "analogy");
      const levels = pieceFacts.filter((f) => f.factType === "level");
      const structures = pieceFacts.filter((f) => f.factType === "structure");

      let line = `- ${formatDate(piece.publishedAt)}: "${piece.oneSentenceSummary}"`;
      if (levels.length > 0) {
        line += ` Key levels: ${levels.map((l) => l.content).join(", ")}.`;
      }
      const firstStructure = structures[0];
      if (firstStructure) {
        line += ` Structure: ${firstStructure.content}.`;
      }
      const firstAnalogy = analogies[0];
      if (firstAnalogy) {
        line += ` Used analogy: "${firstAnalogy.content}" — DO NOT reuse.`;
      }
      sections.push(line);
    }
  }

  // Guidelines
  const guidelines: string[] = [];

  if (pending.length > 0) {
    guidelines.push(
      "Acknowledge the shift — do not silently change positions",
    );
  } else if (
    latestPosition &&
    input.recentPieces.length > 0 &&
    input.contradictionDetectionRan === true
  ) {
    guidelines.push(
      "Lean in and say so explicitly — your prior view has been validated",
    );
  }

  const allAnalogies = input.activeFacts.filter(
    (f) => f.factType === "analogy",
  );
  if (allAnalogies.length > 0) {
    guidelines.push(
      `Do NOT repeat these analogies: ${allAnalogies.map((a) => `"${a.content}"`).join(", ")}. Find a fresh metaphor.`,
    );
  }

  const recentStructures = input.activeFacts.filter(
    (f) => f.factType === "structure",
  );
  if (recentStructures.length > 0) {
    guidelines.push("Vary your structural approach from prior pieces.");
  }

  if (input.recentPieces.length > 0) {
    guidelines.push(
      'Reference prior coverage where relevant ("As we noted on...", "Our view has shifted since...").',
    );
  }

  if (guidelines.length > 0) {
    sections.push(`### Guidelines`);
    for (const g of guidelines) {
      sections.push(`- ${g}`);
    }
  }

  const renderedBlock = sections.join("\n");
  const tokenCount = estimateTokens(renderedBlock);

  // Truncate if over budget (drop oldest prior coverage entries one at a time).
  // Must slice off a strictly smaller array each call — `slice(-2)` was a bug
  // that stabilised at length 2 and recursed forever.
  if (tokenCount > maxTokens && input.recentPieces.length > 1) {
    return assembleEditorialContext({
      ...input,
      recentPieces: input.recentPieces.slice(1),
    });
  }

  return {
    renderedBlock,
    tokenCount,
    includedFacts: input.activeFacts,
    contradictions: pending,
    usedVectorSearch: input.usedVectorSearch,
  };
}
