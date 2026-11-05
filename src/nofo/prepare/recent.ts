import { UUID_PATTERN } from '../schemas.js';

/**
 * Opportunities the server itself showed in a recent search. The prepare route accepts only these (or ones
 * already prepared), so it cannot be used to make the server download and read arbitrary opportunities, or to
 * spend model calls on IDs a person made up.
 */
export class RecentOpportunities {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly maxEntries = 500,
    private readonly clock: () => number = Date.now
  ) {}

  remember(ids: string[]): void {
    const now = this.clock();
    for (const raw of ids) {
      const id = String(raw).toLowerCase();
      if (!UUID_PATTERN.test(id)) continue;
      this.seen.delete(id); // re-insert so the oldest entry is always first
      this.seen.set(id, now + this.ttlMs);
    }
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  has(id: string): boolean {
    const key = String(id).toLowerCase();
    const expires = this.seen.get(key);
    if (expires === undefined) return false;
    if (expires <= this.clock()) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }
}
