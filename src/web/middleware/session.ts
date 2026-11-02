import { NextFunction, Request, RequestHandler, Response } from 'express';
import { explicitAllowedOrigins } from '../../projects/project-config.js';
import { ProjectService } from '../../projects/project-service.js';
import { GrantServerError } from '../../types/index.js';

/**
 * Anonymous, server-issued sessions for the project workspace, plus the
 * same-origin (CSRF) check for state-changing requests.
 *
 * The cookie value is an opaque 32-byte random string; only its SHA-256 is
 * stored, mapped to a server-side `ownerId`. Nothing client-supplied (a
 * project UUID, an owner id in a body) is ever treated as authorization.
 */

export const SESSION_COOKIE = 'tg_session';
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by loadSession when the request carries a valid session. */
    ownerId?: string;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!name || name in out) continue; // first occurrence wins
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function isSecureRequest(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function setSessionCookie(req: Request, res: Response, cookieValue: string): void {
  res.cookie(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_MAX_AGE_MS, // persistent: closing the browser must not lose projects
    path: '/',
  });
}

/** Resolves the session cookie to `req.ownerId`. Never creates a session. */
export function loadSession(getService: () => ProjectService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const session = await getService().resolveSession(cookie);
      if (session) req.ownerId = session.ownerId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 401 SESSION_REQUIRED unless loadSession found a valid session. */
export const requireSession: RequestHandler = (req, _res, next) => {
  if (!req.ownerId) {
    next(
      new GrantServerError(
        'SESSION_REQUIRED',
        'No project session found. Your browser may have cleared its cookies, which makes earlier projects unreachable. Create a new project to start again.',
        false
      )
    );
    return;
  }
  next();
};

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function isAllowedOrigin(origin: string | undefined, req: Pick<Request, 'headers'>): boolean {
  if (!origin || origin === 'null') return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (explicitAllowedOrigins().includes(url.origin)) return true;
  // Same origin: the Origin host is the host this request was sent to.
  const host = req.headers.host;
  return !!host && url.host.toLowerCase() === host.toLowerCase();
}

/**
 * CSRF protection for state-changing requests: a matching `Origin` header and
 * `Content-Type: application/json` are both required (403 ORIGIN_REJECTED).
 * Throws; the middleware below and the project-aware chat route both use it.
 */
export function assertSameOrigin(req: Request): void {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const jsonOk = /^application\/json\s*(;|$)/.test(contentType);
  if (!isAllowedOrigin(req.headers.origin as string | undefined, req) || !jsonOk) {
    throw new GrantServerError(
      'ORIGIN_REJECTED',
      'This request was rejected: it must come from this site and use JSON.',
      false
    );
  }
}

/** Express middleware form of assertSameOrigin. Safe methods pass through. */
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  if (!STATE_CHANGING.has(req.method)) {
    next();
    return;
  }
  try {
    assertSameOrigin(req);
    next();
  } catch (err) {
    next(err);
  }
};
