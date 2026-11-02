import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'fs';
import { dirname, resolve } from 'path';
import { logger } from '../config/config.js';
import type {
  DiscoveryMessage,
  DiscoveryRequestRecord,
  IdempotencyRecord,
  Project,
  SessionRecord,
  SuggestionBatch,
} from './schemas.js';
import { SCHEMA_VERSION } from './schemas.js';

/**
 * Durable-ish storage for the project workspace: a structured JSON file
 * (ephemeral by design — see doc/PROJECT_DISCOVERY.md). The service talks only
 * to the `ProjectStore` interface, so a real database can replace this later.
 *
 * Guarantees:
 *  - `transaction(fn)` calls run one at a time (in-process mutex).
 *  - `fn` is synchronous and mutates a deep clone; it is committed (written to
 *    disk via temp file + fsync + atomic rename, then swapped in) only if `fn`
 *    returns and the write succeeds. A throw or a failed write leaves both the
 *    file and the in-memory state exactly as before.
 *  - It supports one server instance only; the whole file is rewritten per
 *    commit, which is fine at the project/message caps the service enforces.
 */

export const FILE_VERSION = 1;

export interface StoreData {
  sessions: Record<string, SessionRecord>;
  projects: Record<string, Project>;
  messages: Record<string, DiscoveryMessage[]>;
  batches: Record<string, SuggestionBatch[]>;
  discoveryRequests: Record<string, DiscoveryRequestRecord[]>;
  idempotency: Record<string, IdempotencyRecord>;
  counters: { discovery: { day: string; count: number } };
}

export function emptyStoreData(): StoreData {
  return {
    sessions: {},
    projects: {},
    messages: {},
    batches: {},
    discoveryRequests: {},
    idempotency: {},
    counters: { discovery: { day: '', count: 0 } },
  };
}

export interface ProjectStore {
  /** Read-only access to the last committed state. The result is deep-cloned. */
  read<T>(fn: (data: Readonly<StoreData>) => T): Promise<T>;
  /** Serialized, atomic read-modify-write. `fn` must be synchronous. */
  transaction<T>(fn: (data: StoreData) => T): Promise<T>;
}

// ---------------------------------------------------------------------------
// Migrations (pure, repeatable)

interface FileEnvelope {
  fileVersion: number;
  data: unknown;
}

/** file version N -> N+1. Add entries here when FILE_VERSION is bumped. */
export const FILE_MIGRATIONS: Record<number, (data: any) => any> = {};

/** project.schemaVersion N -> N+1. Add entries here when SCHEMA_VERSION is bumped. */
export const PROJECT_MIGRATIONS: Record<number, (project: any) => any> = {};

export function migrateProject(project: any, migrations = PROJECT_MIGRATIONS, target = SCHEMA_VERSION): any {
  let p = project;
  while (typeof p?.schemaVersion === 'number' && p.schemaVersion < target) {
    const step = migrations[p.schemaVersion];
    if (!step) throw new Error(`No migration from project schemaVersion ${p.schemaVersion}`);
    p = { ...step(p), schemaVersion: p.schemaVersion + 1 };
  }
  return p;
}

export function migrateEnvelope(
  env: FileEnvelope,
  migrations = FILE_MIGRATIONS,
  target = FILE_VERSION
): StoreData {
  if (env.fileVersion > target) {
    throw new Error(
      `Project store file version ${env.fileVersion} is newer than supported (${target}); refusing to load it`
    );
  }
  let data: any = env.data;
  for (let v = env.fileVersion; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from project store file version ${v}`);
    data = step(data);
  }
  const base = emptyStoreData();
  const merged: StoreData = { ...base, ...(data as Partial<StoreData>) };
  for (const id of Object.keys(merged.projects)) {
    merged.projects[id] = migrateProject(merged.projects[id]);
  }
  return merged;
}

function looksLikeEnvelope(v: any): v is FileEnvelope {
  return v && typeof v === 'object' && typeof v.fileVersion === 'number' && v.data && typeof v.data === 'object';
}

// ---------------------------------------------------------------------------
// Implementation

export class JsonFileProjectStore implements ProjectStore {
  private state: StoreData;
  private chain: Promise<unknown> = Promise.resolve();

  /** @param filePath absolute or cwd-relative path; `null` keeps everything in memory (tests). */
  constructor(private readonly filePath: string | null) {
    this.state = filePath ? this.load(resolve(filePath)) : emptyStoreData();
    if (filePath) this.filePath = resolve(filePath);
  }

  private load(path: string): StoreData {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return emptyStoreData();

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!looksLikeEnvelope(parsed)) throw new Error('unrecognized file structure');
    } catch (error) {
      // Corrupt (e.g. hand-edited or truncated by a crash outside our atomic write): keep it for
      // inspection and start empty rather than refusing to boot. This store is ephemeral by design.
      const quarantine = `${path}.corrupt-${Date.now()}`;
      renameSync(path, quarantine);
      logger.error(`Project store file was unreadable; moved to ${quarantine}`, (error as Error).message);
      return emptyStoreData();
    }
    // A newer file version throws (the process must not overwrite data it cannot understand).
    return migrateEnvelope(parsed);
  }

  private persist(data: StoreData): void {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const body = JSON.stringify({ fileVersion: FILE_VERSION, data } satisfies FileEnvelope);
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  async read<T>(fn: (data: Readonly<StoreData>) => T): Promise<T> {
    return structuredClone(fn(this.state));
  }

  transaction<T>(fn: (data: StoreData) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = structuredClone(this.state);
      const result = fn(draft);
      if (result instanceof Promise) {
        throw new Error('ProjectStore.transaction callbacks must be synchronous');
      }
      this.persist(draft); // throws => state unchanged
      this.state = draft;
      // Callers get a copy: the result may reference rows that are now live state.
      return structuredClone(result);
    };
    const next = this.chain.then(run, run);
    // Keep the chain alive after a failure without leaking the error to the next caller.
    this.chain = next.catch(() => undefined);
    return next;
  }
}

// ---------------------------------------------------------------------------
// Process-wide instance

let storeInstance: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!storeInstance) {
    storeInstance = new JsonFileProjectStore(process.env.PROJECT_DB_PATH || '.data/projects.json');
  }
  return storeInstance;
}

/** Test hook. */
export function setProjectStoreForTests(store: ProjectStore | null): void {
  storeInstance = store;
}
