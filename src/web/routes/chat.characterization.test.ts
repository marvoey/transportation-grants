import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization of POST /api/chat with NO projectId, written before the
 * project-aware changes and kept unchanged afterwards. It stubs the Anthropic
 * client and the MCP tool call, and pins: the response envelope, the three
 * pipeline stages, per-intent tool scoping, and how facts reach the drafter.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  callMcpTool: vi.fn(),
  apiKey: 'test-anthropic-key' as string | undefined,
}));

vi.mock('../../clients/anthropic-client.js', () => ({
  getAnthropicClient: () => ({ messages: { create: h.create } }),
}));
vi.mock('../../mcp/client.js', () => ({ callMcpTool: h.callMcpTool }));
vi.mock('../../config/config.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...real,
    getConfig: () => {
      const c = real.getConfig();
      return { ...c, anthropic: { ...c.anthropic, apiKey: h.apiKey } };
    },
  };
});

import { INTENT_TOOLS } from '../chat/types.js';
import { startTestServer } from '../test-http.js';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server;

beforeEach(async () => {
  h.create.mockReset();
  h.callMcpTool.mockReset();
  h.apiKey = 'test-anthropic-key';
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

const text = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const classified = (intent: string) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'c1', name: 'classify_intent', input: { intent } }],
});
const toolUse = (name: string, input: object) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'tu1', name, input }],
});

/** Routes each stubbed model call to its stage by the shape of the request. */
function script(opts: { intent: string; retrieval?: unknown[]; draft?: string }) {
  const retrieval = [...(opts.retrieval ?? [])];
  h.create.mockImplementation(async (params: any) => {
    if (params.tool_choice?.name === 'classify_intent') return classified(opts.intent);
    if (params.tools?.length) return retrieval.shift() ?? text('no more retrieval');
    return text(opts.draft ?? 'Final reply');
  });
}
const calls = (stage: 'classify' | 'retrieve' | 'draft') =>
  h.create.mock.calls
    .map((c) => c[0])
    .filter((p) =>
      stage === 'classify' ? p.tool_choice?.name === 'classify_intent' : stage === 'retrieve' ? p.tools?.length && !p.tool_choice : !p.tools
    );

const chat = (body: unknown) => server.client().post('/api/chat', body);
const MESSAGES = [{ role: 'user', content: 'transit grants for cities?' }];

describe('POST /api/chat without projectId (characterization)', () => {
  it('general intent: classify -> no retrieval call -> draft; envelope has only reply and toolCalls', async () => {
    script({ intent: 'general', draft: 'Hello there' });
    const r = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { reply: 'Hello there', toolCalls: [] } });
    expect(calls('classify')).toHaveLength(1);
    expect(calls('retrieve')).toHaveLength(0);
    expect(calls('draft')).toHaveLength(1);
    expect(h.callMcpTool).not.toHaveBeenCalled();
  });

  it('classifier sees only the conversation, with a forced classify_intent tool', async () => {
    script({ intent: 'general' });
    await chat({ messages: MESSAGES });
    const [c] = calls('classify');
    expect(c.messages).toEqual(MESSAGES);
    expect(c.tool_choice).toEqual({ type: 'tool', name: 'classify_intent' });
    expect(c.max_tokens).toBe(64);
    expect(c.system).toMatch(/Classify the user's latest message/);
  });

  it.each(Object.entries(INTENT_TOOLS).filter(([, tools]) => tools.length > 0))(
    '%s intent exposes exactly its allowlisted tools to retrieval',
    async (intent, tools) => {
      script({ intent, retrieval: [text('facts')] });
      await chat({ messages: MESSAGES });
      const [r] = calls('retrieve');
      expect(r.tools.map((t: any) => t.name).sort()).toEqual([...tools].sort());
    }
  );

  it('search: runs the model-chosen MCP tool, returns toolCalls, and hands facts to the drafter', async () => {
    h.callMcpTool.mockResolvedValue({ grants: [{ id: 'G1', title: 'Transit Grant' }] });
    script({
      intent: 'search',
      retrieval: [toolUse('search_dot_grants', { applicantType: 'city' }), text('Found G1: Transit Grant, $5M')],
      draft: 'Here is G1',
    });
    const r = await chat({ messages: MESSAGES });
    expect(h.callMcpTool).toHaveBeenCalledWith('search_dot_grants', { applicantType: 'city' });
    expect(r.body.data).toEqual({
      reply: 'Here is G1',
      toolCalls: [{ name: 'search_dot_grants', input: { applicantType: 'city' } }],
    });
    const [d] = calls('draft');
    expect(d.system).toMatch(/^You are a helpful assistant for the DOT Grants website\./);
    expect(d.system).toContain('\n\nFacts gathered for this question:\nFound G1: Transit Grant, $5M');
    expect(d.messages).toEqual(MESSAGES);
    expect(d.max_tokens).toBe(1024);
  });

  it('without facts the drafter system prompt is the bare prompt', async () => {
    script({ intent: 'general' });
    await chat({ messages: MESSAGES });
    const [d] = calls('draft');
    expect(d.system).not.toContain('Facts gathered');
  });

  it('retrieval tool errors are fed back as results rather than failing the request', async () => {
    h.callMcpTool.mockRejectedValue(new Error('boom'));
    script({ intent: 'details', retrieval: [toolUse('get_grant_details', { opportunityId: 'x' }), text('could not load')] });
    const r = await chat({ messages: MESSAGES });
    expect(r.status).toBe(200);
    expect(r.body.data.toolCalls).toHaveLength(1);
  });

  it('retrieval is capped at five tool-use iterations', async () => {
    h.callMcpTool.mockResolvedValue({});
    script({ intent: 'details', retrieval: Array.from({ length: 10 }, () => toolUse('get_grant_details', { opportunityId: 'x' })) });
    await chat({ messages: MESSAGES });
    expect(calls('retrieve')).toHaveLength(5);
  });

  it('an empty draft becomes the fallback message', async () => {
    script({ intent: 'general', draft: '' });
    const r = await chat({ messages: MESSAGES });
    expect(r.body.data.reply).toBe("I wasn't able to finish answering that — please try rephrasing your question.");
  });

  it('validates the body (400 VALIDATION_ERROR) and ignores nothing else', async () => {
    for (const body of [{}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] }, { messages: 'hi' }]) {
      const r = await chat(body);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', retryable: false });
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it('503 MISSING_CONFIG without an Anthropic key', async () => {
    h.apiKey = undefined;
    const r = await chat({ messages: MESSAGES });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ success: false, code: 'MISSING_CONFIG', retryable: false });
  });
});
