import { RequestHandler, Router, Request } from 'express';
import { CreateProjectInput, ProjectService } from '../../projects/project-service.js';
import { GrantServerError } from '../../types/index.js';
import { asyncHandler, successResponse } from '../middleware/error-handler.js';
import { requireSameOrigin, requireSession, setSessionCookie } from '../middleware/session.js';

export interface ProjectsRouterDeps {
  getService: () => ProjectService;
  /** Extra limiters for the model-calling route (per session and per IP). */
  discoveryLimiters?: RequestHandler[];
}

function badRequest(message: string): GrantServerError {
  return new GrantServerError('VALIDATION_ERROR', `Validation error: ${message}`, false);
}

/** Query-string value -> a single string, or undefined. Arrays/objects are rejected. */
function queryString(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw badRequest(`${name} must be a single value`);
  return v;
}

function queryInt(req: Request, name: string): number | undefined {
  const v = queryString(req, name);
  if (v === undefined) return undefined;
  if (!/^\d{1,16}$/.test(v)) throw badRequest(`${name} must be a positive integer`);
  return Number(v);
}

/**
 * Project CRUD routes. Mounted at /api/projects behind the feature flag,
 * session loading and rate limiters (see api-server.ts). Every handler
 * derives the owner from the session — never from the request body.
 */
export function createProjectsRouter(deps: ProjectsRouterDeps): Router {
  const router = Router();
  const svc = () => deps.getService();

  // Create — the only route that may issue a session.
  router.post(
    '/',
    requireSameOrigin,
    asyncHandler(async (req, res) => {
      // Validate before issuing a session so bad requests cannot fill the sessions table.
      const parsed = CreateProjectInput.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest(parsed.error.errors.map((e) => `${e.path.join('.') || 'body'}: ${e.message}`).join('; '));
      }
      let ownerId = req.ownerId;
      if (!ownerId) {
        const session = await svc().createSession();
        setSessionCookie(req, res, session.cookieValue);
        ownerId = session.ownerId;
      }
      const result = await svc().createProject(ownerId, parsed.data);
      res.status(201).json(successResponse(result));
    })
  );

  // List — without a session this returns an empty list and creates nothing.
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.ownerId) {
        res.json(successResponse({ items: [], nextCursor: null }));
        return;
      }
      const input: Record<string, unknown> = {};
      const cursor = queryString(req, 'cursor');
      const limit = queryInt(req, 'limit');
      const status = queryString(req, 'status');
      if (cursor !== undefined) input.cursor = cursor;
      if (limit !== undefined) input.limit = limit;
      if (status !== undefined) input.status = status;
      res.json(successResponse(await svc().listProjects(req.ownerId, input)));
    })
  );

  const mutating: RequestHandler[] = [requireSameOrigin, requireSession];

  router.get(
    '/:id',
    requireSession,
    asyncHandler(async (req, res) => {
      res.json(successResponse(await svc().getProject(req.ownerId!, req.params.id)));
    })
  );

  router.patch(
    '/:id',
    ...mutating,
    asyncHandler(async (req, res) => {
      res.json(successResponse(await svc().patchProject(req.ownerId!, req.params.id, req.body)));
    })
  );

  router.post(
    '/:id/status',
    ...mutating,
    asyncHandler(async (req, res) => {
      res.json(successResponse(await svc().setStatus(req.ownerId!, req.params.id, req.body)));
    })
  );

  // DELETE carries its inputs in the query string (some proxies drop DELETE bodies).
  router.delete(
    '/:id',
    ...mutating,
    asyncHandler(async (req, res) => {
      const input = {
        expectedRevision: queryInt(req, 'expectedRevision'),
        requestId: queryString(req, 'requestId'),
      };
      res.json(successResponse(await svc().deleteProject(req.ownerId!, req.params.id, input)));
    })
  );

  // ---- discovery ----------------------------------------------------------

  const pageInput = (req: Request) => {
    const input: Record<string, unknown> = {};
    const cursor = queryString(req, 'cursor');
    const limit = queryInt(req, 'limit');
    if (cursor !== undefined) input.cursor = cursor;
    if (limit !== undefined) input.limit = limit;
    return input;
  };

  router.get(
    '/:id/discovery/messages',
    requireSession,
    asyncHandler(async (req, res) => {
      res.json(successResponse(await svc().listMessages(req.ownerId!, req.params.id, pageInput(req))));
    })
  );

  router.get(
    '/:id/discovery/suggestions',
    requireSession,
    asyncHandler(async (req, res) => {
      const state = queryString(req, 'state');
      res.json(successResponse(await svc().listSuggestions(req.ownerId!, req.params.id, state ? { state } : {})));
    })
  );

  router.post(
    '/:id/discovery',
    ...mutating,
    ...(deps.discoveryLimiters ?? []),
    asyncHandler(async (req, res) => {
      res.json(successResponse(await svc().runDiscoveryTurn(req.ownerId!, req.params.id, req.body)));
    })
  );

  router.post(
    '/:id/discovery/suggestions/:suggestionId/apply',
    ...mutating,
    asyncHandler(async (req, res) => {
      res.json(
        successResponse(await svc().applySuggestion(req.ownerId!, req.params.id, req.params.suggestionId, req.body))
      );
    })
  );

  router.post(
    '/:id/discovery/suggestions/:suggestionId/dismiss',
    ...mutating,
    asyncHandler(async (req, res) => {
      res.json(
        successResponse(await svc().dismissSuggestion(req.ownerId!, req.params.id, req.params.suggestionId, req.body))
      );
    })
  );

  return router;
}
