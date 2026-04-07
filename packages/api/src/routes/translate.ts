/**
 * Translation API routes.
 */

import { Hono } from "hono";
import { z } from "zod";
import { streamSSE } from "hono/streaming";

import type { ProfileStore, TranslationStore, PipelineEvent } from "../lib/types.js";
import { runTranslationEngine } from "../pipeline/translation-engine.js";
import { scorecardToDict } from "../scoring/scorecard.js";

const TranslateRequestSchema = z.object({
  sourceText: z.string().min(1),
  clientId: z.string().min(1),
  language: z.string().min(2).max(5),
});

export function createTranslateRoutes(
  profileStore: ProfileStore,
  translationStore?: TranslationStore,
) {
  const app = new Hono();

  /**
   * POST /translate — Run translation engine pipeline.
   * Returns the full result with scorecard and audit trail.
   */
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = TranslateRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }

    const { sourceText, clientId, language } = parsed.data;

    try {
      const result = await runTranslationEngine(sourceText, clientId, language, {
        profileStore,
        translationStore,
      });

      return c.json({
        clientId: result.clientId,
        language: result.language,
        passed: result.passed,
        revisionCount: result.revisionCount,
        escalatedToHitl: result.escalatedToHitl,
        translatedText: result.translatedText,
        scorecard: scorecardToDict(result.scorecard),
        auditTrail: result.auditTrail,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  });

  /**
   * POST /translate/stream — SSE endpoint for real-time pipeline events.
   */
  app.post("/stream", async (c) => {
    const body = await c.req.json();
    const parsed = TranslateRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }

    const { sourceText, clientId, language } = parsed.data;

    return streamSSE(c, async (stream) => {
      const onEvent = (event: PipelineEvent) => {
        stream.writeSSE({
          event: event.stage,
          data: JSON.stringify(event),
        });
      };

      try {
        const result = await runTranslationEngine(
          sourceText,
          clientId,
          language,
          { profileStore, translationStore, onEvent },
        );

        await stream.writeSSE({
          event: "result",
          data: JSON.stringify({
            clientId: result.clientId,
            language: result.language,
            passed: result.passed,
            revisionCount: result.revisionCount,
            escalatedToHitl: result.escalatedToHitl,
            translatedText: result.translatedText,
            scorecard: scorecardToDict(result.scorecard),
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: message }),
        });
      }
    });
  });

  return app;
}
