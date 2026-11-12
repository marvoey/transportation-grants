import { resolve } from 'path';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { getConfig, logger } from '../../config/config.js';
import { GrantServerError } from '../../types/index.js';
import { assessTurn, AssessmentError } from '../../nofo/service.js';
import { FactsError } from '../../nofo/assessment/facts.js';
import { createInterpretCache, type InterpretCache } from '../../nofo/assessment/interpret.js';
import { createDiscoveryLlm, createSearchSource, isSearchConfigured } from '../../nofo/discovery/default-source.js';
import { DocumentsCache, type AttachmentListSource } from '../../nofo/discovery/documents.js';
import { describeDownloaded, downloadedTotals } from '../../nofo/discovery/downloaded.js';
import { HomeStatsService } from '../../nofo/stats.js';
import { SearchCache } from '../../nofo/discovery/search.js';
import { DiscoverInputSchema, UserMessagesSchema } from '../../nofo/discovery/schemas.js';
import { describeProject } from '../../nofo/discovery/describe.js';
import { DiscoveryError, discoverTurn } from '../../nofo/discovery/service.js';
import type { LlmFn } from '../../nofo/llm.js';
import { SimplerApiError } from '../../nofo/simpler/client.js';
import { AssessInputSchema } from '../../nofo/assessment/schemas.js';
import type { ConsoleFn, ProgressEvent, ProgressFn } from '../../nofo/progress.js';
import { PrepareError, PrepareManager } from '../../nofo/prepare/manager.js';
import { RecentOpportunities } from '../../nofo/prepare/recent.js';
import { createCliRunner } from '../../nofo/prepare/runner.js';
import type { OpportunitySearchSource } from '../../nofo/simpler/source.js';
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
  /**
   * Grant discovery: the Simpler.Grants.gov search. Injected in tests. Default: built from the server's
   * SIMPLER_GRANTS_API_KEY on first use (the key never leaves the server).
   */
  searchSource?: OpportunitySearchSource;
  /** The home page numbers. Default: counted from Simpler.Grants.gov (cached), with a saved snapshot as the fallback. */
  homeStats?: HomeStatsService;
  /** Whether grant search can run. Default: a Simpler key is configured. Tests override it. */
  isSearchConfigured?: () => boolean;
  /**
   * Preparing an opportunity (ingest + extract) for assessment. Injected in tests. Default: a manager that runs the
   * ingest and extract CLIs as child processes.
   */
  prepare?: PrepareManager;
  /** Opportunities shown in recent searches (the only ones the prepare route accepts). Injected in tests. */
  recent?: RecentOpportunities;
  /** Whether the server has the keys that preparing needs (Simpler and Anthropic). Tests override it. */
  isPrepareConfigured?: () => boolean;
  /** Requests per window; tests lower these. */
  limits?: { assessPerWindow?: number; discoverPerWindow?: number; preparePerWindow?: number; readPerWindow?: number; windowMs?: number };
}

const PrepareInputSchema = z.object({ opportunityId: z.string().max(100) }).strict();

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
  if (error instanceof DiscoveryError) {
    return error.code === 'VALIDATION_ERROR'
      ? new GrantServerError('VALIDATION_ERROR', error.message, false)
      : new GrantServerError('API_ERROR', 'The grant search service could not be reached. Please try again in a moment.', true);
  }
  if (error instanceof SimplerApiError) {
    // Messages from this client never contain the key or response content, but the browser only needs the gist.
    return error.kind === 'config'
      ? new GrantServerError('MISSING_CONFIG', 'Grant search needs SIMPLER_GRANTS_API_KEY to be set on the server.', false)
      : new GrantServerError('API_ERROR', 'The grant search service could not be reached. Please try again in a moment.', true);
  }
  if (error instanceof PrepareError) {
    return error.code === 'NOT_FOUND'
      ? new GrantServerError('NOT_FOUND', error.message, false)
      : new GrantServerError('RATE_LIMIT_EXCEEDED', error.message, error.code === 'BUSY');
  }
  if (error instanceof FactsError) return new GrantServerError('VALIDATION_ERROR', error.message, false);
  if (error instanceof PackageCorruptError) return new GrantServerError('API_ERROR', 'The stored data for this opportunity could not be read.', false);
  return error;
}

/**
 * Streams a long-running job as newline-delimited JSON: {"type":"progress",...} lines while it works, then one
 * {"type":"console",...} lines (the Find grants developer console), then one {"type":"result","data":...} line, or one {"type":"error",...} line if it fails (the HTTP status was already sent, so a
 * failure can only be reported in the stream). Errors are translated to generic, safe messages; nothing the
 * person wrote is logged.
 */
