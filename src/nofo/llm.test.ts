import { afterEach, describe, expect, it } from 'vitest';
import { LlmError, createAnthropicLlm, resolveEffort, resolveExtractionModel } from './llm.js';

interface Recorded {
  params: Record<string, unknown>;
}

function fakeClient(respond: (params: Record<string, unknown>) => unknown) {
  const recorded: Recorded[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        recorded.push({ params });
        return respond(params);
      },
    },
  };
  return { client: client as never, recorded };
}

const okResponse = {
  content: [{ type: 'text', text: '{"requirements": ' }, { type: 'text', text: '[]}' }],
  stop_reason: 'end_turn',
  model: 'served-model',
  usage: { input_tokens: 12, output_tokens: 3 },
};
const call = { system: 'SYS', user: 'USER', schema: { type: 'object' }, maxTokens: 777 };

afterEach(() => {
  delete process.env.ANTHROPIC_EXTRACTION_EFFORT;
});

describe('createAnthropicLlm', () => {
  it('sends a structured-output request with exactly the parameters we intend', async () => {
    const { client, recorded } = fakeClient(() => okResponse);
    const llm = createAnthropicLlm({ client, model: 'test-model' });
    const result = await llm(call);

    expect(result).toEqual({ text: '{"requirements": []}', stopReason: 'end_turn', model: 'served-model', inputTokens: 12, outputTokens: 3 });
    expect(recorded[0].params).toEqual({
      model: 'test-model',
      max_tokens: 777,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } }, effort: 'medium' },
    });
    // Parameters several current models reject must never be sent.
    for (const forbidden of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice', 'tools']) {
      expect(recorded[0].params).not.toHaveProperty(forbidden);
    }
  });

  it('omits effort when disabled, and honors the environment override', async () => {
    const off = fakeClient(() => okResponse);
    await createAnthropicLlm({ client: off.client, model: 'm', effort: null })(call);
    expect((off.recorded[0].params.output_config as Record<string, unknown>).effort).toBeUndefined();

    process.env.ANTHROPIC_EXTRACTION_EFFORT = 'high';
    const high = fakeClient(() => okResponse);
    await createAnthropicLlm({ client: high.client, model: 'm' })(call);
    expect((high.recorded[0].params.output_config as Record<string, unknown>).effort).toBe('high');
  });

  it('turns API errors into a LlmError that never contains the prompt', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('model: claude-nope not found'), { status: 404, name: 'NotFoundError' });
    });
    const error = await createAnthropicLlm({ client, model: 'claude-nope' })(call).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toMatch(/NotFoundError, HTTP 404.*not found/);
    expect(error.message).not.toContain('USER');
    expect(error.message).not.toContain('SYS');
  });

  it('ignores non-text blocks and reports the stop reason', async () => {
    const { client } = fakeClient(() => ({ ...okResponse, content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'OUT' }], stop_reason: 'max_tokens' }));
    const result = await createAnthropicLlm({ client, model: 'm' })(call);
    expect(result.text).toBe('OUT');
    expect(result.stopReason).toBe('max_tokens');
  });
});

describe('configuration helpers', () => {
  it('resolves the effort level', () => {
    expect(resolveEffort()).toBe('medium');
    expect(resolveEffort('low')).toBe('low');
    expect(resolveEffort(null)).toBeNull();
    process.env.ANTHROPIC_EXTRACTION_EFFORT = 'OFF';
    expect(resolveEffort()).toBeNull();
    process.env.ANTHROPIC_EXTRACTION_EFFORT = 'nonsense';
    expect(resolveEffort()).toBe('medium');
  });

  it('prefers an explicit model, then the extraction model, then the chat model', () => {
    expect(resolveExtractionModel('explicit')).toBe('explicit');
    expect(typeof resolveExtractionModel()).toBe('string');
  });
});
