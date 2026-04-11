/**
 * Per-token pricing for cost computation in the harness.
 *
 * These rates are approximate as of April 2026 and are used only to give
 * the report a rough cost figure. They are NOT used for billing.
 */

interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (April 2026 approximate)
  "claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 1, outputPerMillion: 5 },
  // OpenAI embeddings
  "text-embedding-3-small": { inputPerMillion: 0.02, outputPerMillion: 0 },
};

export function modelForTier(tier: "opus" | "sonnet" | "haiku"): string {
  switch (tier) {
    case "opus":
      return "claude-opus-4-6";
    case "sonnet":
      return "claude-sonnet-4-6";
    case "haiku":
      return "claude-haiku-4-5-20251001";
  }
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) {
    return 0;
  }
  const input = (inputTokens * pricing.inputPerMillion) / 1_000_000;
  const output = (outputTokens * pricing.outputPerMillion) / 1_000_000;
  return input + output;
}

export function formatUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
