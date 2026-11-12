import { readFile } from 'fs/promises';
import { z } from 'zod';
import { logger } from '../config/config.js';
import type { SearchRequestBody } from './simpler/search.js';
import type { OpportunitySearchSource } from './simpler/source.js';

/**
 * The numbers on the home page: how big the funding landscape is that a person would otherwise screen by hand. Every
 * figure is a count Simpler.Grants.gov itself reports (nothing is estimated, and no time or cost is claimed).
 *
 * Counts come from the search endpoint's facet counts. The unfiltered `total_records` is capped at 10,000 upstream, so
 * the all-time total is the sum of the four status counts instead.
 */

const Count = z.number().int().nonnegative();

export const HomeStatsSchema = z
  .object({
    /** When Simpler.Grants.gov reported these numbers (ISO time). */
    asOf: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'asOf must be a date'),
    /** Every opportunity ever published there: open, forecasted, closed and archived. */
    everPublished: Count,
    closedOrArchived: Count,
    /** Posted and forecasted together: what can still be applied for, or is about to open. */
    openOrForecasted: Count,
    open: Count,
    forecasted: Count,
    /** Distinct agency codes (offices) among the open and forecasted listings. */
    agencyOffices: Count,
    /** Distinct top-level agencies: the part of the agency code before the first hyphen. */
    topLevelAgencies: Count,
    /** Open or forecasted listings that name state, county or city/township governments as eligible applicants. */
    openToLocalGovernments: Count,
    /** Open or forecasted listings from the U.S. Department of Transportation. */
    dot: Count,
  })
  .strict();
export type HomeStats = z.infer<typeof HomeStatsSchema>;

export interface HomeStatsView {
  stats: HomeStats;
  /** 'live' = counted by this server from the API (possibly some hours ago); 'snapshot' = the saved file. */
  source: 'live' | 'snapshot';
}

const OPEN: NonNullable<SearchRequestBody['filters']> = { opportunity_status: { one_of: ['posted', 'forecasted'] } };
const LOCAL_GOVERNMENTS = ['state_governments', 'county_governments', 'city_or_township_governments'];
const PAGE_OF_ONE: SearchRequestBody['pagination'] = { page_offset: 1, page_size: 1, sort_order: [{ order_by: 'post_date', sort_direction: 'descending' }] };

const FacetEnvelope = z.object({ facet_counts: z.record(z.string(), z.record(z.string(), z.number())) });
type Facets = Record<string, Record<string, number>>;

function facetsOf(raw: unknown): Facets {
  const parsed = FacetEnvelope.safeParse(raw);
  if (!parsed.success) throw new Error('The search response had no facet counts.');
  return parsed.data.facet_counts;
}

const sum = (counts: Record<string, number> | undefined, keys: string[]): number => keys.reduce((n, k) => n + (counts?.[k] ?? 0), 0);

/** The top-level agency of an agency code such as "DOT-FHWA" (or "EPA" on its own). */
export const topLevelOf = (agencyCode: string): string => agencyCode.split('-')[0];

/** Asks Simpler.Grants.gov four small questions (one result each) and turns the answers into the numbers above. */
export async function computeHomeStats(source: OpportunitySearchSource, now: Date = new Date()): Promise<HomeStats> {
  const ask = (filters?: SearchRequestBody['filters']) => source.searchOpportunities({ ...(filters ? { filters } : {}), pagination: PAGE_OF_ONE });
  const [everything, open, local, dot] = await Promise.all([
    ask(),
    ask(OPEN),
    ask({ ...OPEN, applicant_type: { one_of: LOCAL_GOVERNMENTS } }),
    ask({ ...OPEN, top_level_agency: { one_of: ['DOT'] } }),
  ]);

  const allStatus = facetsOf(everything.raw).opportunity_status;
  const openFacets = facetsOf(open.raw);
  const offices = Object.keys(openFacets.agency ?? {});
  if (open.totalRecords === null || local.totalRecords === null || dot.totalRecords === null) {
    throw new Error('A search response had no total.');
  }

  return HomeStatsSchema.parse({
    asOf: now.toISOString(),
    everPublished: sum(allStatus, ['posted', 'forecasted', 'closed', 'archived']),
    closedOrArchived: sum(allStatus, ['closed', 'archived']),
    openOrForecasted: open.totalRecords,
    open: sum(openFacets.opportunity_status, ['posted']),
    forecasted: sum(openFacets.opportunity_status, ['forecasted']),
    agencyOffices: offices.length,
    topLevelAgencies: new Set(offices.map(topLevelOf)).size,
    openToLocalGovernments: local.totalRecords,
    dot: dot.totalRecords,
  });
}

export interface HomeStatsDeps {
  source: () => OpportunitySearchSource;
  /** False when no API key is configured: the saved snapshot is served and no refresh is attempted. */
  configured: () => boolean;
  /** A small saved copy of an earlier answer, used until the first refresh succeeds or when the API is down. */
  snapshotPath?: string;
  /** How long a refreshed answer is considered fresh. */
  ttlMs?: number;
  /** After a failed refresh, how long to wait before trying again. */
  retryAfterMs?: number;
  clock?: () => number;
  now?: () => Date;
}

/**
 * Serves the home page numbers without ever making a visitor wait on Simpler.Grants.gov: it answers at once from its
 * last good count (or the saved snapshot), and refreshes in the background when that count is older than the freshness
 * time. One refresh runs at a time, and a failed one is not retried for a few minutes.
 */
export class HomeStatsService {
  private cached: { stats: HomeStats; at: number } | null = null;
  private inflight: Promise<void> | null = null;
  private lastFailureAt: number | null = null;
  private snapshot: Promise<HomeStats | null> | null = null;

  constructor(private readonly deps: HomeStatsDeps) {}

  private get ttlMs(): number {
    return this.deps.ttlMs ?? 6 * 60 * 60 * 1000;
  }
  private get retryAfterMs(): number {
    return this.deps.retryAfterMs ?? 5 * 60 * 1000;
  }
  private clock(): number {
    return (this.deps.clock ?? Date.now)();
  }

  /** The numbers to show now, or null when there is neither a count nor a snapshot. */
  async get(): Promise<HomeStatsView | null> {
    const fresh = this.cached !== null && this.clock() - this.cached.at < this.ttlMs;
    if (!fresh) void this.refresh();
    if (this.cached) return { stats: this.cached.stats, source: 'live' };
    const snapshot = await this.loadSnapshot();
    return snapshot ? { stats: snapshot, source: 'snapshot' } : null;
  }

  /** Starts a refresh unless one is running, none is possible, or one failed a moment ago. Resolves when it has finished. */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.deps.configured()) return Promise.resolve();
    if (this.lastFailureAt !== null && this.clock() - this.lastFailureAt < this.retryAfterMs) return Promise.resolve();
    this.inflight = (async () => {
      try {
        const stats = await computeHomeStats(this.deps.source(), (this.deps.now ?? (() => new Date()))());
        this.cached = { stats, at: this.clock() };
        this.lastFailureAt = null;
      } catch {
        // Never logged with the cause: it is only a count that could not be refreshed.
        this.lastFailureAt = this.clock();
        logger.warn('Home page statistics could not be refreshed; the last saved numbers are shown.');
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private loadSnapshot(): Promise<HomeStats | null> {
    const path = this.deps.snapshotPath;
    if (!path) return Promise.resolve(null);
    this.snapshot ??= readFile(path, 'utf8')
      .then((text) => HomeStatsSchema.parse(JSON.parse(text)))
      .catch(() => null);
    return this.snapshot;
  }
}
