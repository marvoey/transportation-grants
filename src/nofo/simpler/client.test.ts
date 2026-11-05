import { describe, expect, it } from 'vitest';
import { SimplerApiError, SimplerGrantsClient, parseRetryAfterMs } from './client.js';
import { asFetch, fakeFetch, jsonResponse } from '../__fixtures__/helpers.js';

const KEY = 'secret-key-value-123';

function makeClient(handler: Parameters<typeof fakeFetch>[0], extra: Partial<ConstructorParameters<typeof SimplerGrantsClient>[0]> = {}) {
  const fetchImpl = fakeFetch(handler);
  const sleeps: number[] = [];
  const client = new SimplerGrantsClient({
    apiKey: KEY,
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    random: () => 1,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl: asFetch(fetchImpl),
    ...extra,
  });
  return { client, fetchImpl, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<SimplerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SimplerApiError);
    return error as SimplerApiError;
  }
  throw new Error('expected the call to fail');
}

describe('SimplerGrantsClient configuration', () => {
  it('requires an API key', () => {
    expect(() => new SimplerGrantsClient({ apiKey: undefined })).toThrow(/SIMPLER_GRANTS_API_KEY/);
  });
  it('requires https and no embedded credentials', () => {
    expect(() => new SimplerGrantsClient({ apiKey: KEY, baseUrl: 'http://api.example.test' })).toThrow(/https/);
    expect(() => new SimplerGrantsClient({ apiKey: KEY, baseUrl: 'https://user:pw@api.example.test' })).toThrow(/credentials/);
    expect(() => new SimplerGrantsClient({ apiKey: KEY, baseUrl: 'not a url' })).toThrow(/valid URL/);
  });
});

describe('SimplerGrantsClient.getJson', () => {
  it('returns parsed JSON and a sha256, sending the key only in X-API-Key', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({ data: { ok: true } }));
    const result = await client.getJson('/v1/opportunities/abc');
    expect(result.json).toEqual({ data: { ok: true } });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe('https://api.example.test/v1/opportunities/abc');
    expect(fetchImpl.calls[0].headers['X-API-Key']).toBe(KEY);
    expect(fetchImpl.calls[0].url).not.toContain(KEY);
  });

  it('401/403 -> auth error whose message never contains the key; no retry', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({ errors: [] }, 401));
    const error = await failure(client.getJson('/x'));
    expect(error.kind).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.message).not.toContain(KEY);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('404 -> not_found, no retry', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({}, 404));
    expect((await failure(client.getJson('/x'))).kind).toBe('not_found');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('other 4xx -> bad_request, no retry', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({}, 422));
    expect((await failure(client.getJson('/x'))).kind).toBe('bad_request');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('429 honors Retry-After then succeeds', async () => {
    let n = 0;
    const { client, fetchImpl, sleeps } = makeClient(() =>
      ++n === 1 ? jsonResponse({}, 429, { 'retry-after': '2' }) : jsonResponse({ data: 1 })
    );
    await expect(client.getJson('/x')).resolves.toMatchObject({ json: { data: 1 } });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('caps a huge Retry-After at maxDelayMs', async () => {
    let n = 0;
    const { client, sleeps } = makeClient(() => (++n === 1 ? jsonResponse({}, 429, { 'retry-after': '99999' }) : jsonResponse({ data: 1 })), {
      maxDelayMs: 5000,
    });
    await client.getJson('/x');
    expect(sleeps).toEqual([5000]);
  });

  it('429 retries are bounded, then rate_limited', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({}, 429));
    const error = await failure(client.getJson('/x'));
    expect(error.kind).toBe('rate_limited');
    expect(fetchImpl.calls).toHaveLength(3); // 1 + maxRetries(2)
  });

  it('5xx retries are bounded, then server error', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({}, 503));
    const error = await failure(client.getJson('/x'));
    expect(error.kind).toBe('server');
    expect(error.status).toBe(503);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('network errors retry then report network; timeouts report timeout', async () => {
    const net = makeClient(() => {
      throw new TypeError('fetch failed');
    });
    expect((await failure(net.client.getJson('/x'))).kind).toBe('network');
    expect(net.fetchImpl.calls).toHaveLength(3);

    const slow = makeClient(() => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    const error = await failure(slow.client.getJson('/x'));
    expect(error.kind).toBe('timeout');
    expect(error.message).not.toContain(KEY);
  });

  it('malformed JSON -> malformed_response, no retry', async () => {
    const { client, fetchImpl } = makeClient(() => new Response('<html>not json</html>', { status: 200 }));
    expect((await failure(client.getJson('/x'))).kind).toBe('malformed_response');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('does not follow redirects', async () => {
    const { client, fetchImpl } = makeClient(() => new Response(null, { status: 302, headers: { location: 'https://evil.example.test/' } }));
    expect((await failure(client.getJson('/x'))).kind).toBe('bad_request');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('refuses to send credentials to another host', async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse({}));
    expect((await failure(client.getJson('//evil.example.test/x'))).kind).toBe('bad_request');
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses seconds, HTTP dates and rejects junk', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(5000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });
});
