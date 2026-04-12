/**
 * Database connection helper.
 *
 * Reads DATABASE_URL from environment. Callers use getDb() to get a
 * Drizzle instance backed by the `postgres` driver.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as editorialMemorySchema from "./schema/editorial-memory.js";

let db: ReturnType<typeof drizzle<typeof editorialMemorySchema>> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (db) return db;

  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Required for Postgres editorial memory store.",
    );
  }

  client = postgres(url);
  db = drizzle(client, { schema: editorialMemorySchema });
  return db;
}

/** Shut down the connection pool. Call in tests or short-lived scripts. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export type Db = ReturnType<typeof getDb>;
