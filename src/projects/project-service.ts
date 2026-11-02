import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { GrantServerError } from '../types/index.js';
import { ChangeError, applyChanges, basisHolds, hasValue, validateChange } from './field-paths.js';
import type { AgentInput, AgentResult, DiscoveryDeps } from './discovery-types.js';
import { REQUIRED_COUNT, computeReadiness } from './readiness.js';
import {
  ChangeInputSchema,
  DiscoveryMessage,
  DiscoveryRequestRecord,
  LIMITS,
  Profile,
  Project,
  ProjectSchema,
  ReadinessAssessment,
  StoredChange,
  SuggestionBatch,
  ProjectStatus,
  ProjectStatusSchema,
  SCHEMA_VERSION,
  boundedString,
  emptyProfile,
} from './schemas.js';
import type { ProjectStore, StoreData } from './project-store.js';
import { canonicalJson, sha256Hex } from './util.js';

/**
 * Project domain service: ownership, revisions, readiness, idempotency.
 * Every method takes a server-derived `ownerId`; nothing here trusts a
 * client-supplied identity. Storage and time/ids are injected for tests.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface ServiceLimits {
  maxProjectsPerOwner: number;
  maxMessagesPerProject: number;
}

export const DEFAULT_LIMITS: ServiceLimits = {
  maxProjectsPerOwner: 25,
  maxMessagesPerProject: 200,
};

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): ServiceLimits {
  const num = (v: string | undefined, d: number) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxProjectsPerOwner: num(env.PROJECT_MAX_PER_SESSION, DEFAULT_LIMITS.maxProjectsPerOwner),
    maxMessagesPerProject: num(env.PROJECT_MAX_MESSAGES, DEFAULT_LIMITS.maxMessagesPerProject),
  };
}

export interface ServiceOptions {
  store: ProjectStore;
  /** Discovery agent and its limits. Without it, discovery turns fail with AI_UNAVAILABLE. */
  discovery?: DiscoveryDeps;
  now?: () => Date;
  newId?: () => string;
  limits?: Partial<ServiceLimits>;
}

// ---------------------------------------------------------------------------
// Inputs

export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'requestId must be 8-64 URL-safe characters');
const RevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const CreateProjectInput = z.object({ name: boundedString(LIMITS.name), requestId: RequestIdSchema }).strict();
export const PatchProjectInput = z
  .object({
    expectedRevision: RevisionSchema,
    requestId: RequestIdSchema,
    changes: z.array(ChangeInputSchema).min(1).max(LIMITS.changesMax),
  })
  .strict();
export const StatusInput = z
  .object({ expectedRevision: RevisionSchema, requestId: RequestIdSchema, status: ProjectStatusSchema })
  .strict();
export const DeleteInput = z.object({ expectedRevision: RevisionSchema, requestId: RequestIdSchema }).strict();

export const DiscoveryTurnInput = z
  .object({ message: boundedString(LIMITS.messageMax), expectedRevision: RevisionSchema, requestId: RequestIdSchema })
  .strict();
export const ApplyInput = z
  .object({
    expectedRevision: RevisionSchema,
    requestId: RequestIdSchema,
    acceptedChangeIds: z.array(z.string().min(1).max(LIMITS.idMax)).max(LIMITS.changesMax),
  })
  .strict();
export const DismissInput = z.object({ requestId: RequestIdSchema }).strict();
export const PageInput = z
  .object({ cursor: z.string().max(LIMITS.idMax).optional(), limit: z.number().int().min(1).max(100).optional() })
  .strict();
export const SuggestionListInput = z
  .object({ state: z.enum(['pending', 'applied', 'dismissed', 'stale']).optional() })
  .strict();

export const ListInput = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    status: ProjectStatusSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Outputs

/** What clients see: the stored record without the owner principal. */
export type PublicProject = Omit<Project, 'ownerId'>;

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completeCount: number;
  requiredCount: number;
}

