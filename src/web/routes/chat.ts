import { Router, Request, Response } from 'express';
import { getConfig } from '../../config/config.js';
import { classifyIntent } from '../chat/classifier-agent.js';
import { runRetrieval } from '../chat/retrieval-agent.js';
import { draftReply } from '../chat/drafting-agent.js';
import { ChatRequestSchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';
import { GrantServerError } from '../../types/index.js';

const router = Router();

/**
 * POST /api/chat
 * Natural-language chat backed by the Anthropic Messages API, split into
 * three stages: classify the intent (src/web/chat/classifier-agent.ts),
 * retrieve facts with the MCP tools scoped to that intent
 * (src/web/chat/retrieval-agent.ts, reusing src/mcp/tool-schemas.ts /
 * tool-executor.ts), then draft the final reply from those facts
 * (src/web/chat/drafting-agent.ts).
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

    const messages: any[] = validation.data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const intent = await classifyIntent(messages);
    const { facts, toolCalls } = await runRetrieval(intent, messages);
    let reply = await draftReply(messages, facts);

    if (!reply) {
      reply = "I wasn't able to finish answering that — please try rephrasing your question.";
    }

    res.json(successResponse({ reply, toolCalls }));
  })
);

export default router;
