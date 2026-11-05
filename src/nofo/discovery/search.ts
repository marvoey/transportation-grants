import type { OpportunitySearchSource } from '../simpler/source.js';
import type { SearchCandidate, SearchResult } from '../simpler/search.js';
import type { SearchPlan } from './filters.js';

/** Small in-memory cache for search responses (keeps repeat turns under the API's per-minute limit). */
export class SearchCache {
  private readonly entries = new Map<string, { at: number; value: SearchResult }>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 100,
    private readonly clock: () => number = Date.now
  ) {}

  get(key: string): SearchResult | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.clock() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: SearchResult): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: this.clock(), value });
  }
}

export interface PlanOutcome {
  plan: SearchPlan;
  result: SearchResult | null;
  /** Set when this search failed. The message is safe to show (no key, no response content). */
  error: string | null;
  /** True when the answer came from the in-memory cache and no request was sent. */
  cached: boolean;
  /** How long the request took (0 when it came from the cache). */
  elapsedMs: number;
}

export interface PlanHooks {
  /** Called just before a request is sent (or the cache is read). */
  onStart?: (plan: SearchPlan) => void;
  /** Called when that search has finished, successfully or not. */
  onDone?: (outcome: PlanOutcome) => void;
}

/**
 * Runs searches in parallel. One failing search does not discard the others; the caller decides what to do
 * when all of them failed. The hooks exist so the progress display can report what is really happening.
 */
export async function runPlans(
  source: OpportunitySearchSource,
  plans: SearchPlan[],
  cache?: SearchCache,
  hooks: PlanHooks = {},
  needRaw = false
): Promise<PlanOutcome[]> {
  return Promise.all(
    plans.map(async (plan): Promise<PlanOutcome> => {
      hooks.onStart?.(plan);
      const outcome = await runOne(source, plan, cache, needRaw);
      hooks.onDone?.(outcome);
      return outcome;
    })
  );
}

async function runOne(source: OpportunitySearchSource, plan: SearchPlan, cache: SearchCache | undefined, needRaw: boolean): Promise<PlanOutcome> {
  const key = JSON.stringify(plan.body);
  const hit = cache?.get(key);
  // A cached answer is only reused for inspection if it still has the raw response (raw bodies are kept in the cache
  // only when someone asked to inspect them, to keep memory small).
  if (hit && (!needRaw || hit.raw !== undefined)) return { plan, result: hit, error: null, cached: true, elapsedMs: 0 };
  const started = Date.now();
  try {
    const result = await source.searchOpportunities(plan.body);
    cache?.set(key, needRaw ? result : { ...result, raw: undefined });
    return { plan, result, error: null, cached: false, elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error && error.name === 'SimplerApiError' ? error.message : 'The search failed unexpectedly.';
    return { plan, result: null, error: message, cached: false, elapsedMs: Date.now() - started };
  }
}

export function mergeCandidates(outcomes: PlanOutcome[]): SearchCandidate[] {
  return outcomes.flatMap((o) => o.result?.candidates ?? []);
}
