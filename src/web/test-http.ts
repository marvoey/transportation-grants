import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp, AppOptions } from './api-server.js';

export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
}

/** Minimal cookie-aware HTTP client against an ephemeral-port server. */
export class TestClient {
  cookies = new Map<string, string>();
  constructor(public readonly baseUrl: string) {}

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(
    method: string,
    path: string,
    opts: { body?: unknown; rawBody?: string; origin?: string | null; contentType?: string | null; headers?: Record<string, string> } = {}
  ): Promise<TestResponse> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const origin = opts.origin === undefined ? this.baseUrl : opts.origin;
    if (origin !== null) headers.Origin = origin;
    const ct = opts.contentType === undefined ? 'application/json' : opts.contentType;
    if (ct !== null) headers['Content-Type'] = ct;
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const res = await fetch(this.baseUrl + path, { method, headers, body });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON (e.g. static file)
    }
    return { status: res.status, headers: res.headers, body: parsed };
  }

  get(path: string, opts = {}) {
    return this.request('GET', path, opts);
  }
  post(path: string, body?: unknown, opts = {}) {
    return this.request('POST', path, { body, ...opts });
  }
  patch(path: string, body?: unknown, opts = {}) {
    return this.request('PATCH', path, { body, ...opts });
  }
  delete(path: string, opts = {}) {
    return this.request('DELETE', path, opts);
  }
}

export async function startTestServer(options: AppOptions = {}) {
  const app = createApp(options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    client: () => new TestClient(baseUrl),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
