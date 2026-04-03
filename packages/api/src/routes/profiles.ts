/**
 * Profile CRUD API routes.
 */

import { Hono } from "hono";

import type { ProfileStore } from "../lib/types.js";
import { ClientProfileSchema } from "../profiles/types.js";

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
