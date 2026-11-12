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
/** `say` marks every guided question as already shown, so these tests reach the search. `sayFresh` is a first message. */
const say = (...contents: string[]) => ({ ...sayFresh(...contents), asked: ['projectType', 'applicant', 'phase', 'request'] });
const sayFresh = (...contents: string[]) => ({ messages: contents.map((content) => ({ role: 'user', content })) });

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
    // The actual API calls, and a plain-language explanation (a template here: the stub model only returns profiles).
    expect(body.data.apiCalls.length).toBeGreaterThan(0);
    expect(body.data.apiCalls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/v1\/opportunities\/search$/) });
    expect(JSON.stringify(body.data.apiCalls)).not.toMatch(/test-key/);
    expect(body.data.explanation).toMatchObject({ source: 'code' });
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

  it('describes the downloaded documents of a listed opportunity, and adds them up, from local files only', async () => {
    const { base, store } = await start({
      llm: wildlifeLlm(),
      searchSource: fakeSearchSource(() => ({
        candidates: [makeCandidate({ opportunityId: OPP_A, title: 'Wildlife Crossing Program' }), makeCandidate({ opportunityId: WCPP_ID, title: 'Another Wildlife Crossing Program' })],
        totalRecords: 2,
        skipped: 0,
      })),
    });
    await store.writeOpportunity(OPP_A, makeOpportunity({ title: 'Prepared' }));
    await writePackage(store, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { title: 'The notice', fileName: 'notice.pdf', processing: { status: 'parsed', processorId: 'test', processorVersion: '1', pages: PAGE_TEXTS.length } } }]);
    await store.writeRequirements(OPP_A, reqFile(RULEBOOK));

    const { body } = await post(`${base}/discover`, say(WILDLIFE));
    const byId = new Map<string, any>(body.data.shortlist.map((s: any) => [s.opportunityId, s]));
    const withDocs = byId.get(OPP_A).downloaded;
    expect(withDocs.documents).toMatchObject([{ title: 'The notice', format: 'PDF', role: 'notice', pages: PAGE_TEXTS.length }]);
    expect(withDocs.totalPages).toBe(PAGE_TEXTS.length);
    expect(withDocs.requirements.total).toBe(RULEBOOK.length);
    expect(byId.get(WCPP_ID).downloaded).toBeUndefined();
    expect(body.data.downloaded).toMatchObject({ listings: 1, documents: 1, pages: PAGE_TEXTS.length, requirements: RULEBOOK.length });
  });

  it('leaves the downloaded figures out when no listed opportunity has documents here', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const { body } = await post(`${base}/discover`, say(WILDLIFE));
    expect(body.data.downloaded).toBeUndefined();
    for (const item of body.data.shortlist) expect(item.downloaded).toBeUndefined();
  });

  it('asks guided questions, and runs no search, for a first message that leaves things out', async () => {
    const source = fixtureSearchSource();
    const { base } = await start({ searchSource: source, isModelConfigured: () => false });
    const { status, body } = await post(`${base}/discover`, sayFresh('We need money for a project'));
    expect(status).toBe(200);
    expect(body.data.stage).toBe('ask');
    expect(body.data.questions.map((q: any) => q.id)).toEqual(['projectType', 'applicant']);
    expect(source.bodies).toHaveLength(0);
  });

  it('rejects an unknown question id in "asked"', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource() });
    expect((await post(`${base}/discover`, { ...sayFresh('hello'), asked: ['password'] })).status).toBe(400);
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
    expect(types.slice(0, -1).every((t) => t === 'progress' || t === 'console')).toBe(true);
    expect(types[types.length - 1]).toBe('result');
    const ids = streamed.lines.filter((l) => l.type === 'progress').map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['read', 'understood', 'plan', 'search:open_all', 'rank']));

    // The developer console rides the same stream: only a kind and a line of text, never credentials.
    const consoleLines = streamed.lines.filter((l) => l.type === 'console');
    expect(consoleLines.length).toBeGreaterThan(0);
    for (const l of consoleLines) expect(Object.keys(l).sort()).toEqual(['kind', 'text', 'type']);
    expect(consoleLines.map((l) => l.text).join('\n')).toMatch(/POST .*\/v1\/opportunities\/search/);
    expect(streamed.text).not.toMatch(/test-key|X-API-Key: [^•\s]/);

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

