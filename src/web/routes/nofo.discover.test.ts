import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../config/config.js';
import { WCPP_ID, fakeSearchSource, fixtureSearchSource, makeCandidate, profileLlm } from '../../nofo/__fixtures__/discovery.js';
import { RULEBOOK, reqFile } from '../../nofo/__fixtures__/assessment.js';
import { DOC_ID, PAGE_TEXTS, pdfDoc, writePackage } from '../../nofo/__fixtures__/extraction.js';
import { OPP_A, makeOpportunity, tmpStore } from '../../nofo/__fixtures__/helpers.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createNofoRouter, type NofoRouterDeps } from './nofo.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

async function start(deps: NofoRouterDeps = {}) {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
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

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
};
const say = (...contents: string[]) => ({ messages: contents.map((content) => ({ role: 'user', content })) });

const wildlifeLlm = () =>
  profileLlm({
    projectTypes: [{ type: 'wildlife_connectivity', quote: 'wildlife overpass' }],
    applicantType: { present: true, value: 'county', quote: 'Our county' },
    terms: ['wildlife crossing'],
  });
const WILDLIFE = 'Our county wants a wildlife overpass on a rural highway.';

describe('POST /discover', () => {
  it('returns a preliminary shortlist in the standard envelope, uncached', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const { status, body, headers } = await post(`${base}/discover`, say(WILDLIFE));
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.success).toBe(true);
    expect(body.data.preliminary).toBe(true);
    expect(body.data.stage).toBe('results');
    expect(body.data.shortlist[0].opportunityId).toBe(WCPP_ID);
    expect(body.count).toBe(body.data.shortlist.length);
    expect(body.data.disclaimer).toMatch(/not an eligibility determination/);
  });

  it('marks which listed opportunities this server can already assess', async () => {
    const { base, store } = await start({
      llm: wildlifeLlm(),
      searchSource: fakeSearchSource(() => ({
        candidates: [
          makeCandidate({ opportunityId: OPP_A, title: 'Wildlife Crossing Program' }),
          makeCandidate({ opportunityId: WCPP_ID, title: 'Another Wildlife Crossing Program' }),
        ],
        totalRecords: 2,
        skipped: 0,
      })),
    });
    await store.writeOpportunity(OPP_A, makeOpportunity({ title: 'Prepared' }));
    await writePackage(store, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS) }]);
    await store.writeRequirements(OPP_A, reqFile(RULEBOOK));

    const { body } = await post(`${base}/discover`, say(WILDLIFE));
    const byId = Object.fromEntries(body.data.shortlist.map((s: any) => [s.opportunityId, s.readyToAssess]));
    expect(byId[OPP_A]).toBe(true);
    expect(byId[WCPP_ID]).toBe(false);
  });

  it('asks one question, and runs no search, for a vague first message', async () => {
    const source = fixtureSearchSource();
    const { base } = await start({ searchSource: source, isModelConfigured: () => false });
    const { status, body } = await post(`${base}/discover`, say('We need money for a project'));
    expect(status).toBe(200);
    expect(body.data.stage).toBe('ask');
    expect(body.data.questions).toHaveLength(1);
    expect(source.bodies).toHaveLength(0);
  });

  it('still returns a list, with a visible warning, when no model key is configured', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), isModelConfigured: () => false });
    const { status, body } = await post(`${base}/discover`, say('We want to replace a bridge'));
    expect(status).toBe(200);
    expect(body.data.warnings.join(' ')).toMatch(/No language model is configured/);
  });

  it('rejects invalid requests with a 400 and searches nothing', async () => {
    const source = fixtureSearchSource();
    const { base } = await start({ searchSource: source });
    const bad: unknown[] = [
      {},
      { messages: [] },
      { messages: [{ role: 'assistant', content: 'hi' }] },
      say('a', 'b', 'c', 'd', 'e', 'f', 'g'),
      say('x'.repeat(4001)),
      { ...say('ok'), unexpected: true },
      { ...say('ok'), includeHistorical: 'yes' },
    ];
    for (const payload of bad) {
      const { status, body } = await post(`${base}/discover`, payload);
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    }
    expect(source.bodies).toHaveLength(0);
  });

  it('is a clean 503 when the server has no Simpler key', async () => {
    const { base } = await start({ isSearchConfigured: () => false });
    const { status, body } = await post(`${base}/discover`, say(WILDLIFE));
    expect(status).toBe(503);
    expect(body.code).toBe('MISSING_CONFIG');
    expect(JSON.stringify(body)).not.toMatch(/test-simpler-key/);
  });

  it('is a generic, retryable 502 when every search fails, with no internal detail', async () => {
    const source = fakeSearchSource(() => {
      throw new Error('internal stack detail and secret-token');
    });
    const { base } = await start({ searchSource: source, llm: wildlifeLlm() });
    const { status, body } = await post(`${base}/discover`, say(WILDLIFE));
    expect(status).toBe(502);
    expect(body.retryable).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secret-token|stack detail/);
  });

  it('rate limits discovery separately from reads', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm(), limits: { discoverPerWindow: 2, windowMs: 60_000 } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await post(`${base}/discover`, say(WILDLIFE))).status);
    expect(statuses).toEqual([200, 200, 429]);
    const read = await fetch(`${base}/opportunities`);
    expect(read.status).toBe(200);
  });

  it('does not log what the applicant wrote', async () => {
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(logger, level));
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    await post(`${base}/discover`, say('Confidential wildlife overpass at 123 Secret Street'));
    await post(`${base}/discover`, { messages: [] });
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    expect(logged).not.toMatch(/Secret Street|Confidential/);
  });
});

