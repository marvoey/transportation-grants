import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getConfig } from '../../config/config.js';
import { GrantServerError } from '../../types/index.js';
import { assessTurn, AssessmentError } from '../../nofo/service.js';
import { FactsError } from '../../nofo/assessment/facts.js';
import { createInterpretCache, type InterpretCache } from '../../nofo/assessment/interpret.js';
import type { LlmFn } from '../../nofo/llm.js';
import { DOCUMENT_ID_PATTERN, parseOpportunityId } from '../../nofo/schemas.js';
import { PackageCorruptError, PackageStore } from '../../nofo/store.js';
import { SourceNotFoundError, getOriginalPdf, getSourceLocation, listOpportunities } from '../../nofo/sources.js';
import { asyncHandler, successResponse } from '../middleware/error-handler.js';

/**
 * NOFO applicant assessment, for the browser. Read-only over the local
 * packages produced by the operator CLIs (`nofo:ingest`, `nofo:extract`):
 * nothing here fetches from Simpler, parses a document or extracts
 * requirements. Errors are generic; message text and project facts are never
 * logged.
 */

export interface NofoRouterDeps {
  store?: PackageStore;
  /** Injected in tests. Default: the Anthropic client, created per request so a missing key is a clean 503. */
  llm?: LlmFn;
  interpretCache?: InterpretCache;
  /** Whether the server can reach a model. Default: an Anthropic key is configured. Tests override it. */
  isModelConfigured?: () => boolean;
  /** Requests per window; tests lower these. */
  limits?: { assessPerWindow?: number; readPerWindow?: number; windowMs?: number };
}

const PAGE_PATTERN = /^\d{1,5}$/;
const SECTION_PATTERN = /^s\d{1,5}(\.\d{1,3})?$/;
const NO_STORE = 'no-store';

function limiter(limit: number, windowMs: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: message, code: 'RATE_LIMIT_EXCEEDED', retryable: true },
  });
}

function documentId(value: string): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) throw new GrantServerError('NOT_FOUND', 'Document not found.', false);
  return value;
}

function translate(error: unknown): unknown {
  if (error instanceof SourceNotFoundError) return new GrantServerError('NOT_FOUND', error.message, false);
  if (error instanceof AssessmentError) {
    return error.code === 'NOT_FOUND'
      ? new GrantServerError('NOT_FOUND', 'This opportunity has no extracted requirements yet, so it cannot be assessed.', false)
      : new GrantServerError('VALIDATION_ERROR', error.message, false);
  }
  if (error instanceof FactsError) return new GrantServerError('VALIDATION_ERROR', error.message, false);
  if (error instanceof PackageCorruptError) return new GrantServerError('API_ERROR', 'The stored data for this opportunity could not be read.', false);
  return error;
}

export function createNofoRouter(deps: NofoRouterDeps = {}): Router {
  const router = Router();
  const windowMs = deps.limits?.windowMs ?? parseInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const assessLimit = deps.limits?.assessPerWindow ?? parseInt(process.env.CHAT_RATE_LIMIT_REQUESTS || '10', 10);
  const readLimit = deps.limits?.readPerWindow ?? 120;
  const interpretCache = deps.interpretCache ?? createInterpretCache();
  const store = (): PackageStore => deps.store ?? PackageStore.fromConfig();

  const readLimiter = limiter(readLimit, windowMs, 'Too many requests. Please try again later.');
  // Assessment spends model calls, so it is limited like chat.
  const assessLimiter = limiter(assessLimit, windowMs, 'Too many assessment requests. Please try again later.');

  router.get(
    '/opportunities',
    readLimiter,
    asyncHandler(async (_req: Request, res: Response) => {
      const opportunities = await listOpportunities(store()).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse({ opportunities }, opportunities.length));
    })
  );

  router.get(
    '/opportunities/:id/documents/:docId/pages/:page',
    readLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const id = parseOpportunityId(req.params.id);
      if (!PAGE_PATTERN.test(req.params.page)) throw new GrantServerError('NOT_FOUND', 'Page not found.', false);
      const location = await getSourceLocation(store(), id, documentId(req.params.docId), { page: Number(req.params.page) }).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(location));
    })
  );

  router.get(
    '/opportunities/:id/documents/:docId/sections/:section',
    readLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const id = parseOpportunityId(req.params.id);
      if (!SECTION_PATTERN.test(req.params.section)) throw new GrantServerError('NOT_FOUND', 'Section not found.', false);
      const location = await getSourceLocation(store(), id, documentId(req.params.docId), { section: req.params.section }).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(location));
    })
  );

  router.get(
    '/opportunities/:id/documents/:docId/original',
    readLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const id = parseOpportunityId(req.params.id);
      const { bytes, fileName } = await getOriginalPdf(store(), id, documentId(req.params.docId)).catch((e) => { throw translate(e); });
      // Served as a PDF only, never sniffed, never as an attachment of another type. The name is server-generated.
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=300',
      });
      res.send(bytes);
    })
  );

  router.post(
    '/assess',
    assessLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const configured = deps.isModelConfigured ?? (() => Boolean(getConfig().anthropic.apiKey));
      if (!deps.llm && !configured()) {
        throw new GrantServerError('MISSING_CONFIG', 'The assessment needs ANTHROPIC_API_KEY to be set on the server.', false);
      }
      const result = await assessTurn(req.body, { store: store(), llm: deps.llm, interpretCache }).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(result));
    })
  );

  return router;
}
