/**
 * Document reader — extracts plain text from .docx and .doc files.
 * Discovery utility for IronFX test data folder structure.
 */

import mammoth from "mammoth";
import { readdir } from "fs/promises";
import { join, extname, basename } from "path";

import type { DocumentPair } from "./types.js";

// --- Language suffix mapping ---

const LANGUAGE_SUFFIXES: Record<string, string[]> = {
  es: ["_ES"],
  de: ["_DE"],
  ar: ["_AR"],
  pt: ["_PT"],
  pl: ["_PL"],
  vi: ["_VI"],
  hu: ["_HU", "_hun"],
  ko: ["_KO", "_ko"],
  zh: ["_CN"],
  it: ["_IT"],
  fr: ["_FR"],
  ru: ["_RU"],
};

// --- Document Reading ---

/**
 * Read a .docx or .doc file and return plain text.
 * Uses mammoth for .docx, macOS textutil for .doc.
 */
export async function readDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  if (ext === ".doc") {
    return readDocWithTextutil(filePath);
  }

  throw new Error(`Unsupported file type: ${ext} (${filePath})`);
}

/**
 * Read .doc (binary Word) using macOS textutil.
 */
async function readDocWithTextutil(filePath: string): Promise<string> {
  const proc = Bun.spawn(["textutil", "-convert", "txt", "-stdout", filePath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`textutil failed for ${filePath}: ${stderr}`);
  }

  return text.trim();
}

// --- Document Discovery ---

/**
 * Scan a data directory and find source + human translation pairs.
 *
 * Expected structure:
 *   dataDir/
 *     AM050115/
 *       Original/AM050115.docx   ← source
 *       AM050115_ES.doc          ← human translation
 *     Midday050415/
 *       Original/Midday050415.docx
 *       Midday050415_ES.doc
 */
export async function discoverDocumentPairs(
  dataDir: string,
  language: string,
): Promise<DocumentPair[]> {
  const suffixes = LANGUAGE_SUFFIXES[language];
  if (!suffixes) {
    throw new Error(
      `Unknown language '${language}'. Known: ${Object.keys(LANGUAGE_SUFFIXES).join(", ")}`,
    );
  }

  const entries = await readdir(dataDir, { withFileTypes: true });
  const reportDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const pairs: DocumentPair[] = [];

  for (const reportId of reportDirs) {
    const reportPath = join(dataDir, reportId);

    // Find source file in Original/
    const sourceFile = await findSourceFile(reportPath, reportId);
    if (!sourceFile) continue;

    // Find human translation
    const humanFile = await findHumanTranslation(
      reportPath,
      reportId,
      suffixes,
    );
    if (!humanFile) continue;

    pairs.push({
      reportId,
      sourceFile,
      humanFile,
      language,
    });
  }

  pairs.sort((a, b) => a.reportId.localeCompare(b.reportId));
  return pairs;
}

async function findSourceFile(
  reportPath: string,
  reportId: string,
): Promise<string | null> {
  const originalDir = join(reportPath, "Original");
  let files: string[];
  try {
    files = await readdir(originalDir).then((f) => f.map((n) => n));
  } catch {
    return null;
  }

  const docFile = files.find((f) => {
    const name = basename(f, extname(f));
    const ext = extname(f).toLowerCase();
    return (
      name.toLowerCase() === reportId.toLowerCase() &&
      (ext === ".docx" || ext === ".doc")
    );
  });

  return docFile ? join(originalDir, docFile) : null;
}

async function findHumanTranslation(
  reportPath: string,
  reportId: string,
  suffixes: string[],
): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(reportPath).then((f) => f.map((n) => n));
  } catch {
    return null;
  }

  for (const suffix of suffixes) {
    const match = files.find((f) => {
      const name = basename(f, extname(f));
      const ext = extname(f).toLowerCase();
      if (ext !== ".docx" && ext !== ".doc") return false;
      // Case-insensitive match: reportId + suffix
      return name.toLowerCase() === `${reportId}${suffix}`.toLowerCase();
    });

    if (match) return join(reportPath, match);
  }

  return null;
}
