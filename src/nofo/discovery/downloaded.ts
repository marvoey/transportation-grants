import type { Authority, ManifestDocument } from '../schemas.js';
import type { PackageStore } from '../store.js';
import { cleanFileName } from './documents.js';

/**
 * What a specialist would have to read and check for a listing whose notice documents are already downloaded here:
 * how many documents, of what type, how many pages and words, and how many requirements the app extracted from them.
 * Every figure is counted from the stored files. Nothing is estimated, and no time or cost is claimed.
 *
 * Only documents actually downloaded are described. Pages exist for PDFs; a Word document has no fixed page count, so
 * it shows words only (and is left out of the page total rather than guessed at).
 */

export type DownloadedRole = 'notice' | 'guidance' | 'other';

export interface DownloadedDocument {
  /** Display-only title (cleaned and shortened). */
  title: string;
  /** "PDF", "Word", "Web page" or "Other", from the file's name and detected type. */
  format: string;
  /** Notice = a NOFO or amendment (the app's "controlling" documents); guidance = template, FAQ, webinar and similar. */
  role: DownloadedRole;
  /** False when the file could not be read; it then has no pages or words. */
  parsed: boolean;
  /** PDF pages, or null (a Word document has none; an unread file has none). */
  pages: number | null;
  words: number | null;
}

export interface RequirementStats {
  total: number;
  /** Counts by category, in a fixed order, only categories that have any. */
  byCategory: Array<{ category: string; count: number }>;
  mandatory: number;
  /** Requirements that are a document or form the applicant must prepare or submit. */
  toPrepare: number;
  /** Requirements with a number or document the code can check against the applicant's facts. */
  checkedByCode: number;
  needsReview: number;
  /** Verified by a person. Today this is nearly always zero. */
  verified: number;
}

export interface DownloadedPackage {
  documents: DownloadedDocument[];
  /** PDF pages only. */
  totalPages: number;
  totalWords: number;
  /** Day the newest document was downloaded (YYYY-MM-DD), or null. */
  downloadedOn: string | null;
  /** Null when requirements have not been extracted for this opportunity. */
  requirements: RequirementStats | null;
}

/** The same figures added up across the listings shown, for the strip above the cards. */
export interface DownloadedTotals {
  listings: number;
  documents: number;
  pages: number;
  words: number;
  requirements: number;
  toPrepare: number;
}

const CATEGORY_ORDER = ['eligibility', 'funding', 'application', 'readiness', 'evaluation', 'post_award'];

export function roleOf(authority: Authority): DownloadedRole {
  if (authority === 'controlling') return 'notice';
  if (authority === 'official_guidance') return 'guidance';
  return 'other';
}

/** A Word file is detected as "zip" (it is a zip container) and a PDF as "pdf", so the file name decides the label. */
export function formatOf(doc: Pick<ManifestDocument, 'fileName' | 'detectedType'>): string {
  const name = String(doc.fileName ?? '').toLowerCase();
  if (/\.pdf$/.test(name) || doc.detectedType === 'pdf') return 'PDF';
  if (/\.docx?$/.test(name)) return 'Word';
  if (/\.html?$/.test(name) || doc.detectedType === 'html') return 'Web page';
  return 'Other';
}

export const countWords = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** Word counts by file hash (or by document id when there is no hash), so a document is read from disk once per server run. */
const wordCache = new Map<string, number>();
const WORD_CACHE_MAX = 500;

async function wordsIn(store: PackageStore, opportunityId: string, doc: ManifestDocument): Promise<number | null> {
  const key = doc.sha256 ?? `${opportunityId}:${doc.documentId}`;
  const hit = wordCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const normalized = await store.readNormalized(opportunityId, doc.documentId);
    if (!normalized) return null;
    const words =
      normalized.kind === 'pdf'
        ? normalized.pages.reduce((n, p) => n + countWords(p.text), 0)
        : normalized.sections.reduce((n, s) => n + countWords(s.text), 0);
    if (wordCache.size >= WORD_CACHE_MAX) {
      const oldest = wordCache.keys().next().value;
      if (oldest !== undefined) wordCache.delete(oldest);
    }
    wordCache.set(key, words);
    return words;
  } catch {
    return null; // a damaged file is simply not counted
  }
}

