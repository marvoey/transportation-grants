import { describe, expect, it } from 'vitest';
import { primaryPlans, wideningPlan, DOT_TOP_LEVEL_AGENCY, TRANSPORTATION_CATEGORIES, type SearchPlan } from './filters.js';
import { EMPTY_PROFILE, type ProjectProfile } from './schemas.js';

const bridge: ProjectProfile = {
  projectTypes: [{ value: 'bridge', quote: 'bridge' }],
  applicantType: { value: 'state', quote: 'state DOT' },
  federalAskUsd: { value: 25_000_000, quote: '$25 million' },
  terms: ['bridge', 'infrastructure'],
};

// Fields whose upstream metadata is unreliable (BUILD lists applicant type "other"; many award ceilings are null).
const FORBIDDEN_FILTERS = ['applicant_type', 'award_ceiling', 'award_floor', 'is_cost_sharing', 'funding_instrument', 'assistance_listing_number', 'close_date', 'post_date', 'agency'];

const allPlans = (profile: ProjectProfile, includeHistorical: boolean): SearchPlan[] => {
  const widening = wideningPlan(profile, { includeHistorical });
  return [...primaryPlans(profile, { includeHistorical }), ...(widening ? [widening] : [])];
};

describe('search plans', () => {
  it('never use a filter whose metadata is unreliable, whatever the profile', () => {
    for (const profile of [bridge, EMPTY_PROFILE, { ...bridge, applicantType: { value: 'tribal' as const, quote: 'tribe' } }]) {
      for (const historical of [false, true]) {
        for (const plan of allPlans(profile, historical)) {
          const keys = Object.keys(plan.body.filters ?? {});
          for (const forbidden of FORBIDDEN_FILTERS) expect(keys).not.toContain(forbidden);
          // And nothing the applicant said about money or type leaks into the request body in any form.
          expect(JSON.stringify(plan.body)).not.toContain('25000000');
          expect(JSON.stringify(plan.body)).not.toContain('state_governments');
        }
      }
    }
  });

  it('always pulls all open DOT opportunities, soonest close date first', () => {
    const [open] = primaryPlans(bridge, { includeHistorical: false });
    expect(open.id).toBe('open_all');
    expect(open.body.query).toBeUndefined();
    expect(open.body.filters?.top_level_agency?.one_of).toEqual([DOT_TOP_LEVEL_AGENCY]);
    expect(open.body.filters?.opportunity_status?.one_of).toEqual(['posted', 'forecasted']);
    expect(open.body.pagination.sort_order).toEqual([{ order_by: 'close_date', sort_direction: 'ascending' }]);
  });

  it('adds a keyword search with OR, relevancy order and a query of at most 100 characters', () => {
    const plans = primaryPlans(bridge, { includeHistorical: false });
    const keywords = plans.find((p) => p.id === 'keywords');
    expect(keywords?.body.query).toBe('bridge infrastructure');
    expect(keywords?.body.query_operator).toBe('OR');
    expect(keywords?.body.pagination.sort_order[0].order_by).toBe('relevancy');

    const long: ProjectProfile = { ...bridge, terms: Array.from({ length: 6 }, (_, i) => `a-very-long-search-term-number-${i}`) };
    const longPlan = primaryPlans(long, { includeHistorical: false }).find((p) => p.id === 'keywords');
    expect((longPlan?.body.query ?? '').length).toBeLessThanOrEqual(100);
  });

  it('quotes multi-word terms as phrases', () => {
    const wildlife: ProjectProfile = { ...EMPTY_PROFILE, terms: ['wildlife crossing', 'highway'] };
    const keywords = primaryPlans(wildlife, { includeHistorical: false }).find((p) => p.id === 'keywords');
    expect(keywords?.body.query).toBe('"wildlife crossing" highway');
  });

  it('runs no keyword search when there are no terms', () => {
    const plans = primaryPlans(EMPTY_PROFILE, { includeHistorical: false });
    expect(plans.map((p) => p.id)).toEqual(['open_all']);
    expect(wideningPlan(EMPTY_PROFILE, { includeHistorical: false })).toBeNull();
  });

  it('historical mode adds a recent closed/archived pull, newest first, and widens the keyword statuses', () => {
    const plans = primaryPlans(bridge, { includeHistorical: true });
    const history = plans.find((p) => p.id === 'historical_recent');
    expect(history?.body.filters?.opportunity_status?.one_of).toEqual(['closed', 'archived']);
    expect(history?.body.pagination.sort_order).toEqual([{ order_by: 'post_date', sort_direction: 'descending' }]);
    expect(plans.find((p) => p.id === 'keywords')?.body.filters?.opportunity_status?.one_of).toEqual(['posted', 'forecasted', 'closed', 'archived']);
    // Open-only mode never asks for closed or archived records.
    for (const plan of primaryPlans(bridge, { includeHistorical: false })) {
      expect(plan.body.filters?.opportunity_status?.one_of).not.toContain('closed');
      expect(plan.body.filters?.opportunity_status?.one_of).not.toContain('archived');
    }
  });

  it('uses the funding category filter only when widening beyond DOT', () => {
    const widening = wideningPlan(bridge, { includeHistorical: false });
    expect(widening?.id).toBe('beyond_dot');
    expect(widening?.body.filters?.top_level_agency).toBeUndefined();
    expect(widening?.body.filters?.funding_category?.one_of).toEqual(TRANSPORTATION_CATEGORIES);
    for (const plan of primaryPlans(bridge, { includeHistorical: true })) expect(plan.body.filters?.funding_category).toBeUndefined();
  });

  it('describes each search in plain language for the user', () => {
    for (const plan of allPlans(bridge, true)) {
      expect(plan.label.length).toBeGreaterThan(10);
      expect(plan.detail).not.toMatch(/one_of|top_level_agency|opportunity_status/);
    }
  });
});
