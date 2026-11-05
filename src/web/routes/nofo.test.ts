import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { createNofoRouter, type NofoRouterDeps } from './nofo.js';
import { PackageStore } from '../../nofo/store.js';
import { RULEBOOK, modelStandIn, reqFile } from '../../nofo/__fixtures__/assessment.js';
import { DOC_ID, GUIDANCE_ID, PAGE_TEXTS, htmlDoc, pdfDoc, writePackage } from '../../nofo/__fixtures__/extraction.js';
import { OPP_A, OPP_B, PDF_BYTES, makeOpportunity, tmpStore } from '../../nofo/__fixtures__/helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start(deps: NofoRouterDeps = {}) {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  const app = express();
  app.use(express.json());
  app.use('/api/nofo', createNofoRouter({ store: t.store, interpretCache: undefined, ...deps }));
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nofo`;
  return { ...t, base };
}

/** A package with a PDF notice (stored original), an HTML FAQ, an unparsed document, and extracted requirements. */
async function seed(store: PackageStore) {
  await store.writeOpportunity(OPP_A, makeOpportunity({ title: 'Synthetic Test Opportunity' }));
  await writePackage(store, [
    { doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { originalUrl: 'https://example.gov/files/notice.pdf', title: 'Notice of Funding' } },
    { doc: htmlDoc(GUIDANCE_ID, [{ id: 's1', heading: 'Q1', text: 'FAQ answer text.' }]), manifest: { detectedType: 'html', fileName: 'faq.html', storedFile: null, originalUrl: 'javascript:alert(1)' } },
    { doc: pdfDoc('sg-test-bad-0003', ['x']), manifest: { processing: { status: 'unsupported_format' } } },
  ]);
  await store.writeOriginal(OPP_A, DOC_ID, 'pdf', PDF_BYTES);
  await store.writeRequirements(OPP_A, reqFile(RULEBOOK));
}

const getJson = async (url: string) => {
  const r = await fetch(url);
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
};
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};

describe('GET /opportunities', () => {
  it('lists ingested packages with coverage and whether they can be assessed', async () => {
    const { base, store } = await start();
    await seed(store);
    // A second package that was ingested but never extracted: listed, but not assessable.
    await store.writeOpportunity(OPP_B, makeOpportunity({ opportunityId: OPP_B, title: 'Not extracted yet' }));
    await writePackage(store, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS) }], OPP_B);

    const { status, body, headers } = await getJson(`${base}/opportunities`);
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.data.opportunities.map((o: any) => [o.opportunityId, o.requirements.ready])).toEqual([[OPP_A, true], [OPP_B, false]]);
    expect(body.data.opportunities[0]).toMatchObject({
      title: 'Synthetic Test Opportunity',
      coverage: { status: 'api_listed_processed' },
      requirements: { total: RULEBOOK.length, verified: 0, status: 'complete' },
    });
  });

  it('is an empty list, not an error, when nothing has been ingested', async () => {
    const { base } = await start();
    const { status, body } = await getJson(`${base}/opportunities`);
    expect(status).toBe(200);
    expect(body.data.opportunities).toEqual([]);
  });
});

describe('source text', () => {
  it('returns the stored text of a PDF page, with the document facts the drawer needs', async () => {
    const { base, store } = await start();
    await seed(store);
    const { status, body } = await getJson(`${base}/opportunities/${OPP_A}/documents/${DOC_ID}/pages/3`);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      documentId: DOC_ID, kind: 'pdf', page: 3, pageCount: 4, authority: 'controlling', title: 'Notice of Funding',
      sourceUrl: 'https://example.gov/files/notice.pdf', originalAvailable: true,
    });
    expect(body.data.text).toBe(PAGE_TEXTS[2]);
  });

  it('returns an HTML/Word section; a non-http(s) source URL is dropped and no original is offered', async () => {
    const { base, store } = await start();
    await seed(store);
    const { status, body } = await getJson(`${base}/opportunities/${OPP_A}/documents/${GUIDANCE_ID}/sections/s1`);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ kind: 'html', section: 's1', heading: 'Q1', text: 'FAQ answer text.', sourceUrl: null, originalAvailable: false });
  });

  it.each([
    ['page out of range', `/documents/${DOC_ID}/pages/9`],
    ['page zero', `/documents/${DOC_ID}/pages/0`],
    ['non-numeric page', `/documents/${DOC_ID}/pages/abc`],
    ['page on an HTML document', `/documents/${GUIDANCE_ID}/pages/1`],
    ['section on a PDF', `/documents/${DOC_ID}/sections/s1`],
    ['unknown section', `/documents/${GUIDANCE_ID}/sections/s9`],
    ['malformed section', `/documents/${GUIDANCE_ID}/sections/..%2Fx`],
    ['unknown document', `/documents/sg-nope-0009/pages/1`],
    ['an unparsed document', `/documents/sg-test-bad-0003/pages/1`],
    ['a path-traversal document id', `/documents/..%2F..%2Fetc/pages/1`],
    ['an uppercase document id', `/documents/SG-TEST/pages/1`],
  ])('404 for %s', async (_label, suffix) => {
    const { base, store } = await start();
    await seed(store);
    const { status, body } = await getJson(`${base}/opportunities/${OPP_A}${suffix}`);
    expect(status).toBe(404);
    expect(body).toMatchObject({ success: false });
    expect(JSON.stringify(body)).not.toMatch(/\/tmp|nofo-test|at .*\.ts/);
  });

  it('400 for a malformed opportunity ID, 404 for an unknown one', async () => {
    const { base, store } = await start();
    await seed(store);
    expect((await getJson(`${base}/opportunities/not-a-uuid/documents/${DOC_ID}/pages/1`)).status).toBe(400);
    expect((await getJson(`${base}/opportunities/${OPP_B}/documents/${DOC_ID}/pages/1`)).status).toBe(404);
  });
});

describe('GET original', () => {
  it('serves a stored PDF with safe headers', async () => {
    const { base, store } = await start();
    await seed(store);
    const r = await fetch(`${base}/opportunities/${OPP_A}/documents/${DOC_ID}/original`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-disposition')).toBe(`inline; filename="${DOC_ID}.pdf"`);
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(Buffer.from(await r.arrayBuffer()).equals(PDF_BYTES)).toBe(true);
  });

  it('404 for a document that is not a PDF, is missing, or whose file is not actually a PDF', async () => {
    const { base, store } = await start();
    await seed(store);
    expect((await fetch(`${base}/opportunities/${OPP_A}/documents/${GUIDANCE_ID}/original`)).status).toBe(404);
    expect((await fetch(`${base}/opportunities/${OPP_A}/documents/sg-test-bad-0003/original`)).status).toBe(404);
    expect((await fetch(`${base}/opportunities/${OPP_A}/documents/..%2F..%2Fx/original`)).status).toBe(404);
    // Stored bytes that are not a PDF are never served as one.
    await store.writeOriginal(OPP_A, DOC_ID, 'pdf', Buffer.from('<html><script>alert(1)</script></html>'));
    expect((await fetch(`${base}/opportunities/${OPP_A}/documents/${DOC_ID}/original`)).status).toBe(404);
  });
});

describe('POST /assess', () => {
  const message = { role: 'user', content: 'It is a capital project and we want to request $18 million.' };

  it('runs one assessment turn and returns the new facts to send back', async () => {
    const { base, store } = await start({ llm: modelStandIn({ facts: { requestedFederalUsd: { value: 18_000_000, quote: '$18 million' } } }) });
    await seed(store);
    const { status, body } = await post(`${base}/assess`, { opportunityId: OPP_A, messages: [message] });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.facts.requestedFederalUsd.value).toBe(18_000_000);
    expect(body.data.advisory.label).toBe('Preliminary assessment');
    expect(body.data.findings.every((f: any) => f.provisional)).toBe(true);
  });

  it('readMessage:false re-assesses the given facts without reading the message again', async () => {
    const llm = modelStandIn({ facts: { requestedFederalUsd: { value: 99_000_000, quote: '$18 million' } } });
    const { base, store } = await start({ llm });
    await seed(store);
    const facts = { areaType: { value: 'urban', provenance: 'user', quote: 'urban' } };
    const { status, body } = await post(`${base}/assess`, { opportunityId: OPP_A, messages: [message], facts, readMessage: false });
    expect(status).toBe(200);
    expect(body.data.facts.requestedFederalUsd).toBeUndefined();
    expect(body.data.facts.areaType.value).toBe('urban');
  });

  it.each([
    ['no body', {}],
    ['no messages', { opportunityId: OPP_A, messages: [] }],
    ['an over-long message', { opportunityId: OPP_A, messages: [{ role: 'user', content: 'x'.repeat(4001) }] }],
    ['an extra key', { opportunityId: OPP_A, messages: [message], admin: true }],
    ['a malformed opportunity ID', { opportunityId: '../../etc/passwd', messages: [message] }],
    ['invalid facts', { opportunityId: OPP_A, messages: [message], facts: { requestedFederalUsd: { value: 'lots', provenance: 'user' } } }],
    ['an assistant-only conversation', { opportunityId: OPP_A, messages: [{ role: 'assistant', content: 'hello' }] }],
  ])('400 for %s', async (_label, payload) => {
    const { base, store } = await start({ llm: modelStandIn() });
    await seed(store);
    const { status, body } = await post(`${base}/assess`, payload);
    expect(status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
  });

  it('404 with a plain message (no CLI command or path) when requirements were never extracted', async () => {
    const { base, store } = await start({ llm: modelStandIn() });
    await store.writeOpportunity(OPP_B, makeOpportunity({ opportunityId: OPP_B }));
    const { status, body } = await post(`${base}/assess`, { opportunityId: OPP_B, messages: [message] });
    expect(status).toBe(404);
    expect(body.error).toMatch(/no extracted requirements/);
    expect(body.error).not.toMatch(/npm run|nofo:/);
  });

  it('503 when the server has no model key and none is injected', async () => {
    const { base, store } = await start({ isModelConfigured: () => false });
    await seed(store);
    const { status, body } = await post(`${base}/assess`, { opportunityId: OPP_A, messages: [message] });
    expect(status).toBe(503);
    expect(body).toMatchObject({ success: false, code: 'MISSING_CONFIG' });
    expect(body.error).not.toMatch(/sk-|key=/i);
  });

  it('is rate limited, and the limit applies to assessment separately from reading', async () => {
    const { base, store } = await start({ llm: modelStandIn(), limits: { assessPerWindow: 2, readPerWindow: 50, windowMs: 60_000 } });
    await seed(store);
    const call = () => post(`${base}/assess`, { opportunityId: OPP_A, messages: [message] });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect((await getJson(`${base}/opportunities`)).status).toBe(200);
  });

  it('does not log message text or project facts', async () => {
    const { logger } = await import('../../config/config.js');
    const lines: string[] = [];
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((level) => {
      const original = (logger as any)[level];
      (logger as any)[level] = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
      return () => { (logger as any)[level] = original; };
    });
    try {
      const { base, store } = await start({ llm: modelStandIn({ facts: { requestedFederalUsd: { value: 18_000_000, quote: '$18 million' } } }) });
      await seed(store);
      await post(`${base}/assess`, { opportunityId: OPP_A, messages: [{ role: 'user', content: 'SENTINEL-TEXT we want to request $18 million.' }] });
    } finally {
      spies.forEach((restore) => restore());
    }
    expect(lines.join('\n')).not.toMatch(/SENTINEL-TEXT|18 million|18000000/);
  });
});
