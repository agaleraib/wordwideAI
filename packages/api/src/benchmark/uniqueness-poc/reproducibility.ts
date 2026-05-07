/**
 * Wave M reproducibility receipt — shared between CLI (`index.ts`) and
 * dashboard (`routes/poc.ts`) entry points so both produce the same
 * `RunManifest.reproducibility` shape. Audit §5.1 / §4.1.4.
 *
 * Three pure helpers extracted from `index.ts`:
 *   - `canonicalSha256` — deterministic JSON value → SHA-256 hex (key-sorted)
 *   - `computePackageHash` — walks up from this file to find a lockfile
 *   - `buildReproducibility` — assembles the full receipt block
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import type { RunManifest } from "./types.js";
import { IDENTITY_REGISTRY } from "./prompts/identities/index.js";
import { FA_AGENT_SYSTEM_PROMPT } from "./prompts/fa-agent.js";
import {
  JUDGE_MODEL,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT_HASH,
} from "./llm-judge.js";
import { CONFORMANCE_SYSTEM_PROMPT } from "./conformance-pass.js";
import { modelForTier } from "./pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Produce a deterministic SHA-256 hex digest over an arbitrary JSON value by
 * canonicalising key order before stringifying. Used by the reproducibility
 * receipt to hash fixtures (and any other JSON inputs) in a way that is
 * insensitive to whitespace, key ordering, and trailing newlines — bytes-on-
 * disk hashes are too brittle for a multi-month methodology baseline.
 */
export function canonicalSha256(value: unknown): string {
  const sorter = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sorter);
    if (val !== null && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(val as Record<string, unknown>).sort()) {
        out[key] = sorter((val as Record<string, unknown>)[key]);
      }
      return out;
    }
    return val;
  };
  return createHash("sha256").update(JSON.stringify(sorter(value))).digest("hex");
}

/**
 * Hash the repository lockfile bytes. Returns the hex digest, or `null` when
 * no recognised lockfile is found (caller is expected to log a warning).
 *
 * Recognised, in order: `bun.lockb`, `bun.lock`, `pnpm-lock.yaml`,
 * `package-lock.json`. The walk starts at this file's directory and climbs
 * up to 8 levels.
 */
export function computePackageHash(): string | null {
  const candidates = ["bun.lockb", "bun.lock", "pnpm-lock.yaml", "package-lock.json"];
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    for (const name of candidates) {
      const path = resolve(dir, name);
      if (existsSync(path)) {
        return createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Build the Wave M reproducibility receipt — every input that determines a
 * run's output. See `RunManifestSchema.reproducibility` (types.ts) for the
 * full field-by-field rationale.
 *
 * Caller supplies the loaded fixture object (so the canonical-form fixture
 * hash is over the in-memory value, not the on-disk bytes — robust to
 * formatting drift). For dashboard runs the natural fixtureValue is the
 * composed event object.
 *
 * Note: `temperatureOverrides` is empty today (every PoC call site uses
 * default temperature 1.0). The field is reserved for future overrides; an
 * empty object means "no overrides" rather than "field absent."
 */
export function buildReproducibility(args: {
  fixtureValue: unknown;
}): NonNullable<RunManifest["reproducibility"]> {
  const identityPromptHashes: Record<string, string> = {};
  for (const reg of IDENTITY_REGISTRY) {
    identityPromptHashes[reg.definition.id] = createHash("sha256")
      .update(reg.definition.systemPrompt)
      .digest("hex");
  }

  const packageHash = computePackageHash();
  if (packageHash === null) {
    console.warn(
      "[reproducibility] No lockfile found while building reproducibility receipt — packageHash will be null.",
    );
  }

  return {
    models: {
      fa: modelForTier("opus"),
      identity: modelForTier("sonnet"),
      judge: JUDGE_MODEL,
      embedding: "text-embedding-3-small",
      conformance: modelForTier("sonnet"),
    },
    promptVersions: {
      judge: JUDGE_PROMPT_VERSION,
      judgeHash: JUDGE_SYSTEM_PROMPT_HASH,
      fa: createHash("sha256").update(FA_AGENT_SYSTEM_PROMPT).digest("hex"),
      identities: identityPromptHashes,
      conformance: createHash("sha256").update(CONFORMANCE_SYSTEM_PROMPT).digest("hex"),
    },
    fixtureHash: canonicalSha256(args.fixtureValue),
    packageHash,
    temperatureOverrides: {},
  };
}
