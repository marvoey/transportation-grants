import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../../clients/anthropic-client.js';
import { getConfig, logger } from '../../config/config.js';
import { TOOL_SCHEMAS } from '../../mcp/tool-schemas.js';
import { executeTool } from '../../mcp/tool-executor.js';
import { formatErrorResponse } from '../../utils/error-handler.js';
import { Intent, INTENT_TOOLS } from './types.js';

const SYSTEM_PROMPT =
  'You are the research step of a DOT grants assistant. Use the provided ' +
  'tools to gather the specific facts (grant names, amounts, dates, ' +
  "eligibility rules, IDs) needed to answer the user's question. Do not " +
  'write a final conversational answer — respond with a concise, factual ' +
  'summary of what you found, including exact figures and identifiers. ' +
  "Only state facts that come from tool results — don't guess.";

// Bounds cost/latency per request regardless of how many tool calls Claude chains.
const MAX_TOOL_ITERATIONS = 5;

export interface RetrievalResult {
  facts: string;
  toolCalls: Array<{ name: string; input: unknown }>;
}

/**
 * Runs a bounded agentic tool-use loop scoped to only the tools relevant to
 * `intent` (src/web/chat/types.ts), and returns gathered facts rather than a
 * user-facing reply — drafting-agent.ts composes the final reply from these.
 */
export async function runRetrieval(intent: Intent, messages: any[]): Promise<RetrievalResult> {
  const allowedTools = INTENT_TOOLS[intent];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  if (allowedTools.length === 0) {
    return { facts: '', toolCalls };
  }

  const config = getConfig();
  const anthropic = getAnthropicClient();
  const tools: Anthropic.Tool[] = TOOL_SCHEMAS.filter((tool) => allowedTools.includes(tool.name)).map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
    })
  );

  const conversation: any[] = [...messages];
  let facts = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: SYSTEM_PROMPT,
      tools,
      messages: conversation,
    });

    if (response.stop_reason !== 'tool_use') {
      facts = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
      break;
    }

    conversation.push({ role: 'assistant', content: response.content });

    const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const block of response.content as any[]) {
      if (block.type !== 'tool_use') continue;

      logger.info(`Retrieval tool call: ${block.name}`, block.input);
      toolCalls.push({ name: block.name, input: block.input });

      let resultContent: string;
      try {
        const result = await executeTool(block.name, block.input);
        resultContent = JSON.stringify(result);
      } catch (error) {
        resultContent = JSON.stringify(formatErrorResponse(error));
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    conversation.push({ role: 'user', content: toolResults });
  }

  return { facts, toolCalls };
}
