/**
 * Anthropic SDK wrapper — streaming + tool_use structured output.
 *
 * Replaces the fragile find("{") JSON extraction in the Python prototype
 * with guaranteed structured output via tool_use.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Tool, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";

import type { AgentConfig, AgentResponse, ModelTier } from "./types.js";
import { resolveModel } from "./model-router.js";

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

/**
 * Run an agent with streaming text output.
 */
export async function runAgent(
  config: AgentConfig,
  userMessage: string,
  onChunk?: (text: string) => void,
): Promise<AgentResponse> {
  const client = getClient();
  let fullText = "";

  const stream = client.messages.stream({
    model: resolveModel(config.model),
    max_tokens: config.maxTokens,
    system: config.systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullText += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }

  const finalMessage = await stream.finalMessage();

  return {
    agentName: config.name,
    content: fullText,
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };
}

/**
 * Run an agent expecting structured output via tool_use.
 *
 * This replaces the Python prototype's fragile JSON-in-text parsing.
 * The agent is forced to call a tool with the expected schema,
 * guaranteeing valid structured output.
 */
export async function runAgentStructured<T>(
  config: AgentConfig,
  userMessage: string,
  toolName: string,
  toolDescription: string,
  inputSchema: Record<string, unknown>,
  parseResult: (input: Record<string, unknown>) => T,
): Promise<{ result: T; usage: { inputTokens: number; outputTokens: number } }> {
  const client = getClient();

  const tool: Tool = {
    name: toolName,
    description: toolDescription,
    input_schema: inputSchema as Tool["input_schema"],
  };

  const response = await client.messages.create({
    model: resolveModel(config.model),
    max_tokens: config.maxTokens,
    temperature: 0,
    system: config.systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [tool],
    tool_choice: { type: "tool", name: toolName },
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error(`Agent ${config.name} did not return tool_use output`);
  }

  return {
    result: parseResult(toolBlock.input as Record<string, unknown>),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export interface CallAgentResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Simple non-streaming call for agents that return plain text.
 */
export async function callAgent(
  model: ModelTier,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
  temperature: number = 0,
): Promise<string> {
  const result = await callAgentWithUsage(model, systemPrompt, userMessage, maxTokens, temperature);
  return result.text;
}

/**
 * Simple non-streaming call that also returns token usage.
 */
export async function callAgentWithUsage(
  model: ModelTier,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
  temperature: number = 0,
): Promise<CallAgentResult> {
  const client = getClient();

  const response = await client.messages.create({
    model: resolveModel(model),
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return {
    text: textBlock?.type === "text" ? textBlock.text : "",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Multi-turn tool-use conversation loop (with prompt caching)
// ---------------------------------------------------------------------------

/** A tool that can be called by the model in a multi-turn loop. */
export interface LoopTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface ToolCallLogEntry {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
}

export interface AgentLoopResult<T> {
  result: T;
  toolCallLog: ToolCallLogEntry[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  turnCount: number;
}

/**
 * Run a multi-turn conversation where the model can call tools repeatedly
 * until it invokes a terminal tool or hits the maxToolRounds cap.
 *
 * Uses prompt caching: system prompt and user message are marked with
 * cache_control breakpoints. On turn N, the stable prefix is a cache hit
 * at 10% input cost. The Anthropic API allows max 4 cache_control blocks,
 * so we place them on: (1) system prompt, (2) initial user message.
 * Tool results are NOT cached to stay within the 4-block limit.
 */
export async function runAgentLoop<T>(
  config: AgentConfig,
  userMessage: string,
  tools: LoopTool[],
  terminalToolName: string,
  parseTerminalResult: (input: Record<string, unknown>) => T,
  options?: { maxToolRounds?: number },
): Promise<AgentLoopResult<T>> {
  const client = getClient();
  const maxRounds = options?.maxToolRounds ?? 6;

  const sdkTools: Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Tool["input_schema"],
  }));

  const toolExecutors = new Map(tools.map((t) => [t.name, t.execute]));

  const CACHE_MARKER = { type: "ephemeral" as const };

  // Initial user message with cache breakpoint
  const messages: MessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: userMessage, cache_control: CACHE_MARKER },
      ],
    },
  ];

  const toolCallLog: ToolCallLogEntry[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let turnCount = 0;

  for (let round = 0; round < maxRounds; round++) {
    const isLastRound = round === maxRounds - 1;

    const systemText = isLastRound
      ? config.systemPrompt + "\n\nYou have reached the final turn. You MUST call " + terminalToolName + " now with your best result."
      : config.systemPrompt;

    const response = await client.messages.create({
      model: resolveModel(config.model),
      max_tokens: config.maxTokens,
      temperature: 0,
      system: [
        { type: "text", text: systemText, cache_control: isLastRound ? undefined : CACHE_MARKER },
      ],
      messages,
      tools: sdkTools,
      ...(isLastRound ? { tool_choice: { type: "tool" as const, name: terminalToolName } } : {}),
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    const usageAny = response.usage as unknown as Record<string, number>;
    totalCacheRead += usageAny.cache_read_input_tokens ?? 0;
    totalCacheCreation += usageAny.cache_creation_input_tokens ?? 0;
    turnCount++;

    // Append assistant response to conversation
    messages.push({ role: "assistant", content: response.content });

    // Find tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    // No tool calls — model ended without submitting
    if (toolUseBlocks.length === 0) {
      if (response.stop_reason === "end_turn") {
        throw new Error(
          `Agent ${config.name} ended without calling ${terminalToolName}. ` +
            `Turn ${turnCount}, stop_reason: ${response.stop_reason}`,
        );
      }
      break;
    }

    // Process each tool call
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    let terminalResult: T | null = null;

    for (const block of toolUseBlocks) {
      const input = block.input as Record<string, unknown>;

      // Terminal tool — parse and exit
      if (block.name === terminalToolName) {
        terminalResult = parseTerminalResult(input);
        toolCallLog.push({
          tool: block.name,
          input,
          output: input,
          durationMs: 0,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ status: "accepted" }),
        });
        break;
      }

      // Non-terminal tool — execute
      const executor = toolExecutors.get(block.name);
      if (!executor) {
        const errMsg = `Unknown tool: ${block.name}`;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: errMsg }),
          is_error: true,
        });
        continue;
      }

      const start = Date.now();
      let output: Record<string, unknown>;
      try {
        output = await executor(input);
      } catch (err) {
        output = { error: String(err) };
      }
      const durationMs = Date.now() - start;

      toolCallLog.push({ tool: block.name, input, output, durationMs });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }

    // If terminal tool was called, return
    if (terminalResult !== null) {
      return {
        result: terminalResult,
        toolCallLog,
        usage: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadInputTokens: totalCacheRead,
          cacheCreationInputTokens: totalCacheCreation,
        },
        turnCount,
      };
    }

    // Feed tool results back for next turn
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(
    `Agent ${config.name} hit maxToolRounds (${maxRounds}) without calling ${terminalToolName}`,
  );
}