describe('POST /discover?stream=1 (live progress)', () => {
  const postStream = async (url: string, body: unknown) => {
    const r = await fetch(`${url}?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, lines: text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
  };

  it('streams one JSON object per line: progress steps first, then the same result the plain call returns', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const streamed = await postStream(`${base}/discover`, say(WILDLIFE));
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    expect(streamed.headers.get('cache-control')).toBe('no-store');
    const types = streamed.lines.map((l) => l.type);
    expect(types.slice(0, -1).every((t) => t === 'progress')).toBe(true);
    expect(types[types.length - 1]).toBe('result');
    const ids = streamed.lines.filter((l) => l.type === 'progress').map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['read', 'understood', 'plan', 'search:open_all', 'rank']));

    const plain = await post(`${base}/discover`, say(WILDLIFE));
    const final = streamed.lines[streamed.lines.length - 1].data;
    expect(final.shortlist.map((s: any) => s.opportunityId)).toEqual(plain.body.data.shortlist.map((s: any) => s.opportunityId));
    expect(final.shortlist[0].opportunityId).toBe(WCPP_ID);
  });

  it('keeps normal HTTP errors for bad input and missing configuration (no stream is started)', async () => {
    const bad = await start({ searchSource: fixtureSearchSource() });
    const invalid = await postStream(`${bad.base}/discover`, { messages: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-type')).toMatch(/application\/json/);
    expect(invalid.lines[0].code).toBe('VALIDATION_ERROR');

    const unconfigured = await start({ isSearchConfigured: () => false });
    const missing = await postStream(`${unconfigured.base}/discover`, say(WILDLIFE));
    expect(missing.status).toBe(503);
    expect(missing.lines[0].code).toBe('MISSING_CONFIG');
  });

  it('reports a failure that happens mid-stream as a final generic error line', async () => {
    const source = fakeSearchSource(() => {
      throw new Error('internal stack detail and secret-token');
    });
    const { base } = await start({ searchSource: source, llm: wildlifeLlm() });
    const streamed = await postStream(`${base}/discover`, say(WILDLIFE));
    expect(streamed.status).toBe(200); // the status was already sent when the failure happened
    const last = streamed.lines[streamed.lines.length - 1];
    expect(last).toMatchObject({ type: 'error', code: 'API_ERROR', retryable: true });
    expect(streamed.text).not.toMatch(/secret-token|stack detail/);
    expect(streamed.lines.some((l) => l.type === 'result')).toBe(false);
  });

  it('never puts what the applicant wrote into a progress line', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const streamed = await postStream(`${base}/discover`, say('Our county wants a wildlife overpass at 123 Secret Street'));
    const progress = streamed.lines.filter((l) => l.type === 'progress');
    expect(progress.length).toBeGreaterThan(3);
    expect(JSON.stringify(progress)).not.toMatch(/Secret Street/);
  });

  it('is rate limited like the plain call', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm(), limits: { discoverPerWindow: 1, windowMs: 60_000 } });
    expect((await postStream(`${base}/discover`, say(WILDLIFE))).status).toBe(200);
    expect((await postStream(`${base}/discover`, say(WILDLIFE))).status).toBe(429);
  });
});

describe('POST /discover with inspect', () => {
  it('returns the Simpler.Grants.gov requests and responses only when asked', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const plain = await post(`${base}/discover`, say(WILDLIFE));
    expect(plain.body.data.inspection).toBeUndefined();
    const inspected = await post(`${base}/discover`, { ...say(WILDLIFE), inspect: true });
    expect(inspected.status).toBe(200);
    expect(inspected.body.data.inspection.length).toBeGreaterThan(1);
    expect(inspected.body.data.inspection[0]).toMatchObject({ ok: true });
    expect(JSON.stringify(inspected.body.data.inspection)).not.toMatch(/test-simpler-key|X-API-Key/i);
  });

  it('also arrives on the final line of the stream', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const r = await fetch(`${base}/discover?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...say(WILDLIFE), inspect: true }) });
    const lines = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    expect(last.type).toBe('result');
    expect(last.data.inspection.length).toBeGreaterThan(1);
    expect(lines.filter((l) => l.type === 'progress').every((l) => !('inspection' in l))).toBe(true);
  });

  it('rejects a non-boolean inspect with a 400', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource() });
    expect((await post(`${base}/discover`, { ...say(WILDLIFE), inspect: 'yes' })).status).toBe(400);
  });
});
