import { promises as fs } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GrantServerError } from '../../types/index.js';
import { SimplerApiError } from '../simpler/client.js';
import { PackageCorruptError } from '../store.js';
import { SupplementalConfigError } from '../acquire/supplemental.js';
import { attachmentDocumentId, ingestOpportunity } from './ingest-opportunity.js';
import { createDocxProcessor } from './processors/docx.js';
import { makeDocx } from '../__fixtures__/docx.js';
import {
  ATT_1,
  ATT_2,
  ATT_3,
  DOCX_BYTES,
  HTML_BYTES,
  OPP_A,
  OPP_B,
  PDF_BYTES,
  asFetch,
  bytesResponse,
  detailOf,
  fakeFetch,
  fakeProcessor,
  fakeSource,
  makeAttachment,
  makeOpportunity,
  streamingResponse,
  tmpStore,
} from '../__fixtures__/helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
async function setup() {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  return t;
}

const NOFO = makeAttachment({ attachmentId: ATT_1, fileName: 'Test_NOFO.pdf', description: 'Test NOFO', downloadPath: 'https://files.example.test/a/nofo.pdf' });
const FAQ = makeAttachment({ attachmentId: ATT_2, fileName: 'Test_FAQ.pdf', description: 'Frequently asked questions', downloadPath: 'https://files.example.test/a/faq.pdf' });
const TEMPLATE = makeAttachment({
  attachmentId: ATT_3,
  fileName: 'Application_Template.docx',
  description: 'Application Template',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  downloadPath: 'https://files.example.test/a/template.docx',
});

/** Serves each file by URL path; unknown paths 404. */
function filesFetch(files: Record<string, Buffer | (() => Response)>) {
  return fakeFetch((url) => {
    const entry = files[url.pathname];
    if (!entry) return new Response('not found', { status: 404 });
    return typeof entry === 'function' ? entry() : bytesResponse(entry);
  });
}

const standardFiles = { '/a/nofo.pdf': PDF_BYTES, '/a/faq.pdf': PDF_BYTES, '/a/template.docx': DOCX_BYTES };

async function run(
  attachments = [NOFO, FAQ],
  files: Record<string, Buffer | (() => Response)> = standardFiles,
  extra: Parameters<typeof ingestOpportunity>[1] = {}
) {
  const t = await setup();
  const source = fakeSource(detailOf(attachments));
  const fetchImpl = filesFetch(files);
  const processor = fakeProcessor('pdf');
  const pkg = await ingestOpportunity(OPP_A, {
    source,
    store: t.store,
    fetchImpl: asFetch(fetchImpl),
    processors: [processor, fakeProcessor('html')],
    ...extra,
  });
  return { ...t, source, fetchImpl, processor, pkg };
}

describe('ingestOpportunity: happy path and traceability', () => {
  it('acquires, parses and persists a traceable package', async () => {
    const { pkg, store, dir } = await run();
    const { manifest } = pkg;

    expect(manifest.documents.map((d) => d.documentId)).toEqual([attachmentDocumentId(ATT_1), attachmentDocumentId(ATT_2)]);
    const nofo = manifest.documents[0];
    expect(nofo).toMatchObject({
      origin: 'simpler_attachment',
      authority: 'controlling',
      authorityMethod: 'heuristic',
      detectedType: 'pdf',
      retrieval: { status: 'downloaded' },
      processing: { status: 'parsed', processorId: 'fake-pdf', pages: 2 },
      originalUrl: 'https://files.example.test/a/nofo.pdf',
      urlKind: 'absolute',
    });
    expect(nofo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.documents[1].authority).toBe('official_guidance');
    expect(manifest.coverage.status).toBe('api_listed_processed');

    // What was returned is what is on disk, and the opportunity is stored with its UUID and number kept apart.
    expect(await store.readManifest(OPP_A)).toEqual(manifest);
    const stored = await store.readOpportunity(OPP_A);
    expect(stored?.opportunityId).toBe(OPP_A);
    expect(stored?.opportunityNumber).toBe('TEST-OPP-001');

    // Traceability: every manifest document resolves to stored original bytes and to non-empty normalized content.
    for (const d of manifest.documents) {
      expect((await store.readStored(OPP_A, d.storedFile!))?.length).toBe(d.sizeBytes);
      const normalized = await store.readNormalized(OPP_A, d.documentId);
      expect(normalized?.documentId).toBe(d.documentId);
      if (normalized?.kind === 'pdf') {
        expect(normalized.pages.length).toBe(d.processing.pages);
        for (const page of normalized.pages) expect(page.text.length).toBeGreaterThan(0);
      }
    }
    expect((await fs.readdir(dir)).sort()).toEqual([OPP_A]);
  });
});