async function requirementStats(store: PackageStore, opportunityId: string): Promise<RequirementStats | null> {
  const file = await store.readRequirements(opportunityId).catch(() => null);
  if (!file || file.requirements.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of file.requirements) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const byCategory = [...counts.entries()]
    .sort((a, b) => (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99))
    .map(([category, count]) => ({ category, count }));
  return {
    total: file.requirements.length,
    byCategory,
    mandatory: file.requirements.filter((r) => r.mandatory).length,
    toPrepare: file.requirements.filter((r) => r.check?.kind === 'document_required').length,
    checkedByCode: file.requirements.filter((r) => r.check).length,
    needsReview: file.requirements.filter((r) => r.reviewStatus === 'needs_review').length,
    verified: file.requirements.filter((r) => r.reviewStatus === 'verified').length,
  };
}

/**
 * Describes the documents downloaded for an opportunity, or returns null when none were (nothing downloaded here, a
 * damaged package, or only files removed upstream). Reads only local files; it never calls an outside service.
 */
export async function describeDownloaded(store: PackageStore, opportunityId: string): Promise<DownloadedPackage | null> {
  let manifest;
  try {
    manifest = await store.readManifest(opportunityId);
  } catch {
    return null;
  }
  if (!manifest) return null;
  // A file that is stored here counts, whether it was just fetched ('downloaded') or was already on disk ('cached').
  const downloaded = manifest.documents.filter((d) => d.retrieval.status === 'downloaded' || d.retrieval.status === 'cached');
  if (downloaded.length === 0) return null;

  const documents: DownloadedDocument[] = await Promise.all(
    downloaded.map(async (doc) => {
      const parsed = doc.processing.status === 'parsed';
      const format = formatOf(doc);
      const pages = parsed && format === 'PDF' && typeof doc.processing.pages === 'number' ? doc.processing.pages : null;
      return { title: cleanFileName(doc.title || doc.fileName), format, role: roleOf(doc.authority), parsed, pages, words: parsed ? await wordsIn(store, opportunityId, doc) : null };
    })
  );
  // Notice first, then guidance, then the rest; larger first within each.
  const order: Record<DownloadedRole, number> = { notice: 0, guidance: 1, other: 2 };
  documents.sort((a, b) => order[a.role] - order[b.role] || (b.pages ?? 0) - (a.pages ?? 0) || (b.words ?? 0) - (a.words ?? 0));

  const days = downloaded.map((d) => d.retrievedAt).filter((d): d is string => typeof d === 'string' && d.length >= 10).sort();
  return {
    documents,
    totalPages: documents.reduce((n, d) => n + (d.pages ?? 0), 0),
    totalWords: documents.reduce((n, d) => n + (d.words ?? 0), 0),
    downloadedOn: days.length > 0 ? days[days.length - 1].slice(0, 10) : null,
    requirements: await requirementStats(store, opportunityId),
  };
}

/** Adds up the listings that have downloaded documents; null when none do. */
export function downloadedTotals(items: Array<{ downloaded?: DownloadedPackage }>): DownloadedTotals | null {
  const withDocs = items.filter((i): i is { downloaded: DownloadedPackage } => i.downloaded !== undefined);
  if (withDocs.length === 0) return null;
  return {
    listings: withDocs.length,
    documents: withDocs.reduce((n, i) => n + i.downloaded.documents.length, 0),
    pages: withDocs.reduce((n, i) => n + i.downloaded.totalPages, 0),
    words: withDocs.reduce((n, i) => n + i.downloaded.totalWords, 0),
    requirements: withDocs.reduce((n, i) => n + (i.downloaded.requirements?.total ?? 0), 0),
    toPrepare: withDocs.reduce((n, i) => n + (i.downloaded.requirements?.toPrepare ?? 0), 0),
  };
}
