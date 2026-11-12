import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeStatsService, type HomeStats } from '../../nofo/stats.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createNofoRouter } from './nofo.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start(homeStats: HomeStatsService) {
  const app = express();
  app.use(express.json());
  app.use('/api/nofo', createNofoRouter({ homeStats }));
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nofo`;
}

const STATS: HomeStats = { asOf: '2026-11-11T00:00:00.000Z', everPublished: 5, closedOrArchived: 3, openOrForecasted: 2, open: 1, forecasted: 1, agencyOffices: 2, topLevelAgencies: 1, openToLocalGovernments: 1, dot: 1 };
const fakeService = (view: Awaited<ReturnType<HomeStatsService['get']>>) => ({ get: async () => view }) as unknown as HomeStatsService;

describe('GET /stats', () => {
  it('returns the numbers in the standard envelope, uncached', async () => {
    const base = await start(fakeService({ stats: STATS, source: 'live' }));
    const response = await fetch(`${base}/stats`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: { stats: STATS, source: 'live' } });
  });

  it('says plainly that the statistics are not available when there is neither a count nor a snapshot', async () => {
    const base = await start(fakeService(null));
    const response = await fetch(`${base}/stats`);
    const body: any = await response.json();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not available right now/);
    expect(body.retryable).toBe(true);
  });
});
