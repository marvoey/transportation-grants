import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { HomeStatsSchema } from '../nofo/stats.js';

// The browser script is a plain script that attaches window.HomeStats. Load it the way a page would (no document).
const sandbox: Record<string, unknown> = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(process.cwd(), 'public/js/home-stats.js'), 'utf-8'), sandbox);
const H = sandbox.HomeStats as any;

const STATS = { asOf: '2026-11-11T22:17:52.230Z', everPublished: 83505, closedOrArchived: 82055, openOrForecasted: 1450, open: 861, forecasted: 589, agencyOffices: 153, topLevelAgencies: 25, openToLocalGovernments: 839, dot: 11 };

describe('home page numbers', () => {
  it('formats whole numbers with thousands separators', () => {
    expect(H.formatInt(83505)).toBe('83,505');
    expect(H.formatInt(11)).toBe('11');
  });

  it('builds the five tiles from the stats, with the exact figures and plain wording', () => {
    const tiles = H.tiles(STATS);
    expect(tiles.map((t: any) => t.key)).toEqual(['open', 'agencies', 'local', 'dot', 'ever']);
    expect(tiles.map((t: any) => t.value)).toEqual([1450, 25, 839, 11, 83505]);
    expect(tiles[0].note).toBe('861 open for applications · 589 forecasted');
    expect(tiles[1].note).toBe('153 agency offices in all');
    expect(tiles[2].note).toBe('58% of the total: filtering by applicant type alone still leaves most of the list');
    expect(tiles[3].note).toBe('The other 1,439 are published by other agencies');
    expect(tiles[4].note).toMatch(/^82,055 are closed or archived/);
  });

  it('only says an applicant-type filter leaves most of the list when that is true', () => {
    expect(H.tiles({ ...STATS, openToLocalGovernments: 100 })[2].note).toBe('7% of the open and forecasted opportunities');
    expect(H.tiles({ ...STATS, openToLocalGovernments: 725 })[2].note).toMatch(/^50% of the total: filtering by applicant type alone still leaves most of the list$/);
  });

  it('never claims a time or cost figure', () => {
    const text = JSON.stringify(H.tiles(STATS));
    expect(text).not.toMatch(/\bhours?\b|\bdays?\b|\bsaves?\b|\$/i);
  });

  it('says where the numbers come from, and says so when they are a saved count', () => {
    expect(H.describeSource({ source: 'live', stats: STATS })).toMatch(/^Counts reported by Simpler\.Grants\.gov as of /);
    expect(H.describeSource({ source: 'snapshot', stats: STATS })).toMatch(/^Saved count from /);
  });

  it('copes with nothing open, without dividing by zero', () => {
    const tiles = H.tiles({ ...STATS, openOrForecasted: 0, open: 0, forecasted: 0, openToLocalGovernments: 0, dot: 0 });
    expect(tiles[2].note).toBe('0% of the open and forecasted opportunities');
    expect(tiles[3].note).toBe('The other 0 are published by other agencies');
  });

  it('matches the shape the server validates', () => {
    expect(HomeStatsSchema.safeParse(STATS).success).toBe(true);
    expect(HomeStatsSchema.safeParse({ ...STATS, extra: 1 }).success).toBe(false);
  });
});
