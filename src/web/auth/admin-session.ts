import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../config/config.js';
import { errorResponse } from '../middleware/error-handler.js';

/**
 * Admin login for a stateless (serverless) deployment.
 *
 * One shared password (ADMIN_PASSWORD) is exchanged for a signed, expiring cookie. Nothing is stored on the server:
 * the cookie carries only its own expiry and an HMAC over it.
 *
 *   token = "v1.<expiry in ms>.<base64url HMAC-SHA256>"
 *
 * The HMAC key is derived from BOTH ADMIN_SESSION_SECRET and ADMIN_PASSWORD, so changing either one signs every admin out
 * (this is also the only way to revoke a session early, because there is no server-side session list).
 *
 * Fail closed: if either value is missing or too short, nobody can log in and no token verifies. Values are read from the
 * environment on every call, never cached, so a rotated secret takes effect on the next request.
 */

export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Used over plain http (local development) only. */
export const COOKIE_NAME = 'grantflow_admin';
/** The __Host- prefix makes browsers refuse the cookie unless it is Secure, has Path=/ and names no Domain. */
export const SECURE_COOKIE_NAME = '__Host-grantflow_admin';

const TOKEN_VERSION = 'v1';
const MAX_COOKIE_VALUE = 256;

export interface AdminAuthOptions {
  /** Override ADMIN_PASSWORD (tests). */
  password?: string;
  /** Override ADMIN_SESSION_SECRET (tests). */
  secret?: string;
  now?: () => number;
  ttlMs?: number;
}

export interface AdminAuth {
  /** Both secrets are present and long enough. */
  isConfigured(): boolean;
  /** Constant-time comparison. Always false when not configured. */
  checkPassword(candidate: string): boolean;
  issue(): { token: string; expiresAt: number };
  verify(token: string | undefined): boolean;
  /** Whether this request carries a valid admin cookie. */
  isAdmin(req: Request): boolean;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function createAdminAuth(options: AdminAuthOptions = {}): AdminAuth {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? ADMIN_SESSION_TTL_MS;
  const password = (): string => options.password ?? process.env.ADMIN_PASSWORD ?? '';
  const secret = (): string => options.secret ?? process.env.ADMIN_SESSION_SECRET ?? '';

  const isConfigured = (): boolean => password().length >= MIN_ADMIN_PASSWORD_LENGTH && secret().length >= MIN_SESSION_SECRET_LENGTH;

  function signature(payload: string): Buffer {
    const key = createHmac('sha256', secret()).update(`grantflow-admin-session\0${password()}`).digest();
    return createHmac('sha256', key).update(payload).digest();
  }

  function checkPassword(candidate: string): boolean {
    if (!isConfigured() || typeof candidate !== 'string') return false;
    // Hashing both sides first gives timingSafeEqual two buffers of equal length, so the length of the password never leaks.
    return timingSafeEqual(sha256(candidate), sha256(password()));
  }

  function issue(): { token: string; expiresAt: number } {
    const expiresAt = now() + ttlMs;
    const payload = `${TOKEN_VERSION}.${expiresAt}`;
    return { token: `${payload}.${b64url(signature(payload))}`, expiresAt };
  }

  function verify(token: string | undefined): boolean {
    if (!isConfigured() || typeof token !== 'string' || token.length === 0 || token.length > MAX_COOKIE_VALUE) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !/^\d{10,16}$/.test(parts[1])) return false;
    const given = Buffer.from(parts[2], 'base64url');
    const expected = signature(`${parts[0]}.${parts[1]}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return Number(parts[1]) > now();
  }

  function isAdmin(req: Request): boolean {
    const cookies = parseCookies(req.headers.cookie);
    return verify(cookies.get(SECURE_COOKIE_NAME)) || verify(cookies.get(COOKIE_NAME));
  }

  return { isConfigured, checkPassword, issue, verify, isAdmin };
}

/** Reads a Cookie header into a map. The first value of a name wins; malformed pieces are skipped. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header || header.length > 4096) return cookies;
  for (const piece of header.split(';')) {
    const at = piece.indexOf('=');
    if (at < 1) continue;
    const name = piece.slice(0, at).trim();
    if (!cookies.has(name)) cookies.set(name, piece.slice(at + 1).trim());
  }
  return cookies;
}

/**
 * Secure everywhere except plain-http local development. Behind Vercel's proxy `req.secure` is true because the app
 * trusts the first proxy hop (see api-server.ts); VERCEL and NODE_ENV are a second guard in case that setting is lost.
 */
export function useSecureCookie(req: Request): boolean {
  return req.secure || Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

export function cookieNameFor(req: Request): string {
  return useSecureCookie(req) ? SECURE_COOKIE_NAME : COOKIE_NAME;
}

/** The Set-Cookie value that stores a session. `maxAgeSeconds` of 0 clears it (same attributes, as browsers require). */
export function sessionCookie(req: Request, token: string, maxAgeSeconds: number): string {
  return [
    `${cookieNameFor(req)}=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(useSecureCookie(req) ? ['Secure'] : []),
  ].join('; ');
}

/** A value that is safe to put in a log line: no control characters, no spaces, bounded length. */
function logSafe(value: unknown): string {
  return String(value ?? '').replace(/[^\w.:-]/g, '').slice(0, 64) || '-';
}

/** Who and where, for a security log line. Never includes a password, cookie or request body. */
export function auditContext(req: Request): string {
  const vercelId = typeof req.headers['x-vercel-id'] === 'string' ? req.headers['x-vercel-id'] : undefined;
  return `ip=${logSafe(req.ip)} req=${logSafe(vercelId)}`;
}

/**
 * The one place that decides whether a route is admin-only. Put it in front of anything that must not be public:
 * `router.post('/x', requireAdmin(auth), handler)`. The refusal is logged (who, what, where) and carries no detail.
 */
export function requireAdmin(auth: AdminAuth): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (auth.isAdmin(req)) {
      next();
      return;
    }
    logger.warn(`admin.denied ${req.method} ${req.path} ${auditContext(req)}`);
    res.status(401).set('Cache-Control', 'no-store').json(errorResponse('Admin login required.', 'ADMIN_REQUIRED', false));
  };
}
