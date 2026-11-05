import { describe, expect, it } from 'vitest';
import { deriveArithmetic, formatUsd } from './arithmetic.js';
import { facts } from '../__fixtures__/assessment.js';

describe('deriveArithmetic', () => {
  it('the guide scenario: $18M + $7M = $25M, a 72 percent federal share, consistent', () => {
    const d = deriveArithmetic(facts({ requestedFederalUsd: 18_000_000, nonFederalMatchUsd: 7_000_000, totalProjectCostUsd: 25_000_000 }));
    expect(d.federalSharePct).toBe(72);
    expect(d.nonFederalSharePct).toBe(28);
    expect(d.impliedTotalUsd).toBe(25_000_000);
    expect(d.consistency.status).toBe('consistent');
    expect(d.consistency.message).toMatch(/\$18,000,000 \+ \$7,000,000 = \$25,000,000/);
    expect(d.assumptions).toEqual(['Assumes no other federal funds, since none were stated.']);
  });

  it('keeps the total project cost and the federal request apart: a request is never the total', () => {
    const d = deriveArithmetic(facts({ requestedFederalUsd: 18_000_000 }));
    expect(d.totalProjectCostUsd).toBeNull();
    expect(d.totalUsedUsd).toBeNull();
    expect(d.federalSharePct).toBeNull(); // not computed from a request alone
  });

  it('derives the total from the parts when it is not stated, and says so', () => {
    const d = deriveArithmetic(facts({ requestedFederalUsd: 10_000_000, nonFederalMatchUsd: 10_000_000 }));
    expect(d.totalSource).toBe('implied');
    expect(d.totalUsedUsd).toBe(20_000_000);
    expect(d.federalSharePct).toBe(50);
    expect(d.assumptions.join(' ')).toMatch(/Total project cost not stated/);
  });

  it('counts other federal funds in the federal share', () => {
    const d = deriveArithmetic(facts({ requestedFederalUsd: 10_000_000, otherFederalFundsUsd: 5_000_000, nonFederalMatchUsd: 5_000_000, totalProjectCostUsd: 20_000_000 }));
    expect(d.federalSharePct).toBe(75);
    expect(d.assumptions).toEqual([]);
  });

  it('flags amounts that do not add up', () => {
    const d = deriveArithmetic(facts({ requestedFederalUsd: 30_000_000, nonFederalMatchUsd: 7_000_000, totalProjectCostUsd: 25_000_000 }));
    expect(d.consistency.status).toBe('inconsistent');
    expect(d.consistency.message).toMatch(/do not add up/);
    expect(d.federalSharePct).toBe(120);
  });

  it('is incomplete, not wrong, when information is missing', () => {
    expect(deriveArithmetic(facts({})).consistency.status).toBe('incomplete');
    expect(deriveArithmetic(facts({ totalProjectCostUsd: 25_000_000 })).federalSharePct).toBeNull();
  });

  it('never divides by zero', () => {
    expect(deriveArithmetic(facts({ requestedFederalUsd: 0, nonFederalMatchUsd: 0, totalProjectCostUsd: 0 })).federalSharePct).toBeNull();
  });

  it('formats dollars', () => {
    expect(formatUsd(5_000_000)).toBe('$5,000,000');
  });
});
