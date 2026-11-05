import type { VerifiableDocument } from '../citations.js';
import type { LlmCall, LlmFn, LlmResult } from '../llm.js';
import type { Authority, ManifestDocument, NormalizedDocument } from '../schemas.js';
import { PackageStore } from '../store.js';
import type { WireRequirement } from '../extraction/schemas.js';
import { OPP_A } from './helpers.js';

// Synthetic text shaped like a funding notice. Not a real document.
export const DOC_ID = 'sg-test-nofo-0001';
export const GUIDANCE_ID = 'sg-test-faq-0002';

export const PAGE_TEXTS = [
  'Table of Contents\nA. Basic Information .......... 2\nB. Eligibility .......... 3',
  'B. ELIGIBILITY\n1. ELIGIBLE APPLICANTS\nEligible applicants are States, units of local government and transit agencies.\nThe following are not eligible applicants: Federal agencies and Individuals.',
  '2. MINIMUM FUNDING REQUEST\nApplicants for capital projects located in urban areas must request at least $5 million in program funding.\nApplicants for capital projects located in rural areas must request at least $1 million in program funding.\nThere is no minimum request for planning grants.',
  '3. APPLICATION LIMIT\nEach applicant can submit up to three applications. Unrelated components should not be combined\nin one application to meet this limit.',
];

export function pdfDoc(documentId: string, pages: string[], authority: Authority = 'controlling'): VerifiableDocument {
  const normalized: NormalizedDocument = {
    schemaVersion: 1,
    kind: 'pdf',
    documentId,
    processorId: 'test-pdf',
    processorVersion: '1',
    warnings: [],
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ page: i + 1, text, headings: [] })),
  };
  return { documentId, authority, normalized };
}

export function htmlDoc(documentId: string, sections: Array<{ id: string; heading: string | null; text: string }>, authority: Authority = 'official_guidance'): VerifiableDocument {
  const normalized: NormalizedDocument = {
    schemaVersion: 1,
    kind: 'html',
    documentId,
    processorId: 'test-html',
    processorVersion: '1',
    warnings: [],
    title: null,
    sourceUrl: null,
    sections: sections.map((s) => ({ ...s, level: s.heading ? 1 : null })),
    links: [],
  };
  return { documentId, authority, normalized };
}

export function docsMap(...docs: VerifiableDocument[]): Map<string, VerifiableDocument> {
  return new Map(docs.map((d) => [d.documentId, d]));
}

export function manifestDoc(overrides: Partial<ManifestDocument> & { documentId: string }): ManifestDocument {
  return {
    origin: 'simpler_attachment',
    title: overrides.documentId,
    fileName: `${overrides.documentId}.pdf`,
    declaredMimeType: 'application/pdf',
    detectedType: 'pdf',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    sourceAttachmentId: overrides.documentId,
    sourceUpdatedAt: null,
    sourceSizeBytes: null,
    originalUrl: null,
    urlKind: null,
    retrievedAt: null,
    retrievalMethod: 'api_download',
    storedFile: `documents/${overrides.documentId}/original.pdf`,
    normalizedFile: `documents/${overrides.documentId}/normalized.json`,
    authority: 'controlling',
    authorityMethod: 'heuristic',
    authorityReason: 'test',
    retrieval: { status: 'downloaded' },
    processing: { status: 'parsed', processorId: 'test-pdf', processorVersion: '1', pages: 4 },
    notes: [],
    ...overrides,
  };
}

/** Writes a package (manifest + normalized documents) into a store. */
export async function writePackage(
  store: PackageStore,
  docs: Array<{ doc: VerifiableDocument; manifest?: Partial<ManifestDocument> }>,
  opportunityId: string = OPP_A
): Promise<void> {
  await store.writeManifest(opportunityId, {
    schemaVersion: 1,
    opportunityId,
    retrievedAt: '2026-01-01T00:00:00Z',
    lastCheckedAt: '2026-01-01T00:00:00Z',
    coverage: { status: 'api_listed_processed', reasons: [], completenessNote: 'test' },
    documents: docs.map(({ doc, manifest }) => manifestDoc({ documentId: doc.documentId, authority: doc.authority, ...manifest })),
    potentialMissingSources: [],
  });
  for (const { doc } of docs) await store.writeNormalized(opportunityId, doc.documentId, doc.normalized);
}

export const URBAN_QUOTE = 'Applicants for capital projects located in urban areas must request at least $5 million in program funding.';
export const RURAL_QUOTE = 'Applicants for capital projects located in rural areas must request at least $1 million in program funding.';
export const LIMIT_QUOTE = 'Each applicant can submit up to three applications.';

/** A valid model-proposed requirement. Override any field. */
export function wire(overrides: Partial<WireRequirement> = {}): WireRequirement {
  return {
    category: 'funding',
    topic: 'minimum_request',
    title: 'Minimum request for urban capital projects',
    description: 'Urban capital applicants must request at least $5 million.',
    mandatory: 'yes',
    programVariant: 'capital',
    appliesWhen: ['capital project', 'urban area'],
    evidenceNeeded: ['federal funding request amount'],
    check: { kind: 'amount_min', amountUsd: 5_000_000, pct: 0, values: [], documentKey: '', areaType: 'urban', grantCategory: 'capital' },
    ambiguous: false,
    ambiguityNote: '',
    sources: [{ documentId: DOC_ID, page: 3, section: '', quote: URBAN_QUOTE }],
    ...overrides,
  };
}

export const NO_CHECK = { kind: 'none' as const, amountUsd: 0, pct: 0, values: [], documentKey: '', areaType: 'any' as const, grantCategory: 'any' as const };

export function envelope(...requirements: unknown[]): string {
  return JSON.stringify({ requirements });
}

export function llmResult(text: string, extra: Partial<LlmResult> = {}): LlmResult {
  return { text, stopReason: 'end_turn', model: 'test-model', inputTokens: 100, outputTokens: 50, ...extra };
}

export interface ScriptedLlm extends LlmFn {
  calls: LlmCall[];
}

/** A stand-in for the model. `handler` sees each call and returns the result (or throws). */
export function scriptedLlm(handler: (call: LlmCall, index: number) => LlmResult | Promise<LlmResult>): ScriptedLlm {
  const fn = (async (call: LlmCall) => {
    const index = fn.calls.length;
    fn.calls.push(call);
    return handler(call, index);
  }) as ScriptedLlm;
  fn.calls = [];
  return fn;
}

export const pagesInPrompt = (call: LlmCall): number => (call.user.match(/<page number=/g) ?? []).length;