describe('ingestOpportunity: missing and partial coverage', () => {
  it('zero attachments: keeps metadata, states coverage is none/unknown, records potential missing sources', async () => {
    const { pkg, store } = await run([]);
    expect(pkg.manifest.documents).toEqual([]);
    expect(pkg.manifest.coverage.status).toBe('none');
    expect(pkg.manifest.coverage.reasons.join(' ')).toMatch(/lists no attachments/);
    expect((await store.readOpportunity(OPP_A))?.title).toBe('Synthetic Test Opportunity');
    const kinds = pkg.manifest.potentialMissingSources.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['no_controlling_document', 'official_guidance_not_attached', 'additional_info_url']));
  });

  it('a failed download is recorded per document and the rest of the package continues', async () => {
    const { pkg, processor } = await run([NOFO, FAQ], { '/a/nofo.pdf': PDF_BYTES }); // faq 404s
    const [nofo, faq] = pkg.manifest.documents;
    expect(nofo.processing.status).toBe('parsed');
    expect(faq.retrieval.status).toBe('failed');
    expect(faq.retrieval.error).toMatch(/HTTP 404/);
    expect(faq.processing.status).toBe('not_attempted');
    expect(pkg.manifest.coverage.status).toBe('partial');
    expect(processor.processCalls).toBe(1);
  });

  it('unsupported formats are stored and registered, never parsed or extracted', async () => {
    const { pkg, store, processor } = await run([NOFO, TEMPLATE]);
    const template = pkg.manifest.documents[1];
    expect(template.detectedType).toBe('zip');
    expect(template.processing.status).toBe('unsupported_format');
    expect(template.processing.detail).toMatch(/Word document.*not parsed/);
    expect(template.normalizedFile).toBeNull();
    expect(template.storedFile).toMatch(/original\.docx$/);
    expect(await store.readNormalized(OPP_A, template.documentId)).toBeNull();
    expect(processor.processCalls).toBe(1); // only the PDF
    expect(pkg.manifest.coverage.status).toBe('partial');
    expect(pkg.manifest.potentialMissingSources.some((m) => m.kind === 'unparsed_attachment' && m.documentId === template.documentId)).toBe(true);
  });

  it('a scanned/empty PDF is empty_text (no OCR) and not usable', async () => {
    const t = await setup();
    const emptyPdf = { ...fakeProcessor('pdf'), process: async ({ documentId }: { documentId: string }) => ({
      schemaVersion: 1 as const, kind: 'pdf' as const, documentId, processorId: 'fake-pdf', processorVersion: '1', warnings: [], pageCount: 3,
      pages: [1, 2, 3].map((page) => ({ page, text: '', headings: [] })),
    }) };
    const pkg = await ingestOpportunity(OPP_A, {
      source: fakeSource(detailOf([NOFO])),
      store: t.store,
      fetchImpl: asFetch(filesFetch(standardFiles)),
      processors: [emptyPdf],
    });
    expect(pkg.manifest.documents[0].processing.status).toBe('empty_text');
    expect(pkg.manifest.documents[0].normalizedFile).toBeNull();
    expect(pkg.manifest.coverage.status).toBe('none');
  });

  it('a parser failure becomes parse_failed with a safe message', async () => {
    const t = await setup();
    const exploding = { ...fakeProcessor('pdf'), process: async () => { throw new Error('internal /secret/path stack detail'); } };
    const pkg = await ingestOpportunity(OPP_A, { source: fakeSource(detailOf([NOFO])), store: t.store, fetchImpl: asFetch(filesFetch(standardFiles)), processors: [exploding] });
    const doc = pkg.manifest.documents[0];
    expect(doc.processing.status).toBe('parse_failed');
    expect(doc.processing.error).toBe('The document could not be processed.');
    expect(JSON.stringify(pkg.manifest)).not.toContain('/secret/path');
  });

  it('an attachment without download_path is a per-document failure', async () => {
    const { pkg } = await run([{ ...NOFO, downloadPath: null }]);
    expect(pkg.manifest.documents[0].retrieval).toMatchObject({ status: 'failed', error: expect.stringMatching(/no download_path/) });
    expect(pkg.manifest.coverage.status).toBe('none');
  });
});

