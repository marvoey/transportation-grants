import { describe, expect, it } from 'vitest';
import { BUILD_ID, WCPP_ID, historicalResult, makeCandidate, openResult } from '../__fixtures__/discovery.js';
import { familyKey, likelyCount, rankCandidates, scoreCandidate, selectShortlist } from './rank.js';
import { EMPTY_PROFILE, type ProjectProfile } from './schemas.js';

const NOW = new Date('2026-11-05T12:00:00Z');

const bridge: ProjectProfile = {
  projectTypes: [{ value: 'bridge', quote: 'bridge' }],
  applicantType: { value: 'state', quote: 'Virginia DOT' },
  federalAskUsd: { value: 25_000_000, quote: '$25 million' },
  terms: ['bridge', 'infrastructure'],
};

const shortlistFor = (profile: ProjectProfile, candidates = [...openResult().candidates, ...historicalResult().candidates]) =>
  selectShortlist(rankCandidates(candidates, { profile, now: NOW }));

describe('ranking against real DOT listings', () => {
  it('puts bridge programs and the general infrastructure program first for a bridge project, and drops other modes', () => {
    const list = shortlistFor(bridge);
    const titles = list.map((s) => s.title);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(5);
    expect(list.map((s) => s.opportunityId)).toContain(BUILD_ID);
    expect(titles.some((t) => /Highway Bridge/i.test(t))).toBe(true);
    for (const title of titles) expect(title).not.toMatch(/Contract Tower|Port Infrastructure|Rail Infrastructure and Safety/i);
    const bridgeIndex = titles.findIndex((t) => /Highway Bridge/i.test(t));
    expect(bridgeIndex).toBeLessThan(list.findIndex((s) => s.opportunityId === BUILD_ID));
  });

  it('folds earlier editions of one program into a single entry', () => {
    const list = shortlistFor({ ...EMPTY_PROFILE, projectTypes: [{ value: 'roadway', quote: 'road' }], terms: ['infrastructure'] });
    const build = list.find((s) => s.opportunityId === BUILD_ID);
    expect(build?.otherEditions).toBeGreaterThanOrEqual(3);
    expect(list.filter((s) => /National Infrastructure Investments/.test(s.title))).toHaveLength(1);
  });

  it('finds the Wildlife Crossings program for a wildlife project and flags its short deadline', () => {
    const wildlife: ProjectProfile = {
      projectTypes: [{ value: 'wildlife_connectivity', quote: 'wildlife overpass' }],
      applicantType: { value: 'county', quote: 'Our county' },
      terms: ['wildlife crossing'],
    };
    const list = shortlistFor(wildlife, openResult().candidates);
    expect(list[0].opportunityId).toBe(WCPP_ID);
    expect(list[0].match).toBe('likely');
    expect(list[0].watchOuts.join(' ')).toMatch(/Closes in 11 days/);
    expect(list[0].whyItMayFit.join(' ')).toMatch(/county governments/);
  });

  it('does not pad the list with programs for another mode', () => {
    const wildlife: ProjectProfile = { ...EMPTY_PROFILE, projectTypes: [{ value: 'wildlife_connectivity', quote: 'wildlife' }], terms: ['wildlife crossing'] };
    for (const item of shortlistFor(wildlife, openResult().candidates)) {
      expect(item.watchOuts.join(' ')).not.toMatch(/not what you described/);
    }
  });
});

