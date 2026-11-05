import { describe, expect, it } from 'vitest';
import { asFetch, fakeFetch, jsonResponse } from '../__fixtures__/helpers.js';
import { BUILD_ID, historicalResult, loadSearchFixture, openResult } from '../__fixtures__/discovery.js';
import { SimplerApiError, SimplerGrantsClient } from './client.js';
import { parseSearchResponse, type SearchRequestBody } from './search.js';
import { SimplerOpportunitySource } from './source.js';

const KEY = 'secret-key-value-123';
const BODY: SearchRequestBody = {
  filters: { top_level_agency: { one_of: ['DOT'] } },
  pagination: { page_offset: 1, page_size: 5, sort_order: [{ order_by: 'relevancy', sort_direction: 'descending' }] },
};

function clientWith(handler: (url: URL, init?: RequestInit) => Response, extra: { maxRetries?: number } = {}) {
  const requests: Array<{ method?: string; body?: string; headers: Record<string, string> }> = [];
  const fetchImpl = fakeFetch((url, init) => {
    requests.push({ method: init?.method, body: init?.body as string | undefined, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    return handler(url, init);
  });
  const client = new SimplerGrantsClient({
    apiKey: KEY,
    baseUrl: 'https://api.example.test',
    maxRetries: extra.maxRetries ?? 2,
    random: () => 1,
    sleep: async () => undefined,
    fetchImpl: asFetch(fetchImpl),
  });
  return { client, requests, fetchImpl };
}

describe('SimplerGrantsClient.postJson', () => {
  it('POSTs a JSON body with the key in X-API-Key only, never in the URL or body', async () => {
    const { client, requests, fetchImpl } = clientWith(() => jsonResponse({ data: [] }));
    await client.postJson('/v1/opportunities/search', BODY);
    expect(requests[0].method).toBe('POST');
    expect(JSON.parse(requests[0].body as string)).toEqual(BODY);
    expect(requests[0].headers['X-API-Key']).toBe(KEY);
    expect(requests[0].headers['Content-Type']).toBe('application/json');
    expect(fetchImpl.calls[0].url).toBe('https://api.example.test/v1/opportunities/search');
    expect(requests[0].body).not.toContain(KEY);
  });

  it('GET requests still send no body and no Content-Type', async () => {
    const { client, requests } = clientWith(() => jsonResponse({ data: {} }));
    await client.getJson('/v1/opportunities/abc');
    expect(requests[0].method).toBe('GET');
    expect(requests[0].body).toBeUndefined();
    expect(requests[0].headers['Content-Type']).toBeUndefined();
  });

  it('retries a 503 and then succeeds', async () => {
    let n = 0;
    const { client, requests } = clientWith(() => (++n < 2 ? jsonResponse({}, 503) : jsonResponse({ data: [] })));
    await client.postJson('/v1/opportunities/search', BODY);
    expect(requests).toHaveLength(2);
  });

  it('refuses a path that would send the key to another host', async () => {
    const { client, requests } = clientWith(() => jsonResponse({}));
    await expect(client.postJson('https://evil.example.net/v1/opportunities/search', BODY)).rejects.toMatchObject({ kind: 'bad_request' });
    expect(requests).toHaveLength(0);
  });

  it('rejects redirects, and maps 422 to bad_request without echoing the response', async () => {
    const redirect = clientWith(() => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/' } }));
    await expect(redirect.client.postJson('/v1/opportunities/search', BODY)).rejects.toMatchObject({ kind: 'bad_request', status: 302 });

    const invalid = clientWith(() => jsonResponse({ errors: [{ message: `echo ${KEY}` }] }, 422));
    const error = await invalid.client.postJson('/v1/opportunities/search', BODY).catch((e: SimplerApiError) => e);
    expect(error).toBeInstanceOf(SimplerApiError);
    expect((error as SimplerApiError).kind).toBe('bad_request');
    expect((error as SimplerApiError).message).not.toContain(KEY);
  });
});

describe('SimplerOpportunitySource.searchOpportunities', () => {
  it('posts to the search endpoint and returns normalized candidates', async () => {
    const { client, fetchImpl } = clientWith(() => jsonResponse(loadSearchFixture('simpler-search-dot-open.json')));
    const result = await new SimplerOpportunitySource(client).searchOpportunities(BODY);
    expect(fetchImpl.calls[0].url).toBe('https://api.example.test/v1/opportunities/search');
    expect(result.candidates.length).toBeGreaterThan(5);
  });
});

describe('parseSearchResponse (real trimmed fixtures)', () => {
  it('maps open DOT listings', () => {
    const { candidates, skipped } = openResult();
    expect(skipped).toBe(0);
    expect(candidates).toHaveLength(11);
    const wildlife = candidates.find((c) => c.opportunityNumber === 'FHWA-WCPP-26-002');
    expect(wildlife).toBeDefined();
    expect(wildlife?.status).toBe('posted');
    expect(wildlife?.fundingCategories).toContain('transportation');
    expect(wildlife?.applicantTypes).toContain('county_governments');
  });

  it('maps BUILD faithfully: applicant type "other" (why that cannot be a filter), archived, null-safe fields', () => {
    const build = historicalResult().candidates.find((c) => c.opportunityId === BUILD_ID);
    expect(build).toBeDefined();
    expect(build?.applicantTypes).toEqual(['other']);
    expect(build?.status).toBe('archived');
    expect(build?.awardCeiling).toBe(25_000_000);
  });

  it('skips a malformed item instead of discarding the page', () => {
    const base = loadSearchFixture('simpler-search-dot-open.json') as { data: unknown[] };
    const result = parseSearchResponse({ ...base, data: [base.data[0], { opportunity_id: 'not-a-uuid' }, { nothing: true }] });
    expect(result.candidates).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('rejects a response that is not a search envelope, naming fields but not content', () => {
    expect(() => parseSearchResponse({ data: 'secret-looking-content' })).toThrow(/did not match the expected shape \(data\)/);
    expect(() => parseSearchResponse({ data: 'secret-looking-content' })).not.toThrow(/secret-looking-content/);
  });
});
