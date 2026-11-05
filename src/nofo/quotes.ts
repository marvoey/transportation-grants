import { matchKey } from './ingest/normalize.js';

/** Length of the longest common substring of two strings (O(n*m), fine for quote-sized inputs). */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Do two quotes point at the same passage?
 *  - strict (used to MERGE duplicate candidates): one contains the other, or
 *    they share at least 85% of the shorter quote. Strict so that two
 *    neighbouring sentences that start the same way (for example an urban and
 *    a rural threshold) are not merged.
 *  - loose (used to MATCH extracted requirements to a reference set): one
 *    contains the other, or they share at least half of the shorter quote
 *    (and at least 25 characters when the shorter quote is that long).
 * Comparison is on letters and digits only, so line breaks, hyphenation and
 * punctuation from PDF extraction do not matter.
 */
export function quotesOverlap(a: string, b: string, mode: 'strict' | 'loose'): boolean {
  const keyA = matchKey(a);
  const keyB = matchKey(b);
  if (!keyA || !keyB) return false;
  if (keyA.includes(keyB) || keyB.includes(keyA)) return true;
  const shorter = Math.min(keyA.length, keyB.length);
  const common = longestCommonSubstring(keyA, keyB);
  return mode === 'strict' ? common >= 0.85 * shorter : common >= Math.max(0.5 * shorter, Math.min(shorter, 25));
}
