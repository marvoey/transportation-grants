import { afterEach, describe, expect, it } from 'vitest';
import { RULEBOOK, reqFile } from '../__fixtures__/assessment.js';
import { makeOpportunity, tmpStore } from '../__fixtures__/helpers.js';
import { PackageStore } from '../store.js';
import { PrepareError, PrepareManager } from './manager.js';
import { RecentOpportunities } from './recent.js';
import type { PrepareStep, RunStep, StepResult } from './runner.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ok: StepResult = { exitCode: 0, timedOut: false, errorLine: null };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** A promise a test can settle later, to hold a step "in progress". */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function writeReqs(store: PackageStore, id: string, status: 'complete' | 'partial' = 'complete') {
  await store.writeOpportunity(id, makeOpportunity({ opportunityId: id }));
  await store.writeRequirements(id, reqFile(RULEBOOK, { opportunityId: id, status }));
}

interface Harness {
  manager: PrepareManager;
  store: PackageStore;
  calls: Array<[PrepareStep, string]>;
  recent: RecentOpportunities;
}

/** The default fake: ingest succeeds; extract writes a complete requirements file. */
async function harness(options: {
  run?: (step: PrepareStep, id: string, store: PackageStore) => Promise<StepResult>;
  dailyLimit?: number;
  now?: () => Date;
  shown?: string[];
} = {}): Promise<Harness> {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  const recent = new RecentOpportunities();
  recent.remember(options.shown ?? [A, B]);
  const calls: Array<[PrepareStep, string]> = [];
  const run: RunStep = async (step, id) => {
    calls.push([step, id]);
    if (options.run) return options.run(step, id, t.store);
    if (step === 'extract') await writeReqs(t.store, id);
    return ok;
  };
  const manager = new PrepareManager({ store: () => t.store, run, recent, dailyLimit: options.dailyLimit ?? 5, now: options.now });
  return { manager, store: t.store, calls, recent };
}

