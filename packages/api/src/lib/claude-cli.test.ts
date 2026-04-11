/**
 * Unit tests for the pure helpers in claude-cli.ts.
 *
 * Only the helpers that don't touch the subprocess are covered here —
 * `buildChildEnv`, `buildCliArgs`, `truncateToWordCap`, `isEnvelopeSuccess`.
 * The full `callClaudeCli` path requires a live `claude` binary and a
 * valid Keychain token and is covered by the end-to-end PoC runs, not
 * by this file.
 *
 * Run with: `bun test src/lib/claude-cli.test.ts` from packages/api/.
 */

import { describe, expect, test } from "bun:test";

import {
  buildChildEnv,
  buildCliArgs,
  isEnvelopeSuccess,
  truncateToWordCap,
} from "./claude-cli.js";

describe("buildChildEnv", () => {
  test("strips ANTHROPIC_API_KEY", () => {
    const out = buildChildEnv({
      HOME: "/h",
      USER: "alex",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk-should-not-leak",
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("strips all auth-routing env vars (the full set gobot flagged)", () => {
    const parent = {
      HOME: "/h",
      USER: "alex",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "x",
      ANTHROPIC_AUTH_TOKEN: "x",
      ANTHROPIC_BASE_URL: "http://ollama:11434",
      ANTHROPIC_BEDROCK_BASE_URL: "x",
      ANTHROPIC_VERTEX_BASE_URL: "x",
      ANTHROPIC_VERTEX_PROJECT_ID: "x",
      CLAUDE_CODE_OAUTH_TOKEN: "x",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDECODE: "1",
    };
    const out = buildChildEnv(parent);
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_BEDROCK_BASE_URL",
      "ANTHROPIC_VERTEX_BASE_URL",
      "ANTHROPIC_VERTEX_PROJECT_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDECODE",
    ]) {
      expect(out[key]).toBeUndefined();
    }
  });

  test("preserves unrelated env vars", () => {
    const out = buildChildEnv({
      HOME: "/h",
      USER: "alex",
      PATH: "/bin",
      NODE_ENV: "test",
      OPENAI_API_KEY: "keep",
    });
    expect(out.NODE_ENV).toBe("test");
    expect(out.OPENAI_API_KEY).toBe("keep");
  });

  test("USER falls back to LOGNAME when USER is unset", () => {
    const out = buildChildEnv({
      HOME: "/h",
      LOGNAME: "alex",
      PATH: "/bin",
    });
    expect(out.USER).toBe("alex");
  });

  test("USER is omitted (not blanked) when neither USER nor LOGNAME is set — blank USER breaks Keychain OAuth", () => {
    const out = buildChildEnv({
      HOME: "/h",
      PATH: "/bin",
    });
    expect(out.USER).toBeUndefined();
  });

  test("undefined values in parentEnv are not copied", () => {
    const out = buildChildEnv({
      HOME: "/h",
      PATH: "/bin",
      UNSET: undefined,
    });
    expect("UNSET" in out).toBe(false);
  });
});

describe("buildCliArgs", () => {
  test("produces the expected flag set in order", () => {
    const args = buildCliArgs({
      model: "claude-opus-4-6",
      systemPrompt: "You are an FA agent.",
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-6",
      "--system-prompt",
      "You are an FA agent.",
      "--disable-slash-commands",
      "--tools",
      "",
      "--no-session-persistence",
    ]);
  });
});

describe("truncateToWordCap", () => {
  test("returns untouched when under the cap", () => {
    const r = truncateToWordCap("one two three", 10);
    expect(r.text).toBe("one two three");
    expect(r.truncated).toBe(false);
  });

  test("returns untouched when exactly at the cap", () => {
    const r = truncateToWordCap("one two three", 3);
    expect(r.text).toBe("one two three");
    expect(r.truncated).toBe(false);
  });

  test("truncates above the cap and flips the flag", () => {
    const r = truncateToWordCap("one two three four five", 3);
    expect(r.text).toBe("one two three");
    expect(r.truncated).toBe(true);
  });

  test("preserves internal whitespace (newlines) up to the cut", () => {
    const r = truncateToWordCap("para one.\n\npara two word word.", 4);
    expect(r.text).toBe("para one.\n\npara two");
    expect(r.truncated).toBe(true);
  });

  test("wordCap <= 0 is a no-op", () => {
    const r = truncateToWordCap("one two three", 0);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("one two three");
  });
});

describe("isEnvelopeSuccess", () => {
  test("subtype='success' is success", () => {
    expect(isEnvelopeSuccess({ type: "result", subtype: "success" })).toBe(
      true,
    );
  });

  test("missing subtype is treated as success (CLI sometimes omits it)", () => {
    expect(isEnvelopeSuccess({ type: "result" })).toBe(true);
  });

  test("is_error=true is failure regardless of subtype", () => {
    expect(
      isEnvelopeSuccess({ type: "result", subtype: "success", is_error: true }),
    ).toBe(false);
  });

  test("non-success subtype is failure", () => {
    expect(isEnvelopeSuccess({ type: "result", subtype: "error_max_turns" })).toBe(
      false,
    );
  });
});
