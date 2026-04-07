/**
 * In-memory store implementation — used for development and testing.
 *
 * Implements the DB-agnostic repository interfaces from types.ts.
 * Will be replaced with Convex or Supabase implementation when the
 * database decision is made.
 */

import type {
  ProfileStore,
  TranslationStore,
  GlossaryCorrectionStore,
  ClientProfileData,
  ProfileSummary,
  TranslationRecord,
  GlossaryCorrection,
} from "./types.js";

export class InMemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, ClientProfileData>();

  async load(clientId: string): Promise<ClientProfileData | null> {
    return this.profiles.get(clientId) ?? null;
  }

  async save(profile: ClientProfileData): Promise<void> {
    profile.updatedAt = new Date().toISOString();
    this.profiles.set(profile.clientId, structuredClone(profile));
  }

  async list(): Promise<ProfileSummary[]> {
    return Array.from(this.profiles.values()).map((p) => ({
      clientId: p.clientId,
      clientName: p.clientName,
      languages: Object.keys(p.languages),
    }));
  }

  async delete(clientId: string): Promise<boolean> {
    return this.profiles.delete(clientId);
  }

  /** Seed profiles for testing. */
  seed(profiles: ClientProfileData[]): void {
    for (const p of profiles) {
      this.profiles.set(p.clientId, structuredClone(p));
    }
  }
}

export class InMemoryTranslationStore implements TranslationStore {
  private translations: TranslationRecord[] = [];

  async saveTranslation(result: TranslationRecord): Promise<string> {
    const id = crypto.randomUUID();
    this.translations.push({ ...result });
    return id;
  }

  getAll(): TranslationRecord[] {
    return [...this.translations];
  }
}

export class InMemoryGlossaryCorrectionStore
  implements GlossaryCorrectionStore
{
  private corrections: GlossaryCorrection[] = [];

  async saveCorrection(correction: GlossaryCorrection): Promise<void> {
    this.corrections.push({ ...correction });
  }

  getAll(): GlossaryCorrection[] {
    return [...this.corrections];
  }
}
