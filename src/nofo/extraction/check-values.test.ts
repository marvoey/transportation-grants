import { describe, expect, it } from 'vitest';
import { checkSupportedByQuotes, dollarAmountsIn, percentagesIn } from './check-values.js';
import type { Check } from './schemas.js';

const any = { areaType: 'any', grantCategory: 'any' } as const;

describe('number extraction', () => {
  it('reads dollar amounts with scale words, commas and no sign', () => {
    expect(dollarAmountsIn('at least $5 million and up to $25 million')).toEqual([5_000_000, 25_000_000]);
    expect(dollarAmountsIn('a total of $1,500,000,000 or $1.5 billion')).toEqual([1_500_000_000, 1_500_000_000]);
    expect(dollarAmountsIn('$239,000 to $25 million')).toEqual([239_000, 25_000_000]);
    expect(dollarAmountsIn('25 million dollars')).toEqual([25_000_000]);
    expect(dollarAmountsIn('no amounts here')).toEqual([]);
  });
  it('reads percentages', () => {
    expect(percentagesIn('not exceed 80 percent; up to 100% federal; 12.5 percent')).toEqual([80, 100, 12.5]);
  });
});

describe('checkSupportedByQuotes', () => {
  it('accepts an amount that is in the quote', () => {
    const check: Check = { kind: 'amount_min', amountUsd: 5_000_000, appliesTo: any };
    expect(checkSupportedByQuotes(check, ['must request at least $5 million in funding'])).toBe(true);
  });

  it('rejects an amount that is not in the quote (a real sentence with a different number)', () => {
    const check: Check = { kind: 'amount_min', amountUsd: 10_000_000, appliesTo: any };
    expect(checkSupportedByQuotes(check, ['must request at least $5 million in funding'])).toBe(false);
  });

  it('considers all quotes together', () => {
    const check: Check = { kind: 'amount_max', amountUsd: 25_000_000, appliesTo: any };
    expect(checkSupportedByQuotes(check, ['unrelated sentence', 'the maximum request is $25 million'])).toBe(true);
  });

  it('checks percentages', () => {
    const share: Check = { kind: 'federal_share_max_pct', pct: 80, appliesTo: any };
    expect(checkSupportedByQuotes(share, ['shall not exceed 80 percent'])).toBe(true);
    expect(checkSupportedByQuotes({ ...share, pct: 90 }, ['shall not exceed 80 percent'])).toBe(false);
  });

  it('passes categorical checks through (no number to verify)', () => {
    expect(checkSupportedByQuotes({ kind: 'document_required', documentKey: 'bca' }, ['anything'])).toBe(true);
    expect(checkSupportedByQuotes({ kind: 'applicant_type_in', values: ['state'] }, ['anything'])).toBe(true);
  });
});
