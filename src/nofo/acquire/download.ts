import { createHash } from 'crypto';

export type DownloadErrorKind =
  | 'invalid_url'
  | 'not_https'
  | 'blocked_host'
  | 'too_large'
  | 'http_error'
  | 'network'
  | 'timeout'
  | 'too_many_redirects';

/** Download failure. Messages contain no URL query strings, headers or credentials. */
export class DownloadError extends Error {
  constructor(
    public readonly kind: DownloadErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  /** Credentials valid for exactly one host. Sent only while the request is on that host. */
  auth?: { host: string; apiKey: string };
}

export interface DownloadResult {
  bytes: Buffer;
  contentType: string | null;
  /** Final URL with the query string removed (signatures must not be persisted). */
  finalUrl: string;
  sha256: string;
  redirects: number;
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Rejects anything that is not a plain public https URL: other schemes,
 * embedded credentials, non-default ports, localhost/internal names, and IP
 * literals. (DNS rebinding is not mitigated; downloads are operator-run and
 * never take URLs from end users.)
 */
export function assertSafeUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new DownloadError('not_https', 'Only https downloads are allowed.');
  }
  if (url.username || url.password) {
    throw new DownloadError('blocked_host', 'URLs with embedded credentials are not allowed.');
  }
  if (url.port && url.port !== '443') {
    throw new DownloadError('blocked_host', 'Non-standard ports are not allowed.');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    IPV4_LITERAL.test(host) ||
    host.includes(':') ||
    host.startsWith('[') ||
    /^\d+$/.test(host) ||
    host.startsWith('0x')
  ) {
    throw new DownloadError('blocked_host', 'Downloads from local, internal or IP-literal hosts are not allowed.');
  }
}

/** URL without its query string or fragment. */
export function stripQuery(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    // Relative path: strip by hand.
    return raw.split(/[?#]/, 1)[0];
  }
}

/** Heuristic: does the URL carry a signature/expiry (presigned)? */
export function classifyUrl(raw: string): 'relative' | 'absolute' | 'presigned' {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'relative';
  }
  const keys = [...url.searchParams.keys()].map((k) => k.toLowerCase());
  const signed = keys.some((k) =>
    ['x-amz-signature', 'x-amz-credential', 'signature', 'sig', 'expires', 'x-goog-signature', 'se'].includes(k)
  );
  return signed ? 'presigned' : 'absolute';
}

/** Resolve a `download_path` (absolute URL or path relative to the API base) to a URL. */
export function resolveDownloadUrl(downloadPath: string, apiBaseUrl: string | undefined): URL {
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(downloadPath)) return new URL(downloadPath);
    if (!apiBaseUrl) throw new Error('no base');
    return new URL(downloadPath, apiBaseUrl);
  } catch {
    throw new DownloadError('invalid_url', 'The document URL is not valid.');
  }
}

/**
 * Bounded download: https only, manual redirects (each hop re-validated, the
 * key dropped when the host changes), a size cap enforced from Content-Length
 * and again while streaming, and one overall timeout.
 */
export async function downloadFile(startUrl: URL, options: DownloadOptions): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 120_000);

  let url = startUrl;
  let redirects = 0;

  for (;;) {
    assertSafeUrl(url);

    const headers: Record<string, string> = { Accept: '*/*' };
    if (options.auth && url.host === options.auth.host) {
      headers['X-API-Key'] = options.auth.apiKey;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal });
    } catch (error) {
      throw toNetworkError(error);
    }

    if (response.status >= 300 && response.status < 400) {
      await cancel(response);
      const location = response.headers.get('location');
      if (!location) throw new DownloadError('http_error', `Unexpected redirect without a location (HTTP ${response.status}).`, response.status);
      if (++redirects > maxRedirects) throw new DownloadError('too_many_redirects', 'Too many redirects.');
      try {
        url = new URL(location, url);
      } catch {
        throw new DownloadError('invalid_url', 'The redirect target is not a valid URL.');
      }
      continue;
    }

    if (response.status !== 200) {
      await cancel(response);
      throw new DownloadError('http_error', `The server responded with HTTP ${response.status}.`, response.status);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await cancel(response);
      throw new DownloadError('too_large', `The file is larger than the ${options.maxBytes}-byte limit.`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > options.maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new DownloadError('too_large', `The file is larger than the ${options.maxBytes}-byte limit.`);
          }
          chunks.push(Buffer.from(value));
        }
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      throw toNetworkError(error);
    }

    const bytes = Buffer.concat(chunks, total);
    return {
      bytes,
      contentType: response.headers.get('content-type'),
      finalUrl: stripQuery(url.toString()),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      redirects,
    };
  }
}

function toNetworkError(error: unknown): DownloadError {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new DownloadError('timeout', 'The download timed out.');
  }
  return new DownloadError('network', 'Network error while downloading the document.');
}

async function cancel(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}
