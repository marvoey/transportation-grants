import { describe, expect, it } from 'vitest';
import {
  DownloadError,
  assertSafeUrl,
  classifyUrl,
  downloadFile,
  resolveDownloadUrl,
  stripQuery,
} from './download.js';
import { asFetch, bytesResponse, fakeFetch, streamingResponse } from '../__fixtures__/helpers.js';

const PDF = Buffer.from('%PDF-1.4 hello');

async function failure(promise: Promise<unknown>): Promise<DownloadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DownloadError);
    return error as DownloadError;
  }
  throw new Error('expected failure');
}

describe('assertSafeUrl', () => {
  it('accepts a normal https URL', () => {
    expect(() => assertSafeUrl(new URL('https://files.example.test/a/b.pdf'))).not.toThrow();
  });
  it.each([
    ['http', 'http://files.example.test/a.pdf', 'not_https'],
    ['ftp', 'ftp://files.example.test/a.pdf', 'not_https'],
    ['file', 'file:///etc/passwd', 'not_https'],
    ['localhost', 'https://localhost/a.pdf', 'blocked_host'],
    ['subdomain of localhost', 'https://x.localhost/a.pdf', 'blocked_host'],
    ['ipv4 literal', 'https://10.0.0.5/a.pdf', 'blocked_host'],
    ['loopback', 'https://127.0.0.1/a.pdf', 'blocked_host'],
    ['metadata ip', 'https://169.254.169.254/latest', 'blocked_host'],
    ['ipv6 literal', 'https://[::1]/a.pdf', 'blocked_host'],
    ['decimal ip', 'https://2130706433/a.pdf', 'blocked_host'],
    ['.internal', 'https://svc.internal/a.pdf', 'blocked_host'],
    ['credentials', 'https://user:pw@files.example.test/a.pdf', 'blocked_host'],
    ['odd port', 'https://files.example.test:8443/a.pdf', 'blocked_host'],
  ])('rejects %s', (_label, raw, kind) => {
    try {
      assertSafeUrl(new URL(raw));
      expect.unreachable();
    } catch (error) {
      expect((error as DownloadError).kind).toBe(kind);
    }
  });
});

describe('URL helpers', () => {
  it('stripQuery removes the query and fragment', () => {
    expect(stripQuery('https://a.example.test/f.pdf?X-Amz-Signature=abc&x=1#frag')).toBe('https://a.example.test/f.pdf');
    expect(stripQuery('/files/f.pdf?token=1')).toBe('/files/f.pdf');
  });
  it('classifyUrl distinguishes relative, absolute and presigned', () => {
    expect(classifyUrl('/files/f.pdf')).toBe('relative');
    expect(classifyUrl('https://a.example.test/f.pdf')).toBe('absolute');
    expect(classifyUrl('https://a.example.test/f.pdf?id=5')).toBe('absolute');
    expect(classifyUrl('https://a.example.test/f.pdf?X-Amz-Signature=abc')).toBe('presigned');
    expect(classifyUrl('https://a.example.test/f.pdf?Expires=123&Signature=abc')).toBe('presigned');
  });
  it('resolveDownloadUrl handles absolute and relative paths', () => {
    expect(resolveDownloadUrl('https://files.example.test/a.pdf', 'https://api.example.test/').toString()).toBe('https://files.example.test/a.pdf');
    expect(resolveDownloadUrl('/files/a.pdf', 'https://api.example.test/').toString()).toBe('https://api.example.test/files/a.pdf');
    expect(() => resolveDownloadUrl('/files/a.pdf', undefined)).toThrow(DownloadError);
  });
});

