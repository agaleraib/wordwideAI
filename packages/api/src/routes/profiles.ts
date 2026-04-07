/**
 * Profile CRUD API routes.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { ProfileStore } from "../lib/types.js";
import { ClientProfileSchema } from "../profiles/types.js";
import {
  extractProfile,
  type TextSample,
} from "../agents/profile-extraction-agent.js";

// --- Schemas ---

const ExtractRequestSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  targetLanguage: z.string().min(2).max(5),
  regionalVariant: z.string().optional(),
  samples: z
    .array(
      z.object({
        source: z.string().min(1),
        translation: z.string().optional(),
      }),
    )
    .min(1, "At least 1 text sample is required"),
  /** If true, save the extracted profile to the store automatically. */
  autoSave: z.boolean().default(false),
});

export function createProfileRoutes(store: ProfileStore) {
  const app = new Hono();

  /** GET /profiles — List all profiles. */
  app.get("/", async (c) => {
    const profiles = await store.list();
    return c.json(profiles);
  });

  /** GET /profiles/:id — Load a profile. */
  app.get("/:id", async (c) => {
    const profile = await store.load(c.req.param("id"));
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }
    return c.json(profile);
  });

  /** POST /profiles — Create or update a profile. */
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = ClientProfileSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }

    await store.save(parsed.data);
    return c.json({ ok: true, clientId: parsed.data.clientId }, 201);
  });

  /**
   * POST /profiles/extract — Extract profile parameters from text samples.
   *
   * Analyzes source texts (and optionally their human translations) to infer
   * glossary, tone, brand rules, regional variant, and compliance patterns.
   *
   * Recommended sample counts:
   *   - Minimum:  5 docs  (basic terminology + tone)
   *   - Solid:   10-15    (reliable statistics)
   *   - Ideal:   20+      (high-confidence full profile)
   */
  app.post("/extract", async (c) => {
    const body = await c.req.json();
    const parsed = ExtractRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }

    const { clientId, clientName, targetLanguage, regionalVariant, samples, autoSave } =
      parsed.data;

    try {
      const result = await extractProfile({
        clientId,
        clientName,
        targetLanguage,
        regionalVariant,
        samples: samples as TextSample[],
      });

      if (autoSave) {
        const profileData = ClientProfileSchema.parse({
          clientId,
          clientName,
          sourceLanguage: "en",
          languages: {
            [targetLanguage]: result.extractedProfile,
          },
        });
        await store.save(profileData);
      }

      return c.json({
        clientId: result.clientId,
        clientName: result.clientName,
        targetLanguage: result.targetLanguage,
        sampleCount: result.sampleCount,
        confidence: result.confidence,
        warnings: result.warnings,
        extractedProfile: result.extractedProfile,
        saved: autoSave,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  });

  /** DELETE /profiles/:id — Delete a profile. */
  app.delete("/:id", async (c) => {
    const deleted = await store.delete(c.req.param("id"));
    if (!deleted) {
      return c.json({ error: "Profile not found" }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