describe('ingestOpportunity: content-based handling and safety', () => {
  it('uses the content, not the declared type, and notes the mismatch', async () => {
    const { pkg } = await run([{ ...NOFO, mimeType: 'application/pdf' }], { '/a/nofo.pdf': HTML_BYTES });
    const doc = pkg.manifest.documents[0];
    expect(doc.detectedType).toBe('html');
    expect(doc.processing.processorId).toBe('fake-html');
    expect(doc.notes.join(' ')).toMatch(/type_mismatch.*"html"/);
  });

  it('notes when the received size differs from the declared size', async () => {
    const { pkg } = await run([{ ...NOFO, sizeBytes: PDF_BYTES.length + 10 }]);
    expect(pkg.manifest.documents[0].notes.join(' ')).toMatch(/size_mismatch/);
  });

  it('unsafe file names never reach the file system: storage names are server-generated', async () => {
    const evil = { ...NOFO, fileName: '../../etc/passwd\u0000.pdf', description: 'Evil\nName' };
    const { pkg, dir } = await run([evil]);
    const doc = pkg.manifest.documents[0];
    expect(doc.storedFile).toBe(`documents/${doc.documentId}/original.pdf`);
    expect(doc.fileName).not.toMatch(/[\u0000-\u001f]/);
    expect(doc.title).toBe('Evil Name');
    expect(await fs.readdir(dir)).toEqual([OPP_A]); // nothing created outside the package
    await expect(fs.stat(join(dir, '..', 'etc'))).rejects.toThrow();
  });

  it('skips files whose declared size is over the per-file limit, without downloading them', async () => {
    const { pkg, fetchImpl } = await run([{ ...NOFO, sizeBytes: 10_000 }], standardFiles, { maxDownloadBytes: 1000 });
    expect(pkg.manifest.documents[0].retrieval.status).toBe('skipped_too_large');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('enforces the size limit while streaming when the declared size is missing or wrong', async () => {
    const { pkg } = await run([{ ...NOFO, sizeBytes: null }], { '/a/nofo.pdf': () => streamingResponse(50_000) }, { maxDownloadBytes: 4096 });
    expect(pkg.manifest.documents[0].retrieval.status).toBe('skipped_too_large');
  });

  it('enforces a package size cap across documents', async () => {
    // Files really are 600 bytes, matching their declared size, so the cap is reached honestly.
    const sixHundred = Buffer.concat([PDF_BYTES, Buffer.alloc(600 - PDF_BYTES.length, 0x20)]);
    const { pkg } = await run(
      [{ ...NOFO, sizeBytes: 600 }, { ...FAQ, sizeBytes: 600 }],
      { '/a/nofo.pdf': sixHundred, '/a/faq.pdf': sixHundred },
      { maxPackageBytes: 1000, concurrency: 1 }
    );
    expect(pkg.manifest.documents.map((d) => d.retrieval.status)).toEqual(['downloaded', 'skipped_too_large']);
  });

  it('presigned URLs: the signature is classified, then never persisted', async () => {
    const signed = { ...NOFO, downloadPath: 'https://files.example.test/a/nofo.pdf?X-Amz-Signature=TOPSECRETSIG&X-Amz-Credential=cred' };
    const { pkg, dir } = await run([signed]);
    const doc = pkg.manifest.documents[0];
    expect(doc.urlKind).toBe('presigned');
    expect(doc.originalUrl).toBe('https://files.example.test/a/nofo.pdf');
    const onDisk = await fs.readFile(join(dir, OPP_A, 'manifest.json'), 'utf-8');
    expect(onDisk).not.toContain('TOPSECRETSIG');
    expect(onDisk).not.toContain('X-Amz');
  });

  it.each([
    ['http (not https)', 'http://files.example.test/a/nofo.pdf'],
    ['loopback IP', 'https://127.0.0.1/a/nofo.pdf'],
    ['cloud metadata IP', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost/a/nofo.pdf'],
  ])('refuses unsafe download URLs (%s) without making a request', async (_label, downloadPath) => {
    const { pkg, fetchImpl } = await run([{ ...NOFO, downloadPath }]);
    expect(pkg.manifest.documents[0].retrieval.status).toBe('skipped_unsafe');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('never sends the API key to the files host, but does for relative paths on the API host', async () => {
    const t = await setup();
    const auth = { host: 'api.example.test', apiKey: 'api-key-xyz' };
    const source = fakeSource(
      detailOf([NOFO, { ...FAQ, downloadPath: '/files/faq.pdf' }]),
      { apiBaseUrl: 'https://api.example.test/', downloadAuth: auth }
    );
    const fetchImpl = filesFetch({ '/a/nofo.pdf': PDF_BYTES, '/files/faq.pdf': PDF_BYTES });
    await ingestOpportunity(OPP_A, { source, store: t.store, fetchImpl: asFetch(fetchImpl), processors: [fakeProcessor('pdf')] });
    const byHost = (host: string) => fetchImpl.calls.filter((c) => new URL(c.url).host === host);
    expect(byHost('files.example.test')).toHaveLength(1);
    expect(byHost('files.example.test')[0].headers['X-API-Key']).toBeUndefined();
    expect(byHost('api.example.test')[0].headers['X-API-Key']).toBe('api-key-xyz');
  });
});

describe('ingestOpportunity: input and API failures', () => {
  it('rejects an invalid UUID before any API call', async () => {
    const t = await setup();
    const source = fakeSource(detailOf([]));
    await expect(ingestOpportunity('../../etc/passwd', { source, store: t.store })).rejects.toBeInstanceOf(GrantServerError);
    expect(source.calls).toBe(0);
  });

  it('propagates API failures (unknown opportunity, auth, rate limit) and writes nothing', async () => {
    for (const kind of ['not_found', 'auth', 'rate_limited', 'malformed_response'] as const) {
      const t = await setup();
      const source = fakeSource(() => {
        throw new SimplerApiError(kind, `${kind} happened`);
      });
      await expect(ingestOpportunity(OPP_A, { source, store: t.store })).rejects.toMatchObject({ kind });
      await expect(fs.stat(join(t.dir, OPP_A))).rejects.toThrow();
    }
  });
});

describe('ingestOpportunity: caching and re-ingestion', () => {
  async function twice(second: Partial<Parameters<typeof ingestOpportunity>[1]> = {}, changeApi?: () => Parameters<typeof detailOf>) {
    const t = await setup();
    let current = detailOf([NOFO, FAQ]);
    const source = fakeSource(() => current);
    const fetchImpl = filesFetch(standardFiles);
    const processor = fakeProcessor('pdf');
    const base = { source, store: t.store, fetchImpl: asFetch(fetchImpl), processors: [processor], now: () => new Date('2026-11-05T10:00:00Z') };
    const first = await ingestOpportunity(OPP_A, base);
    if (changeApi) current = detailOf(...changeApi());
    const downloadsAfterFirst = fetchImpl.calls.length;
    const processedAfterFirst = processor.processCalls;
    const second_ = await ingestOpportunity(OPP_A, { ...base, now: () => new Date('2026-11-06T10:00:00Z'), ...second });
    return { t, source, fetchImpl, processor, first, second: second_, downloadsAfterFirst, processedAfterFirst };
  }

  it('a repeat ingest makes exactly one API call and re-downloads / re-parses nothing', async () => {
    const r = await twice();
    expect(r.source.calls).toBe(2); // one detail call per run
    expect(r.fetchImpl.calls.length).toBe(r.downloadsAfterFirst);
    expect(r.processor.processCalls).toBe(r.processedAfterFirst);
    expect(r.second.manifest.documents.map((d) => d.retrieval.status)).toEqual(['cached', 'cached']);
    expect(r.second.manifest.documents.every((d) => d.processing.status === 'parsed')).toBe(true);
  });

  it('the manifest is identical across runs apart from lastCheckedAt and the cached status', async () => {
    const r = await twice();
    const normalize = (m: typeof r.first.manifest) => ({
      ...m,
      lastCheckedAt: 'x',
      documents: m.documents.map((d) => ({ ...d, retrieval: { status: 'same' } })),
    });
    expect(normalize(r.second.manifest)).toEqual(normalize(r.first.manifest));
    expect(r.second.manifest.retrievedAt).toBe('2026-11-05T10:00:00.000Z'); // first retrieval time preserved
    expect(r.second.manifest.lastCheckedAt).toBe('2026-11-06T10:00:00.000Z');
  });

  it('a newer adapter version re-parses from the stored original without downloading', async () => {
    const t = await setup();
    const source = fakeSource(detailOf([NOFO]));
    const fetchImpl = filesFetch(standardFiles);
    const v1 = fakeProcessor('pdf', '1');
    await ingestOpportunity(OPP_A, { source, store: t.store, fetchImpl: asFetch(fetchImpl), processors: [v1] });
    const downloads = fetchImpl.calls.length;
    const v2 = fakeProcessor('pdf', '2');
    const pkg = await ingestOpportunity(OPP_A, { source, store: t.store, fetchImpl: asFetch(fetchImpl), processors: [v2] });
    expect(fetchImpl.calls.length).toBe(downloads);
    expect(v2.processCalls).toBe(1);
    expect(pkg.manifest.documents[0].processing.processorVersion).toBe('2');
    expect(pkg.manifest.documents[0].retrieval.status).toBe('cached');
  });

  it('a Word document registered as unsupported is parsed later, once the adapter exists, without re-downloading', async () => {
    const t = await setup();
    const docx = makeDocx([
      { kind: 'p', style: 'Heading1', text: 'Application Template' },
      { kind: 'p', text: 'Describe the project, its cost, and the amount of federal funding requested.' },
    ]);
    const source = fakeSource(detailOf([TEMPLATE]));
    const fetchImpl = filesFetch({ '/a/template.docx': docx });
    const base = { source, store: t.store, fetchImpl: asFetch(fetchImpl), now: () => new Date('2026-11-05T10:00:00Z') };

    // Before the adapter exists: stored and registered, not parsed.
    const first = await ingestOpportunity(OPP_A, { ...base, processors: [fakeProcessor('pdf')] });
    expect(first.manifest.documents[0].processing.status).toBe('unsupported_format');
    expect(first.manifest.coverage.status).toBe('none');

    // After: the stored original is parsed; no new download.
    const downloads = fetchImpl.calls.length;
    const second = await ingestOpportunity(OPP_A, { ...base, processors: [fakeProcessor('pdf'), createDocxProcessor()] });
    expect(fetchImpl.calls.length).toBe(downloads);
    const doc = second.manifest.documents[0];
    expect(doc.retrieval.status).toBe('cached');
    expect(doc.processing).toMatchObject({ status: 'parsed', processorId: 'mammoth-docx', sections: 1 }); // one heading + its paragraph = one section
    const normalized = await t.store.readNormalized(OPP_A, doc.documentId);
    expect(normalized?.kind === 'html' && normalized.sections[0].heading).toBe('Application Template');
  });

  it('--refresh forces a re-download', async () => {
    const r = await twice({ refresh: true });
    expect(r.fetchImpl.calls.length).toBe(r.downloadsAfterFirst + 2);
    expect(r.second.manifest.documents.map((d) => d.retrieval.status)).toEqual(['downloaded', 'downloaded']);
  });

  it('a changed attachment (new updated_at) is re-downloaded, an unchanged one is not', async () => {
    const r = await twice({}, () => [[{ ...NOFO, updatedAt: '2026-06-01T00:00:00Z' }, FAQ]]);
    expect(r.fetchImpl.calls.length).toBe(r.downloadsAfterFirst + 1);
    expect(r.second.manifest.documents.map((d) => d.retrieval.status)).toEqual(['downloaded', 'cached']);
  });

  it('retries a previously failed download on the next run', async () => {
    const t = await setup();
    let up = false;
    const fetchImpl = fakeFetch(() => (up ? bytesResponse(PDF_BYTES) : new Response('down', { status: 503 })));
    const source = fakeSource(detailOf([NOFO]));
    const opts = { source, store: t.store, fetchImpl: asFetch(fetchImpl), processors: [fakeProcessor('pdf')] };
    expect((await ingestOpportunity(OPP_A, opts)).manifest.documents[0].retrieval.status).toBe('failed');
    up = true;
    expect((await ingestOpportunity(OPP_A, opts)).manifest.documents[0].processing.status).toBe('parsed');
  });

  it('an attachment that disappears upstream is kept as removed_upstream, never deleted', async () => {
    const r = await twice({}, () => [[NOFO]]);
    const faq = r.second.manifest.documents.find((d) => d.documentId === attachmentDocumentId(ATT_2))!;
    expect(faq.retrieval.status).toBe('removed_upstream');
    expect(faq.notes.join(' ')).toMatch(/No longer listed/);
    expect(await r.t.store.readStored(OPP_A, faq.storedFile!)).not.toBeNull();
    expect(r.second.manifest.coverage.reasons.join(' ')).toMatch(/no longer listed/);
  });

  it('fails closed on a corrupt package unless --refresh is given', async () => {
    const r = await twice();
    await fs.writeFile(join(r.t.dir, OPP_A, 'manifest.json'), '{broken');
    const opts = { source: r.source, store: r.t.store, fetchImpl: asFetch(r.fetchImpl), processors: [r.processor] };
    await expect(ingestOpportunity(OPP_A, opts)).rejects.toBeInstanceOf(PackageCorruptError);
    const repaired = await ingestOpportunity(OPP_A, { ...opts, refresh: true });
    expect(repaired.manifest.documents).toHaveLength(2);
  });
});

describe('ingestOpportunity: curated supplemental sources (designed now, optional)', () => {
  async function withSupplemental(config: unknown, files: Record<string, Buffer> = {}, fetchFiles: Record<string, Buffer> = standardFiles) {
    const t = await setup();
    await fs.mkdir(join(t.dir, OPP_A, 'supplemental'), { recursive: true });
    await fs.writeFile(join(t.dir, OPP_A, 'supplemental.json'), JSON.stringify(config));
    for (const [name, bytes] of Object.entries(files)) await fs.writeFile(join(t.dir, OPP_A, 'supplemental', name), bytes);
    const fetchImpl = filesFetch(fetchFiles);
    const pkg = await ingestOpportunity(OPP_A, {
      source: fakeSource(detailOf([NOFO])),
      store: t.store,
      fetchImpl: asFetch(fetchImpl),
      processors: [fakeProcessor('pdf'), fakeProcessor('html')],
    });
    return { ...t, pkg, fetchImpl };
  }

  it('no supplemental.json means no supplemental documents', async () => {
    const { pkg } = await run([NOFO]);
    expect(pkg.manifest.documents.every((d) => d.origin === 'simpler_attachment')).toBe(true);
  });

  it('a manually placed file is registered as a curated source with the curator-set authority', async () => {
    const { pkg } = await withSupplemental({ sources: [{ title: 'Agency FAQ', localFile: 'faq.pdf', authority: 'official_guidance' }] }, { 'faq.pdf': PDF_BYTES });
    const sup = pkg.manifest.documents.find((d) => d.origin === 'curated_supplemental')!;
    expect(sup.documentId).toMatch(/^sup-agency-faq-[0-9a-f]{8}$/);
    expect(sup).toMatchObject({ retrievalMethod: 'manual_file', authority: 'official_guidance', authorityMethod: 'manual', processing: { status: 'parsed' } });
  });

  it('a listed file that has not been placed is reported as manual_required, not silently skipped', async () => {
    const { pkg } = await withSupplemental({ sources: [{ title: 'Missing FAQ', localFile: 'missing.pdf' }] });
    const sup = pkg.manifest.documents.find((d) => d.origin === 'curated_supplemental')!;
    expect(sup.retrieval.status).toBe('manual_required');
    expect(pkg.manifest.coverage.status).toBe('partial');
    expect(pkg.manifest.coverage.reasons.join(' ')).toMatch(/Missing FAQ.*manually placed file/);
  });

  it('a listed https URL is fetched (without credentials) and a listed URL that fails is recorded', async () => {
    const ok = await withSupplemental(
      { sources: [{ title: 'Official FAQ', url: 'https://agency.example.test/faq.pdf' }] },
      {},
      { ...standardFiles, '/faq.pdf': PDF_BYTES }
    );
    const sup = ok.pkg.manifest.documents.find((d) => d.origin === 'curated_supplemental')!;
    expect(sup).toMatchObject({ retrievalMethod: 'curated_url', originalUrl: 'https://agency.example.test/faq.pdf', processing: { status: 'parsed' } });
    expect(ok.fetchImpl.calls.find((c) => c.url.includes('agency.example.test'))?.headers['X-API-Key']).toBeUndefined();

    const bad = await withSupplemental({ sources: [{ title: 'Blocked', url: 'https://agency.example.test/gone.pdf' }] });
    expect(bad.pkg.manifest.documents.find((d) => d.origin === 'curated_supplemental')!.retrieval.status).toBe('failed');
  });

  it('applies manual authority overrides to API attachments', async () => {
    const { pkg } = await withSupplemental({ overrides: { [attachmentDocumentId(ATT_1)]: 'unclassified' } });
    expect(pkg.manifest.documents[0]).toMatchObject({ authority: 'unclassified', authorityMethod: 'manual' });
  });

  it('rejects an invalid supplemental.json with a clear error', async () => {
    const t = await setup();
    await fs.mkdir(join(t.dir, OPP_A), { recursive: true });
    await fs.writeFile(join(t.dir, OPP_A, 'supplemental.json'), JSON.stringify({ sources: [{ title: 'x', localFile: '../evil.pdf' }] }));
    await expect(
      ingestOpportunity(OPP_A, { source: fakeSource(detailOf([NOFO])), store: t.store, fetchImpl: asFetch(filesFetch(standardFiles)), processors: [fakeProcessor('pdf')] })
    ).rejects.toBeInstanceOf(SupplementalConfigError);
  });
});

describe('ingestOpportunity is generic', () => {
  it('runs two different opportunities with different attachment mixes through the identical code path', async () => {
    const t = await setup();
    const processors = [fakeProcessor('pdf'), fakeProcessor('html')];
    const fetchImpl = filesFetch(standardFiles);

    const a = await ingestOpportunity(OPP_A, {
      source: fakeSource(detailOf([NOFO])),
      store: t.store,
      fetchImpl: asFetch(fetchImpl),
      processors,
    });
    const b = await ingestOpportunity(OPP_B, {
      source: fakeSource(detailOf([NOFO, TEMPLATE], makeOpportunity({ opportunityId: OPP_B, opportunityNumber: 'OTHER-999', title: 'A Different Program' }))),
      store: t.store,
      fetchImpl: asFetch(fetchImpl),
      processors,
    });

    expect(a.manifest.coverage.status).toBe('api_listed_processed');
    expect(b.manifest.coverage.status).toBe('partial'); // the DOCX template is registered, not parsed
    expect(b.opportunity.opportunityNumber).toBe('OTHER-999');
    expect((await t.store.listPackages()).map((p) => p.opportunityId)).toEqual([OPP_A, OPP_B]);
  });
});
