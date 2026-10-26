import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../../clients/anthropic-client.js';
import { getConfig, logger } from '../../config/config.js';
import { TOOL_SCHEMAS } from '../../mcp/tool-schemas.js';
import { executeTool } from '../../mcp/tool-executor.js';
import { ChatRequestSchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';
import { formatErrorResponse } from '../../utils/error-handler.js';
import { GrantServerError } from '../../types/index.js';

const router = Router();

const SYSTEM_PROMPT =
  'You are a helpful assistant for the DOT Grants website. Use the provided ' +
  'tools to answer questions about U.S. Department of Transportation grant ' +
  "opportunities, eligibility, and deadlines. Only state facts that come " +
  "from tool results — don't guess at specific grant names, amounts, or " +
  'deadlines you have not looked up.';

// Bounds cost/latency per request regardless of how many tool calls Claude chains.
const MAX_TOOL_ITERATIONS = 5;

const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOL_SCHEMAS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
}));

/**
 * POST /api/chat
 * Natural-language chat backed by the Anthropic Messages API, using the
 * same tool schemas/dispatch as the MCP server (src/mcp/tool-schemas.ts,
 * src/mcp/tool-executor.ts).
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const validation = validateParams(ChatRequestSchema, req.body);
    if (!validation.success) {
      res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
      return;
    }

    const config = getConfig();
    if (!config.anthropic.apiKey) {
      throw new GrantServerError(
        'MISSING_CONFIG',
        'ANTHROPIC_API_KEY environment variable is required for chat. Please set it in your .env file.',
        false
      );
    }

    const anthropic = getAnthropicClient();
    const messages: any[] = validation.data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let reply = '';
    const toolCalls: Array<{ name: string; input: unknown }> = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: SYSTEM_PROMPT,
        tools: ANTHROPIC_TOOLS,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        reply = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');
        break;
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
      for (const block of response.content as any[]) {
        if (block.type !== 'tool_use') continue;

        logger.info(`Chat tool call: ${block.name}`, block.input);
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

      messages.push({ role: 'user', content: toolResults });
    }

    if (!reply) {
      reply = "I wasn't able to finish answering that — please try rephrasing your question.";
    }

    res.json(successResponse({ reply, toolCalls }));
  })
);

export default router;
