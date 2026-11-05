import { describe, expect, it } from 'vitest';
import { computeCoverage, computePotentialMissingSources } from './coverage.js';
import { makeOpportunity } from '../__fixtures__/helpers.js';
import type { ManifestDocument } from '../schemas.js';

function doc(overrides: Partial<ManifestDocument> & { documentId: string }): ManifestDocument {
  return {
    origin: 'simpler_attachment',
    title: overrides.documentId,
    fileName: `${overrides.documentId}.pdf`,
    declaredMimeType: 'application/pdf',
    detectedType: 'pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    sourceAttachmentId: overrides.documentId,
    sourceUpdatedAt: null,
    sourceSizeBytes: null,
    originalUrl: null,
    urlKind: null,
    retrievedAt: null,
    retrievalMethod: 'api_download',
    storedFile: 'documents/x/original.pdf',
    normalizedFile: 'documents/x/normalized.json',
    authority: 'controlling',
    authorityMethod: 'heuristic',
    authorityReason: 'test',
    retrieval: { status: 'downloaded' },
    processing: { status: 'parsed' },
    notes: [],
    ...overrides,
  };
}

describe('computeCoverage', () => {
  it('zero documents -> none, explained, and never "complete"', () => {
    const c = computeCoverage([]);
    expect(c.status).toBe('none');
    expect(c.reasons.join(' ')).toMatch(/lists no attachments/);
    expect(c.completenessNote).toMatch(/cannot be verified/);
  });

  it('all listed documents parsed with a controlling one -> api_listed_processed (with the completeness caveat)', () => {
    const c = computeCoverage([doc({ documentId: 'nofo' }), doc({ documentId: 'faq', authority: 'official_guidance' })]);
    expect(c.status).toBe('api_listed_processed');
    expect(c.reasons).toEqual([]);
    expect(c.completenessNote.length).toBeGreaterThan(20);
  });

  it('one unsupported document -> partial, naming the document', () => {
    const c = computeCoverage([
      doc({ documentId: 'nofo' }),
      doc({ documentId: 'tmpl', title: 'Application Template', authority: 'official_guidance', processing: { status: 'unsupported_format', detail: 'Word document (.docx)' } }),
    ]);
    expect(c.status).toBe('partial');
    expect(c.reasons.join(' ')).toMatch(/Application Template.*unsupported format/);
  });

  it.each([
    ['download failure', { retrieval: { status: 'failed' as const, error: 'http_error (HTTP 404)' }, processing: { status: 'not_attempted' as const } }, /could not be downloaded.*404/],
    ['too large', { retrieval: { status: 'skipped_too_large' as const }, processing: { status: 'not_attempted' as const } }, /size limit/],
    ['unsafe url', { retrieval: { status: 'skipped_unsafe' as const, error: 'blocked_host' }, processing: { status: 'not_attempted' as const } }, /not allowed/],
    ['parse failure', { processing: { status: 'parse_failed' as const, error: 'password protected' } }, /could not be parsed.*password/],
    ['scanned', { processing: { status: 'empty_text' as const } }, /no extractable text/],
  ])('%s makes coverage partial with a reason', (_label, overrides, pattern) => {
    const c = computeCoverage([doc({ documentId: 'nofo' }), doc({ documentId: 'bad', authority: 'official_guidance', ...overrides })]);
    expect(c.status).toBe('partial');
    expect(c.reasons.join(' ')).toMatch(pattern);
  });

  it('parsed documents but no controlling one -> partial', () => {
    const c = computeCoverage([doc({ documentId: 'faq', authority: 'official_guidance' }), doc({ documentId: 'u', authority: 'unclassified' })]);
    expect(c.status).toBe('partial');
    expect(c.reasons.join(' ')).toMatch(/No controlling document/);
  });

  it('nothing parsed -> none, listing every problem', () => {
    const c = computeCoverage([doc({ documentId: 'a', processing: { status: 'unsupported_format', detail: 'x' } })]);
    expect(c.status).toBe('none');
    expect(c.reasons.join(' ')).toMatch(/No document could be parsed/);
  });

  it('documents removed upstream are reported but do not count against the current listing', () => {
    const c = computeCoverage([doc({ documentId: 'nofo' }), doc({ documentId: 'gone', title: 'Old Doc', retrieval: { status: 'removed_upstream' } })]);
    expect(c.status).toBe('api_listed_processed');
    expect(c.reasons.join(' ')).toMatch(/Old Doc.*no longer listed/);
  });
});

describe('computePotentialMissingSources', () => {
  it('records what may be missing instead of assuming it does not exist', () => {
    const kinds = computePotentialMissingSources(makeOpportunity(), [doc({ documentId: 'nofo' })]).map((m) => m.kind);
    expect(kinds).toContain('additional_info_url');
    expect(kinds).toContain('official_guidance_not_attached');
    expect(kinds).toContain('amendments_not_listed');
    expect(kinds).not.toContain('no_controlling_document');
  });

  it('flags a missing controlling document and each unparsed attachment', () => {
    const missing = computePotentialMissingSources(makeOpportunity(), [
      doc({ documentId: 'tmpl', authority: 'official_guidance', processing: { status: 'unsupported_format', detail: 'docx' } }),
    ]);
    expect(missing.map((m) => m.kind)).toEqual(expect.arrayContaining(['no_controlling_document', 'unparsed_attachment']));
    expect(missing.find((m) => m.kind === 'unparsed_attachment')?.documentId).toBe('tmpl');
  });

  it('drops guidance/amendment hints that are already satisfied, and ignores non-http info URLs', () => {
    const opportunity = makeOpportunity({
      summary: { ...makeOpportunity().summary, additionalInfoUrl: 'javascript:alert(1)' },
    });
    const kinds = computePotentialMissingSources(opportunity, [
      doc({ documentId: 'nofo', fileName: 'NOFO_Amendment_1.pdf' }),
      doc({ documentId: 'faq', authority: 'official_guidance' }),
    ]).map((m) => m.kind);
    expect(kinds).toEqual([]);
  });
});
