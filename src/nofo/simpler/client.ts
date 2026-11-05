import { createHash } from 'crypto';

export type SimplerErrorKind =
  | 'config'
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'malformed_response';

/**
 * Error from the Simpler.Grants.gov client. Messages never contain the API
 * key, request headers or response bodies.
 */
export class SimplerApiError extends Error {
  constructor(
    public readonly kind: SimplerErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'SimplerApiError';
  }
}

export interface SimplerClientOptions {
  apiKey: string | undefined;
  /** Must be https. Defaults to the public API. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries after the first attempt, for 429 / 5xx / network errors only. */
  maxRetries?: number;
  baseDelayMs?: number;
  /** Upper bound for any single wait, including a server-supplied Retry-After. */
  maxDelayMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_BODY_CHARS = 5_000_000;

/**
 * Minimal Simpler.Grants.gov API client on native fetch (not axios): manual
 * redirect handling, AbortSignal timeouts, bounded retries, and a key that is
 * attached to requests for the configured API host only.
 */
export class SimplerGrantsClient {
  readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: SimplerClientOptions) {
    if (!options.apiKey) {
      throw new SimplerApiError(
        'config',
        'SIMPLER_GRANTS_API_KEY is not set. Create a key at https://simpler.grants.gov/developers and add it to your local .env file.'
      );
    }
    let base: URL;
    try {
      base = new URL(options.baseUrl ?? 'https://api.simpler.grants.gov');
    } catch {
      throw new SimplerApiError('config', 'SIMPLER_GRANTS_BASE_URL is not a valid URL.');
    }
    if (base.protocol !== 'https:') {
      throw new SimplerApiError('config', 'SIMPLER_GRANTS_BASE_URL must use https.');
    }
    if (base.username || base.password) {
      throw new SimplerApiError('config', 'SIMPLER_GRANTS_BASE_URL must not contain credentials.');
    }
    this.baseUrl = base;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  /** Host (with any port) the API key may be sent to. */
  get apiHost(): string {
    return this.baseUrl.host;
  }

  /** Credentials for the one host allowed to receive them (used by downloads of relative paths). */
  get downloadAuth(): { host: string; apiKey: string } {
    return { host: this.baseUrl.host, apiKey: this.apiKey };
  }

  /** GET `path` (relative to the API base) and return the parsed JSON plus a sha256 of the body. */
  async getJson(path: string): Promise<{ json: unknown; sha256: string }> {
    const url = new URL(path, this.baseUrl);
    if (url.host !== this.baseUrl.host || url.protocol !== 'https:') {
      // Defense in depth: callers only build paths from validated IDs.
      throw new SimplerApiError('bad_request', 'Refusing to send credentials to a different host.');
    }

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut = isAbortError(error);
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw new SimplerApiError(
          timedOut ? 'timeout' : 'network',
          timedOut
            ? 'The request to Simpler.Grants.gov timed out.'
            : 'Could not reach Simpler.Grants.gov (network error).'
        );
      }

      const status = response.status;

      if (status >= 300 && status < 400) {
        await discard(response);
        throw new SimplerApiError('bad_request', `Simpler.Grants.gov returned an unexpected redirect (HTTP ${status}).`, status);
      }

      if (status === 429 || status >= 500) {
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
        await discard(response);
        if (attempt < this.maxRetries) {
          await this.sleep(Math.min(this.maxDelayMs, retryAfter ?? this.backoffMs(attempt)));
          continue;
        }
        throw new SimplerApiError(
          status === 429 ? 'rate_limited' : 'server',
          status === 429
            ? 'Simpler.Grants.gov rate limit exceeded (HTTP 429) and retries were exhausted.'
            : `Simpler.Grants.gov returned a server error (HTTP ${status}) and retries were exhausted.`,
          status
        );
      }

      if (status === 401 || status === 403) {
        await discard(response);
        throw new SimplerApiError(
          'auth',
          `Simpler.Grants.gov rejected the API key (HTTP ${status}). Check SIMPLER_GRANTS_API_KEY.`,
          status
        );
      }
      if (status === 404) {
        await discard(response);
        throw new SimplerApiError('not_found', 'Opportunity not found on Simpler.Grants.gov (HTTP 404).', 404);
      }
      if (!response.ok) {
        await discard(response);
        throw new SimplerApiError('bad_request', `Simpler.Grants.gov rejected the request (HTTP ${status}).`, status);
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new SimplerApiError('network', 'Could not read the response from Simpler.Grants.gov.');
      }
      if (text.length > MAX_BODY_CHARS) {
        throw new SimplerApiError('malformed_response', 'Simpler.Grants.gov response was unexpectedly large.');
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new SimplerApiError('malformed_response', 'Simpler.Grants.gov returned a response that is not valid JSON.');
      }
      return { json, sha256: createHash('sha256').update(text).digest('hex') };
    }
  }

  private backoffMs(attempt: number): number {
    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(exponential * (0.5 + this.random() * 0.5));
  }
}

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function discard(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    /* ignore */
  }
}

/** Retry-After as delta-seconds or an HTTP date; null if absent or unparseable. */
export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}