export interface DiscoveryTurnResult {
  userMessage: DiscoveryMessage;
  assistantMessage: DiscoveryMessage;
  questions: Array<{ field: string; text: string }>;
  suggestedNextStep: string;
  /** The batch created by this turn (null if the model proposed nothing). Current state, so a replay may differ. */
  batch: SuggestionBatch | null;
  revision: number;
  readiness: ReadinessAssessment;
}

/** Old non-pending batches are trimmed beyond this, keeping the file bounded. */
const MAX_BATCHES_PER_PROJECT = 20;

export function toPublicProject(p: Project): PublicProject {
  const { ownerId: _owner, ...rest } = p;
  return rest;
}

function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.profile.name,
    status: p.status,
    revision: p.revision,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    completeCount: p.readinessAssessment.completeCount,
    requiredCount: p.readinessAssessment.requiredCount,
  };
}

export function fail(code: string, message: string, retryable = false): GrantServerError {
  return new GrantServerError(code, message, retryable);
}

function parseInput<T>(schema: z.ZodType<T, any, any>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.errors.map((e) => `${e.path.join('.') || 'body'}: ${e.message}`).join('; ');
    throw fail('VALIDATION_ERROR', `Validation error: ${msg}`);
  }
  return r.data;
}

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['ready', 'archived'],
  ready: ['draft', 'archived'],
  archived: ['draft'],
};

// ---------------------------------------------------------------------------

export class ProjectService {
  readonly store: ProjectStore;
  readonly limits: ServiceLimits;
  protected readonly now: () => Date;
  protected readonly newId: () => string;
  readonly discovery?: DiscoveryDeps;

  constructor(opts: ServiceOptions) {
    this.store = opts.store;
    this.discovery = opts.discovery;
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
  }

  // ---- sessions ----------------------------------------------------------

  /** Issues an anonymous session. Only `POST /api/projects` may call this. */
  async createSession(): Promise<{ cookieValue: string; ownerId: string }> {
    const cookieValue = randomBytes(32).toString('base64url');
    const ownerId = this.newId();
    const id = sha256Hex(cookieValue);
    const createdAt = this.now().toISOString();
    await this.store.transaction((d) => {
      d.sessions[id] = { id, ownerId, createdAt };
    });
    return { cookieValue, ownerId };
  }

  /** Resolves a cookie value to its owner without creating or touching anything. */
  async resolveSession(cookieValue: string | undefined): Promise<{ ownerId: string } | null> {
    if (!cookieValue || cookieValue.length > 200) return null;
    const id = sha256Hex(cookieValue);
    return this.store.read((d) => {
      const s = d.sessions[id];
      return s ? { ownerId: s.ownerId } : null;
    });
  }

  // ---- idempotency -------------------------------------------------------

  protected idemKey(ownerId: string, operation: string, projectId: string | null, requestId: string): string {
    return [ownerId, operation, projectId ?? '', requestId].join('|');
  }

  /** Returns a stored result on replay; throws IDEMPOTENCY_CONFLICT if the body differs. */
  protected idemLookup(d: StoreData, key: string, body: unknown): { result: unknown } | undefined {
    const cutoff = this.now().getTime() - IDEMPOTENCY_TTL_MS;
    for (const k of Object.keys(d.idempotency)) {
      if (Date.parse(d.idempotency[k].createdAt) < cutoff) delete d.idempotency[k];
    }
    const rec = d.idempotency[key];
    if (!rec) return undefined;
    if (rec.bodyHash !== sha256Hex(canonicalJson(body))) {
      throw fail('IDEMPOTENCY_CONFLICT', 'This requestId was already used with a different request body.');
    }
    return { result: structuredClone(rec.result) };
  }

  protected idemStore(d: StoreData, key: string, body: unknown, result: unknown, projectId: string | null): void {
    d.idempotency[key] = {
      bodyHash: sha256Hex(canonicalJson(body)),
      result: structuredClone(result),
      projectId,
      createdAt: this.now().toISOString(),
    };
  }

