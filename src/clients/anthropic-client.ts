import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config/config.js';

let anthropicClientInstance: Anthropic | null = null;

/**
 * Singleton Anthropic client. Callers must verify config.anthropic.apiKey
 * is set before calling this (the chat route does so and returns a 503
 * MISSING_CONFIG error otherwise).
 */
export function getAnthropicClient(): Anthropic {
  if (!anthropicClientInstance) {
    const config = getConfig();
    anthropicClientInstance = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropicClientInstance;
}