describe('POST /project-description', () => {
  it('returns a description for the Assess tab, from the applicant\'s own messages when there is no model', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), isModelConfigured: () => false });
    const { status, body, headers } = await post(`${base}/project-description`, sayFresh(WILDLIFE, 'Design is 30 percent complete.'));
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.data.source).toBe('code');
    expect(body.data.text).toContain(WILDLIFE);
    expect(body.data.text).toContain('Design is 30 percent complete.');
  });

  it('rejects invalid requests with a 400', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), isModelConfigured: () => false });
    for (const payload of [{}, { messages: [] }, { ...sayFresh('ok'), asked: ['phase'] }, sayFresh('x'.repeat(4001))]) {
      expect((await post(`${base}/project-description`, payload)).status).toBe(400);
    }
  });

  it('never logs what the applicant wrote', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn')];
    const { base } = await start({ searchSource: fixtureSearchSource(), isModelConfigured: () => false });
    await post(`${base}/project-description`, sayFresh('Confidential bridge at 123 Secret Street'));
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    expect(logged).not.toMatch(/Secret Street|Confidential/);
  });
});

describe('POST /discover: documents on the shortlist', () => {
  const attachment = (fileName: string) => ({ attachmentId: 'a1', fileName, description: null, mimeType: 'application/pdf', sizeBytes: 10, downloadPath: 'https://files.example.test/a1.pdf', createdAt: null, updatedAt: null });

  it('says which shortlisted listings list documents, with names only', async () => {
    const lookups: string[] = [];
    const searchSource = Object.assign(fixtureSearchSource(), {
      async getAttachments(id: string) {
        lookups.push(id);
        return id === WCPP_ID ? [attachment('Final_NOFO.pdf')] : [];
      },
    });
    const { base } = await start({ searchSource, llm: wildlifeLlm() });
    const { status, body } = await post(`${base}/discover`, say(WILDLIFE));
    expect(status).toBe(200);
    const byId = new Map<string, any>(body.data.shortlist.map((s: any) => [s.opportunityId, s]));
    expect(byId.get(WCPP_ID).documents).toEqual({ status: 'listed', count: 1, files: ['Final_NOFO.pdf'], hasNotice: true });
    const others = body.data.shortlist.filter((s: any) => s.opportunityId !== WCPP_ID);
    expect(others.length).toBeGreaterThan(0);
    for (const item of others) expect(item.documents.status).toBe('none');
    expect(lookups.sort()).toEqual(body.data.shortlist.map((s: any) => s.opportunityId).sort());
    expect(JSON.stringify(body)).not.toMatch(/files\.example\.test/); // no download links
  });

  it('shows the check as a progress step in the stream', async () => {
    const searchSource = Object.assign(fixtureSearchSource(), { getAttachments: async () => [] });
    const { base } = await start({ searchSource, llm: wildlifeLlm() });
    const response = await fetch(`${base}/discover?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(say(WILDLIFE)) });
    const lines = (await response.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const steps = lines.filter((l) => l.type === 'progress' && l.id === 'documents').map((l) => l.status);
    expect(steps).toEqual(['running', 'done']);
    expect(lines[lines.length - 1].type).toBe('result');
  });

  it('leaves documents out when the source cannot list attachments', async () => {
    const { base } = await start({ searchSource: fixtureSearchSource(), llm: wildlifeLlm() });
    const { body } = await post(`${base}/discover`, say(WILDLIFE));
    for (const item of body.data.shortlist) expect(item.documents).toBeUndefined();
  });
});
