/**
 * Similarity primitives for the uniqueness PoC.
 *
 * Stage 1 — embedding cosine similarity via OpenAI text-embedding-3-small
 *           (the canonical embedding model from content-uniqueness spec §6.1)
 * Stage 2 — ROUGE-L F1 (longest common subsequence over tokens)
 *
 * Stage 3 (LLM judge) lives in llm-judge.ts and only fires on borderline pairs.
 */

import { computeCostUsd } from "./pricing.js";

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export interface EmbeddingResult {
  vector: number[];
  inputTokens: number;
  costUsd: number;
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env at the repo root.",
    );
  }

  const response = await fetch(OPENAI_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `OpenAI embedding API returned ${response.status}: ${errBody}`,
    );
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number; total_tokens: number };
  };

  return {
    vector: json.data[0]!.embedding,
    inputTokens: json.usage.prompt_tokens,
    costUsd: computeCostUsd(OPENAI_EMBEDDING_MODEL, json.usage.prompt_tokens, 0),
  };
}

/** Cosine similarity in [0, 1] (since embeddings are normalized) clipped just in case. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, sim));
}

// ───────────────────────────────────────────────────────────────────
// ROUGE-L F1 — longest common subsequence over tokenized text
// ───────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Length of the longest common subsequence between two token arrays (DP). */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  // Use a single row + previous-cell trick to save memory.
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]! + 1;
      } else {
        curr[j] = Math.max(prev[j]!, curr[j - 1]!);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n]!;
}

/**
 * ROUGE-L F1 score in [0, 1].
 * F1 = 2 * P * R / (P + R) where P = LCS / |b|, R = LCS / |a|
 */
export function rougeLF1(textA: string, textB: string): number {
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (a.length === 0 || b.length === 0) return 0;

  const lcs = lcsLength(a, b);
  if (lcs === 0) return 0;

  const precision = lcs / b.length;
  const recall = lcs / a.length;
  if (precision + recall === 0) return 0;

  return (2 * precision * recall) / (precision + recall);
}

// ───────────────────────────────────────────────────────────────────
// Combined pairwise similarity helper
// ───────────────────────────────────────────────────────────────────

export interface PairwiseScore {
  cosineSimilarity: number;
  rougeL: number;
}

export function scorePair(
  embeddingA: number[],
  embeddingB: number[],
  textA: string,
  textB: string,
): PairwiseScore {
  return {
    cosineSimilarity: cosineSimilarity(embeddingA, embeddingB),
    rougeL: rougeLF1(textA, textB),
  };
}
