import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { logger } from '../../config/config.js';
import { GrantServerError } from '../../types/index.js';
import { asyncHandler, errorResponse, successResponse } from '../middleware/error-handler.js';
import { ADMIN_SESSION_TTL_MS, auditContext, createAdminAuth, sessionCookie, type AdminAuth } from '../auth/admin-session.js';

/**
 * Admin login, logout and session check. See ../auth/admin-session.ts for how the cookie works.
 *
 *   POST /api/admin/login    { "password": "..." }  -> sets the session cookie
 *   POST /api/admin/logout                          -> clears it
 *   GET  /api/admin/session                         -> { admin: boolean }
 *
 * The password is only ever read from a JSON body: never from a URL or query string, never logged. Every response is
 * `no-store`. A wrong password gets the same answer whatever the reason, after a delay that grows with the number of recent
 * failures from that address, and too many failures in a window are refused outright.
 */

export interface AdminRouterDeps {
  auth?: AdminAuth;
  /** Failed attempts allowed per address per window, and the window. Tests lower these. */
  limits?: { failuresPerWindow?: number; windowMs?: number };
  /** How long to wait before answering a failed login, given the number of failures before this one. Tests return 0. */
  failureDelayMs?: (priorFailures: number) => number;
}

const LoginInputSchema = z.object({ password: z.string().min(1).max(256) }).strict();

const NO_STORE = 'no-store';

/** 0.5 s, 1 s, 2 s, 4 s, then 8 s: slows guessing without locking the real admin out. */
function defaultFailureDelay(priorFailures: number): number {
  return Math.min(500 * 2 ** Math.min(priorFailures, 5), 8000);
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** express-rate-limit records how many requests (here: failed ones) this address has made, including the current one. */
function failuresSoFar(req: Request): number {
  const info = (req as Request & { rateLimit?: { used?: number } }).rateLimit;
  return typeof info?.used === 'number' ? info.used : 1;
}

export function createAdminRouter(deps: AdminRouterDeps = {}): Router {
  const router = Router();
  const auth = deps.auth ?? createAdminAuth();
  const failureDelay = deps.failureDelayMs ?? defaultFailureDelay;

  // Only failed requests count (a successful login is refunded), so the real admin is never blocked by their own use.
  const loginLimiter = rateLimit({
    windowMs: deps.limits?.windowMs ?? 15 * 60 * 1000,
    limit: deps.limits?.failuresPerWindow ?? 8,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      logger.warn(`admin.login lockout ${auditContext(req)}`);
      res
        .status(429)
        .set('Cache-Control', NO_STORE)
        .json(errorResponse('Too many failed attempts. Please wait a few minutes and try again.', 'RATE_LIMIT_EXCEEDED', true));
    },
  });
  const sessionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: errorResponse('Too many requests. Please try again later.', 'RATE_LIMIT_EXCEEDED', true),
  });

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', NO_STORE);

      // JSON only: a plain HTML form post (which a cross-site page could send) is refused, and so is a password in a URL.
      if (!req.is('application/json')) {
        res.status(415).json(errorResponse('Send the password as JSON.', 'VALIDATION_ERROR', false));
        return;
      }
      const input = LoginInputSchema.safeParse(req.body);
      if (!input.success) throw new GrantServerError('VALIDATION_ERROR', 'The request is not valid.', false);

      if (!auth.isConfigured()) {
        // Fail closed. The browser only learns that login is unavailable; the operator reads why in the log.
        logger.error('admin.login unavailable: ADMIN_PASSWORD or ADMIN_SESSION_SECRET is missing or too short');
        throw new GrantServerError('MISSING_CONFIG', 'Admin login is not available.', false);
      }

      if (!auth.checkPassword(input.data.password)) {
        await wait(failureDelay(failuresSoFar(req) - 1));
        logger.warn(`admin.login failure ${auditContext(req)}`);
        res.status(401).json(errorResponse('Incorrect password.', 'INVALID_CREDENTIALS', false));
        return;
      }

      const { token, expiresAt } = auth.issue();
      res.append('Set-Cookie', sessionCookie(req, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000)));
      logger.info(`admin.login success ${auditContext(req)}`);
      res.json(successResponse({ admin: true, expiresAt: new Date(expiresAt).toISOString() }));
    })
  );

  router.post('/logout', sessionLimiter, (req: Request, res: Response) => {
    res.set('Cache-Control', NO_STORE);
    // Clears the cookie in this browser. A stateless token cannot be recalled, so it stays valid until it expires if it was
    // copied elsewhere; changing ADMIN_SESSION_SECRET or ADMIN_PASSWORD signs every session out.
    res.append('Set-Cookie', sessionCookie(req, '', 0));
    logger.info(`admin.logout ${auditContext(req)}`);
    res.json(successResponse({ admin: false }));
  });

  router.get('/session', sessionLimiter, (req: Request, res: Response) => {
    res.set('Cache-Control', NO_STORE);
    res.json(successResponse({ admin: auth.isAdmin(req) }));
  });

  return router;
}
