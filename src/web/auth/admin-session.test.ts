import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, SECURE_COOKIE_NAME, createAdminAuth, parseCookies, sessionCookie } from './admin-session.js';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'a-session-secret-that-is-at-least-32-chars-long';

function make(overrides: { password?: string; secret?: string; now?: () => number; ttlMs?: number } = {}) {
  return createAdminAuth({ password: PASSWORD, secret: SECRET, ...overrides });
}

function fakeRequest(options: { secure?: boolean; cookie?: string } = {}): Request {
  return { secure: options.secure ?? false, headers: { cookie: options.cookie } } as unknown as Request;
}

describe('admin configuration (fails closed)', () => {
  it('is configured only when both values are long enough', () => {
    expect(make().isConfigured()).toBe(true);
    expect(make({ password: 'too short' }).isConfigured()).toBe(false);
    expect(make({ password: '' }).isConfigured()).toBe(false);
    expect(make({ secret: 'short' }).isConfigured()).toBe(false);
    expect(make({ secret: '' }).isConfigured()).toBe(false);
  });

  it('refuses every password and verifies no token when it is not configured', () => {
    const open = make({ secret: '' });
    expect(open.checkPassword(PASSWORD)).toBe(false);
    expect(open.checkPassword('')).toBe(false);
    const issuedElsewhere = make().issue().token;
    expect(open.verify(issuedElsewhere)).toBe(false);
  });
});

describe('checkPassword', () => {
  it('accepts the password and nothing else', () => {
    const auth = make();
    expect(auth.checkPassword(PASSWORD)).toBe(true);
    expect(auth.checkPassword(PASSWORD + ' ')).toBe(false);
    expect(auth.checkPassword(PASSWORD.toUpperCase())).toBe(false);
    expect(auth.checkPassword('')).toBe(false);
  });
});

describe('session tokens', () => {
  it('verifies a token it issued, until it expires', () => {
    let clock = 1_800_000_000_000;
    const auth = make({ now: () => clock, ttlMs: 60_000 });
    const { token, expiresAt } = auth.issue();
    expect(expiresAt).toBe(clock + 60_000);
    expect(auth.verify(token)).toBe(true);
    clock += 59_999;
    expect(auth.verify(token)).toBe(true);
    clock += 2;
    expect(auth.verify(token)).toBe(false);
  });

  it('rejects a token whose expiry was changed', () => {
    const auth = make();
    const [version, exp, signature] = auth.issue().token.split('.');
    const later = String(Number(exp) + 10 * 24 * 3600 * 1000);
    expect(auth.verify(`${version}.${later}.${signature}`)).toBe(false);
  });

  it('rejects a damaged signature, a wrong version and garbage', () => {
    const auth = make();
    const token = auth.issue().token;
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(auth.verify(flipped)).toBe(false);
    expect(auth.verify(token.replace(/^v1/, 'v2'))).toBe(false);
    for (const junk of [undefined, '', 'x', 'a.b.c', '..', 'v1..', `${token}.extra`, 'v1.1.' + 'A'.repeat(500)]) {
      expect(auth.verify(junk)).toBe(false);
    }
  });

  it('is signed with both the secret and the password, so changing either signs everyone out', () => {
    const token = make().issue().token;
    expect(make({ secret: SECRET + 'x' }).verify(token)).toBe(false);
    expect(make({ password: PASSWORD + 'x' }).verify(token)).toBe(false);
    expect(make().verify(token)).toBe(true);
  });
});

describe('isAdmin', () => {
  it('reads the cookie in either of its two names', () => {
    const auth = make();
    const { token } = auth.issue();
    expect(auth.isAdmin(fakeRequest({ cookie: `${COOKIE_NAME}=${token}` }))).toBe(true);
    expect(auth.isAdmin(fakeRequest({ cookie: `other=1; ${SECURE_COOKIE_NAME}=${token}` }))).toBe(true);
    expect(auth.isAdmin(fakeRequest({ cookie: `${COOKIE_NAME}=nope` }))).toBe(false);
    expect(auth.isAdmin(fakeRequest())).toBe(false);
  });
});

describe('parseCookies', () => {
  it('splits a header, keeps the first value of a name and skips malformed pieces', () => {
    const cookies = parseCookies('a=1; b=2; a=3; =x; novalue');
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('b')).toBe('2');
    expect(cookies.size).toBe(2);
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('a=' + 'x'.repeat(5000)).size).toBe(0);
  });
});

describe('sessionCookie', () => {
  it('is HttpOnly, SameSite=Lax and, outside plain-http development, Secure with the __Host- name', () => {
    const secure = sessionCookie(fakeRequest({ secure: true }), 'tok', 28800);
    expect(secure).toContain(`${SECURE_COOKIE_NAME}=tok`);
    for (const part of ['Max-Age=28800', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure']) expect(secure).toContain(part);
    expect(secure).not.toContain('Domain');

    const previousVercel = process.env.VERCEL;
    const previousEnv = process.env.NODE_ENV;
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'development';
    try {
      const local = sessionCookie(fakeRequest({ secure: false }), 'tok', 28800);
      expect(local).toContain(`${COOKIE_NAME}=tok`);
      expect(local).toContain('HttpOnly');
      expect(local).not.toContain('Secure');
    } finally {
      if (previousVercel !== undefined) process.env.VERCEL = previousVercel;
      process.env.NODE_ENV = previousEnv;
    }
  });
});
