import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../../clients/anthropic-client.js';
import { getConfig } from '../../config/config.js';
import { Intent } from './types.js';

const SYSTEM_PROMPT =
  "Classify the user's latest message in this DOT grants chat into exactly " +
  'one intent using the classify_intent tool. Pick "general" for greetings ' +
  'or questions unrelated to DOT grants.';

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'classify_intent',
  description: 'Classify the conversation into one DOT-grants chat intent.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['search', 'eligibility', 'deadlines', 'details', 'general'],
        description:
          'search: looking for grant opportunities. eligibility: asking who ' +
          'can apply. deadlines: asking about upcoming due dates. details: ' +
          'asking about a specific known program/opportunity. general: ' +
          'anything else (including greetings).',
      },
    },
    required: ['intent'],
  },
};

/**
 * Single forced-tool-choice call that routes the conversation to one of the
 * fixed intents, so retrieval/drafting don't have to re-derive it from prose.
 */
export async function classifyIntent(messages: any[]): Promise<Intent> {
  const config = getConfig();
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 64,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_intent' },
    messages,
  });

  const toolUse = (response.content as any[]).find((block) => block.type === 'tool_use');
  return (toolUse?.input?.intent as Intent) ?? 'general';
}
