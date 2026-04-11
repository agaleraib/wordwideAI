/**
 * Identity registry — the family of transformer agents.
 *
 * This is the v1 stable of writers. Each identity has a fixed native format,
 * a fixed editorial voice, and a fixed audience. Adding a new identity is
 * a self-contained task: write the system prompt, the user-message builder,
 * and register it here.
 */

import type { IdentityDefinition, ContentPersona } from "../../types.js";

import { BEGINNER_BLOGGER, buildBeginnerBloggerUserMessage } from "./beginner-blogger.js";
import { IN_HOUSE_JOURNALIST, buildInHouseJournalistUserMessage } from "./in-house-journalist.js";
import { TRADING_DESK, buildTradingDeskUserMessage } from "./trading-desk.js";
import { NEWSLETTER_EDITOR, buildNewsletterEditorUserMessage } from "./newsletter-editor.js";
import { EDUCATOR, buildEducatorUserMessage } from "./educator.js";
import { SENIOR_STRATEGIST, buildSeniorStrategistUserMessage } from "./senior-strategist.js";

export type UserMessageBuilder = (coreAnalysis: string, persona?: ContentPersona) => string;

export interface RegisteredIdentity {
  definition: IdentityDefinition;
  buildUserMessage: UserMessageBuilder;
}

export const IDENTITY_REGISTRY: ReadonlyArray<RegisteredIdentity> = [
  { definition: BEGINNER_BLOGGER, buildUserMessage: buildBeginnerBloggerUserMessage },
  { definition: IN_HOUSE_JOURNALIST, buildUserMessage: buildInHouseJournalistUserMessage },
  { definition: TRADING_DESK, buildUserMessage: buildTradingDeskUserMessage },
  { definition: NEWSLETTER_EDITOR, buildUserMessage: buildNewsletterEditorUserMessage },
  { definition: EDUCATOR, buildUserMessage: buildEducatorUserMessage },
  { definition: SENIOR_STRATEGIST, buildUserMessage: buildSeniorStrategistUserMessage },
];

export function getIdentityById(id: string): RegisteredIdentity | undefined {
  return IDENTITY_REGISTRY.find((i) => i.definition.id === id);
}
