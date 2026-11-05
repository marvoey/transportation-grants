import { createHash } from 'crypto';
import { getConfig, logger } from '../../config/config.js';
import {
  DownloadError,
  classifyUrl,
  downloadFile,
  resolveDownloadUrl,
  stripQuery,
} from '../acquire/download.js';
import { classifyAuthority } from '../acquire/authority.js';
import { describeUnsupported, detectType, expectedType, storageExtension } from '../acquire/sniff.js';
import { loadSupplementalConfig } from '../acquire/supplemental.js';
import {
  parseOpportunityId,
  type Attachment,
  type ManifestDocument,
  type NormalizedDocument,
  type OpportunityPackage,
  type PackageManifest,
  type SupplementalConfig,
} from '../schemas.js';
import { SimplerGrantsClient } from '../simpler/client.js';
import { SimplerOpportunitySource, type OpportunitySource } from '../simpler/source.js';
import { PackageCorruptError, PackageStore } from '../store.js';
import { computeCoverage, computePotentialMissingSources } from './coverage.js';
import { defaultProcessors, pickProcessor } from './processors/registry.js';
import { ProcessingError, type DocumentProcessor } from './processors/types.js';

export interface IngestOptions {
  source?: OpportunitySource;
  store?: PackageStore;
  processors?: DocumentProcessor[];
  /** Ignore cached documents and re-download everything. */
  refresh?: boolean;
  /** Used for downloads (and the default API client). Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxDownloadBytes?: number;
  maxPackageBytes?: number;
  downloadTimeoutMs?: number;
  concurrency?: number;
}

interface Context {
  id: string;
  store: PackageStore;
  source: OpportunitySource;
  processors: DocumentProcessor[];
  fetchImpl?: typeof fetch;
  now: () => Date;
  maxDownloadBytes: number;
  maxPackageBytes: number;
  downloadTimeoutMs: number;
  /** Bytes downloaded so far in this run (approximate under concurrency). */
  downloaded: { bytes: number };
}

/**
 * The stable entry point. Given a Simpler.Grants.gov opportunity UUID it:
 *  1. fetches the opportunity and its attachment list (one API call),
 *  2. downloads each attachment safely (per-document statuses; one failure
 *     never aborts the package),
 *  3. parses supported formats (PDF, HTML) and registers all others honestly,
 *  4. persists a traceable package under data/opportunities/<uuid>/.
 * Nothing here knows about any program, fiscal year or opportunity.
 */
