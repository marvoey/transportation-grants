import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { LlmFn } from '../llm.js';
import type { OpportunitySearchSource } from '../simpler/source.js';
import { parseSearchResponse, type SearchCandidate, type SearchRequestBody, type SearchResult } from '../simpler/search.js';

/** Trimmed real Simpler.Grants.gov search responses (see data/fixtures). */
export function loadSearchFixture(name: 'simpler-search-dot-open.json' | 'simpler-search-dot-historical.json'): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'data/fixtures', name), 'utf8'));
}

export const openResult = (): SearchResult => parseSearchResponse(loadSearchFixture('simpler-search-dot-open.json'));
export const historicalResult = (): SearchResult => parseSearchResponse(loadSearchFixture('simpler-search-dot-historical.json'));

export const BUILD_ID = '4d8f5775-ff01-4a6f-ab4e-b125899043b3';
export const WCPP_ID = '41eb2492-6242-49f8-89ae-17d15c068be4';

export function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    opportunityId: '33333333-3333-4333-8333-333333333333',
    opportunityNumber: 'TEST-001',
    title: 'Synthetic Test Program',
    status: 'posted',
    category: 'discretionary',
    agencyCode: 'DOT-FHWA',
    agencyName: 'Federal Highway Administration',
    topLevelAgencyCode: 'DOT',
    purpose: null,
    description: null,
    postDate: '2026-09-01',
    closeDate: '2026-12-31',
    awardCeiling: null,
    awardFloor: null,
    estimatedTotalProgramFunding: null,
    expectedNumberOfAwards: null,
    isCostSharing: null,
    applicantTypes: [],
    fundingCategories: ['transportation'],
    assistanceListings: [],
    additionalInfoUrl: null,
    ...overrides,
  };
}

export interface FakeSearchSource extends OpportunitySearchSource {
  bodies: SearchRequestBody[];
}

/** Search source whose answer depends on the request body. Records every body it receives. */
export function fakeSearchSource(handler: (body: SearchRequestBody) => SearchResult | Promise<SearchResult>): FakeSearchSource {
  const source: FakeSearchSource = {
    bodies: [],
    async searchOpportunities(body) {
      source.bodies.push(body);
      return handler(body);
    },
  };
  return source;
}

/** Answers like the live API did: open searches return the open fixture, historical ones the historical fixture. */
export const fixtureSearchSource = (): FakeSearchSource =>
  fakeSearchSource((body) => {
    const statuses = body.filters?.opportunity_status?.one_of ?? [];
    const wantsHistory = statuses.includes('closed') || statuses.includes('archived');
    const wantsOpen = statuses.includes('posted') || statuses.includes('forecasted');
    const open = openResult();
    const hist = historicalResult();
    const candidates = [...(wantsOpen ? open.candidates : []), ...(wantsHistory ? hist.candidates : [])];
    return { candidates, totalRecords: candidates.length, skipped: 0, raw: { message: 'Success', status_code: 200, pagination_info: { total_records: candidates.length }, data: candidates.map((c) => ({ opportunity_id: c.opportunityId })) } };
  });

export interface ProfileWire {
  projectTypes?: Array<{ type: string; quote: string }>;
  applicantType?: { present: boolean; value: string; quote: string };
  phase?: { present: boolean; value: string; quote: string };
  federalAskUsd?: { present: boolean; value: number; quote: string };
  totalCostUsd?: { present: boolean; value: number; quote: string };
  stateName?: { present: boolean; value: string; quote: string };
  terms?: string[];
}

const none = { present: false, value: '', quote: '' };

/** A model stand-in that returns the given wire profile, and records the calls it received. */
export function profileLlm(wire: ProfileWire): LlmFn & { calls: number } {
  const fn = (async (): Promise<Awaited<ReturnType<LlmFn>>> => {
    fn.calls += 1;
    const full = {
      projectTypes: [],
      applicantType: { ...none, value: 'unknown' },
      phase: { ...none, value: 'unknown' },
      federalAskUsd: { ...none, value: 0 },
      totalCostUsd: { ...none, value: 0 },
      stateName: none,
      terms: [],
      ...wire,
    };
    return { text: JSON.stringify(full), stopReason: 'end_turn', model: 'test-model', inputTokens: 1, outputTokens: 1 };
  }) as unknown as LlmFn & { calls: number };
  fn.calls = 0;
  return fn;
}
