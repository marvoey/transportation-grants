import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { RULEBOOK, modelStandIn, reqFile } from '../../nofo/__fixtures__/assessment.js';
import { OPP_A, OPP_B, makeOpportunity, tmpStore } from '../../nofo/__fixtures__/helpers.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createNofoRouter, type NofoRouterDeps } from './nofo.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start(deps: NofoRouterDeps = {}) {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  await t.store.writeOpportunity(OPP_A, makeOpportunity());
  await t.store.writeRequirements(OPP_A, reqFile(RULEBOOK));
  const app = express();
  app.use(express.json());
  app.use('/api/nofo', createNofoRouter({ store: t.store, ...deps }));
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { ...t, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nofo` };
}

const llm = () => modelStandIn({ facts: { requestedFederalUsd: { value: 18_000_000, quote: '$18 million' } } });
const body = (extra: Record<string, unknown> = {}) => ({
  opportunityId: OPP_A,
  messages: [{ role: 'user', content: 'We want to request $18 million.' }],
  ...extra,
});

const postStream = async (url: string, payload: unknown) => {
  const r = await fetch(`${url}/assess?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, lines: text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
};

describe('POST /assess?stream=1 (live progress)', () => {
  it('streams progress steps, then the same result the plain call returns', async () => {
    const { base } = await start({ llm: llm() });
    const streamed = await postStream(base, body());
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    expect(streamed.headers.get('cache-control')).toBe('no-store');
    const types = streamed.lines.map((l) => l.type);
    expect(types.slice(0, -1).every((t) => t === 'progress')).toBe(true);
    expect(types[types.length - 1]).toBe('result');
    const ids = streamed.lines.filter((l) => l.type === 'progress').map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['load', 'read', 'rules', 'summary']));

    const plain = (await (await fetch(`${base}/assess`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) })).json()) as any;
    const final = streamed.lines[streamed.lines.length - 1].data;
    expect(final.advisory.headline).toBe(plain.data.advisory.headline);
    expect(final.findings.length).toBe(plain.data.findings.length);
    expect(final.facts.requestedFederalUsd.value).toBe(18_000_000);
  });

  it('keeps normal HTTP errors for bad input, an opportunity with no requirements, and a missing key', async () => {
    const { base } = await start({ llm: llm() });
    const invalid = await postStream(base, { opportunityId: OPP_A, messages: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-type')).toMatch(/application\/json/);
    expect(invalid.lines[0].code).toBe('VALIDATION_ERROR');

    const noUser = await postStream(base, { opportunityId: OPP_A, messages: [{ role: 'assistant', content: 'hello' }] });
    expect(noUser.status).toBe(400);

    const none = await postStream(base, body({ opportunityId: OPP_B }));
    expect(none.status).toBe(404);
    expect(none.lines[0].code).toBe('NOT_FOUND');

    const unconfigured = await start({ isModelConfigured: () => false });
    const missing = await postStream(unconfigured.base, body());
    expect(missing.status).toBe(503);
    expect(missing.lines[0].code).toBe('MISSING_CONFIG');
  });

  it('never puts what the applicant wrote into a progress line', async () => {
    const { base } = await start({ llm: llm() });
    const streamed = await postStream(base, body({ messages: [{ role: 'user', content: 'Work at 123 Secret Street. We want to request $18 million.' }] }));
    const progress = streamed.lines.filter((l) => l.type === 'progress');
    expect(progress.length).toBeGreaterThan(3);
    expect(JSON.stringify(progress)).not.toMatch(/Secret Street/);
  });

  it('is rate limited like the plain call', async () => {
    const { base } = await start({ llm: llm(), limits: { assessPerWindow: 1, windowMs: 60_000 } });
    expect((await postStream(base, body())).status).toBe(200);
    expect((await postStream(base, body())).status).toBe(429);
  });
});
