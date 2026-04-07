/**
 * Pipeline event types and helpers.
 */

import type { PipelineEvent, EventHandler } from "../lib/types.js";

export function emitEvent(
  handler: EventHandler | undefined,
  stage: string,
  status: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  handler?.({
    stage,
    status,
    message,
    timestamp: new Date().toISOString(),
    data,
  });
}
