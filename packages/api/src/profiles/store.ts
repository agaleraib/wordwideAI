/**
 * Profile store — DB-agnostic CRUD for client profiles.
 *
 * Re-exports the in-memory implementation for now.
 * Will be swapped for Convex or Supabase when the database decision is made.
 */

export {
  InMemoryProfileStore,
  InMemoryTranslationStore,
  InMemoryGlossaryCorrectionStore,
} from "../lib/store.js";