describe('downloadFile', () => {
  const url = new URL('https://files.example.test/a.pdf?X-Amz-Signature=secretsig');

  it('downloads bytes, hashes them and strips the query from the final URL', async () => {
    const fetchImpl = fakeFetch(() => bytesResponse(PDF, { headers: { 'content-type': 'application/pdf' } }));
    const result = await downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) });
    expect(result.bytes.equals(PDF)).toBe(true);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.finalUrl).toBe('https://files.example.test/a.pdf');
    expect(result.finalUrl).not.toContain('secretsig');
    expect(result.contentType).toBe('application/pdf');
  });

  it('rejects an oversize file from Content-Length without reading it', async () => {
    const fetchImpl = fakeFetch(() => bytesResponse(PDF, { headers: { 'content-length': '5000' } }));
    const error = await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }));
    expect(error.kind).toBe('too_large');
  });

  it('rejects an oversize file while streaming when Content-Length is missing or lies', async () => {
    const fetchImpl = fakeFetch(() => streamingResponse(50_000));
    const error = await failure(downloadFile(url, { maxBytes: 4096, fetchImpl: asFetch(fetchImpl) }));
    expect(error.kind).toBe('too_large');
  });

  it('refuses non-https and blocked hosts without making a request', async () => {
    const fetchImpl = fakeFetch(() => bytesResponse(PDF));
    expect((await failure(downloadFile(new URL('http://files.example.test/a.pdf'), { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }))).kind).toBe('not_https');
    expect((await failure(downloadFile(new URL('https://127.0.0.1/a.pdf'), { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }))).kind).toBe('blocked_host');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('reports HTTP errors with the status', async () => {
    const fetchImpl = fakeFetch(() => new Response('nope', { status: 404 }));
    const error = await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }));
    expect(error.kind).toBe('http_error');
    expect(error.status).toBe(404);
    expect(error.message).not.toContain('secretsig');
  });

  it('maps network failures and timeouts without leaking the URL', async () => {
    const net = fakeFetch(() => {
      throw new TypeError('fetch failed: https://files.example.test/a.pdf?X-Amz-Signature=secretsig');
    });
    const netError = await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(net) }));
    expect(netError.kind).toBe('network');
    expect(netError.message).not.toContain('secretsig');

    const slow = fakeFetch(() => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    });
    expect((await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(slow) }))).kind).toBe('timeout');
  });

  describe('redirects and credentials', () => {
    const auth = { host: 'api.example.test', apiKey: 'api-key-xyz' };

    it('follows a safe redirect and drops the API key when the host changes', async () => {
      const fetchImpl = fakeFetch((u) =>
        u.host === 'api.example.test'
          ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/final.pdf' } })
          : bytesResponse(PDF)
      );
      const result = await downloadFile(new URL('https://api.example.test/files/a.pdf'), { maxBytes: 1000, auth, fetchImpl: asFetch(fetchImpl) });
      expect(result.redirects).toBe(1);
      expect(fetchImpl.calls[0].headers['X-API-Key']).toBe('api-key-xyz'); // first hop: API host
      expect(fetchImpl.calls[1].headers['X-API-Key']).toBeUndefined(); // cross-host hop: no key
    });

    it('never sends the key to a different host from the start', async () => {
      const fetchImpl = fakeFetch(() => bytesResponse(PDF));
      await downloadFile(new URL('https://files.example.test/a.pdf'), { maxBytes: 1000, auth, fetchImpl: asFetch(fetchImpl) });
      expect(fetchImpl.calls[0].headers['X-API-Key']).toBeUndefined();
    });

    it('rejects a redirect to an unsafe target', async () => {
      const fetchImpl = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } }));
      const error = await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }));
      expect(error.kind).toBe('blocked_host');
      expect(fetchImpl.calls).toHaveLength(1);
    });

    it('rejects a downgrade to http', async () => {
      const fetchImpl = fakeFetch(() => new Response(null, { status: 301, headers: { location: 'http://files.example.test/a.pdf' } }));
      expect((await failure(downloadFile(url, { maxBytes: 1000, fetchImpl: asFetch(fetchImpl) }))).kind).toBe('not_https');
    });

    it('bounds the number of redirects', async () => {
      const fetchImpl = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://files.example.test/next' } }));
      const error = await failure(downloadFile(url, { maxBytes: 1000, maxRedirects: 3, fetchImpl: asFetch(fetchImpl) }));
      expect(error.kind).toBe('too_many_redirects');
      expect(fetchImpl.calls).toHaveLength(4);
    });
  });
});
