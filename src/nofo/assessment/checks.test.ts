import { describe, expect, it } from 'vitest';
import { deriveArithmetic } from './arithmetic.js';
import { evaluateCheck, situationFor } from './checks.js';
import {
  applicantTypes, bca, facts, matchMin, maxRequest, req, ruralMin, shareCapPlain, shareCapUrban, urbanMin,
} from '../__fixtures__/assessment.js';
import type { Requirement } from '../extraction/schemas.js';
import type { ProjectFacts } from './schemas.js';

const run = (requirement: Requirement, f: ProjectFacts) => evaluateCheck(requirement, f, deriveArithmetic(f))!;

describe('minimum / maximum request', () => {
  it('supported when the request meets the minimum, with the numbers in the explanation', () => {
    const o = run(urbanMin, facts({ requestedFederalUsd: 18_000_000, areaType: 'urban', grantCategory: 'capital' }));
    expect(o).toMatchObject({ applicability: 'applies', status: 'supported', gap: false, missingFacts: [] });
    expect(o.explanation).toMatch(/\$18,000,000 meets the \$5,000,000 minimum for urban capital projects/);
    expect(o.factsUsed).toEqual(expect.arrayContaining(['requestedFederalUsd', 'areaType', 'grantCategory']));
  });

  it('conflict when the request is below the minimum', () => {
    const o = run(urbanMin, facts({ requestedFederalUsd: 3_000_000, areaType: 'urban', grantCategory: 'capital' }));
    expect(o.status).toBe('conflict');
    expect(o.explanation).toMatch(/\$3,000,000 is below the \$5,000,000 minimum/);
  });

  it('a request exactly at the limit passes, for both minimum and maximum', () => {
    expect(run(urbanMin, facts({ requestedFederalUsd: 5_000_000, areaType: 'urban', grantCategory: 'capital' })).status).toBe('supported');
    expect(run(maxRequest, facts({ requestedFederalUsd: 25_000_000 })).status).toBe('supported');
  });

  it('a request over the maximum is a conflict with the numbers stated', () => {
    const o = run(maxRequest, facts({ requestedFederalUsd: 30_000_000 }));
    expect(o.status).toBe('conflict');
    expect(o.explanation).toMatch(/\$30,000,000 exceeds the \$25,000,000 maximum/);
  });

  it('missing request => unknown (never pass or fail) and asks for the request', () => {
    const o = run(maxRequest, facts({ applicantType: 'state' }));
    expect(o).toMatchObject({ status: 'unknown', gap: false });
    expect(o.missingFacts).toEqual(['requestedFederalUsd']);
  });

  it('is not applicable when the project is outside the requirement\'s situation', () => {
    const rural = run(urbanMin, facts({ requestedFederalUsd: 1_000_000, areaType: 'rural', grantCategory: 'capital' }));
    expect(rural.applicability).toBe('not_applicable');
    expect(rural.explanation).toMatch(/covers urban capital projects; this project is rural/);
    const planning = run(urbanMin, facts({ requestedFederalUsd: 1_000_000, areaType: 'urban', grantCategory: 'planning' }));
    expect(planning.applicability).toBe('not_applicable');
  });

  it('unknown area or category => unknown, and asks for them (we cannot tell whether the rule applies)', () => {
    const o = run(urbanMin, facts({ requestedFederalUsd: 18_000_000 }));
    expect(o.status).toBe('unknown');
    expect(o.missingFacts).toEqual(expect.arrayContaining(['areaType', 'grantCategory']));
    expect(run(ruralMin, facts({ requestedFederalUsd: 500_000, grantCategory: 'capital' })).missingFacts).toEqual(['areaType']);
  });

  it('a conflict on a different situation is never reported (urban amount against a rural project)', () => {
    expect(run(ruralMin, facts({ requestedFederalUsd: 500_000, areaType: 'urban', grantCategory: 'capital' })).applicability).toBe('not_applicable');
  });
});

