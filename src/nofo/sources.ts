import { DOCUMENT_ID_PATTERN, type Authority } from './schemas.js';
import { parseOpportunityId } from './schemas.js';
import type { PackageStore } from './store.js';

/**
 * Read-only views over ingested packages, for the web layer: what can be
 * assessed, and the exact text (and original file) behind a citation. These
 * read stored files only; nothing is fetched and nothing is written. Every ID
 * is validated and resolved THROUGH the manifest, so no user input becomes a path.
 */

export interface OpportunitySummary {
  opportunityId: string;
  title: string | null;
  opportunityNumber: string | null;
  status: string;
  closeDate: string | null;
  coverage: { status: 'none' | 'partial' | 'api_listed_processed'; reasons: string[] };
  documents: number;
  requirements: {
    /** Only opportunities with extracted requirements can be assessed. */
    ready: boolean;
    total: number;
    needsReview: number;
    verified: number;
    status: 'complete' | 'partial' | null;
    generatedAt: string | null;
  };
}

export async function listOpportunities(store: PackageStore): Promise<OpportunitySummary[]> {
  const packages = await store.listPackages();
  const out: OpportunitySummary[] = [];
  for (const { opportunityId, manifest } of packages) {
    const opportunity = await store.readOpportunity(opportunityId).catch(() => null);
    const requirements = await store.readRequirements(opportunityId).catch(() => null);
    out.push({
      opportunityId,
      title: opportunity?.title ?? null,
      opportunityNumber: opportunity?.opportunityNumber ?? null,
      status: opportunity?.status ?? 'unknown',
      closeDate: opportunity?.summary.closeDate ?? null,
      coverage: { status: manifest.coverage.status, reasons: manifest.coverage.reasons },
      documents: manifest.documents.filter((d) => d.retrieval.status !== 'removed_upstream').length,
      requirements: {
        ready: requirements !== null && requirements.requirements.length > 0,
        total: requirements?.requirements.length ?? 0,
        needsReview: requirements?.requirements.filter((r) => r.reviewStatus === 'needs_review').length ?? 0,
        verified: requirements?.requirements.filter((r) => r.reviewStatus === 'verified').length ?? 0,
        status: requirements?.status ?? null,
        generatedAt: requirements?.generatedAt ?? null,
      },
    });
  }
  // Assessable ones first, then by title.
  return out.sort((a, b) => Number(b.requirements.ready) - Number(a.requirements.ready) || (a.title ?? '').localeCompare(b.title ?? ''));
}

export interface SourceLocation {
  opportunityId: string;
  documentId: string;
  title: string;
  fileName: string;
  authority: Authority;
  kind: 'pdf' | 'html';
  page: number | null;
  pageCount: number | null;
  section: string | null;
  heading: string | null;
  text: string;
  /** Public URL of the official file (query string already removed at ingestion), if http(s). */
  sourceUrl: string | null;
  /** Whether the stored original can be opened through the original-file route. */
  originalAvailable: boolean;
}

const SECTION_PATTERN = /^s\d{1,5}(\.\d{1,3})?$/;

export class SourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNotFoundError';
  }
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The stored text of one page (PDF) or section (HTML/Word) of a document in the package. */
export async function getSourceLocation(
  store: PackageStore,
  rawOpportunityId: string,
  documentId: string,
  where: { page?: number; section?: string }
): Promise<SourceLocation> {
  const opportunityId = parseOpportunityId(rawOpportunityId);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new SourceNotFoundError('Document not found.');
  const manifest = await store.readManifest(opportunityId);
  const entry = manifest?.documents.find((d) => d.documentId === documentId);
  if (!manifest || !entry || entry.processing.status !== 'parsed') throw new SourceNotFoundError('Document not found.');
  const normalized = await store.readNormalized(opportunityId, documentId);
  if (!normalized) throw new SourceNotFoundError('Document not found.');

  const common = {
    opportunityId,
    documentId,
    title: entry.title,
    fileName: entry.fileName,
    authority: entry.authority,
    sourceUrl: safeHttpUrl(entry.originalUrl),
    originalAvailable: entry.detectedType === 'pdf' && entry.storedFile !== null && entry.retrieval.status !== 'failed',
  };

  if (normalized.kind === 'pdf') {
    const page = where.page;
    if (page === undefined || !Number.isInteger(page) || page < 1 || page > normalized.pageCount) throw new SourceNotFoundError('Page not found.');
    const found = normalized.pages.find((p) => p.page === page);
    if (!found) throw new SourceNotFoundError('Page not found.');
    return { ...common, kind: 'pdf', page, pageCount: normalized.pageCount, section: null, heading: null, text: found.text };
  }

  const sectionId = where.section;
  if (!sectionId || !SECTION_PATTERN.test(sectionId)) throw new SourceNotFoundError('Section not found.');
  const section = normalized.sections.find((s) => s.id === sectionId);
  if (!section) throw new SourceNotFoundError('Section not found.');
  return { ...common, originalAvailable: false, kind: 'html', page: null, pageCount: null, section: section.id, heading: section.heading, text: section.text };
}

/** The stored original, only for PDFs. The path comes from the manifest, never from the request. */
export async function getOriginalPdf(store: PackageStore, rawOpportunityId: string, documentId: string): Promise<{ bytes: Buffer; fileName: string }> {
  const opportunityId = parseOpportunityId(rawOpportunityId);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new SourceNotFoundError('Document not found.');
  const manifest = await store.readManifest(opportunityId);
  const entry = manifest?.documents.find((d) => d.documentId === documentId);
  if (!entry || entry.detectedType !== 'pdf' || !entry.storedFile) throw new SourceNotFoundError('Document not found.');
  const bytes = await store.readStored(opportunityId, entry.storedFile);
  if (!bytes || bytes.subarray(0, 1024).toString('latin1').indexOf('%PDF-') < 0) throw new SourceNotFoundError('Document not found.');
  return { bytes, fileName: `${documentId}.pdf` };
}