export async function ingestOpportunity(opportunityId: string, options: IngestOptions = {}): Promise<OpportunityPackage> {
  const id = parseOpportunityId(opportunityId);
  const config = getConfig();
  const now = options.now ?? (() => new Date());
  const store = options.store ?? PackageStore.fromConfig();
  const source = options.source ?? createDefaultSource(options.fetchImpl, now);

  const detail = await source.getOpportunityWithAttachments(id);

  let prior: PackageManifest | null = null;
  try {
    prior = await store.readManifest(id);
  } catch (error) {
    // A corrupt package fails closed unless the caller explicitly asked to rebuild it.
    if (!(error instanceof PackageCorruptError) || !options.refresh) throw error;
  }
  const useCache = !options.refresh;

  const ctx: Context = {
    id,
    store,
    source,
    processors: options.processors ?? defaultProcessors(),
    fetchImpl: options.fetchImpl,
    now,
    maxDownloadBytes: options.maxDownloadBytes ?? config.nofo.maxDownloadBytes,
    maxPackageBytes: options.maxPackageBytes ?? config.nofo.maxPackageBytes,
    downloadTimeoutMs: options.downloadTimeoutMs ?? 120_000,
    downloaded: { bytes: 0 },
  };
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const priorById = new Map((prior?.documents ?? []).map((d) => [d.documentId, d]));

  // ---- Simpler.Grants.gov attachments -------------------------------------------
  const seenAttachments = new Set<string>();
  const attachments = detail.attachments.filter((a) => {
    if (seenAttachments.has(a.attachmentId)) return false;
    seenAttachments.add(a.attachmentId);
    return true;
  });
  const attachmentDocs = await mapLimit(attachments, concurrency, (attachment) =>
    acquireAttachment(ctx, attachment, priorById.get(attachmentDocumentId(attachment.attachmentId)), useCache)
  );

  // Attachments that disappeared upstream are kept, never silently deleted (amendments matter).
  const currentIds = new Set(attachmentDocs.map((d) => d.documentId));
  const removedDocs = (prior?.documents ?? [])
    .filter((d) => d.origin === 'simpler_attachment' && !currentIds.has(d.documentId))
    .map((d): ManifestDocument =>
      d.retrieval.status === 'removed_upstream'
        ? d
        : {
            ...d,
            retrieval: { status: 'removed_upstream' },
            notes: [...d.notes, 'No longer listed by Simpler.Grants.gov; kept from an earlier retrieval.'],
          }
    );

  // ---- Curated supplemental sources (optional; none unless a curator adds them) ---
  const supplemental = await loadSupplementalConfig(store, id);
  const supplementalDocs = await mapLimit(supplemental.sources, concurrency, (entry) =>
    acquireSupplemental(ctx, entry, priorById, useCache)
  );

  // ---- Manual authority overrides ----------------------------------------------
  const documents = [...attachmentDocs, ...supplementalDocs, ...removedDocs].map((doc) => applyOverride(doc, supplemental));

  const stamp = now().toISOString();
  const manifest: PackageManifest = {
    schemaVersion: 1,
    opportunityId: id,
    retrievedAt: prior?.retrievedAt ?? stamp,
    lastCheckedAt: stamp,
    coverage: computeCoverage(documents),
    documents,
    potentialMissingSources: computePotentialMissingSources(detail.opportunity, documents),
  };

  // Keep the stored opportunity record when the API response is unchanged.
  const priorOpportunity = await store.readOpportunity(id).catch(() => null);
  const opportunity =
    priorOpportunity && priorOpportunity.responseSha256 === detail.responseSha256 ? priorOpportunity : detail.opportunity;
  await store.writeOpportunity(id, opportunity);
  await store.writeManifest(id, manifest); // last: a crash leaves the previous manifest valid

  logger.info(`Ingested opportunity ${id}: coverage=${manifest.coverage.status}, documents=${documents.length}`);
  return { opportunity, manifest };
}

