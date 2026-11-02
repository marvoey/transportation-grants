import { Router, Request, Response } from 'express';
import { getConfig } from '../../config/config.js';
import { classifyIntent } from '../chat/classifier-agent.js';
import { runRetrieval } from '../chat/retrieval-agent.js';
import { draftReply } from '../chat/drafting-agent.js';
import { ChatRequestSchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';
import { GrantServerError } from '../../types/index.js';
import { isProjectDiscoveryEnabled } from '../../projects/project-config.js';
import { ProjectService } from '../../projects/project-service.js';
import { ProjectContext, buildProjectContext } from '../../projects/project-context.js';
import { SESSION_COOKIE, assertSameOrigin, parseCookies } from '../middleware/session.js';
import { getProjectService } from '../project-service-factory.js';

export interface ChatRouterDeps {
  getService: () => ProjectService;
}

/**
 * Resolves the optional project for a chat request. Ownership comes only from
 * the session cookie; a project the session cannot see (missing, deleted, not
 * owned, feature off, no session) is one indistinguishable 404 PROJECT_NOT_FOUND.
 */
async function resolveProjectContext(
  req: Request,
  projectId: string,
  getService: () => ProjectService
): Promise<ProjectContext> {
  const notFound = () => new GrantServerError('PROJECT_NOT_FOUND', 'Project not found.', false);
  if (!isProjectDiscoveryEnabled()) throw notFound();
  // Project-aware chat carries a cookie, so it gets the same CSRF protection as project routes.
  assertSameOrigin(req);
  const service = getService();
  const session = await service.resolveSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!session) throw notFound();
  const { project } = await service.getProject(session.ownerId, projectId);
  return buildProjectContext(project);
}

/**
 * POST /api/chat
 * Natural-language chat backed by the Anthropic Messages API, split into
 * three stages: classify the intent (src/web/chat/classifier-agent.ts),
 * retrieve facts with the MCP tools scoped to that intent
 * (src/web/chat/retrieval-agent.ts, reusing src/mcp/tool-schemas.ts /
 * tool-executor.ts), then draft the final reply from those facts
 * (src/web/chat/drafting-agent.ts).
 *
 * With an optional `projectId`, a bounded read-only profile context is passed
 * to retrieval (default tool arguments) and drafting (tailoring). The
 * classifier never sees it, so profile text cannot influence which tools run.
 */
export function createChatRouter(deps: ChatRouterDeps = { getService: getProjectService }): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const validation = validateParams(ChatRequestSchema, req.body);
      if (!validation.success) {
        res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
        return;
      }

      const projectId = validation.data.projectId;
      const project = projectId ? await resolveProjectContext(req, projectId, deps.getService) : undefined;

      const config = getConfig();
      if (!config.anthropic.apiKey) {
        throw new GrantServerError(
          'MISSING_CONFIG',
          'ANTHROPIC_API_KEY environment variable is required for chat. Please set it in your .env file.',
          false
        );
      }

      const messages: any[] = validation.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const intent = await classifyIntent(messages);
      const { facts, toolCalls } = await runRetrieval(intent, messages, project?.structured);
      let reply = await draftReply(messages, facts, project?.text);

      if (!reply) {
        reply = "I wasn't able to finish answering that — please try rephrasing your question.";
      }

      res.json(
        successResponse(
          project
            ? { reply, toolCalls, context: { projectId: project.projectId, revision: project.revision } }
            : { reply, toolCalls }
        )
      );
    })
  );

  return router;
}

