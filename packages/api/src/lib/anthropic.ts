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
