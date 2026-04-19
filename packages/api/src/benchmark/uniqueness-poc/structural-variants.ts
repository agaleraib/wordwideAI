/**
 * Per-tenant structural variant assignment for identity agents.
 * Implements docs/specs/2026-04-16-structural-variants.md §6.2.
 */
import type { StructuralVariantId } from "./types.js";

export const IDENTITY_VARIANT_COUNTS: Record<string, 2 | 3> = {
  "trading-desk": 3,
  "in-house-journalist": 3,
  "senior-strategist": 3,
  "newsletter-editor": 2,
  "educator": 3,
  "beginner-blogger": 2,
};

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function assignStructuralVariant(
  tenantId: string,
  identityId: string,
): StructuralVariantId {
  if (!Object.hasOwn(IDENTITY_VARIANT_COUNTS, identityId)) {
    throw new Error(`Unknown identityId: ${identityId}`);
  }
  const variantCount = IDENTITY_VARIANT_COUNTS[identityId]!;
  const hash = fnv1a32(`${tenantId}::${identityId}`);
  return ((hash % variantCount) + 1) as StructuralVariantId;
}