  // ---- lookups -----------------------------------------------------------

  /** Missing, deleted and not-owned are indistinguishable. */
  protected loadOwned(d: Readonly<StoreData>, ownerId: string, projectId: string): Project {
    const p = Object.prototype.hasOwnProperty.call(d.projects, projectId) ? d.projects[projectId] : undefined;
    if (!p || p.ownerId !== ownerId) throw fail('PROJECT_NOT_FOUND', 'Project not found.');
    const parsed = ProjectSchema.safeParse(p);
    if (!parsed.success) throw fail('INTERNAL_ERROR', 'Stored project is invalid.', false);
    return parsed.data;
  }

  protected requireRevision(p: Project, expected: number): void {
    if (p.revision !== expected) {
      throw fail('REVISION_CONFLICT', 'This project changed since you loaded it. Reload to see the latest version.');
    }
  }

  protected requireWritable(p: Project): void {
    if (p.status === 'archived') {
      throw fail('PROJECT_ARCHIVED', 'This project is archived. Restore it to make changes.');
    }
  }

  // ---- CRUD --------------------------------------------------------------

  async createProject(ownerId: string, input: unknown): Promise<{ project: PublicProject }> {
    const body = parseInput(CreateProjectInput, input);
    const { requestId, ...rest } = body;
    return this.store.transaction((d) => {
      const key = this.idemKey(ownerId, 'project.create', null, requestId);
      const hit = this.idemLookup(d, key, rest);
      if (hit) return hit.result as { project: PublicProject };

      const owned = Object.values(d.projects).filter((p) => p.ownerId === ownerId).length;
      if (owned >= this.limits.maxProjectsPerOwner) {
        throw fail(
          'LIMIT_EXCEEDED',
          `You can have at most ${this.limits.maxProjectsPerOwner} projects. Delete one to create another.`
        );
      }

      const now = this.now().toISOString();
      const profile = emptyProfile(rest.name);
      const project: Project = {
        id: this.newId(),
        ownerId,
        schemaVersion: SCHEMA_VERSION,
        revision: 1,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        profile,
        fieldMetadata: { name: { source: 'user_edit', messageId: null, confirmedAt: now } },
        readinessAssessment: computeReadiness(profile),
      };
      d.projects[project.id] = project;
      const result = { project: toPublicProject(project) };
      this.idemStore(d, key, rest, result, project.id);
      return result;
    });
  }

