/**
 * Model router — maps tier names to Anthropic model IDs.
 *
 * Adapted from GoBot's src/lib/model-router.ts.
 * Simplified: removed local LLM tiers (qwen/ollama), kept Haiku/Sonnet/Opus only.
 */

import type { ModelTier } from "./types.js";

const MODEL_IDS: Record<ModelTier, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

export function resolveModel(tier: ModelTier): string {
  return MODEL_IDS[tier];
}
