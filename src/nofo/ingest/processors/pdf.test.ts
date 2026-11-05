import { describe, expect, it } from 'vitest';
import { PDF_PROCESSOR_ID, createPdfProcessor, detectHeadings, linesFromItems, type PdfTextItem } from './pdf.js';
import { ProcessingError } from './types.js';
import { makePdf } from '../../__fixtures__/helpers.js';

const item = (str: string, x: number, y: number, height = 11, extra: Partial<PdfTextItem> = {}): PdfTextItem => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width: str.length * height * 0.5,
  height,
  ...extra,
});

describe('linesFromItems', () => {
  it('joins items on one baseline and breaks lines when the baseline moves', () => {
    const lines = linesFromItems([item('Applicants', 72, 700), item('must', 140, 700), item('apply.', 175, 700), item('Next line', 72, 672)]);
    expect(lines.map((l) => l.text)).toEqual(['Applicants must apply.', 'Next line']);
  });
  it('ends a line after an end-of-line item and drops empty lines', () => {
    const lines = linesFromItems([item('One', 72, 700, 11, { hasEOL: true }), item('', 72, 690), item('Two', 72, 700)]);
    expect(lines.map((l) => l.text)).toEqual(['One', 'Two']);
  });
  it('does not insert a space inside a word split across items', () => {
    const first = item('Fed', 72, 700);
    const second = item('eral', 72 + first.width, 700);
    expect(linesFromItems([first, second])[0].text).toBe('Federal');
  });
});

describe('detectHeadings', () => {
  it('flags lines noticeably larger than body text and ranks levels by size', () => {
    const page = linesFromItems([
      item('Section A. Program Description', 72, 740, 18),
      item('Body text that is long enough to be the dominant size on this page.', 72, 700),
      item('More body text, also long enough to dominate the weighting here.', 72, 672),
      item('A subsection', 72, 640, 14),
      item('Even more body text to keep the body size dominant by character count.', 72, 612),
    ]);
    const [headings] = detectHeadings([page]);
    expect(headings).toEqual([
      { text: 'Section A. Program Description', level: 1 },
      { text: 'A subsection', level: 2 },
    ]);
  });
  it('finds no headings when all text is one size', () => {
    const page = linesFromItems([item('All the same size here, nothing stands out at all.', 72, 700)]);
    expect(detectHeadings([page])).toEqual([[]]);
  });
});

// The adapter itself needs pdfjs-dist. If the package is not installed these are
// reported as SKIPPED (visible in the run output), never silently passed.
const pdfjsAvailable = await import('pdfjs-dist/legacy/build/pdf.mjs' as string).then(
  () => true,
  () => false
);

describe.skipIf(!pdfjsAvailable)(`pdfjs adapter${pdfjsAvailable ? '' : ' (SKIPPED: pdfjs-dist is not installed)'}`, () => {
  const processor = createPdfProcessor();
  const input = (file: Buffer) => ({ documentId: 'sg-test', file, fileName: 'x.pdf', mimeType: 'application/pdf', detectedType: 'pdf' as const });

  it('extracts page-addressed text, preserving original wording and line breaks', async () => {
    const pdf = makePdf([
      [{ text: 'Section A. Program Description', size: 18 }, { text: 'Applicants must submit through Grants.gov before the deadline.' }, { text: 'The non-Federal cost share must be at least 20 percent.' }],
      [{ text: 'Section B. Federal Award Information', size: 18 }, { text: 'The maximum award is limited by the statute and this notice.' }],
    ]);
    const doc = await processor.process(input(pdf));
    expect(doc.kind).toBe('pdf');
    if (doc.kind !== 'pdf') return;
    expect(doc.processorId).toBe(PDF_PROCESSOR_ID);
    expect(doc.pageCount).toBe(2);
    expect(doc.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(doc.pages[0].text).toContain('Applicants must submit through Grants.gov before the deadline.');
    expect(doc.pages[0].text.split('\n')).toHaveLength(3);
    expect(doc.pages[1].text).toContain('maximum award');
    expect(doc.pages[0].headings[0]).toEqual({ text: 'Section A. Program Description', level: 1 });
  });

  it('returns blank pages with a warning for a scan-like PDF (no OCR)', async () => {
    const doc = await processor.process(input(makePdf([[], []])));
    if (doc.kind !== 'pdf') throw new Error('expected pdf');
    expect(doc.pages.every((p) => p.text === '')).toBe(true);
    expect(doc.warnings.join(' ')).toMatch(/No extractable text on page/);
  });

  it('reports a corrupt PDF as a ProcessingError, without internal details', async () => {
    const error = await processor.process(input(Buffer.from('%PDF-1.4\nthis is not really a pdf'))).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/could not be parsed/);
  });

  it('enforces the page limit', async () => {
    const small = createPdfProcessor({ maxPages: 1, maxChars: 1_000_000, timeoutMs: 30_000 });
    const error = await small.process(input(makePdf([[{ text: 'one' }], [{ text: 'two' }]]))).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/page limit/);
  });
});
