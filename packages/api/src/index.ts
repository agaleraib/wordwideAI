/**
 * FinFlow API — Hono + Bun entry point.
 *
 * Translation engine with multi-agent quality scoring pipeline.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import { InMemoryProfileStore, InMemoryTranslationStore } from "./lib/store.js";
import { createTranslateRoutes } from "./routes/translate.js";
import { createProfileRoutes } from "./routes/profiles.js";

const app = new Hono();

// Middleware
app.use("/*", cors());

// Stores (in-memory for now — swap for Convex/Supabase later)
const profileStore = new InMemoryProfileStore();
const translationStore = new InMemoryTranslationStore();

// Routes
app.route("/translate", createTranslateRoutes(profileStore, translationStore));
app.route("/profiles", createProfileRoutes(profileStore));

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "finflow-api" }));

// Start
const port = parseInt(process.env["PORT"] ?? "3000", 10);

export default {
  port,
  fetch: app.fetch,
};

console.log(`FinFlow API running on http://localhost:${port}`);
