import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../clients/anthropic-client.js';
import { getConfig } from '../config/config.js';

/**
 * Thin, injectable wrapper over one structured-output model call. Unit tests
 * and the pipeline depend only on `LlmFn`, so no test ever touches the network.
 *
 * Structured outputs (`output_config.format`) are used instead of a forced
 * tool call: newer models reject forced `tool_choice`. Sampling parameters
 * and a thinking configuration are deliberately not sent, because several
 * current models reject them; run-to-run variation is handled by caching the
 * result and by the evaluation script, not by temperature.
 */

export interface LlmCall {
  system: string;
  user: string;
  /** JSON schema for the response. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmResult {
  text: string;
  stopReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type LlmFn = (call: LlmCall) => Promise<LlmResult>;

/** Failure of a model call. Messages never include prompt content. */
export class LlmError extends Error {
  constructor(
    public readonly kind: 'config' | 'api',
    message: string
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicLlmOptions {
  model?: string;
  client?: Pick<Anthropic, 'messages'>;
  /** Thinking/response effort. Defaults to ANTHROPIC_EXTRACTION_EFFORT, else "medium"; null omits it. */
  effort?: Effort | null;
}

const EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh', 'max']);

/** Extraction is bounded, structured work: "medium" keeps output (and cost) down. "off" in the env var omits the parameter. */
export function resolveEffort(override?: Effort | null): Effort | null {
  if (override !== undefined) return override;
  const fromEnv = (process.env.ANTHROPIC_EXTRACTION_EFFORT ?? '').trim().toLowerCase();
  if (fromEnv === 'off') return null;
  return EFFORTS.has(fromEnv) ? (fromEnv as Effort) : 'medium';
}

export function resolveExtractionModel(override?: string): string {
  const { anthropic } = getConfig();
  return override ?? anthropic.extractionModel ?? anthropic.model;
}

export function createAnthropicLlm(options: AnthropicLlmOptions = {}): LlmFn {
  const config = getConfig();
  if (!options.client && !config.anthropic.apiKey) {
    throw new LlmError('config', 'ANTHROPIC_API_KEY is not set. Add it to your local .env file to run requirements extraction.');
  }
  const client = options.client ?? getAnthropicClient();
  const model = resolveExtractionModel(options.model);
  const effort = resolveEffort(options.effort);

  return async (call: LlmCall): Promise<LlmResult> => {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
        output_config: { format: { type: 'json_schema', schema: call.schema }, ...(effort ? { effort } : {}) },
      });
      return {
        text: response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        stopReason: response.stop_reason,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const name = (error as { name?: string } | null)?.name ?? 'Error';
      // The API's own message (for example "model not found") is useful and does not contain our prompt.
      const detail = String((error as { message?: string } | null)?.message ?? '').slice(0, 200);
      throw new LlmError('api', `Anthropic API call failed (${name}${status ? `, HTTP ${status}` : ''}): ${detail}`);
    }
  };
}