  async listProjects(
    ownerId: string,
    input: unknown = {}
  ): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
    const { cursor, limit = 25, status } = parseInput(ListInput, input);
    let after: { updatedAt: string; id: string } | null = null;
    if (cursor) {
      try {
        const [updatedAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        if (!updatedAt || !id) throw new Error();
        after = { updatedAt, id };
      } catch {
        throw fail('VALIDATION_ERROR', 'Validation error: cursor is invalid');
      }
    }
    return this.store.read((d) => {
      const owned = Object.values(d.projects)
        .filter((p) => p.ownerId === ownerId && (!status || p.status === status))
        .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1));
      const start = after
        ? owned.findIndex((p) => p.updatedAt < after!.updatedAt || (p.updatedAt === after!.updatedAt && p.id > after!.id))
        : 0;
      const page = start === -1 ? [] : owned.slice(start, start + limit);
      const more = start !== -1 && start + limit < owned.length;
      const last = page[page.length - 1];
      return {
        items: page.map(summarize),
        nextCursor: more && last ? Buffer.from(`${last.updatedAt}|${last.id}`).toString('base64url') : null,
      };
    });
  }

  async getProject(ownerId: string, projectId: string): Promise<{ project: PublicProject }> {
    return this.store.read((d) => ({ project: toPublicProject(this.loadOwned(d, ownerId, projectId)) }));
  }

  /**
   * Shared tail of every profile mutation (PATCH and suggestion apply): update field metadata,
   * recompute readiness, revert `ready` -> `draft` if completeness dropped, bump the revision.
   * Mutates `project` (a copy inside a transaction).
   */
  protected commitProfile(
    project: Project,
    profile: Profile,
    touched: string[],
    source: 'user_edit' | 'accepted_suggestion',
    messageId: string | null
  ): { statusChanged: boolean } {
    const now = this.now().toISOString();
    project.profile = profile;
    for (const path of touched) {
      if (hasValue(profile, path)) {
        project.fieldMetadata[path] = { source, messageId, confirmedAt: now };
      } else {
        delete project.fieldMetadata[path];
      }
    }
    project.readinessAssessment = computeReadiness(profile);
    let statusChanged = false;
    if (project.status === 'ready' && project.readinessAssessment.completeCount < REQUIRED_COUNT) {
      project.status = 'draft';
      statusChanged = true;
    }
    project.revision += 1;
    project.updatedAt = now;
    return { statusChanged };
  }

  async patchProject(
    ownerId: string,
    projectId: string,
    input: unknown
  ): Promise<{ project: PublicProject; statusChanged: boolean }> {
    const body = parseInput(PatchProjectInput, input);
    const { requestId, ...rest } = body;
    return this.store.transaction((d) => {
      const key = this.idemKey(ownerId, 'project.patch', projectId, requestId);
      const hit = this.idemLookup(d, key, rest);
      if (hit) return hit.result as { project: PublicProject; statusChanged: boolean };

      const project = this.loadOwned(d, ownerId, projectId);
      this.requireWritable(project);
      this.requireRevision(project, rest.expectedRevision);

      let applied;
      try {
        applied = applyChanges(project.profile, rest.changes, { actor: 'user', newId: this.newId });
      } catch (e) {
        if (e instanceof ChangeError) throw fail(e.code, e.message);
        throw e;
      }
      const { statusChanged } = this.commitProfile(project, applied.profile, applied.touched, 'user_edit', null);
      d.projects[project.id] = project;
      const result = { project: toPublicProject(project), statusChanged };
      this.idemStore(d, key, rest, result, project.id);
      return result;
    });
  }

  async setStatus(ownerId: string, projectId: string, input: unknown): Promise<{ project: PublicProject }> {
    const body = parseInput(StatusInput, input);
    const { requestId, ...rest } = body;
    return this.store.transaction((d) => {
      const key = this.idemKey(ownerId, 'project.status', projectId, requestId);
      const hit = this.idemLookup(d, key, rest);
      if (hit) return hit.result as { project: PublicProject };

      const project = this.loadOwned(d, ownerId, projectId);
      this.requireRevision(project, rest.expectedRevision);
      if (!TRANSITIONS[project.status].includes(rest.status)) {
        throw fail('INVALID_TRANSITION', `A ${project.status} project cannot become ${rest.status}.`);
      }
      if (rest.status === 'ready' && project.readinessAssessment.completeCount < REQUIRED_COUNT) {
        throw fail(
          'INVALID_TRANSITION',
          `A project needs all ${REQUIRED_COUNT} required items before it can be marked ready.`
        );
      }
      project.status = rest.status;
      project.revision += 1;
      project.updatedAt = this.now().toISOString();
      d.projects[project.id] = project;
      const result = { project: toPublicProject(project) };
      this.idemStore(d, key, rest, result, project.id);
      return result;
    });
  }

  /** Hard delete of the project and every dependent row, atomically. */
  async deleteProject(ownerId: string, projectId: string, input: unknown): Promise<{ deleted: true }> {
    const body = parseInput(DeleteInput, input);
    const { requestId, ...rest } = body;
    return this.store.transaction((d) => {
      const key = this.idemKey(ownerId, 'project.delete', projectId, requestId);
      const hit = this.idemLookup(d, key, rest);
      if (hit) return hit.result as { deleted: true };

      const project = this.loadOwned(d, ownerId, projectId);
      this.requireRevision(project, rest.expectedRevision);
      this.purgeProject(d, projectId);
      const result = { deleted: true as const };
      // Stored without a projectId so the purge above (and any later one) cannot remove it.
      this.idemStore(d, key, rest, result, null);
      return result;
    });
  }

  // ---- discovery ---------------------------------------------------------

  /** Builds the client-facing result of a completed turn from stored rows. */
  protected turnResult(d: Readonly<StoreData>, req: DiscoveryRequestRecord): DiscoveryTurnResult {
    const msgs = d.messages[req.projectId] ?? [];
    const project = d.projects[req.projectId];
    const stored = req.result as { questions: DiscoveryTurnResult['questions']; suggestedNextStep: string };
    return structuredClone({
      userMessage: msgs.find((m) => m.id === req.userMessageId)!,
      assistantMessage: msgs.find((m) => m.id === req.assistantMessageId)!,
      questions: stored.questions,
      suggestedNextStep: stored.suggestedNextStep,
      batch: req.batchId ? ((d.batches[req.projectId] ?? []).find((b) => b.id === req.batchId) ?? null) : null,
      revision: project.revision,
      readiness: project.readinessAssessment,
    });
  }

  private async failTurn(projectId: string, requestId: string, error: unknown): Promise<GrantServerError> {
    const mapped =
      error instanceof GrantServerError
        ? error
        : fail('AI_UNAVAILABLE', 'The AI assistant is not available right now. Please try again later.', true);
    await this.store.transaction((d) => {
      const req = (d.discoveryRequests[projectId] ?? []).find((r) => r.requestId === requestId);
      if (req && req.state === 'in_progress') {
        req.state = 'failed';
        req.errorCode = mapped.code;
        req.updatedAt = this.now().toISOString();
      }
    });
    return mapped;
  }

  /**
   * One discovery turn, in the order required by the plan (§6): idempotency and revision check;
   * store the user message and an `in_progress` row (the per-project busy lock) in one transaction;
   * call the model with no transaction open; store the reply and suggestion batch in a second one.
   */
  async runDiscoveryTurn(ownerId: string, projectId: string, input: unknown): Promise<DiscoveryTurnResult> {
    const deps = this.discovery;
    const body = parseInput(DiscoveryTurnInput, input);
    if (!deps) throw fail('AI_UNAVAILABLE', 'AI discovery is not available on this server.', true);
    if (!deps.isConfigured()) throw fail('MISSING_CONFIG', 'AI discovery is not configured on this server.', false);
    const { requestId, expectedRevision, message } = body;
    // The revision is deliberately not part of the replay hash: a retry after the user edited the
    // profile must still match the original request.
    const bodyHash = sha256Hex(canonicalJson({ message }));

    type Started =
      | { replay: DiscoveryTurnResult }
      | { agentInput: AgentInput; userMessage: DiscoveryMessage; baseRevision: number };

    const started = await this.store.transaction<Started>((d) => {
      const project = this.loadOwned(d, ownerId, projectId);
      this.requireWritable(project);
      const nowIso = this.now().toISOString();
      const nowMs = this.now().getTime();
      const reqs = (d.discoveryRequests[projectId] ??= []);

      // A crashed server must not lock a project: stuck rows count as failed.
      for (const r of reqs) {
        if (r.state === 'in_progress' && nowMs - Date.parse(r.updatedAt) > deps.timeoutMs + deps.graceMs) {
          r.state = 'failed';
          r.errorCode = 'AGENT_TIMEOUT';
          r.updatedAt = nowIso;
        }
      }

      const existing = reqs.find((r) => r.requestId === requestId);
      if (existing) {
        if (existing.bodyHash !== bodyHash) {
          throw fail('IDEMPOTENCY_CONFLICT', 'This requestId was already used with a different message.');
        }
        if (existing.state === 'complete') return { replay: this.turnResult(d, existing) };
        if (existing.state === 'in_progress') throw fail('DISCOVERY_BUSY', 'A reply is already being prepared for this project.', true);
        // failed: fall through and re-run the model without duplicating the stored message
      } else {
        this.requireRevision(project, expectedRevision);
      }
      if (reqs.some((r) => r !== existing && r.state === 'in_progress')) {
        throw fail('DISCOVERY_BUSY', 'A reply is already being prepared for this project.', true);
      }

      const msgs = (d.messages[projectId] ??= []);
      if (!existing && msgs.length + 2 > this.limits.maxMessagesPerProject) {
        throw fail('LIMIT_EXCEEDED', `This project's conversation is full (${this.limits.maxMessagesPerProject} messages).`);
      }

      const day = nowIso.slice(0, 10);
      const counter = d.counters.discovery;
      if (counter.day !== day) {
        counter.day = day;
        counter.count = 0;
      }
      if (counter.count >= deps.dailyLimit) {
        throw fail('AI_UNAVAILABLE', 'The assistant has reached its daily limit. Please try again tomorrow.', true);
      }
      counter.count += 1;

      let userMessage: DiscoveryMessage;
      if (existing) {
        userMessage = msgs.find((m) => m.id === existing.userMessageId)!;
        existing.state = 'in_progress';
        existing.errorCode = null;
        existing.updatedAt = nowIso;
      } else {
        userMessage = { id: this.newId(), projectId, role: 'user', content: message, createdAt: nowIso, requestId };
        msgs.push(userMessage);
        reqs.push({
          requestId, projectId, state: 'in_progress', bodyHash, userMessageId: userMessage.id,
          assistantMessageId: null, batchId: null, result: null, errorCode: null, startedAt: nowIso, updatedAt: nowIso,
        });
      }

      return {
        agentInput: {
          requestId,
          profile: structuredClone(project.profile),
          missingFields: structuredClone(project.readinessAssessment.missingFields),
          history: msgs.slice(-deps.historyMessages).map((m) => ({ role: m.role, content: m.content })),
        },
        userMessage: structuredClone(userMessage),
        baseRevision: project.revision,
      };
    });

    if ('replay' in started) return started.replay;

    let result: AgentResult;
    try {
      result = await deps.runAgent(started.agentInput); // no transaction is open here
    } catch (e) {
      throw await this.failTurn(projectId, requestId, e);
    }

    return this.store.transaction((d) => {
      const owned =
        Object.prototype.hasOwnProperty.call(d.projects, projectId) && d.projects[projectId].ownerId === ownerId;
      const req = owned ? (d.discoveryRequests[projectId] ?? []).find((r) => r.requestId === requestId) : undefined;
      // The project was deleted while the model was working: discard the result, write nothing.
      if (!owned || !req) throw fail('PROJECT_NOT_FOUND', 'Project not found.');

      const nowIso = this.now().toISOString();
      const assistant: DiscoveryMessage = {
        id: this.newId(), projectId, role: 'assistant', content: result.reply, createdAt: nowIso, requestId,
      };
      (d.messages[projectId] ??= []).push(assistant);

      let batch: SuggestionBatch | null = null;
      if (result.changes.length) {
        const batches = (d.batches[projectId] ??= []);
        for (const b of batches) if (b.state === 'pending') b.state = 'stale';
        batch = {
          id: this.newId(),
          projectId,
          baseRevision: started.baseRevision,
          state: 'pending',
          createdAt: nowIso,
          changes: result.changes.map((c): StoredChange => {
            const change: StoredChange = {
              id: this.newId(), op: c.op, path: c.path, rationale: c.rationale,
              sourceMessageIds: [started.userMessage.id, assistant.id], disposition: 'pending',
            };
            if (c.value !== undefined) change.value = c.value;
            if (c.itemId !== undefined) change.itemId = c.itemId;
            if (c.basis !== undefined) change.basis = c.basis;
            return change;
          }),
        };
        batches.push(batch);
        // Keep the file bounded: drop the oldest finished batches.
        while (batches.length > MAX_BATCHES_PER_PROJECT) {
          const i = batches.findIndex((b) => b.state !== 'pending');
          if (i === -1) break;
          batches.splice(i, 1);
        }
      }

      req.state = 'complete';
      req.assistantMessageId = assistant.id;
      req.batchId = batch ? batch.id : null;
      req.result = { questions: result.questions, suggestedNextStep: result.suggestedNextStep };
      req.errorCode = null;
      req.updatedAt = nowIso;
      return this.turnResult(d, req);
    });
  }

  /** Persisted conversation, chronological, with bounded pages. `lastTurn` lets the UI offer a retry. */
  async listMessages(
    ownerId: string,
    projectId: string,
    input: unknown = {}
  ): Promise<{
    items: DiscoveryMessage[];
    nextCursor: string | null;
    lastTurn: {
      requestId: string;
      state: string;
      errorCode: string | null;
      questions?: DiscoveryTurnResult['questions'];
      suggestedNextStep?: string;
    } | null;
  }> {
    const { cursor, limit = 50 } = parseInput(PageInput, input);
    return this.store.read((d) => {
      this.loadOwned(d, ownerId, projectId);
      const msgs = d.messages[projectId] ?? [];
      let start = 0;
      if (cursor) {
        const i = msgs.findIndex((m) => m.id === cursor);
        if (i === -1) throw fail('VALIDATION_ERROR', 'Validation error: cursor is invalid');
        start = i + 1;
      }
      const items = msgs.slice(start, start + limit);
      const reqs = d.discoveryRequests[projectId] ?? [];
      const last = reqs[reqs.length - 1];
      return {
        items,
        nextCursor: start + limit < msgs.length ? items[items.length - 1].id : null,
        lastTurn: last
          ? {
              requestId: last.requestId,
              state: last.state,
              errorCode: last.errorCode,
              ...(last.state === 'complete'
                ? (last.result as { questions: DiscoveryTurnResult['questions']; suggestedNextStep: string })
                : {}),
            }
          : null,
      };
    });
  }

  async listSuggestions(ownerId: string, projectId: string, input: unknown = {}): Promise<{ items: SuggestionBatch[] }> {
    const { state } = parseInput(SuggestionListInput, input);
    return this.store.read((d) => {
      this.loadOwned(d, ownerId, projectId);
      const batches = (d.batches[projectId] ?? []).filter((b) => !state || b.state === state);
      return { items: [...batches].reverse() };
    });
  }

  private dismissBatch(batch: SuggestionBatch): void {
    for (const c of batch.changes) c.disposition = 'dismissed';
    batch.state = 'dismissed';
  }

  /**
   * One-time review of a stored batch. Each selected change applies only if its `basis` still
   * holds (otherwise `conflict`); only stored changes are ever applied, never client values.
   * An empty selection is a dismiss.
   */
  async applySuggestion(
    ownerId: string,
    projectId: string,
    suggestionId: string,
    input: unknown
  ): Promise<{ project: PublicProject; batch: SuggestionBatch }> {
    const body = parseInput(ApplyInput, input);
    const { requestId, expectedRevision } = body;
    const accepted = [...new Set(body.acceptedChangeIds)].sort();
    const hashBody = { suggestionId, expectedRevision, accepted };

    const outcome = await this.store.transaction(
      (d): { kind: 'ok'; result: { project: PublicProject; batch: SuggestionBatch } } | { kind: 'all_conflict' } => {
        const key = this.idemKey(ownerId, 'suggestion.apply', projectId, requestId);
        const hit = this.idemLookup(d, key, hashBody);
        if (hit) return { kind: 'ok', result: hit.result as { project: PublicProject; batch: SuggestionBatch } };

        const project = this.loadOwned(d, ownerId, projectId);
        this.requireWritable(project);
        const batch = (d.batches[projectId] ?? []).find((b) => b.id === suggestionId);
        if (!batch) throw fail('PROJECT_NOT_FOUND', 'Suggestion not found.');
        if (batch.state !== 'pending') throw fail('SUGGESTION_STALE', 'These suggestions are no longer current.');

        if (accepted.length === 0) {
          this.dismissBatch(batch);
          const result = { project: toPublicProject(project), batch: structuredClone(batch) };
          this.idemStore(d, key, hashBody, result, projectId);
          return { kind: 'ok', result };
        }

        this.requireRevision(project, expectedRevision);
        const known = new Set(batch.changes.map((c) => c.id));
        if (accepted.some((id) => !known.has(id))) {
          throw fail('VALIDATION_ERROR', 'Validation error: acceptedChangeIds contains an unknown change id');
        }
        const ids = new Set(accepted);

        const live: StoredChange[] = [];
        const conflicts: StoredChange[] = [];
        for (const c of batch.changes) {
          if (!ids.has(c.id)) continue;
          try {
            const vc = validateChange({ op: c.op, path: c.path, value: c.value, itemId: c.itemId }, 'agent');
            (basisHolds(project.profile, vc, c.basis) ? live : conflicts).push(c);
          } catch (e) {
            if (!(e instanceof ChangeError)) throw e;
            conflicts.push(c);
          }
        }

        if (live.length === 0) {
          // Every selected change conflicted: this commits (state recorded) and is reported as 409 afterwards.
          for (const c of batch.changes) c.disposition = ids.has(c.id) ? 'conflict' : 'dismissed';
          batch.state = 'stale';
          return { kind: 'all_conflict' };
        }

        let applied;
        try {
          applied = applyChanges(
            project.profile,
            live.map(({ op, path, value, itemId }) => ({ op, path, value, itemId })),
            { actor: 'agent', newId: this.newId }
          );
        } catch (e) {
          if (e instanceof ChangeError) throw fail(e.code, e.message); // rolls back; batch stays pending
          throw e;
        }
        const messageId = live[0].sourceMessageIds[live[0].sourceMessageIds.length - 1] ?? null;
        this.commitProfile(project, applied.profile, applied.touched, 'accepted_suggestion', messageId);
        d.projects[project.id] = project;

        const liveIds = new Set(live.map((c) => c.id));
        for (const c of batch.changes) {
          c.disposition = liveIds.has(c.id) ? 'applied' : ids.has(c.id) ? 'conflict' : 'dismissed';
        }
        batch.state = 'applied';
        const result = { project: toPublicProject(project), batch: structuredClone(batch) };
        this.idemStore(d, key, hashBody, result, projectId);
        return { kind: 'ok', result };
      }
    );

    if (outcome.kind === 'all_conflict') {
      throw fail('SUGGESTION_STALE', 'Every selected change conflicts with edits made since it was suggested.');
    }
    return outcome.result;
  }

  async dismissSuggestion(
    ownerId: string,
    projectId: string,
    suggestionId: string,
    input: unknown
  ): Promise<{ batch: SuggestionBatch }> {
    const { requestId } = parseInput(DismissInput, input);
    const hashBody = { suggestionId };
    return this.store.transaction((d) => {
      const key = this.idemKey(ownerId, 'suggestion.dismiss', projectId, requestId);
      const hit = this.idemLookup(d, key, hashBody);
      if (hit) return hit.result as { batch: SuggestionBatch };
      this.loadOwned(d, ownerId, projectId);
      const batch = (d.batches[projectId] ?? []).find((b) => b.id === suggestionId);
      if (!batch) throw fail('PROJECT_NOT_FOUND', 'Suggestion not found.');
      if (batch.state !== 'pending') throw fail('SUGGESTION_STALE', 'These suggestions are no longer current.');
      this.dismissBatch(batch);
      const result = { batch: structuredClone(batch) };
      this.idemStore(d, key, hashBody, result, projectId);
      return result;
    });
  }

  protected purgeProject(d: StoreData, projectId: string): void {
    delete d.projects[projectId];
    delete d.messages[projectId];
    delete d.batches[projectId];
    delete d.discoveryRequests[projectId];
    for (const k of Object.keys(d.idempotency)) {
      if (d.idempotency[k].projectId === projectId) delete d.idempotency[k];
    }
  }
}