async function settled(manager: PrepareManager, id: string) {
  for (let i = 0; i < 400; i++) {
    const state = await manager.status(id);
    if (state.status !== 'ingesting' && state.status !== 'extracting') return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the job did not finish');
}

describe('starting', () => {
  it('returns "ready" at once, runs nothing, and needs no allow-list when requirements already exist', async () => {
    const h = await harness({ shown: [] });
    await writeReqs(h.store, A);
    const state = await h.manager.start(A);
    expect(state.status).toBe('ready');
    expect(state.requirements).toBe(RULEBOOK.length);
    expect(h.calls).toEqual([]);
  });

  it('refuses an opportunity that was not shown in a recent search, and runs nothing', async () => {
    const h = await harness({ shown: [] });
    await expect(h.manager.start(A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.calls).toEqual([]);
  });

  it('rejects something that is not a UUID', async () => {
    const h = await harness();
    await expect(h.manager.start('../../etc')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(h.manager.status('nope')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('runs ingest, then extract, and reports each stage while it works', async () => {
    const hold = gate();
    const h = await harness({
      run: async (step, id, store) => {
        if (step === 'ingest') await hold.promise;
        else await writeReqs(store, id);
        return ok;
      },
    });
    const started = await h.manager.start(A);
    expect(started.status).toBe('ingesting');
    expect(started.message).toMatch(/Downloading the official documents/);
    expect((await h.manager.status(A)).status).toBe('ingesting');
    hold.open();
    const done = await settled(h.manager, A);
    expect(done.status).toBe('ready');
    expect(done.requirements).toBe(RULEBOOK.length);
    expect(done.partial).toBe(false);
    expect(done.startedAt).not.toBeNull();
    expect(h.calls).toEqual([['ingest', A], ['extract', A]]);
  });

  it('shows the extraction stage while the model is working', async () => {
    const hold = gate();
    const h = await harness({
      run: async (step, id, store) => {
        if (step === 'extract') {
          await hold.promise;
          await writeReqs(store, id);
        }
        return ok;
      },
    });
    await h.manager.start(A);
    for (let i = 0; i < 200 && (await h.manager.status(A)).status !== 'extracting'; i++) await new Promise((r) => setTimeout(r, 5));
    const mid = await h.manager.status(A);
    expect(mid.status).toBe('extracting');
    expect(mid.message).toMatch(/language model/);
    hold.open();
    expect((await settled(h.manager, A)).status).toBe('ready');
  });
});

describe('safeguards', () => {
  it('allows one job at a time', async () => {
    const hold = gate();
    const h = await harness({
      run: async (step, id, store) => {
        if (step === 'ingest') await hold.promise;
        if (step === 'extract') await writeReqs(store, id);
        return ok;
      },
    });
    await h.manager.start(A);
    await expect(h.manager.start(B)).rejects.toMatchObject({ code: 'BUSY' });
    hold.open();
    await settled(h.manager, A);
    expect((await h.manager.start(B)).status).toBe('ingesting');
  });

  it('returns the running job when the same opportunity is requested again, without a second run', async () => {
    const hold = gate();
    const h = await harness({
      run: async (step, id, store) => {
        if (step === 'ingest') await hold.promise;
        if (step === 'extract') await writeReqs(store, id);
        return ok;
      },
    });
    await h.manager.start(A);
    const again = await h.manager.start(A);
    expect(again.status).toBe('ingesting');
    hold.open();
    await settled(h.manager, A);
    expect(h.calls.filter(([s]) => s === 'ingest')).toHaveLength(1);
  });

  it('stops at the daily limit, and starts counting again the next day', async () => {
    let now = new Date('2026-11-05T10:00:00Z');
    const h = await harness({ dailyLimit: 1, now: () => now });
    await h.manager.start(A);
    await settled(h.manager, A);
    await expect(h.manager.start(B)).rejects.toMatchObject({ code: 'DAILY_LIMIT' });
    now = new Date('2026-11-06T00:30:00Z');
    expect((await h.manager.start(B)).status).toBe('ingesting');
  });

  it('does not count an already-prepared opportunity against the daily limit', async () => {
    const h = await harness({ dailyLimit: 1 });
    await writeReqs(h.store, A);
    await h.manager.start(A);
    expect((await h.manager.start(B)).status).toBe('ingesting');
  });

  it('refusals are PrepareError instances the route can translate', async () => {
    const h = await harness({ shown: [] });
    await expect(h.manager.start(A)).rejects.toBeInstanceOf(PrepareError);
  });
});

describe('failures are reported plainly and do not wedge the manager', () => {
  it('shows the CLI\'s own error message when ingestion fails, and does not run extraction', async () => {
    const h = await harness({ run: async () => ({ exitCode: 2, timedOut: false, errorLine: 'Opportunity not found on Simpler.Grants.gov (HTTP 404).' }) });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('failed');
    expect(state.failedStep).toBe('ingest');
    expect(state.error).toBe('Opportunity not found on Simpler.Grants.gov (HTTP 404).');
    expect(h.calls).toEqual([['ingest', A]]);
  });

  it('says no document could be read when ingestion finds nothing parseable (exit 3)', async () => {
    const h = await harness({ run: async () => ({ exitCode: 3, timedOut: false, errorLine: null }) });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/No document for this opportunity could be read/);
    expect(h.calls).toEqual([['ingest', A]]);
  });

  it('uses a generic message, never process output, when a step fails without an error line', async () => {
    const h = await harness({
      run: async (step) => (step === 'ingest' ? ok : { exitCode: 2, timedOut: false, errorLine: null }),
    });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('failed');
    expect(state.failedStep).toBe('extract');
    expect(state.error).toMatch(/Preparing this opportunity failed/);
  });

  it('reports a timeout', async () => {
    const h = await harness({ run: async () => ({ exitCode: null, timedOut: true, errorLine: null }) });
    await h.manager.start(A);
    expect((await settled(h.manager, A)).error).toMatch(/took too long/);
  });

  it('treats a step that throws as a generic failure with no detail leaked', async () => {
    const h = await harness({
      run: async () => {
        throw new Error('internal detail with secret-token');
      },
    });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('failed');
    expect(JSON.stringify(state)).not.toContain('secret-token');
  });

  it('frees the manager after a failure, so another opportunity (or a retry) can run', async () => {
    let fail = true;
    const h = await harness({
      run: async (step, id, store) => {
        if (fail) return { exitCode: 2, timedOut: false, errorLine: 'Error text' };
        if (step === 'extract') await writeReqs(store, id);
        return ok;
      },
    });
    await h.manager.start(A);
    expect((await settled(h.manager, A)).status).toBe('failed');
    fail = false;
    expect((await h.manager.start(A)).status).toBe('ingesting');
    expect((await settled(h.manager, A)).status).toBe('ready');
  });

  it('is "ready" but flagged partial when extraction wrote requirements yet did not cover every document (exit 3)', async () => {
    const h = await harness({
      run: async (step, id, store) => {
        if (step === 'extract') {
          await writeReqs(store, id, 'partial');
          return { exitCode: 3, timedOut: false, errorLine: null };
        }
        return ok;
      },
    });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('ready');
    expect(state.partial).toBe(true);
    expect(state.message).toMatch(/incomplete/);
  });

  it('is not "ready" when extraction claims success but wrote no requirements', async () => {
    const h = await harness({ run: async () => ok });
    await h.manager.start(A);
    const state = await settled(h.manager, A);
    expect(state.status).toBe('failed');
    expect(state.failedStep).toBe('extract');
  });
});

describe('status', () => {
  it('is "idle" for an opportunity nothing has been done for', async () => {
    const h = await harness();
    const state = await h.manager.status(A);
    expect(state).toMatchObject({ status: 'idle', requirements: null, error: null });
  });

  it('re-derives "ready" from disk even if this process never ran the job (for example after a restart)', async () => {
    const h = await harness();
    await writeReqs(h.store, B);
    expect((await h.manager.status(B)).status).toBe('ready');
  });
});