async function streamLines(res: Response, work: (onProgress: ProgressFn, onConsole: ConsoleFn) => Promise<unknown>, label: string): Promise<void> {
  res.status(200);
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
  res.flushHeaders();
  const send = (line: Record<string, unknown>): void => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(line) + '\n');
  };
  try {
    const result = await work(
      (event) => send({ type: 'progress', ...event }),
      (line) => send({ type: 'console', kind: line.kind, text: line.text })
    );
    send({ type: 'result', data: result });
  } catch (e) {
    const failure = translate(e);
    logger.error(`${label} stream failed: ${failure instanceof Error ? failure.name : 'error'}`);
    send(
      failure instanceof GrantServerError
        ? { type: 'error', error: failure.message, code: failure.code, retryable: failure.retryable }
        : { type: 'error', error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR', retryable: true }
    );
  } finally {
    res.end();
  }
}

export function createNofoRouter(deps: NofoRouterDeps = {}): Router {
  const router = Router();
  const windowMs = deps.limits?.windowMs ?? parseInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const assessLimit = deps.limits?.assessPerWindow ?? parseInt(process.env.CHAT_RATE_LIMIT_REQUESTS || '10', 10);
  const readLimit = deps.limits?.readPerWindow ?? 120;
  const interpretCache = deps.interpretCache ?? createInterpretCache();
  const store = (): PackageStore => deps.store ?? PackageStore.fromConfig();

  const discoverLimit = deps.limits?.discoverPerWindow ?? assessLimit;
  const searchCache = new SearchCache();
  let defaultSource: OpportunitySearchSource | undefined;
  const searchSource = (): OpportunitySearchSource => deps.searchSource ?? (defaultSource ??= createSearchSource());
  // The same source can list an opportunity's attachments (names only). A source that cannot (a test fake) skips the check.
  const documentsCache = new DocumentsCache();
  const documentSource = (): AttachmentListSource | undefined => {
    const source = searchSource() as Partial<AttachmentListSource>;
    return typeof source.getAttachments === 'function' ? (source as AttachmentListSource) : undefined;
  };

  // The numbers on the home page: answered at once from the last count or a saved snapshot, refreshed in the background.
  const homeStats =
    deps.homeStats ??
    new HomeStatsService({
      source: searchSource,
      configured: () => (deps.searchSource ? true : (deps.isSearchConfigured ?? isSearchConfigured)()),
      snapshotPath: resolve(process.cwd(), 'data/fixtures/simpler-stats-snapshot.json'),
    });

  const prepareLimit = deps.limits?.preparePerWindow ?? 6;
  const recent = deps.recent ?? new RecentOpportunities();
  const prepare =
    deps.prepare ??
    new PrepareManager({
      store,
      recent,
      dailyLimit: parseInt(process.env.PREPARE_DAILY_LIMIT || '5', 10),
      run: createCliRunner({
        ingestTimeoutMs: parseInt(process.env.PREPARE_INGEST_TIMEOUT_MS || '300000', 10),
        extractTimeoutMs: parseInt(process.env.PREPARE_EXTRACT_TIMEOUT_MS || '1200000', 10),
      }),
    });

  const readLimiter = limiter(readLimit, windowMs, 'Too many requests. Please try again later.');
  // Preparing downloads documents and spends model calls, so it is limited tightly.
  const prepareLimiter = limiter(prepareLimit, windowMs, 'Too many requests to prepare opportunities. Please try again later.');
  // Discovery spends a model call and up to four Simpler.Grants.gov searches per request, so it is limited like chat.
  const discoverLimiter = limiter(discoverLimit, windowMs, 'Too many searches. Please try again later.');
  // Assessment spends model calls, so it is limited like chat.
  const assessLimiter = limiter(assessLimit, windowMs, 'Too many assessment requests. Please try again later.');

  // The numbers on the home page. Always answers at once; the counts themselves are refreshed in the background.
  router.get(
    '/stats',
    readLimiter,
    asyncHandler(async (_req: Request, res: Response) => {
      res.set('Cache-Control', NO_STORE);
      const view = await homeStats.get();
      if (!view) throw new GrantServerError('API_ERROR', 'The funding statistics are not available right now.', true);
      res.json(successResponse(view));
    })
  );

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
    '/discover',
    discoverLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const searchReady = deps.searchSource ? true : (deps.isSearchConfigured ?? isSearchConfigured)();
      if (!searchReady) {
        throw new GrantServerError('MISSING_CONFIG', 'Grant search needs SIMPLER_GRANTS_API_KEY to be set on the server.', false);
      }
      // No model key is not an error here: the profile falls back to a keyword reader and the result says so.
      const modelConfigured = deps.isModelConfigured ?? (() => Boolean(getConfig().anthropic.apiKey));
      const llm = deps.llm ?? (modelConfigured() ? createDiscoveryLlm() : null);

      const run = async (onProgress?: (event: ProgressEvent) => void, onConsole?: ConsoleFn) => {
        const result = await discoverTurn(req.body, { source: searchSource(), llm, cache: searchCache, documents: documentSource(), documentsCache, onProgress, onConsole, apiBaseUrl: getConfig().simpler.baseUrl }).catch((e) => { throw translate(e); });
        // Which listed opportunities can be opened in the Assess tab right now (extracted requirements exist here).
        const ready = new Set(
          (await listOpportunities(store()).catch(() => [])).filter((o) => o.requirements.ready).map((o) => o.opportunityId)
        );
        for (const item of result.shortlist) item.readyToAssess = ready.has(item.opportunityId);
        // What a specialist would have to read for the listings whose documents are downloaded here (local files only).
        const downloaded = await Promise.all(result.shortlist.map((item) => describeDownloaded(store(), item.opportunityId).catch(() => null)));
        result.shortlist.forEach((item, i) => {
          const pkg = downloaded[i];
          if (pkg) item.downloaded = pkg;
        });
        const totals = downloadedTotals(result.shortlist);
        if (totals) result.downloaded = totals;
        // Only what was just shown can later be prepared.
        recent.remember(result.shortlist.map((item) => item.opportunityId));
        return result;
      };

      res.set('Cache-Control', NO_STORE);
      if (req.query.stream !== '1') {
        const result = await run();
        res.json(successResponse(result, result.shortlist.length));
        return;
      }

      // Streaming: bad input is rejected here, before any stream starts, so it keeps its normal 400.
      if (!DiscoverInputSchema.safeParse(req.body).success) {
        throw new GrantServerError('VALIDATION_ERROR', 'The request is not valid.', false);
      }
      await streamLines(res, run, 'Discover');
    })
  );

  router.post(
    '/project-description',
    discoverLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = z.object({ messages: UserMessagesSchema }).strict().safeParse(req.body);
      if (!parsed.success) throw new GrantServerError('VALIDATION_ERROR', 'The request is not valid.', false);
      // No model key is not an error: the applicant's own messages are returned instead, and the source says so.
      const modelConfigured = deps.isModelConfigured ?? (() => Boolean(getConfig().anthropic.apiKey));
      const llm = deps.llm ?? (modelConfigured() ? createDiscoveryLlm() : null);
      const description = await describeProject(parsed.data.messages.map((m) => m.content), llm);
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(description));
    })
  );

  router.post(
    '/prepare',
    prepareLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const input = PrepareInputSchema.safeParse(req.body);
      if (!input.success) throw new GrantServerError('VALIDATION_ERROR', 'The request is not valid.', false);
      const id = parseOpportunityId(input.data.opportunityId);

      // Something already prepared needs no keys and no work.
      const current = await prepare.status(id).catch((e) => { throw translate(e); });
      if (current.status !== 'ready') {
        const configured = deps.isPrepareConfigured ?? (() => isSearchConfigured() && Boolean(getConfig().anthropic.apiKey));
        if (!configured()) {
          throw new GrantServerError('MISSING_CONFIG', 'Preparing an opportunity needs both SIMPLER_GRANTS_API_KEY and ANTHROPIC_API_KEY on the server.', false);
        }
      }
      const state = await prepare.start(id).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(state));
    })
  );

  router.get(
    '/prepare/:id',
    readLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const state = await prepare.status(req.params.id).catch((e) => { throw translate(e); });
      res.set('Cache-Control', NO_STORE);
      res.json(successResponse(state));
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
      res.set('Cache-Control', NO_STORE);
      if (req.query.stream !== '1') {
        const result = await assessTurn(req.body, { store: store(), llm: deps.llm, interpretCache }).catch((e) => { throw translate(e); });
        res.json(successResponse(result));
        return;
      }

      // Streaming: refuse bad input and an opportunity without requirements here, with their normal HTTP statuses,
      // before any stream starts.
      const input = AssessInputSchema.safeParse(req.body);
      if (!input.success || !input.data.messages.some((m) => m.role === 'user')) {
        throw new GrantServerError('VALIDATION_ERROR', 'The request is not valid: it needs an opportunity ID and 1-40 messages of at most 4,000 characters each.', false);
      }
      const id = parseOpportunityId(input.data.opportunityId);
      const stored = await store().readRequirements(id).catch((e) => { throw translate(e); });
      if (!stored) throw new GrantServerError('NOT_FOUND', 'This opportunity has no extracted requirements yet, so it cannot be assessed.', false);
      await streamLines(res, (onProgress) => assessTurn(req.body, { store: store(), llm: deps.llm, interpretCache, onProgress }), 'Assess');
    })
  );

  return router;
}
