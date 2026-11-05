import type { Check } from './schemas.js';

/**
 * A numeric check (a dollar amount or a percentage) is accepted only if the
 * number is actually present in the verified quote text. This catches a model
 * that cites a real sentence but states a different number.
 */

const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9 };

export function dollarAmountsIn(text: string): number[] {
  const out: number[] = [];
  const pattern = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|bn|k|m)?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const base = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(base)) out.push(base * (match[2] ? SCALE[match[2].toLowerCase()] : 1));
  }
  // "25 million dollars" written without a dollar sign.
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)\s+dollars?/gi)) {
    const base = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(base)) out.push(base * SCALE[match[2].toLowerCase()]);
  }
  return out;
}

export function percentagesIn(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** True if the check's number appears in the quotes. Categorical checks have no number and pass through. */
export function checkSupportedByQuotes(check: Check, quotes: string[]): boolean {
  const text = quotes.join('\n');
  switch (check.kind) {
    case 'amount_min':
    case 'amount_max':
      return dollarAmountsIn(text).some((amount) => Math.abs(amount - check.amountUsd) < 0.5);
    case 'federal_share_max_pct':
    case 'match_min_pct':
      return percentagesIn(text).some((pct) => Math.abs(pct - check.pct) < 1e-6);
    default:
      return true;
  }
}
