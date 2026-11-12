import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SearchRequestBody, SearchResult } from './simpler/search.js';
import type { OpportunitySearchSource } from './simpler/source.js';
import { HomeStatsSchema, HomeStatsService, computeHomeStats, topLevelOf, type HomeStats } from './stats.js';

const result = (totalRecords: number | null, facets: Record<string, Record<string, number>>): SearchResult => ({
  candidates: [],
  totalRecords,
  skipped: 0,
  raw: { facet_counts: facets },
});

/** A Simpler.Grants.gov that answers the four home page questions the way the real one does. */
function fakeSimpler(overrides: { fail?: boolean } = {}) {
  const bodies: SearchRequestBody[] = [];
  const source: OpportunitySearchSource & { bodies: SearchRequestBody[] } = {
    bodies,
    async searchOpportunities(body) {
      bodies.push(body);
      if (overrides.fail) throw new Error('down');
      const f = body.filters;
      if (!f) {
        // Unfiltered: total_records is capped upstream at 10,000, so the status counts are the real totals.
        return result(10000, { opportunity_status: { archived: 700, closed: 100, forecasted: 20, posted: 30 } });
      }
      if (f.top_level_agency) return result(11, {});
      if (f.applicant_type) return result(120, {});
      return result(50, { opportunity_status: { posted: 30, forecasted: 20 }, agency: { 'DOT-FHWA': 3, 'DOT-FTA': 2, 'EPA-OW': 4, HUD: 1, 'DOE-EERE': 5 } });
    },
  };
  return source;
}

const NOW = new Date('2026-11-11T12:00:00Z');

describe('topLevelOf', () => {
  it('takes the part of an agency code before the first hyphen', () => {
    expect(topLevelOf('DOT-FHWA')).toBe('DOT');
    expect(topLevelOf('HUD')).toBe('HUD');
    expect(topLevelOf('DHS-DHS')).toBe('DHS');
  });
});

describe('computeHomeStats', () => {
  it('turns the four answers into the numbers, using the status counts for the all-time total', async () => {
    const stats = await computeHomeStats(fakeSimpler(), NOW);
    expect(stats).toEqual({
      asOf: NOW.toISOString(),
      everPublished: 850, // not the capped 10,000
      closedOrArchived: 800,
      openOrForecasted: 50,
      open: 30,
      forecasted: 20,
      agencyOffices: 5,
      topLevelAgencies: 4, // DOT, EPA, HUD, DOE
      openToLocalGovernments: 120,
      dot: 11,
    });
    expect(HomeStatsSchema.safeParse(stats).success).toBe(true);
  });

  it('asks for one result per question, never a whole listing page', async () => {
    const source = fakeSimpler();
    await computeHomeStats(source, NOW);
    expect(source.bodies).toHaveLength(4);
    for (const body of source.bodies) expect(body.pagination.page_size).toBe(1);
    expect(source.bodies.some((b) => b.filters?.applicant_type?.one_of.includes('county_governments'))).toBe(true);
  });

  it('fails, rather than inventing a number, when a response has no facet counts or no total', async () => {
    const noFacets: OpportunitySearchSource = { searchOpportunities: async () => ({ candidates: [], totalRecords: 1, skipped: 0, raw: {} }) };
    await expect(computeHomeStats(noFacets, NOW)).rejects.toThrow(/facet counts/);
    const noTotal: OpportunitySearchSource = { searchOpportunities: async () => result(null, { opportunity_status: {}, agency: {} }) };
    await expect(computeHomeStats(noTotal, NOW)).rejects.toThrow(/no total/);
  });
});

describe('HomeStatsService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  });

  const SNAPSHOT: HomeStats = { asOf: '2026-11-01T00:00:00.000Z', everPublished: 1, closedOrArchived: 1, openOrForecasted: 2, open: 1, forecasted: 1, agencyOffices: 1, topLevelAgencies: 1, openToLocalGovernments: 1, dot: 1 };
  async function snapshotFile(content: unknown = SNAPSHOT): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stats-'));
    dirs.push(dir);
    const path = join(dir, 'snapshot.json');
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  it('answers at once from the saved snapshot, then from the live count once it has finished', async () => {
    const source = fakeSimpler();
    const service = new HomeStatsService({ source: () => source, configured: () => true, snapshotPath: await snapshotFile(), now: () => NOW });
    const first = await service.get();
    expect(first).toEqual({ stats: SNAPSHOT, source: 'snapshot' });
    await service.refresh();
    const second = await service.get();
    expect(second?.source).toBe('live');
    expect(second?.stats.openOrForecasted).toBe(50);
  });

  it('counts once per freshness time, however many visitors arrive', async () => {
    const source = fakeSimpler();
    let now = 0;
    const service = new HomeStatsService({ source: () => source, configured: () => true, ttlMs: 1000, clock: () => now, now: () => NOW });
    await service.get();
    await service.refresh();
    const afterFirst = source.bodies.length;
    expect(afterFirst).toBe(4);
    await service.get();
    await service.get();
    expect(source.bodies.length).toBe(afterFirst); // still fresh
    now = 5000;
    await service.get();
    await service.refresh();
    expect(source.bodies.length).toBe(afterFirst + 4); // stale: one more count, not one per visitor
  });

  it('keeps showing the last good count when a refresh fails, and does not retry at once', async () => {
    let failing = false;
    const good = fakeSimpler();
    const bad = fakeSimpler({ fail: true });
    let now = 0;
    const service = new HomeStatsService({ source: () => (failing ? bad : good), configured: () => true, ttlMs: 1000, retryAfterMs: 60_000, clock: () => now, now: () => NOW });
    await service.get();
    await service.refresh();
    failing = true;
    now = 5000;
    await service.get();
    await service.refresh();
    expect((await service.get())?.stats.openOrForecasted).toBe(50);
    const attempts = bad.bodies.length;
    await service.get();
    await service.refresh();
    expect(bad.bodies.length).toBe(attempts); // inside the wait after a failure
  });

  it('serves the snapshot and makes no request when no API key is configured', async () => {
    const source = fakeSimpler();
    const service = new HomeStatsService({ source: () => source, configured: () => false, snapshotPath: await snapshotFile() });
    expect((await service.get())?.source).toBe('snapshot');
    await service.refresh();
    expect(source.bodies).toHaveLength(0);
  });

  it('returns nothing, rather than made-up numbers, when there is no count and no usable snapshot', async () => {
    const none = new HomeStatsService({ source: () => fakeSimpler({ fail: true }), configured: () => true });
    expect(await none.get()).toBeNull();
    const damaged = new HomeStatsService({ source: () => fakeSimpler({ fail: true }), configured: () => false, snapshotPath: await snapshotFile('{"everPublished": "lots"}') });
    expect(await damaged.get()).toBeNull();
    const missing = new HomeStatsService({ source: () => fakeSimpler({ fail: true }), configured: () => false, snapshotPath: '/nonexistent/stats.json' });
    expect(await missing.get()).toBeNull();
  });
});
