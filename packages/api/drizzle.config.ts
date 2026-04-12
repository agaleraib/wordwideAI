import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/editorial-memory.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/finflow",
  },
});
