import { getAnthropicClient } from '../../clients/anthropic-client.js';
import { getConfig } from '../../config/config.js';

const SYSTEM_PROMPT =
  'You are a helpful assistant for the DOT Grants website. Write the final ' +
  'reply to the user using only the facts provided to you below — do not ' +
  "invent grant names, amounts, or deadlines. If no facts were gathered, " +
  'answer general or greeting questions directly, or say you can only help ' +
  'with U.S. Department of Transportation grant opportunities, eligibility, ' +
  'and deadlines.';

/**
 * Final, tool-free call that composes the user-facing reply from the facts
 * retrieval-agent.ts gathered. Facts are appended to the system prompt
 * (rather than as an extra `user` message) so they don't break the
 * Anthropic API's required user/assistant role alternation.
 */
export async function draftReply(messages: any[], facts: string): Promise<string> {
  const config = getConfig();
  const anthropic = getAnthropicClient();

  const system = facts ? `${SYSTEM_PROMPT}\n\nFacts gathered for this question:\n${facts}` : SYSTEM_PROMPT;

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
    system,
    messages,
  });

  return response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
}