describe('soft signals (scored, never filtered)', () => {
  const base = makeCandidate({ title: 'Bridge Program', fundingCategories: ['transportation'] });

  it('treats an applicant list of only "other" as unknown: no penalty, but a watch-out', () => {
    const other = scoreCandidate({ ...base, applicantTypes: ['other'] }, { profile: bridge, now: NOW });
    const none = scoreCandidate({ ...base, applicantTypes: [] }, { profile: bridge, now: NOW });
    expect(other.score).toBe(none.score);
    expect(other.watch.join(' ')).toMatch(/only as "other"/);
  });

  it('penalizes an explicit applicant list that omits the applicant, and rewards one that includes them', () => {
    const lacking = scoreCandidate({ ...base, applicantTypes: ['county_governments'] }, { profile: bridge, now: NOW });
    const including = scoreCandidate({ ...base, applicantTypes: ['state_governments'] }, { profile: bridge, now: NOW });
    expect(including.score).toBeGreaterThan(lacking.score);
    expect(lacking.watch.join(' ')).toMatch(/do not include state governments/);
  });

  it('compares the ceiling to the federal request only, never to total project cost', () => {
    const profile: ProjectProfile = { ...bridge, federalAskUsd: undefined, totalCostUsd: { value: 40_000_000, quote: '$40 million' } };
    const r = scoreCandidate({ ...base, awardCeiling: 5_000_000 }, { profile, now: NOW });
    expect(r.watch.join(' ')).not.toMatch(/below your stated request/);
    const withAsk = scoreCandidate({ ...base, awardCeiling: 5_000_000 }, { profile: bridge, now: NOW });
    expect(withAsk.watch.join(' ')).toMatch(/\(\$5 million\) is below your stated request \(\$25 million\)/);
  });

  it('adds no award line when the ceiling is unknown', () => {
    const r = scoreCandidate({ ...base, awardCeiling: null }, { profile: bridge, now: NOW });
    expect(r.why.join(' ')).not.toMatch(/Maximum award/);
    expect(r.watch.join(' ')).not.toMatch(/Maximum award/);
  });

  it('flags cost sharing, forecasts, historical listings and a passed close date', () => {
    expect(scoreCandidate({ ...base, isCostSharing: true }, { profile: bridge, now: NOW }).watch.join(' ')).toMatch(/cost sharing/);
    expect(scoreCandidate({ ...base, status: 'forecasted', closeDate: null }, { profile: bridge, now: NOW }).watch.join(' ')).toMatch(/Forecasted/);
    expect(scoreCandidate({ ...base, status: 'archived' }, { profile: bridge, now: NOW }).historical).toBe(true);
    expect(scoreCandidate({ ...base, status: 'posted', closeDate: '2026-10-01' }, { profile: bridge, now: NOW }).watch.join(' ')).toMatch(/has passed/);
  });

  it('never invents text: reasons come only from fields the listing has', () => {
    const r = scoreCandidate(makeCandidate({ title: 'Plain Program', fundingCategories: [] }), { profile: bridge, now: NOW });
    expect(r.why.join(' ')).not.toMatch(/transportation program|Lists /);
  });
});

describe('selectShortlist', () => {
  it('returns at most five, ordered best first', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeCandidate({ opportunityId: `4444444${i}-4444-4444-8444-444444444444`, title: `Bridge Program ${String.fromCharCode(65 + i)}`, opportunityNumber: `B-${i}` })
    );
    const list = selectShortlist(rankCandidates(many, { profile: bridge, now: NOW }));
    expect(list).toHaveLength(5);
  });

  it('marks everything "weaker" when no search terms are known, and says nothing about matching words', () => {
    const list = shortlistFor(EMPTY_PROFILE, openResult().candidates);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.match === 'weaker')).toBe(true);
    expect(likelyCount(rankCandidates(openResult().candidates, { profile: EMPTY_PROFILE, now: NOW }))).toBe(0);
  });

  it('dedupes the same opportunity returned by two searches', () => {
    const c = makeCandidate({ title: 'Bridge Program' });
    const ranked = rankCandidates([c, { ...c }, { ...c }], { profile: bridge, now: NOW });
    expect(ranked).toHaveLength(1);
  });

  it('returns an empty list rather than padding with unrelated programs', () => {
    const unrelated = makeCandidate({ title: 'Consumer Recall Program', fundingCategories: ['consumer_protection'] });
    expect(selectShortlist(rankCandidates([unrelated], { profile: bridge, now: NOW }))).toEqual([]);
  });
});

describe('familyKey', () => {
  it('ignores fiscal years so editions of one program share a key', () => {
    expect(familyKey('FY 2026 National Infrastructure Investments')).toBe(familyKey('Fiscal Year 2011 National Infrastructure Investments'));
    expect(familyKey('FY24 CRISI Grant')).toBe(familyKey('FY25 CRISI Grant'));
    // Editions written as year ranges fold too, so one program cannot fill the whole list.
    expect(familyKey('FY25-26 Railroad Crossing Elimination Grant Program')).toBe(familyKey('FY22 Railroad Crossing Elimination Grant Program'));
    expect(familyKey('FY23-24 Railroad Crossing Elimination Grant Program')).toBe(familyKey('FY25-26 Railroad Crossing Elimination Grant Program'));
    expect(familyKey('FYs 2024 through 2026 - PROTECT Competitive Grant Program')).toBe(familyKey('FY 2022 - PROTECT Competitive Grant Program'));
    expect(familyKey('Fiscal Years 2024 Through 2026 Tribal Projects Program')).toBe(familyKey('Fiscal Year 2021 Tribal Projects Program'));
    expect(familyKey(null)).toBe('');
  });
});

describe('link to the opportunity on Simpler.Grants.gov', () => {
  it('every shortlist entry links to its own page, built from its ID', () => {
    const list = shortlistFor(bridge);
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) expect(item.simplerUrl).toBe(`https://simpler.grants.gov/opportunity/${item.opportunityId}`);
  });
});
