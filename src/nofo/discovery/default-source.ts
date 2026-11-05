import { getConfig } from '../../config/config.js';
import { createAnthropicLlm, type LlmFn } from '../llm.js';
import { SimplerGrantsClient } from '../simpler/client.js';
import { SimplerOpportunitySource } from '../simpler/source.js';

/** Search source from configuration. Throws SimplerApiError('config') when SIMPLER_GRANTS_API_KEY is missing. */
export function createSearchSource(fetchImpl?: typeof fetch): SimplerOpportunitySource {
  const { simpler } = getConfig();
  return new SimplerOpportunitySource(
    new SimplerGrantsClient({
      apiKey: simpler.apiKey,
      baseUrl: simpler.baseUrl,
      timeoutMs: simpler.timeoutMs,
      maxRetries: simpler.maxRetries,
      fetchImpl,
    })
  );
}

export const isSearchConfigured = (): boolean => Boolean(getConfig().simpler.apiKey);

/** The model used for the project profile, or null when no Anthropic key is configured (a keyword reader is used instead). */
export function createDiscoveryLlm(): LlmFn | null {
  return getConfig().anthropic.apiKey ? createAnthropicLlm() : null;
}
