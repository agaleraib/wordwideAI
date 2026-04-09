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
import { createPocRoutes } from "./routes/poc.js";

const app = new Hono();

// Middleware
app.use("/*", cors());

// Stores (in-memory for now — swap for Convex/Supabase later)
const profileStore = new InMemoryProfileStore();
const translationStore = new InMemoryTranslationStore();

// Routes
app.route("/translate", createTranslateRoutes(profileStore, translationStore));
app.route("/profiles", createProfileRoutes(profileStore));
app.route("/poc", createPocRoutes());

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "finflow-api" }));

// Start
const port = parseInt(process.env["PORT"] ?? "3000", 10);
// On the LXC live env, HOST is set to 127.0.0.1 so the api only accepts
// connections from Caddy on loopback — Caddy is the only public door and
// this is defense-in-depth against an accidental ufw disable. Mac dev
// leaves HOST unset and Bun defaults to listening on all interfaces.
const hostname = process.env["HOST"];

export default {
  port,
  ...(hostname ? { hostname } : {}),
  // Bun's default idleTimeout is 10 seconds, which kills SSE streams as soon
  // as an upstream LLM call takes more than 10s (Stage 1 Opus is ~60s). Bump
  // to the max (255s) as a backstop — the /poc/runs/:id/stream handler also
  // emits a heartbeat every 15s to keep the connection warm.
  idleTimeout: 255,
  fetch: app.fetch,
};

console.log(`FinFlow API running on http://${hostname ?? "localhost"}:${port}`);
