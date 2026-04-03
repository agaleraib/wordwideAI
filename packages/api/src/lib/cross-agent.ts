/**
 * Cross-agent invocation — [INVOKE:agent|question] tag parsing.
 *
 * Adapted from GoBot's src/lib/cross-agent.ts.
 * Narrowed permission map for translation engine agents only.
 */

export interface InvocationTag {
  targetAgent: string;
  question: string;
}

/**
 * Permission map: which agents can invoke which.
 * Keys are the invoking agent, values are allowed targets.
 */
const INVOCATION_MAP: Record<string, string[]> = {
  arbiter: ["terminology", "style", "structural", "linguistic"],
  quality: ["ta", "fa"],
};

/**
 * Check if an agent is allowed to invoke another.
 */
export function canInvoke(sourceAgent: string, targetAgent: string): boolean {
  const allowed = INVOCATION_MAP[sourceAgent];
  return allowed?.includes(targetAgent) ?? false;
}

/**
 * Parse [INVOKE:agent|question] tags from agent output.
 */
export function parseInvocationTags(text: string): InvocationTag[] {
  const pattern = /\[INVOKE:(\w+)\|([^\]]+)\]/g;
  const tags: InvocationTag[] = [];

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const targetAgent = match[1];
    const question = match[2];
    if (targetAgent && question) {
      tags.push({ targetAgent, question });
    }
  }

  return tags;
}

/**
 * Strip INVOKE tags from text, returning clean content.
 */
export function stripInvocationTags(text: string): string {
  return text.replace(/\[INVOKE:\w+\|[^\]]+\]/g, "").trim();
}
