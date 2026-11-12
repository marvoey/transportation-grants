import { classifyAuthority } from '../acquire/authority.js';
import type { Attachment } from '../schemas.js';

/**
 * Which listed opportunities have documents on Simpler.Grants.gov. This reads the attachment LIST (names and sizes) from
 * the opportunity's detail record. It never downloads a file and never opens a link from a listing.
 *
 * "none" means the API lists no documents for the opportunity. It does not mean none exist: the notice may be on another
 * page (see additionalInfoUrl), so callers must word it as "none listed". "unknown" means the check itself failed.
 */

/** Read-only capability: the attachment list of one opportunity (SimplerOpportunitySource has it). */
export interface AttachmentListSource {
  getAttachments(id: string): Promise<Attachment[]>;
}

export type DocumentsStatus = 'listed' | 'none' | 'unknown';

export interface DocumentsInfo {
  status: DocumentsStatus;
  /** How many documents the API lists, or null when the check failed. */
  count: number | null;
  /** Display-only file names (cleaned, shortened, and capped at MAX_FILE_NAMES). */
  files: string[];
  /**
   * Only when documents are listed: whether any listed file looks like the notice itself (a NOFO or an amendment). This
   * uses the same file-name rule the extraction step uses to pick its source documents (classifyAuthority), so "false"
   * means extraction would stop with "no controlling document". It is a name check, not a reading of the file.
   */
  hasNotice?: boolean;
}

export const MAX_FILE_NAMES = 8;
export const MAX_FILE_NAME_CHARS = 120;

// Control characters and the bidirectional overrides that can make a file name read differently from what it is.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A file name from the API is untrusted text: strip control characters, collapse spaces, and cut it short. */
export function cleanFileName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!text) return '(unnamed file)';
  return text.length > MAX_FILE_NAME_CHARS ? `${text.slice(0, MAX_FILE_NAME_CHARS - 1)}…` : text;
}

export function describeAttachments(attachments: Attachment[]): DocumentsInfo {
  const files = attachments.slice(0, MAX_FILE_NAMES).map((a) => cleanFileName(a.fileName));
  if (attachments.length === 0) return { status: 'none', count: 0, files };
  const hasNotice = attachments.some((a) => classifyAuthority(String(a.fileName ?? ''), a.description ?? null).authority === 'controlling');
  return { status: 'listed', count: attachments.length, files, hasNotice };
}

/**
 * True when preparing this opportunity cannot work: the API lists no documents, or lists some but none looks like the
 * notice (extraction needs a NOFO or an amendment). "unknown" is not included: nothing is assumed when a check failed.
 */
export const cannotPrepare = (info: DocumentsInfo | undefined): boolean =>
  info?.status === 'none' || (info?.status === 'listed' && info.hasNotice === false);

export const UNKNOWN_DOCUMENTS: DocumentsInfo = { status: 'unknown', count: null, files: [] };

/** Small in-memory cache so searching again does not repeat the same lookups. A failed check is never cached. */
export class DocumentsCache {
  private readonly entries = new Map<string, { at: number; value: DocumentsInfo }>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 200,
    private readonly clock: () => number = Date.now
  ) {}

  get(id: string): DocumentsInfo | undefined {
    const hit = this.entries.get(id);
    if (!hit) return undefined;
    if (this.clock() - hit.at > this.ttlMs) {
      this.entries.delete(id);
      return undefined;
    }
    return hit.value;
  }

  set(id: string, value: DocumentsInfo): void {
    if (value.status === 'unknown') return;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(id, { at: this.clock(), value });
  }
}

export interface DocumentsCheck {
  /** One entry per requested ID. */
  byId: Map<string, DocumentsInfo>;
  /** How many answers came from the cache (no request was sent for them). */
  cached: number;
}

/** How many lookups run at once: a screen can have a couple of dozen listings, and the API limits requests per minute. */
export const DOCUMENT_CHECK_CONCURRENCY = 5;

/**
 * Looks up the attachment list of each opportunity, a few at a time. A lookup that fails becomes "unknown" for that one
 * listing and never fails the others or the search.
 */
export async function checkDocuments(
  source: AttachmentListSource,
  ids: string[],
  cache?: DocumentsCache,
  concurrency: number = DOCUMENT_CHECK_CONCURRENCY
): Promise<DocumentsCheck> {
  const byId = new Map<string, DocumentsInfo>();
  let cached = 0;
  const queue = [...ids];
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const hit = cache?.get(id);
      if (hit) {
        byId.set(id, hit);
        cached += 1;
        continue;
      }
      try {
        const info = describeAttachments(await source.getAttachments(id));
        cache?.set(id, info);
        byId.set(id, info);
      } catch {
        // The error message is not kept: it is never shown, and it must never carry anything from the response.
        byId.set(id, UNKNOWN_DOCUMENTS);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  return { byId, cached };
}

/**
 * Moves every listing that cannot be prepared (no documents listed, or none that looks like the notice) to the end,
 * keeping the order within each group, so the best fit among them is still first. A listing whose check failed
 * ("unknown") is not moved.
 */
export function documentsLast<T extends { documents?: DocumentsInfo }>(items: T[]): T[] {
  return [...items.filter((i) => !cannotPrepare(i.documents)), ...items.filter((i) => cannotPrepare(i.documents))];
}
