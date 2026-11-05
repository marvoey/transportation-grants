import { describe, expect, it } from 'vitest';
import { DOCX_PROCESSOR_ID, createDocxProcessor } from './docx.js';
import { ProcessingError } from './types.js';
import { makeDocx, makeZip } from '../../__fixtures__/docx.js';

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const input = (file: Buffer, fileName = 'Template.docx', mimeType: string | null = WORD_MIME) => ({
  documentId: 'sg-docx',
  file,
  fileName,
  mimeType,
  detectedType: 'zip' as const,
});

describe('docx adapter', () => {
  const processor = createDocxProcessor();

  it('handles Word documents (a ZIP by content) and nothing else', () => {
    expect(processor.supports('zip', WORD_MIME, 'a.bin')).toBe(true);
    expect(processor.supports('zip', null, 'Template.DOCX')).toBe(true);
    expect(processor.supports('zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'book.xlsx')).toBe(false);
    expect(processor.supports('pdf', WORD_MIME, 'a.docx')).toBe(false);
    expect(processor.supports('html', null, 'a.docx')).toBe(false);
  });

  it('turns Word headings, paragraphs and tables into sections, like HTML', async () => {
    const docx = makeDocx([
      { kind: 'p', text: 'Introductory paragraph before any heading.' },
      { kind: 'p', style: 'Heading1', text: 'Project Description' },
      { kind: 'p', text: 'Describe the project in plain language.' },
      { kind: 'p', style: 'Heading2', text: 'Budget' },
      { kind: 'table', rows: [['Item', 'Amount'], ['Federal request', '$18 million']] },
    ]);
    const doc = await processor.process(input(docx));

    expect(doc.kind).toBe('html');
    if (doc.kind !== 'html') return;
    expect(doc.processorId).toBe(DOCX_PROCESSOR_ID);
    expect(doc.sourceUrl).toBeNull();
    expect(doc.sections.map((s) => [s.heading, s.level])).toEqual([
      [null, null],
      ['Project Description', 1],
      ['Budget', 2],
    ]);
    expect(doc.sections[0].text).toBe('Introductory paragraph before any heading.');
    expect(doc.sections[1].text).toBe('Describe the project in plain language.');
    expect(doc.sections[2].text).toContain('Federal request');
    expect(doc.sections[2].text).toContain('$18 million');
  });

  it('escapes markup characters in the Word text instead of treating them as HTML', async () => {
    const doc = await processor.process(input(makeDocx([{ kind: 'p', text: 'Use <script>alert(1)</script> & "quotes"' }])));
    if (doc.kind !== 'html') throw new Error('expected html');
    expect(doc.sections[0].text).toBe('Use <script>alert(1)</script> & "quotes"'); // plain text, never executed
  });

  it('rejects a ZIP that is not a Word document', async () => {
    const xlsxLike = makeZip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
    const error = await processor.process(input(xlsxLike, 'book.docx')).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/not a Word document/);
  });

  it('rejects a corrupt container without internal details', async () => {
    const error = await processor.process(input(Buffer.from('PK\x03\x04 this is not really a zip'))).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/not a valid Word document/);
  });

  it('refuses a decompression-bomb-shaped archive before converting anything', async () => {
    const bomb = makeDocx([{ kind: 'p', text: 'tiny' }], { declaredUncompressedSize: 2_000_000_000 });
    const error = await processor.process(input(bomb)).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/size limit|compression ratio/);
  });

  it('refuses an archive with an unreasonable number of entries', async () => {
    const files: Record<string, string> = { 'word/document.xml': '<w:document/>' };
    for (let i = 0; i < 5_100; i++) files[`junk/${i}.txt`] = 'x';
    const error = await processor.process(input(makeZip(files))).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
    expect(error.message).toMatch(/number of internal files/);
  });

  it('enforces the text limit', async () => {
    const small = createDocxProcessor({ maxPages: 10, maxChars: 30, timeoutMs: 10_000 });
    const error = await small.process(input(makeDocx([{ kind: 'p', text: 'x'.repeat(500) }]))).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
  });
});
