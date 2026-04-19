/**
 * Identity registry — the family of transformer agents.
 *
 * This is the v1 stable of writers. Each identity has a fixed native format,
 * a fixed editorial voice, and a fixed audience. Adding a new identity is
 * a self-contained task: write the system prompt, the user-message builder,
 * and register it here.
 *
 * As of Wave 1 (2026-04-19), each identity also exports a `*_VARIANTS` map
 * of structural variants. The registry surfaces the variant map and its
 * count on each `RegisteredIdentity` so downstream code (runner, reports,
 * judges) can look up variant information without importing each identity
 * file directly. See docs/specs/2026-04-16-structural-variants.md.
 */

import type {
  IdentityDefinition,
  ContentPersona,
  StructuralVariantId,
} from "../../types.js";
import { IDENTITY_VARIANT_COUNTS } from "../../structural-variants.js";

import {
  BEGINNER_BLOGGER,
  BEGINNER_BLOGGER_VARIANTS,
  buildBeginnerBloggerUserMessage,
} from "./beginner-blogger.js";
import {
  IN_HOUSE_JOURNALIST,
  IN_HOUSE_JOURNALIST_VARIANTS,
  buildInHouseJournalistUserMessage,
} from "./in-house-journalist.js";
import {
  TRADING_DESK,
  TRADING_DESK_VARIANTS,
  buildTradingDeskUserMessage,
  type StructuralVariantEntry,
} from "./trading-desk.js";
import {
  NEWSLETTER_EDITOR,
  NEWSLETTER_EDITOR_VARIANTS,
  buildNewsletterEditorUserMessage,
} from "./newsletter-editor.js";
import {
  EDUCATOR,
  EDUCATOR_VARIANTS,
  buildEducatorUserMessage,
} from "./educator.js";
import {
  SENIOR_STRATEGIST,
  SENIOR_STRATEGIST_VARIANTS,
  buildSeniorStrategistUserMessage,
} from "./senior-strategist.js";

// Re-export so downstream callers have a single import path for variant info.
export { IDENTITY_VARIANT_COUNTS } from "../../structural-variants.js";
export type { StructuralVariantEntry } from "./trading-desk.js";

export type UserMessageBuilder = (coreAnalysis: string, persona?: ContentPersona) => string;

/**
 * A map from `StructuralVariantId` to the variant entry for a given identity.
 * 3-variant identities populate keys 1, 2, 3; 2-variant identities populate
 * only 1 and 2 (hence `Partial<...>`). Callers must consult `variantCount`
 * before indexing into keys > 2.
 */
export type IdentityVariantMap = Partial<Record<StructuralVariantId, StructuralVariantEntry>>;

export interface RegisteredIdentity {
  definition: IdentityDefinition;
  buildUserMessage: UserMessageBuilder;
  /**
   * Number of structural variants this identity supports (2 or 3). Sourced
   * from `IDENTITY_VARIANT_COUNTS` at module load so the single source of
   * truth lives in `structural-variants.ts`.
   */
  variantCount: 2 | 3;
  /**
   * Per-variant structural directive + optional word-count override.
   * Wave 1 ships 16 entries total across the 6 identities.
   */
  variants: IdentityVariantMap;
}

export const IDENTITY_REGISTRY: ReadonlyArray<RegisteredIdentity> = [
  {
    definition: BEGINNER_BLOGGER,
    buildUserMessage: buildBeginnerBloggerUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[BEGINNER_BLOGGER.id]!,
    variants: BEGINNER_BLOGGER_VARIANTS,
  },
  {
    definition: IN_HOUSE_JOURNALIST,
    buildUserMessage: buildInHouseJournalistUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[IN_HOUSE_JOURNALIST.id]!,
    variants: IN_HOUSE_JOURNALIST_VARIANTS,
  },
  {
    definition: TRADING_DESK,
    buildUserMessage: buildTradingDeskUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[TRADING_DESK.id]!,
    variants: TRADING_DESK_VARIANTS,
  },
  {
    definition: NEWSLETTER_EDITOR,
    buildUserMessage: buildNewsletterEditorUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[NEWSLETTER_EDITOR.id]!,
    variants: NEWSLETTER_EDITOR_VARIANTS,
  },
  {
    definition: EDUCATOR,
    buildUserMessage: buildEducatorUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[EDUCATOR.id]!,
    variants: EDUCATOR_VARIANTS,
  },
  {
    definition: SENIOR_STRATEGIST,
    buildUserMessage: buildSeniorStrategistUserMessage,
    variantCount: IDENTITY_VARIANT_COUNTS[SENIOR_STRATEGIST.id]!,
    variants: SENIOR_STRATEGIST_VARIANTS,
  },
];

export function getIdentityById(id: string): RegisteredIdentity | undefined {
  return IDENTITY_REGISTRY.find((i) => i.definition.id === id);
}
