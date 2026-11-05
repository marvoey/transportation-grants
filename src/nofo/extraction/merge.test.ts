import { describe, expect, it } from 'vitest';
import { finalizeRequirements, mergeDrafts, type Draft } from './merge.js';
import { DOC_ID, LIMIT_QUOTE, RURAL_QUOTE, URBAN_QUOTE } from '../__fixtures__/extraction.js';
import { OPP_A } from '../__fixtures__/helpers.js';
import { RequirementSchema, type Check } from './schemas.js';

function draft(overrides: Partial<Draft> = {}, quote = URBAN_QUOTE, page = 3): Draft {
  return {
    category: 'funding',
    topic: 'minimum_request',
    title: 'Minimum request for urban capital projects',
    description: 'Urban capital applicants must request at least $5 million.',
    mandatory: true,
    programVariant: 'capital',
    appliesWhen: ['urban area'],
    evidenceNeeded: [],
    check: undefined,
    sources: [{ documentId: DOC_ID, page, section: null, quote, authority: 'controlling', verified: true, locationCorrected: false }],
    flags: [],
    ...overrides,
  };
}

const amountMin = (amountUsd: number): Check => ({ kind: 'amount_min', amountUsd, appliesTo: { areaType: 'any', grantCategory: 'any' } });

describe('mergeDrafts', () => {
  it('merges candidates that cite the same passage under the same category and topic, uniting their sources', () => {
    const a = draft();
    const b = draft({ title: 'Urban minimum', description: 'A much longer description of the urban minimum request amount for capital grant applicants.' }, URBAN_QUOTE.toLowerCase());
    const { merged, mergedCount } = mergeDrafts([a, b]);
    expect(mergedCount).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe('A much longer description of the urban minimum request amount for capital grant applicants.');
    expect(merged[0].sources).toHaveLength(1); // same passage, not duplicated
  });

  it('keeps an urban and a rural threshold separate even though the sentences start alike', () => {
    const urban = draft();
    const rural = draft({ title: 'Minimum request for rural capital projects', appliesWhen: ['rural area'] }, RURAL_QUOTE);
    expect(mergeDrafts([urban, rural]).merged).toHaveLength(2);
  });

  it('merges identical titles found on different pages, keeping both citations', () => {
    const p7 = draft({ category: 'eligibility', topic: 'application_limit', title: 'Limit of three applications' }, LIMIT_QUOTE, 4);
    const p42 = draft({ category: 'eligibility', topic: 'application_limit', title: 'Limit of three applications' }, 'Each applicant may submit no more than three applications in total.', 9);
    const { merged } = mergeDrafts([p7, p42]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((s) => s.page)).toEqual([4, 9]);
  });

  it('merges the same constraint under the same topic (identical check) even with different titles and quotes', () => {
    const a = draft({ title: 'Maximum request', topic: 'maximum_request', check: amountMin(25_000_000) }, 'The maximum request amount is $25 million.', 15);
    const b = draft({ title: 'Cap on award size', topic: 'maximum_request', check: amountMin(25_000_000) }, 'Awards may not exceed twenty-five million dollars in total.', 3);
    expect(mergeDrafts([a, b]).merged).toHaveLength(1);
  });

  it('never merges candidates with different checks, even when one sentence states both thresholds', () => {
    const both = 'The minimum amount for capital projects in rural areas is $1 million and $5 million in urban areas.';
    const ruralMin = draft({ title: 'Rural minimum', appliesWhen: ['rural'], check: { kind: 'amount_min', amountUsd: 1_000_000, appliesTo: { areaType: 'rural', grantCategory: 'capital' } } }, both, 15);
    const urbanMin = draft({ title: 'Urban minimum', appliesWhen: ['urban'], check: { kind: 'amount_min', amountUsd: 5_000_000, appliesTo: { areaType: 'urban', grantCategory: 'capital' } } }, both, 15);
    const { merged } = mergeDrafts([ruralMin, urbanMin]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.appliesWhen)).toEqual([['rural'], ['urban']]); // no cross-contamination
    expect(merged.every((m) => m.check !== undefined)).toBe(true);
  });

  it('does not merge different categories or topics that cite the same passage', () => {
    const funding = draft();
    const eligibility = draft({ category: 'eligibility', title: 'Failure to meet the minimum makes the application ineligible' });
    expect(mergeDrafts([funding, eligibility]).merged).toHaveLength(2);
    expect(mergeDrafts([draft(), draft({ topic: 'maximum_request' })]).merged).toHaveLength(2);
  });

  it('never resolves a mandatory conflict silently: it becomes unclear and is flagged', () => {
    const { merged } = mergeDrafts([draft({ mandatory: true }), draft({ mandatory: false })]);
    expect(merged[0].mandatory).toBeNull();
    expect(merged[0].flags.join(' ')).toMatch(/disagreed on whether this is mandatory/);
  });

  it('flags conflicting program variants instead of picking one', () => {
    const { merged } = mergeDrafts([draft({ programVariant: 'capital' }), draft({ programVariant: 'planning' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].programVariant).toBeNull();
    expect(merged[0].flags.join(' ')).toMatch(/program variant/);
  });

  it('adopts a check from one side when the other has none', () => {
    const { merged } = mergeDrafts([draft(), draft({ check: amountMin(5_000_000) })]);
    expect(merged[0].check).toEqual(amountMin(5_000_000));
  });

  it('unions appliesWhen without case-insensitive duplicates', () => {
    const { merged } = mergeDrafts([draft({ appliesWhen: ['Urban area', 'capital'] }), draft({ appliesWhen: ['urban area', 'new item'] })]);
    expect(merged[0].appliesWhen).toEqual(['Urban area', 'capital', 'new item']);
  });
});

describe('finalizeRequirements', () => {
  it('produces schema-valid requirements with stable, unique ids', () => {
    const drafts = [draft(), draft({ title: 'Rural', appliesWhen: ['rural'] }, RURAL_QUOTE)];
    const first = finalizeRequirements(OPP_A, drafts);
    const second = finalizeRequirements(OPP_A, drafts);
    for (const r of first) expect(RequirementSchema.safeParse(r).success).toBe(true);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id)); // stable across runs
    expect(new Set(first.map((r) => r.id)).size).toBe(2);
  });

  it('gives colliding ids a suffix instead of overwriting', () => {
    const same = [draft(), draft()];
    const ids = finalizeRequirements(OPP_A, same).map((r) => r.id);
    expect(ids[0]).toMatch(/^req-[0-9a-f]{8}$/);
    expect(ids[1]).toBe(`${ids[0]}-2`);
  });

  it('marks clean requirements unreviewed and anything doubtful needs_review, with the reasons', () => {
    const clean = finalizeRequirements(OPP_A, [draft()])[0];
    expect(clean.reviewStatus).toBe('unreviewed');
    expect(clean.reviewNote).toBeUndefined();

    const unclear = finalizeRequirements(OPP_A, [draft({ mandatory: null })])[0];
    expect(unclear.reviewStatus).toBe('needs_review');
    expect(unclear.reviewNote).toMatch(/mandatory status unclear/);

    const corrected = draft();
    corrected.sources[0].locationCorrected = true;
    expect(finalizeRequirements(OPP_A, [corrected])[0].reviewNote).toMatch(/location was corrected/);

    const spans = draft();
    spans.sources[0].note = 'quote spans pages 1 and 2';
    expect(finalizeRequirements(OPP_A, [spans])[0].reviewNote).toMatch(/spans a page break/);

    const flagged = finalizeRequirements(OPP_A, [draft({ flags: ['flagged ambiguous by the model: unclear scope'] })])[0];
    expect(flagged.reviewStatus).toBe('needs_review');
  });
});
