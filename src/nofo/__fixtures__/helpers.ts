import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Attachment, Opportunity } from '../schemas.js';
import { PackageStore } from '../store.js';
import type { OpportunityDetail, OpportunitySource } from '../simpler/source.js';
import type { DocumentProcessor } from '../ingest/processors/types.js';

// Synthetic IDs for unit tests. They are not real opportunities.
export const OPP_A = '11111111-1111-4111-8111-111111111111';
export const OPP_B = '22222222-2222-4222-8222-222222222222';
export const ATT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ATT_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
export const ATT_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

export async function tmpStore(): Promise<{ store: PackageStore; dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'nofo-test-'));
  return { store: new PackageStore(dir), dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    schemaVersion: 1,
    source: 'simpler.grants.gov',
    opportunityId: OPP_A,
    opportunityNumber: 'TEST-OPP-001',
    legacyOpportunityId: 1001,
    title: 'Synthetic Test Opportunity',
    status: 'posted',
    category: 'discretionary',
    agency: { code: 'TEST-AGENCY', name: 'Test Agency', topLevelCode: 'TEST', topLevelName: 'Test Department' },
    summary: {
      awardCeiling: 1_000_000,
      awardFloor: 1,
      estimatedTotalProgramFunding: null,
      expectedNumberOfAwards: null,
      postDate: '2026-01-01',
      closeDate: '2026-12-31',
      archiveDate: null,
      fiscalYear: null,
      isCostSharing: true,
      applicantTypes: ['other'],
      additionalInfoUrl: 'https://agency.example.test/program',
      applicantEligibilityDescription: null,
    },
    sourceUpdatedAt: '2026-01-02T00:00:00Z',
    responseSha256: 'a'.repeat(64),
    retrievedAt: '2026-01-03T00:00:00Z',
    ...overrides,
  };
}

export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    attachmentId: ATT_1,
    fileName: 'Test_NOFO.pdf',
    description: 'Test NOFO',
    mimeType: 'application/pdf',
    sizeBytes: null,
    downloadPath: 'https://files.example.test/opportunities/x/attachments/y/Test_NOFO.pdf',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

export interface FakeSource extends OpportunitySource {
  calls: number;
}

/** In-memory OpportunitySource. `detail` may be a function so tests can change what the "API" returns. */
export function fakeSource(
  detail: OpportunityDetail | (() => OpportunityDetail | Promise<OpportunityDetail>),
  extra: Partial<Pick<OpportunitySource, 'apiBaseUrl' | 'downloadAuth'>> = {}
): FakeSource {
  const source: FakeSource = {
    calls: 0,
    ...extra,
    async getOpportunityWithAttachments() {
      source.calls += 1;
      return typeof detail === 'function' ? detail() : detail;
    },
    async getOpportunity(id) {
      return (await source.getOpportunityWithAttachments(id)).opportunity;
    },
    async getAttachments(id) {
      return (await source.getOpportunityWithAttachments(id)).attachments;
    },
  };
  return source;
}

export function detailOf(attachments: Attachment[], opportunity: Opportunity = makeOpportunity(), sha = 'b'.repeat(64)): OpportunityDetail {
  return { opportunity: { ...opportunity, responseSha256: sha }, attachments, responseSha256: sha };
}

export interface FakeFetch {
  (input: URL | string, init?: RequestInit): Promise<Response>;
  calls: Array<{ url: string; headers: Record<string, string> }>;
}

/** fetch stand-in: `handler` maps a URL to a Response. Records every call (URL and headers). */
export function fakeFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): FakeFetch {
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    fn.calls.push({ url: url.toString(), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    return handler(url, init);
  }) as FakeFetch;
  fn.calls = [];
  return fn;
}

export const asFetch = (f: FakeFetch): typeof fetch => f as unknown as typeof fetch;

export function bytesResponse(bytes: Buffer | Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(new Uint8Array(bytes), { status: init.status ?? 200, headers: init.headers });
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A body that streams `totalBytes` with NO Content-Length, to test streaming size caps. */
export function streamingResponse(totalBytes: number, chunkSize = 1024): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(65));
      sent += size;
    },
  });
  return new Response(stream, { status: 200 });
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Builds a minimal valid text PDF. Each page is a list of lines; a line may
 * set its font size. A page with no lines draws a rectangle only (like a scan).
 */
export function makePdf(pages: Array<Array<{ text: string; size?: number }>>): Buffer {
  const objects: string[] = [];
  const pageObjects = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const pageNumber = 4 + i * 2;
    const contentNumber = pageNumber + 1;
    const content = lines.length
      ? 'BT\n' +
        lines
          .map((line, idx) => `/F1 ${line.size ?? 11} Tf 1 0 0 1 72 ${720 - idx * 28} Tm (${pdfEscape(line.text)}) Tj`)
          .join('\n') +
        '\nET'
      : '0 0 100 100 re S';
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentNumber] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(out);
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Fake PDF/HTML adapters so pipeline tests do not depend on pdfjs or cheerio. */
export function fakeProcessor(
  kind: 'pdf' | 'html' = 'pdf',
  version = '1'
): DocumentProcessor & { processCalls: number } {
  const processor: DocumentProcessor & { processCalls: number } = {
    id: `fake-${kind}`,
    version,
    processCalls: 0,
    supports: (detected) => detected === kind,
    async process({ documentId }) {
      processor.processCalls += 1;
      const filler = 'This is synthetic extracted text for a unit test document. ';
      if (kind === 'pdf') {
        return {
          schemaVersion: 1,
          kind: 'pdf',
          documentId,
          processorId: processor.id,
          processorVersion: version,
          warnings: [],
          pageCount: 2,
          pages: [
            { page: 1, text: filler.repeat(3), headings: [] },
            { page: 2, text: filler.repeat(3), headings: [] },
          ],
        };
      }
      return {
        schemaVersion: 1,
        kind: 'html',
        documentId,
        processorId: processor.id,
        processorVersion: version,
        warnings: [],
        title: 'Synthetic page',
        sourceUrl: null,
        sections: [{ id: 's1', heading: 'Heading', level: 1, text: filler.repeat(3) }],
        links: [],
      };
    },
  };
  return processor;
}

export const PDF_BYTES = Buffer.from('%PDF-1.4\n% synthetic pdf bytes for pipeline tests\n', 'latin1');
export const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('synthetic zip container')]);
export const HTML_BYTES = Buffer.from('<!DOCTYPE html><html><head><title>t</title></head><body><h1>Hi</h1><p>text</p></body></html>');