describe('federal share', () => {
  const base = { requestedFederalUsd: 18_000_000, nonFederalMatchUsd: 7_000_000, totalProjectCostUsd: 25_000_000, areaType: 'urban' as const };

  it('supported when within the limit (72 percent against 80)', () => {
    const o = run(shareCapUrban, facts(base));
    expect(o.status).toBe('supported');
    expect(o.explanation).toMatch(/72%, within the 80% limit/);
    expect(o.explanation).toMatch(/Assumes no other federal funds/); // assumptions are always shown
  });

  it('over the limit with an exception in the requirement text => specialist review, not a conflict', () => {
    const o = run(shareCapUrban, facts({ ...base, requestedFederalUsd: 24_000_000, nonFederalMatchUsd: 1_000_000 }));
    expect(o.status).toBe('needs_specialist_review');
    expect(o.explanation).toMatch(/exceptions that numbers alone cannot settle/);
  });

  it('over the limit with no exceptions described => conflict', () => {
    const o = run(shareCapPlain, facts({ requestedFederalUsd: 18_000_000, totalProjectCostUsd: 25_000_000 }));
    expect(o.status).toBe('conflict');
    expect(o.explanation).toMatch(/72%, above the 50% limit/);
  });

  it('not enough amounts => unknown, asking for the request first, then the cost or match', () => {
    expect(run(shareCapPlain, facts({})).missingFacts).toEqual(['requestedFederalUsd']);
    expect(run(shareCapPlain, facts({ requestedFederalUsd: 18_000_000 })).missingFacts).toEqual(['totalProjectCostUsd', 'nonFederalMatchUsd']);
  });

  it('applies only to its situation, and asks when the situation is unknown', () => {
    expect(run(shareCapUrban, facts({ ...base, areaType: 'rural' })).applicability).toBe('not_applicable');
    const noArea = run(shareCapUrban, facts({ requestedFederalUsd: 18_000_000, totalProjectCostUsd: 25_000_000 }));
    expect(noArea.status).toBe('unknown');
    expect(noArea.missingFacts).toEqual(['areaType']);
  });
});

describe('minimum match', () => {
  it('checks the non-federal share', () => {
    expect(run(matchMin, facts({ requestedFederalUsd: 18_000_000, nonFederalMatchUsd: 7_000_000, totalProjectCostUsd: 25_000_000 })).status).toBe('supported'); // 28%
    expect(run(matchMin, facts({ requestedFederalUsd: 24_000_000, nonFederalMatchUsd: 1_000_000, totalProjectCostUsd: 25_000_000 })).status).toBe('conflict'); // 4%
    expect(run(matchMin, facts({ requestedFederalUsd: 24_000_000 })).missingFacts).toEqual(['nonFederalMatchUsd', 'totalProjectCostUsd']);
  });
});

describe('applicant type', () => {
  it('supported when the stated type fits a listed one', () => {
    expect(run(applicantTypes, facts({ applicantType: 'state' })).status).toBe('supported');
    expect(run(applicantTypes, facts({ applicantType: 'transit_agency' })).status).toBe('supported');
    expect(run(applicantTypes, facts({ applicantType: 'city' })).status).toBe('supported'); // "a unit of local government"
  });
  it('a non-match goes to a person, not to a conflict (free-text lists can use other words)', () => {
    expect(run(applicantTypes, facts({ applicantType: 'tribal' })).status).toBe('needs_specialist_review');
  });
  it('unknown without the applicant type', () => {
    const o = run(applicantTypes, facts({}));
    expect(o).toMatchObject({ status: 'unknown', missingFacts: ['applicantType'] });
  });
});

describe('benefit-cost analysis (a required deliverable)', () => {
  it('supported when the applicant says it is done (its content is not assessed)', () => {
    const o = run(bca, facts({ grantCategory: 'capital', bcaCompleted: true }));
    expect(o.status).toBe('supported');
    expect(o.explanation).toMatch(/content is not assessed/);
  });
  it('a missing analysis is a preparation GAP, not a plain conflict', () => {
    const o = run(bca, facts({ grantCategory: 'capital', bcaCompleted: false }));
    expect(o).toMatchObject({ status: 'conflict', gap: true });
    expect(o.explanation).toMatch(/preparation gap, not a disqualifier/);
  });
  it('unknown until stated, and not applicable to a planning project', () => {
    expect(run(bca, facts({ grantCategory: 'capital' }))).toMatchObject({ status: 'unknown', missingFacts: ['bcaCompleted'] });
    expect(run(bca, facts({ grantCategory: 'planning', bcaCompleted: false })).applicability).toBe('not_applicable');
  });
  it('other documents have no fact to check against: not handled here', () => {
    expect(evaluateCheck(req({ id: 'x', check: { kind: 'document_required', documentKey: 'sf424' } }), facts({}), deriveArithmetic({}))).toBeNull();
    expect(evaluateCheck(req({ id: 'y' }), facts({}), deriveArithmetic({}))).toBeNull(); // no check at all
  });
});

describe('situationFor', () => {
  it('reports what is missing without deciding', () => {
    expect(situationFor({ area: 'urban', category: 'capital' }, facts({}))).toMatchObject({ result: 'undetermined', missing: ['areaType', 'grantCategory'] });
    expect(situationFor({ area: 'any', category: 'any' }, facts({}))).toMatchObject({ result: 'applies', missing: [] });
  });
});
