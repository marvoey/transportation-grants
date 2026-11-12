import { logger } from '../../config/config.js';
import { parseOpportunityId } from '../schemas.js';
import type { PackageStore } from '../store.js';
import type { RecentOpportunities } from './recent.js';
import type { PrepareStep, RunStep, StepResult } from './runner.js';

/**
 * Prepares one opportunity for assessment: ingest its documents, then extract its requirements. State lives in
 * memory (a restart forgets finished jobs, but "ready" is always re-derived from what is on disk).
 *
 * Safeguards, because the app has no login and extraction spends model calls:
 * - only an opportunity this server showed in a recent search (or one already prepared) is accepted;
 * - one job at a time, and one per opportunity;
 * - a daily cap on jobs that actually run.
 */

export type PrepareStatus = 'idle' | 'ingesting' | 'extracting' | 'ready' | 'failed';

export interface PrepareState {
  opportunityId: string;
  status: PrepareStatus;
  /** Plain-language line for the screen, written by code. */
  message: string;
  /** Requirements exist but extraction did not cover every document. */
  partial: boolean;
  /** Which step failed, when status is "failed". */
  failedStep: PrepareStep | null;
  /** Safe to show. Never contains keys, headers or response content. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  requirements: number | null;
}

export class PrepareError extends Error {
  constructor(
    message: string,
    /** NOT_FOUND -> 404; BUSY and DAILY_LIMIT -> 429. */
    public readonly code: 'NOT_FOUND' | 'BUSY' | 'DAILY_LIMIT'
  ) {
    super(message);
    this.name = 'PrepareError';
  }
}

export interface PrepareManagerDeps {
  store: () => PackageStore;
  run: RunStep;
  recent: RecentOpportunities;
  dailyLimit: number;
  now?: () => Date;
}

const MESSAGES = {
  ingesting: 'Downloading the official documents from Simpler.Grants.gov and reading them…',
  extracting: 'Reading the notice with the language model to extract its requirements. This is the slow step and can take several minutes…',
  ready: 'Ready to assess.',
  partial: 'Ready, but the requirement extraction is incomplete, so some requirements may be missing from the assessment.',
  idle: 'Not prepared yet.',
  generic: 'Preparing this opportunity failed. An operator can check the server log or run the commands by hand.',
  noDocuments: 'No document for this opportunity could be read, so it cannot be assessed.',
  noNotice:
    'The documents listed for this opportunity do not include its notice of funding (a NOFO or an amendment), so there are no requirements to extract and it cannot be assessed here. The notice may not be published yet, or it may be on another page.',
  timeout: 'Preparing this opportunity took too long and was stopped. Try again, or ask an operator to run the commands by hand.',
} as const;

const MAX_KEPT = 50;

export class PrepareManager {
  private readonly jobs = new Map<string, PrepareState>();
  private current: string | null = null;
  private day = '';
  private startedToday = 0;