function createDefaultSource(fetchImpl: typeof fetch | undefined, now: () => Date): OpportunitySource {
  const { simpler } = getConfig();
  return new SimplerOpportunitySource(
    new SimplerGrantsClient({
      apiKey: simpler.apiKey,
      baseUrl: simpler.baseUrl,
      timeoutMs: simpler.timeoutMs,
      maxRetries: simpler.maxRetries,
      fetchImpl,
    }),
    now
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function attachmentDocumentId(attachmentId: string): string {
  const lower = attachmentId.toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(lower) ? `sg-${lower}` : `sg-${sha256(Buffer.from(attachmentId)).slice(0, 16)}`;
}

async function acquireAttachment(
  ctx: Context,
  attachment: Attachment,
  prior: ManifestDocument | undefined,
  useCache: boolean
): Promise<ManifestDocument> {
  const documentId = attachmentDocumentId(attachment.attachmentId);
  const authority = classifyAuthority(attachment.fileName, attachment.description);
  const doc: ManifestDocument = {
    documentId,
    origin: 'simpler_attachment',
    title: cleanDisplay(attachment.description) || cleanDisplay(attachment.fileName) || documentId,
    fileName: cleanDisplay(attachment.fileName) || documentId,
    declaredMimeType: attachment.mimeType,
    detectedType: null,
    sizeBytes: null,
    sha256: null,
    sourceAttachmentId: attachment.attachmentId,
    sourceUpdatedAt: attachment.updatedAt,
    sourceSizeBytes: attachment.sizeBytes,
    originalUrl: null,
    urlKind: null,
    retrievedAt: null,
    retrievalMethod: 'api_download',
    storedFile: null,
    normalizedFile: null,
    authority: authority.authority,
    authorityMethod: 'heuristic',
    authorityReason: authority.reason,
    retrieval: { status: 'failed' },
    processing: { status: 'not_attempted' },
    notes: [],
  };

  // Cache: same attachment id, timestamp and size, and the stored file still matches its hash.
  if (
    useCache &&
    prior &&
    prior.sourceAttachmentId === attachment.attachmentId &&
    prior.sourceUpdatedAt === attachment.updatedAt &&
    prior.sourceSizeBytes === attachment.sizeBytes &&
    prior.storedFile &&
    prior.sha256 &&
    (prior.retrieval.status === 'downloaded' || prior.retrieval.status === 'cached')
  ) {
    const bytes = await ctx.store.readStored(ctx.id, prior.storedFile);
    if (bytes && sha256(bytes) === prior.sha256) {
      const cached: ManifestDocument = {
        ...doc,
        detectedType: prior.detectedType,
        sizeBytes: prior.sizeBytes,
        sha256: prior.sha256,
        originalUrl: prior.originalUrl,
        urlKind: prior.urlKind,
        retrievedAt: prior.retrievedAt,
        storedFile: prior.storedFile,
        normalizedFile: prior.normalizedFile,
        retrieval: { status: 'cached' },
        processing: prior.processing,
        notes: prior.notes,
      };
      await ensureProcessed(ctx, cached, bytes);
      return cached;
    }
  }

  if (!attachment.downloadPath) {
    doc.retrieval = { status: 'failed', error: 'The API response has no download_path for this attachment.' };
    return doc;
  }

  let url: URL;
  try {
    url = resolveDownloadUrl(attachment.downloadPath, ctx.source.apiBaseUrl);
  } catch (error) {
    applyDownloadError(doc, error);
    return doc;
  }
  doc.originalUrl = stripQuery(url.toString());
  doc.urlKind = classifyUrl(attachment.downloadPath);

  // Cheap pre-checks from the declared size, before spending a download.
  if (attachment.sizeBytes !== null && attachment.sizeBytes > ctx.maxDownloadBytes) {
    doc.retrieval = { status: 'skipped_too_large', error: `Declared size ${attachment.sizeBytes} bytes exceeds the per-file limit.` };
    return doc;
  }
  if (attachment.sizeBytes !== null && ctx.downloaded.bytes + attachment.sizeBytes > ctx.maxPackageBytes) {
    doc.retrieval = { status: 'skipped_too_large', error: 'The package size limit would be exceeded.' };
    return doc;
  }

  let bytes: Buffer;
  try {
    const result = await downloadFile(url, {
      maxBytes: ctx.maxDownloadBytes,
      timeoutMs: ctx.downloadTimeoutMs,
      fetchImpl: ctx.fetchImpl,
      auth: ctx.source.downloadAuth,
    });
    bytes = result.bytes;
    doc.originalUrl = result.finalUrl;
  } catch (error) {
    applyDownloadError(doc, error);
    return doc;
  }

  ctx.downloaded.bytes += bytes.length;
  if (bytes.length === 0) {
    doc.retrieval = { status: 'failed', error: 'The downloaded file was empty.' };
    return doc;
  }
  if (ctx.downloaded.bytes > ctx.maxPackageBytes) {
    doc.retrieval = { status: 'skipped_too_large', error: 'The package size limit was exceeded.' };
    return doc;
  }

  await storeAndProcess(ctx, doc, bytes, attachment.sizeBytes);
  return doc;
}

// ---------------------------------------------------------------------------
// Curated supplemental sources
// ---------------------------------------------------------------------------

async function acquireSupplemental(
  ctx: Context,
  entry: SupplementalConfig['sources'][number],
  priorById: Map<string, ManifestDocument>,
  useCache: boolean
): Promise<ManifestDocument> {
  const spec = entry.url ?? entry.localFile ?? '';
  const documentId = `sup-${slugify(entry.title)}-${sha256(Buffer.from(spec)).slice(0, 8)}`;
  const prior = priorById.get(documentId);
  const fileName = entry.localFile ?? lastPathSegment(entry.url ?? '') ?? documentId;
  const doc: ManifestDocument = {
    documentId,
    origin: 'curated_supplemental',
    title: cleanDisplay(entry.title),
    fileName: cleanDisplay(fileName) || documentId,
    declaredMimeType: null,
    detectedType: null,
    sizeBytes: null,
    sha256: null,
    sourceAttachmentId: null,
    sourceUpdatedAt: null,
    sourceSizeBytes: null,
    originalUrl: entry.url ? stripQuery(entry.url) : null,
    urlKind: entry.url ? classifyUrl(entry.url) : null,
    retrievedAt: null,
    retrievalMethod: entry.url ? 'curated_url' : 'manual_file',
    storedFile: null,
    normalizedFile: null,
    authority: entry.authority,
    authorityMethod: 'manual',
    authorityReason: 'curated supplemental source (authority set by the curator)',
    retrieval: { status: 'failed' },
    processing: { status: 'not_attempted' },
    notes: entry.note ? [cleanDisplay(entry.note)] : [],
  };

  let bytes: Buffer | null = null;

  if (entry.localFile) {
    bytes = await ctx.store.readSupplementalFile(ctx.id, entry.localFile);
    if (!bytes) {
      doc.retrieval = { status: 'manual_required', error: 'The file is not in the package supplemental/ folder.' };
      return doc;
    }
  } else if (entry.url) {
    if (useCache && prior?.storedFile && prior.sha256 && (prior.retrieval.status === 'downloaded' || prior.retrieval.status === 'cached')) {
      const stored = await ctx.store.readStored(ctx.id, prior.storedFile);
      if (stored && sha256(stored) === prior.sha256) bytes = stored; // cached: no re-download
    }
    if (!bytes) {
      try {
        const result = await downloadFile(new URL(entry.url), {
          maxBytes: ctx.maxDownloadBytes,
          timeoutMs: ctx.downloadTimeoutMs,
          fetchImpl: ctx.fetchImpl,
          // No credentials: curated URLs are third-party hosts.
        });
        bytes = result.bytes;
        doc.originalUrl = result.finalUrl;
      } catch (error) {
        applyDownloadError(doc, error);
        return doc;
      }
      ctx.downloaded.bytes += bytes.length;
    }
  }
  if (!bytes || bytes.length === 0) {
    doc.retrieval = { status: 'failed', error: 'The source was empty.' };
    return doc;
  }

  const digest = sha256(bytes);
  if (prior && prior.sha256 === digest && prior.storedFile) {
    // Same bytes as last time: reuse, re-processing only if the adapter changed.
    Object.assign(doc, {
      detectedType: prior.detectedType,
      sizeBytes: prior.sizeBytes,
      sha256: prior.sha256,
      retrievedAt: prior.retrievedAt,
      storedFile: prior.storedFile,
      normalizedFile: prior.normalizedFile,
      processing: prior.processing,
      notes: [...new Set([...doc.notes, ...prior.notes])],
      retrieval: { status: 'cached' as const },
    });
    await ensureProcessed(ctx, doc, bytes);
    return doc;
  }

  await storeAndProcess(ctx, doc, bytes, null);
  return doc;
}

// ---------------------------------------------------------------------------
// Shared: store original, process, re-process
// ---------------------------------------------------------------------------

async function storeAndProcess(ctx: Context, doc: ManifestDocument, bytes: Buffer, declaredSize: number | null): Promise<void> {
  const detected = detectType(bytes);
  const expected = expectedType(doc.declaredMimeType, doc.fileName);
  if (expected && expected !== detected) {
    doc.notes.push(
      `type_mismatch: declared ${doc.declaredMimeType ?? doc.fileName} but the content looks like "${detected}"; the content decided how it was handled.`
    );
  }
  if (declaredSize !== null && declaredSize !== bytes.length) {
    doc.notes.push(`size_mismatch: the source declared ${declaredSize} bytes but ${bytes.length} were received.`);
  }

  doc.detectedType = detected;
  doc.sizeBytes = bytes.length;
  doc.sha256 = sha256(bytes);
  doc.retrievedAt = ctx.now().toISOString();
  doc.retrieval = { status: 'downloaded' };
  doc.storedFile = await ctx.store.writeOriginal(ctx.id, doc.documentId, storageExtension(detected, doc.fileName), bytes);

  await processDocument(ctx, doc, bytes);
  logger.info(`Document ${doc.documentId}: ${doc.retrieval.status}, ${doc.processing.status}`);
}

/** Re-process a cached document only when the adapter (or its version) changed or it never parsed. */
async function ensureProcessed(ctx: Context, doc: ManifestDocument, bytes: Buffer): Promise<void> {
  const processor = pickProcessor(ctx.processors, doc.detectedType ?? 'unknown', doc.declaredMimeType, doc.fileName);
  let current: boolean;
  if (!processor) {
    current = doc.processing.status === 'unsupported_format';
  } else {
    current =
      doc.processing.status === 'parsed' &&
      doc.processing.processorId === processor.id &&
      doc.processing.processorVersion === processor.version &&
      doc.normalizedFile !== null &&
      (await ctx.store.readNormalized(ctx.id, doc.documentId).catch(() => null)) !== null;
  }
  if (!current) await processDocument(ctx, doc, bytes);
}

async function processDocument(ctx: Context, doc: ManifestDocument, bytes: Buffer): Promise<void> {
  const detected = doc.detectedType ?? 'unknown';
  const processor = pickProcessor(ctx.processors, detected, doc.declaredMimeType, doc.fileName);

  if (!processor) {
    doc.processing = { status: 'unsupported_format', detail: describeUnsupported(detected, doc.declaredMimeType, doc.fileName) };
    doc.normalizedFile = null;
    return;
  }

  try {
    const normalized = await processor.process({
      documentId: doc.documentId,
      file: bytes,
      fileName: doc.fileName,
      mimeType: doc.declaredMimeType,
      detectedType: detected,
      sourceUrl: doc.originalUrl ?? undefined,
    });
    const stats = textStats(normalized);
    if (stats.empty) {
      doc.processing = {
        status: 'empty_text',
        processorId: processor.id,
        processorVersion: processor.version,
        pages: stats.units,
        detail: 'No extractable text (possibly a scanned document). OCR is out of scope.',
      };
      doc.normalizedFile = null;
      return;
    }
    doc.normalizedFile = await ctx.store.writeNormalized(ctx.id, doc.documentId, normalized);
    doc.processing = {
      status: 'parsed',
      processorId: processor.id,
      processorVersion: processor.version,
      ...(normalized.kind === 'pdf' ? { pages: normalized.pageCount } : { sections: normalized.sections.length }),
    };
  } catch (error) {
    if (!(error instanceof ProcessingError)) logger.debug(`Unexpected processing error for ${doc.documentId}`);
    doc.processing = {
      status: 'parse_failed',
      processorId: processor.id,
      processorVersion: processor.version,
      error: error instanceof ProcessingError ? error.message : 'The document could not be processed.',
    };
    doc.normalizedFile = null;
  }
}

/** Non-whitespace character count; "empty" means too little text to be a real document. */
function textStats(doc: NormalizedDocument): { empty: boolean; units: number } {
  const count = (s: string): number => s.replace(/\s+/g, '').length;
  if (doc.kind === 'pdf') {
    const chars = doc.pages.reduce((sum, p) => sum + count(p.text), 0);
    return { empty: chars < Math.max(20, doc.pageCount * 10), units: doc.pageCount };
  }
  const chars = doc.sections.reduce((sum, s) => sum + count(s.text) + count(s.heading ?? ''), 0);
  return { empty: chars < 20, units: doc.sections.length };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function applyOverride(doc: ManifestDocument, supplemental: SupplementalConfig): ManifestDocument {
  const override = supplemental.overrides[doc.documentId];
  if (!override) return doc;
  return {
    ...doc,
    authority: override,
    authorityMethod: 'manual',
    authorityReason: 'manual override in supplemental.json',
  };
}

function applyDownloadError(doc: ManifestDocument, error: unknown): void {
  if (error instanceof DownloadError) {
    const status =
      error.kind === 'too_large'
        ? 'skipped_too_large'
        : error.kind === 'invalid_url' || error.kind === 'not_https' || error.kind === 'blocked_host'
          ? 'skipped_unsafe'
          : 'failed';
    doc.retrieval = {
      status,
      error: `${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}`,
    };
  } else {
    doc.retrieval = { status: 'failed', error: 'Unexpected error while downloading the document.' };
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Display text from an untrusted source: no control characters, collapsed whitespace, bounded length. */
export function cleanDisplay(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'doc';
}

function lastPathSegment(raw: string): string | null {
  try {
    const segment = new URL(raw).pathname.split('/').filter(Boolean).pop();
    return segment ?? null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
