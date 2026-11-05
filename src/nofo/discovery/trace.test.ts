import { describe, expect, it } from 'vitest';
import { codeOnlyTerms, verifyWire } from './profile.js';
import { primaryPlans, wideningPlan } from './filters.js';
import { buildTrace, type TraceInput } from './trace.js';
import type { ProjectProfile } from './schemas.js';

const TEXT = 'Virginia DOT wants to replace a structurally deficient bridge. We would request $25 million in federal funds.';
const wire = {
  projectTypes: [{ type: 'bridge', quote: 'replace a structurally deficient bridge' }],
  applicantType: { present: true, value: 'state', quote: 'Virginia DOT' },
  phase: { present: false, value: 'unknown', quote: '' },
  federalAskUsd: { present: true, value: 25_000_000, quote: '$25 million in federal funds' },
  totalCostUsd: { present: false, value: 0, quote: '' },
  stateName: { present: false, value: '', quote: '' },
  terms: ['bridge', 'airport'],
};

const make = (over: Partial<TraceInput> = {}): TraceInput => {
  const verified = verifyWire(wire, [TEXT]);
  const profile: ProjectProfile = verified.profile;
  return {
    reader: 'model',
    messageCount: 1,
    profile,
    rejected: verified.rejected,
    terms: verified.terms,
    plans: primaryPlans(profile, { includeHistorical: false }),
    includeHistorical: false,
    widenedAfterLikely: null,
    minimumLikely: 4,
    ...over,
  };
};

describe('where each search word came from (verifyWire)', () => {
  it('separates what the model proposed, what was kept, what was dropped and what code added', () => {
    const { terms, profile } = verifyWire(wire, [TEXT]);
    expect(terms.proposed).toEqual(['bridge', 'airport']);
    expect(terms.kept).toEqual(['bridge']);
    expect(terms.dropped).toEqual(['airport']);
    expect(terms.addedByCode).toEqual(['infrastructure']);
    expect(profile.terms).toEqual(['bridge', 'infrastructure']);
  });

  it('says every word was code\'s own when no model read the text', () => {
    const { profile } = verifyWire(wire, [TEXT]);
    expect(codeOnlyTerms(profile)).toEqual({ proposed: [], kept: [], dropped: [], addedByCode: profile.terms });
  });
});

describe('the build trace', () => {
  it('walks through who did what, in order: you, the model, then code checking, deciding words, the query, the filters and the searches', () => {
    const { steps } = buildTrace(make());
    expect(steps.map((s) => s.actor)).toEqual(['you', 'model', 'code', 'code', 'code', 'code', 'code', 'code']);
    expect(steps[1].detail).toMatch(/does not choose the filters/);
    expect(steps[7].detail).toMatch(/model never sees the key/);
  });

  it('shows each verified fact with the applicant\'s own quote, and what code threw out', () => {
    const { steps } = buildTrace(make({ rejected: ['phase: no verbatim quote from the applicant'] }));
    const items = steps[2].items!.join('\n');
    expect(items).toContain('Federal request: $25 million — your words: “$25 million in federal funds”');
    expect(items).toContain('Applicant type: state');
    expect(items).toContain('Discarded: phase: no verbatim quote from the applicant');
  });

  it('explains the search words: proposed, kept, dropped and added by code', () => {
    const items = buildTrace(make()).steps[3].items!.join('\n');
    expect(items).toMatch(/The model proposed: “bridge”, “airport”/);
    expect(items).toMatch(/Dropped, because they are not in your words: “airport”/);
    expect(items).toMatch(/Added by code from its word list.*“infrastructure”/);
  });

  it('shows the exact query and says what the 100-character limit cost', () => {
    const profile: ProjectProfile = { projectTypes: [], terms: ['a'.repeat(38), 'b'.repeat(38), 'c'.repeat(38)] };
    const plans = primaryPlans(profile, { includeHistorical: false });
    const step = buildTrace(make({ profile, plans, terms: codeOnlyTerms(profile) })).steps[5];
    expect(step.items![0]).toContain('query = ');
    expect(step.items!.join('\n')).toMatch(/Left out to stay under 100 characters: “c{38}”/);
  });

  it('says so when there is no query to build, and when no model was used', () => {
    const profile: ProjectProfile = { projectTypes: [], terms: [] };
    const trace = buildTrace(make({ reader: 'keyword', profile, plans: primaryPlans(profile, { includeHistorical: false }), terms: codeOnlyTerms(profile) }));
    expect(trace.steps[1]).toMatchObject({ actor: 'code' });
    expect(trace.steps[1].title).toMatch(/keyword reader/);
    expect(trace.steps.some((s) => /no query to build/.test(s.title))).toBe(true);
    expect(trace.parameters.some((p) => p.parameter === 'query')).toBe(false);
  });

  it('explains a widened search with the count that triggered it, and a historical one with the checkbox', () => {
    const base = make();
    const plans = [...base.plans, wideningPlan(base.profile, { includeHistorical: false })!];
    const wide = buildTrace(make({ plans, widenedAfterLikely: 2 })).steps.find((s) => s.title === 'Code chose which searches to run')!;
    expect(wide.detail).toMatch(/Only 2 listings matched your words \(fewer than 4\)/);
    expect(wide.items!.join('\n')).toMatch(/beyond_dot/);
    const hist = buildTrace(make({ includeHistorical: true, plans: primaryPlans(base.profile, { includeHistorical: true }) }));
    expect(hist.steps.find((s) => s.title === 'Code applied fixed rules for the filters')!.items!.join('\n')).toMatch(/you ticked/);
    expect(hist.parameters.some((p) => p.origin === 'choice')).toBe(true);
  });

  it('lists every parameter of every request with its real value and where it came from', () => {
    const { parameters } = buildTrace(make());
    const query = parameters.find((p) => p.call === 'keywords' && p.parameter === 'query')!;
    expect(query.origin).toBe('words');
    expect(JSON.parse(query.value)).toBe('bridge infrastructure');
    expect(parameters.find((p) => p.call === 'open_all' && p.parameter === 'filters.top_level_agency')).toMatchObject({ origin: 'rule', value: '{"one_of":["DOT"]}' });
    expect(parameters.filter((p) => p.call === 'open_all').map((p) => p.parameter)).toEqual([
      'filters.top_level_agency', 'filters.opportunity_status', 'pagination.page_size', 'pagination.sort_order',
    ]);
    for (const p of parameters) expect(p.why.length).toBeGreaterThan(5);
  });

  it('never includes more of the applicant\'s words than the quotes already shown, and never a key', () => {
    const text = JSON.stringify(buildTrace(make()));
    expect(text).not.toMatch(/X-API-Key|SIMPLER_GRANTS/);
    // Only the verified quotes appear; the rest of the message does not.
    expect(text).not.toContain('We would request $25 million in federal funds.');
  });
});