  constructor(private readonly deps: PrepareManagerDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Requirements on disk for this opportunity, or null. */
  private async prepared(id: string): Promise<{ total: number; partial: boolean } | null> {
    const file = await this.deps.store().readRequirements(id).catch(() => null);
    if (!file || file.requirements.length === 0) return null;
    return { total: file.requirements.length, partial: file.status === 'partial' };
  }

  private readyState(id: string, info: { total: number; partial: boolean }, base?: PrepareState): PrepareState {
    return {
      opportunityId: id,
      status: 'ready',
      message: info.partial ? MESSAGES.partial : MESSAGES.ready,
      partial: info.partial,
      failedStep: null,
      error: null,
      startedAt: base?.startedAt ?? null,
      finishedAt: base?.finishedAt ?? null,
      requirements: info.total,
    };
  }

  /** Where this opportunity stands: a running or finished job, else whatever is on disk. */
  async status(rawId: string): Promise<PrepareState> {
    const id = parseOpportunityId(rawId);
    const job = this.jobs.get(id);
    if (job && (job.status === 'ingesting' || job.status === 'extracting')) return { ...job };
    const info = await this.prepared(id);
    if (info) return this.readyState(id, info, job);
    if (job) return { ...job };
    return { opportunityId: id, status: 'idle', message: MESSAGES.idle, partial: false, failedStep: null, error: null, startedAt: null, finishedAt: null, requirements: null };
  }

  /** Starts preparing (or returns what is already running or done). Throws PrepareError when it must refuse. */
  async start(rawId: string): Promise<PrepareState> {
    const id = parseOpportunityId(rawId);

    const existing = this.jobs.get(id);
    if (existing && (existing.status === 'ingesting' || existing.status === 'extracting')) return { ...existing };

    // Already prepared: nothing to run, nothing to spend, and no allow-list needed.
    const info = await this.prepared(id);
    if (info) return this.readyState(id, info, existing);

    if (!this.deps.recent.has(id)) {
      throw new PrepareError('This opportunity was not in a recent search on this server. Search for it again first.', 'NOT_FOUND');
    }
    if (this.current !== null) {
      throw new PrepareError('Another opportunity is being prepared. Please try again in a few minutes.', 'BUSY');
    }
    const today = this.now().toISOString().slice(0, 10);
    if (this.day !== today) {
      this.day = today;
      this.startedToday = 0;
    }
    if (this.startedToday >= this.deps.dailyLimit) {
      throw new PrepareError('The daily limit for preparing opportunities has been reached. Try again tomorrow, or ask an operator to prepare it.', 'DAILY_LIMIT');
    }

    this.startedToday += 1;
    this.current = id;
    const job: PrepareState = {
      opportunityId: id,
      status: 'ingesting',
      message: MESSAGES.ingesting,
      partial: false,
      failedStep: null,
      error: null,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      requirements: null,
    };
    this.remember(id, job);
    // Runs in the background; progress is read with status().
    void this.execute(job);
    return { ...job };
  }

  private remember(id: string, job: PrepareState): void {
    this.jobs.delete(id);
    this.jobs.set(id, job);
    while (this.jobs.size > MAX_KEPT) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined || oldest === this.current) break;
      this.jobs.delete(oldest);
    }
  }

  private fail(job: PrepareState, step: PrepareStep, result: StepResult | null, fallback: string): void {
    job.status = 'failed';
    job.failedStep = step;
    job.error = result?.errorLine ?? fallback;
    job.message = job.error;
    job.finishedAt = this.now().toISOString();
  }

  private async execute(job: PrepareState): Promise<void> {
    const id = job.opportunityId;
    try {
      const ingest = await this.deps.run('ingest', id);
      if (ingest.timedOut) return this.fail(job, 'ingest', null, MESSAGES.timeout);
      if (ingest.exitCode === 3) return this.fail(job, 'ingest', null, MESSAGES.noDocuments);
      if (ingest.exitCode !== 0) return this.fail(job, 'ingest', ingest, MESSAGES.generic);

      job.status = 'extracting';
      job.message = MESSAGES.extracting;
      const extract = await this.deps.run('extract', id);
      if (extract.timedOut) return this.fail(job, 'extract', null, MESSAGES.timeout);
      // Exit 4 means the package has no parsed notice (NOFO or amendment): say so plainly, not with the developer message.
      if (extract.exitCode === 4) return this.fail(job, 'extract', null, MESSAGES.noNotice);
      // Exit 3 means "written but partial": the requirements exist, so it is judged from what is on disk below.
      if (extract.exitCode !== 0 && extract.exitCode !== 3) return this.fail(job, 'extract', extract, MESSAGES.generic);

      const info = await this.prepared(id);
      if (!info) return this.fail(job, 'extract', null, MESSAGES.generic);
      Object.assign(job, this.readyState(id, info, job), { finishedAt: this.now().toISOString() });
      logger.info(`Prepared opportunity ${id}: ${info.total} requirements${info.partial ? ' (partial)' : ''}`);
    } catch {
      this.fail(job, job.status === 'extracting' ? 'extract' : 'ingest', null, MESSAGES.generic);
    } finally {
      if (this.current === id) this.current = null;
    }
  }
}
