/**
 * Feature flags for pipeline optimization experiments.
 *
 * Read at invocation time (not cached), so changes take effect
 * between runs without restarting the server.
 */

/** Enable the Sonnet agentic pipeline loop (replaces specialist dispatch). */
export function isPipelineLoopEnabled(): boolean {
  return process.env.FINFLOW_PIPELINE_LOOP === "1";
}
