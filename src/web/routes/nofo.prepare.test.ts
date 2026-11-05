import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { WCPP_ID, fixtureSearchSource, profileLlm } from '../../nofo/__fixtures__/discovery.js';
import { RULEBOOK, reqFile } from '../../nofo/__fixtures__/assessment.js';
import { makeOpportunity, tmpStore } from '../../nofo/__fixtures__/helpers.js';
import { PrepareManager } from '../../nofo/prepare/manager.js';
import { RecentOpportunities } from '../../nofo/prepare/recent.js';
import type { PrepareStep, RunStep } from '../../nofo/prepare/runner.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createNofoRouter, type NofoRouterDeps } from './nofo.js';

const OTHER_ID = '99999999-9999-4999-8999-999999999999';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** A router wired to a temp store, a fake runner (no real process is ever started) and a real manager. */
async function start(options: { hold?: Promise<void>; dailyLimit?: number; deps?: NofoRouterDeps; configured?: boolean } = {}) {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  const recent = new RecentOpportunities();
  const calls: Array<[PrepareStep, string]> = [];
  const run: RunStep = async (step, id) => {
    calls.push([step, id]);
    if (step === 'ingest' && options.hold) await options.hold;
    if (step === 'extract') {
      await t.store.writeOpportunity(id, makeOpportunity({ opportunityId: id }));
      await t.store.writeRequirements(id, reqFile(RULEBOOK, { opportunityId: id }));
    }
    return { exitCode: 0, timedOut: false, errorLine: null };
  };
  const prepare = new PrepareManager({ store: () => t.store, run, recent, dailyLimit: options.dailyLimit ?? 5 });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/nofo',
    createNofoRouter({
      store: t.store,
      prepare,
      recent,
      isPrepareConfigured: () => options.configured !== false,
      searchSource: fixtureSearchSource(),
      llm: profileLlm({
        projectTypes: [{ type: 'wildlife_connectivity', quote: 'wildlife overpass' }],
        terms: ['wildlife crossing'],
      }),
      ...options.deps,
    })
  );
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { ...t, calls, recent, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nofo` };
}

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
};
const get = async (url: string) => {
  const r = await fetch(url);
  return { status: r.status, body: (await r.json()) as any };
};
const search = (base: string) => post(`${base}/discover`, { messages: [{ role: 'user', content: 'Our county wants a wildlife overpass on a rural highway.' }] });

async function until(base: string, id: string, done: (status: string) => boolean) {
  for (let i = 0; i < 400; i++) {
    const { body } = await get(`${base}/prepare/${id}`);
    if (done(body.data.status)) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the job did not reach the expected state');
}

describe('POST /prepare', () => {
  it('refuses an opportunity the server has not shown in a search, and runs nothing', async () => {
    const { base, calls } = await start();
    const { status, body } = await post(`${base}/prepare`, { opportunityId: WCPP_ID });
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(calls).toEqual([]);
  });

  it('accepts an opportunity after a search showed it, then reports progress until it is ready', async () => {
    const hold = gate();
    const { base, calls } = await start({ hold: hold.promise });
    expect((await search(base)).body.data.shortlist.map((s: any) => s.opportunityId)).toContain(WCPP_ID);

    const started = await post(`${base}/prepare`, { opportunityId: WCPP_ID.toUpperCase() });
    expect(started.status).toBe(200);
    expect(started.headers.get('cache-control')).toBe('no-store');
    expect(started.body.data).toMatchObject({ opportunityId: WCPP_ID, status: 'ingesting' });
    expect((await get(`${base}/prepare/${WCPP_ID}`)).body.data.status).toBe('ingesting');

    hold.open();
    const ready = await until(base, WCPP_ID, (s) => s === 'ready');
    expect(ready.requirements).toBe(RULEBOOK.length);
    expect(calls.map(([step]) => step)).toEqual(['ingest', 'extract']);

    // The prepared opportunity now shows up for assessment, and the next search says it is ready.
    const listed = await get(`${base}/opportunities`);
    expect(listed.body.data.opportunities.find((o: any) => o.opportunityId === WCPP_ID)?.requirements.ready).toBe(true);
    const again = await search(base);
    expect(again.body.data.shortlist.find((s: any) => s.opportunityId === WCPP_ID).readyToAssess).toBe(true);
  });

  it('returns "ready" for something already prepared even without a recent search or configured keys', async () => {
    const { base, store, calls } = await start({ configured: false });
    await store.writeOpportunity(OTHER_ID, makeOpportunity({ opportunityId: OTHER_ID }));
    await store.writeRequirements(OTHER_ID, reqFile(RULEBOOK, { opportunityId: OTHER_ID }));
    const { status, body } = await post(`${base}/prepare`, { opportunityId: OTHER_ID });
    expect(status).toBe(200);
    expect(body.data.status).toBe('ready');
    expect(calls).toEqual([]);
  });

  it('is a clean 503, running nothing, when the server lacks the keys preparing needs', async () => {
    const { base, calls } = await start({ configured: false });
    await search(base);
    const { status, body } = await post(`${base}/prepare`, { opportunityId: WCPP_ID });
    expect(status).toBe(503);
    expect(body.code).toBe('MISSING_CONFIG');
    expect(body.error).toMatch(/SIMPLER_GRANTS_API_KEY and ANTHROPIC_API_KEY/);
    expect(calls).toEqual([]);
  });

  it('rejects bad requests with a 400 and runs nothing', async () => {
    const { base, calls } = await start();
    await search(base);
    for (const payload of [{}, { opportunityId: 5 }, { opportunityId: 'not-a-uuid' }, { opportunityId: `${WCPP_ID}; rm -rf /` }, { opportunityId: WCPP_ID, extra: true }, []]) {
      const { status, body } = await post(`${base}/prepare`, payload);
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    }
    expect(calls).toEqual([]);
  });

  it('allows one job at a time (429, retryable) and does not start a second run for the same opportunity', async () => {
    const hold = gate();
    const { base, recent, calls } = await start({ hold: hold.promise });
    await search(base);
    recent.remember([OTHER_ID]);
    await post(`${base}/prepare`, { opportunityId: WCPP_ID });

    const busy = await post(`${base}/prepare`, { opportunityId: OTHER_ID });
    expect(busy.status).toBe(429);
    expect(busy.body.retryable).toBe(true);
    expect(busy.body.error).toMatch(/Another opportunity is being prepared/);

    const same = await post(`${base}/prepare`, { opportunityId: WCPP_ID });
    expect(same.status).toBe(200);
    expect(same.body.data.status).toBe('ingesting');
    hold.open();
    await until(base, WCPP_ID, (s) => s === 'ready');
    expect(calls.filter(([step]) => step === 'ingest')).toHaveLength(1);
  });

  it('stops at the daily limit with a non-retryable 429', async () => {
    const { base, recent } = await start({ dailyLimit: 1 });
    await search(base);
    recent.remember([OTHER_ID]);
    await post(`${base}/prepare`, { opportunityId: WCPP_ID });
    await until(base, WCPP_ID, (s) => s === 'ready');
    const limited = await post(`${base}/prepare`, { opportunityId: OTHER_ID });
    expect(limited.status).toBe(429);
    expect(limited.body.retryable).toBe(false);
    expect(limited.body.error).toMatch(/daily limit/);
  });

  it('is rate limited separately from reads', async () => {
    const { base } = await start({ deps: { limits: { preparePerWindow: 2, windowMs: 60_000 } } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await post(`${base}/prepare`, { opportunityId: OTHER_ID })).status);
    expect(statuses).toEqual([404, 404, 429]);
    expect((await get(`${base}/opportunities`)).status).toBe(200);
  });
});

describe('GET /prepare/:id', () => {
  it('is "idle", not an error, for an opportunity nothing has been done for', async () => {
    const { base } = await start();
    const { status, body } = await get(`${base}/prepare/${OTHER_ID}`);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: 'idle', requirements: null });
  });

  it('rejects an ID that is not a UUID', async () => {
    const { base } = await start();
    expect((await get(`${base}/prepare/not-a-uuid`)).status).toBe(400);
    expect((await get(`${base}/prepare/..%2F..%2Fetc`)).status).toBe(400);
  });
});
