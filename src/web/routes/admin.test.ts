import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminAuth, requireAdmin } from '../auth/admin-session.js';
import { errorHandler, successResponse } from '../middleware/error-handler.js';
import { createAdminRouter, type AdminRouterDeps } from './admin.js';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'a-session-secret-that-is-at-least-32-chars-long';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

async function start(options: { configured?: boolean; limits?: AdminRouterDeps['limits'] } = {}) {
  const auth = createAdminAuth({ password: PASSWORD, secret: options.configured === false ? '' : SECRET });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRouter({ auth, failureDelayMs: () => 0, limits: options.limits }));
  // A stand-in for any route that Phase 2 will protect.
  app.get('/api/secret', requireAdmin(auth), (_req, res) => res.json(successResponse({ secret: true })));
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function login(base: string, password: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  return fetch(`${base}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ password }) });
}

/** The name=value part of the Set-Cookie header, ready to send back. */
function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('POST /api/admin/login', () => {
  it('sets an HttpOnly, SameSite=Lax cookie for the right password and never returns the token in the body', async () => {
    const base = await start();
    const response = await login(base, PASSWORD);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=28800');
    expect(setCookie).toContain('Path=/');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(cookieFrom(response).split('=')[1]);
  });

  it('refuses a wrong password with 401 and no cookie', async () => {
    const base = await start();
    const response = await login(base, 'wrong password!!');
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(((await response.json()) as { code: string }).code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses anything that is not a JSON body with only a password', async () => {
    const base = await start();
    const form = await login(base, PASSWORD, { 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(415);
    expect(form.headers.get('set-cookie')).toBeNull();
    for (const bad of [undefined, '', 42, { nested: true }, 'x'.repeat(300)]) {
      const response = await login(base, bad);
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    const extra = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD, admin: true }) });
    expect(extra.status).toBe(400);
  });

  it('fails closed with 503 when the secrets are not set, even for the right password', async () => {
    const base = await start({ configured: false });
    const response = await login(base, PASSWORD);
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('locks out after too many failures, but a success is not counted against the admin', async () => {
    const base = await start({ limits: { failuresPerWindow: 2, windowMs: 60_000 } });
    expect((await login(base, PASSWORD)).status).toBe(200);
    expect((await login(base, PASSWORD)).status).toBe(200);
    expect((await login(base, PASSWORD)).status).toBe(200);
    expect((await login(base, 'nope nope nope')).status).toBe(401);
    expect((await login(base, 'nope nope nope')).status).toBe(401);
    const locked = await login(base, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('set-cookie')).toBeNull();
  });

  it('never writes the password to a log, even when the body is malformed JSON', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${JSON.stringify(a)}` : String(a))).join(' ')); };
    vi.spyOn(console, 'info').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'debug').mockImplementation(capture);
    vi.spyOn(console, 'log').mockImplementation(capture);

    const base = await start();
    await login(base, 'hunter2-hunter2');
    await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"hunter2-hunter2"' });
    const ok = await login(base, PASSWORD);

    expect(ok.status).toBe(200);
    const all = lines.join('\n');
    expect(all).not.toContain('hunter2');
    expect(all).not.toContain(PASSWORD);
    expect(all).toContain('admin.login failure');
    expect(all).toContain('admin.login success');
  });
});

describe('the session and requireAdmin', () => {
  it('reports no admin without a cookie, and refuses a gated route with 401', async () => {
    const base = await start();
    const session = await fetch(`${base}/api/admin/session`);
    expect(((await session.json()) as { data: { admin: boolean } }).data.admin).toBe(false);
    expect(session.headers.get('cache-control')).toBe('no-store');
    const gated = await fetch(`${base}/api/secret`);
    expect(gated.status).toBe(401);
    expect(((await gated.json()) as { code: string }).code).toBe('ADMIN_REQUIRED');
  });

  it('accepts the cookie from a login, and refuses a tampered one', async () => {
    const base = await start();
    const cookie = cookieFrom(await login(base, PASSWORD));
    const session = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
    expect(((await session.json()) as { data: { admin: boolean } }).data.admin).toBe(true);
    expect((await fetch(`${base}/api/secret`, { headers: { Cookie: cookie } })).status).toBe(200);

    const tampered = cookie.slice(0, -3) + (cookie.endsWith('abc') ? 'xyz' : 'abc');
    expect((await fetch(`${base}/api/secret`, { headers: { Cookie: tampered } })).status).toBe(401);
  });

  it('logout clears the cookie in the browser', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/admin/logout`, { method: 'POST' });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });
});
