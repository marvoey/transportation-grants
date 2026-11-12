import { afterEach, describe, expect, it } from 'vitest';
import { RULEBOOK, reqFile } from '../__fixtures__/assessment.js';
import { DOC_ID, GUIDANCE_ID, PAGE_TEXTS, htmlDoc, pdfDoc, writePackage } from '../__fixtures__/extraction.js';
import { OPP_A, OPP_B, tmpStore } from '../__fixtures__/helpers.js';
import type { PackageStore } from '../store.js';
import { countWords, describeDownloaded, downloadedTotals, formatOf, roleOf } from './downloaded.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
async function store(): Promise<PackageStore> {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  return t.store;
}

const PARSED = (pages?: number) => ({ status: 'parsed' as const, processorId: 'test', processorVersion: '1', ...(pages === undefined ? {} : { pages }) });

describe('formatOf and roleOf', () => {
  it('labels a Word file by its name, because it is detected as a zip container', () => {
    expect(formatOf({ fileName: 'Budget_Template.docx', detectedType: 'zip' })).toBe('Word');
    expect(formatOf({ fileName: 'Notice.pdf', detectedType: 'pdf' })).toBe('PDF');
    expect(formatOf({ fileName: 'page.html', detectedType: 'html' })).toBe('Web page');
    expect(formatOf({ fileName: 'data.bin', detectedType: 'unknown' })).toBe('Other');
  });
  it('calls a controlling document the notice, guidance guidance, and anything else other', () => {
    expect(roleOf('controlling')).toBe('notice');
    expect(roleOf('official_guidance')).toBe('guidance');
    expect(roleOf('unclassified')).toBe('other');
  });
  it('counts words by whitespace', () => {
    expect(countWords('one two\nthree\t four')).toBe(4);
    expect(countWords('   ')).toBe(0);
  });
});

describe('describeDownloaded', () => {
  it('lists each document with its type, role, pages and words, notice first, and totals the pages and words', async () => {
    const s = await store();
    await writePackage(s, [
      { doc: pdfDoc(GUIDANCE_ID, ['faq one two three'], 'official_guidance'), manifest: { title: 'Questions and answers', fileName: 'faq.pdf', processing: PARSED(1), retrievedAt: '2026-11-10T08:00:00Z' } },
      { doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { title: 'The NOFO', fileName: 'nofo.pdf', processing: PARSED(PAGE_TEXTS.length), retrievedAt: '2026-11-11T09:30:00Z' } },
    ]);
    const d = (await describeDownloaded(s, OPP_A))!;
    expect(d.documents.map((x) => [x.title, x.format, x.role, x.pages])).toEqual([
      ['The NOFO', 'PDF', 'notice', PAGE_TEXTS.length],
      ['Questions and answers', 'PDF', 'guidance', 1],
    ]);
    expect(d.totalPages).toBe(PAGE_TEXTS.length + 1);
    expect(d.totalWords).toBe(PAGE_TEXTS.reduce((n, t) => n + countWords(t), 0) + 4);
    expect(d.downloadedOn).toBe('2026-11-11');
    expect(d.requirements).toBeNull();
  });

  it('shows a Word document with words and no pages, and leaves it out of the page total', async () => {
    const s = await store();
    await writePackage(s, [
      { doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { processing: PARSED(PAGE_TEXTS.length) } },
      { doc: htmlDoc(GUIDANCE_ID, [{ id: 's1', heading: 'Template', text: 'fill in this template please' }]), manifest: { title: 'Application template', fileName: 'template.docx', detectedType: 'zip', processing: { status: 'parsed', processorId: 'test', processorVersion: '1', sections: 1 } } },
    ]);
    const d = (await describeDownloaded(s, OPP_A))!;
    const word = d.documents.find((x) => x.format === 'Word')!;
    expect(word).toMatchObject({ pages: null, words: 4, role: 'guidance', parsed: true });
    expect(d.totalPages).toBe(PAGE_TEXTS.length);
  });

  it('counts a file that was already on disk ("cached") and skips one removed upstream', async () => {
    const s = await store();
    await writePackage(s, [
      { doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { retrieval: { status: 'cached' }, processing: PARSED(PAGE_TEXTS.length) } },
      { doc: pdfDoc(GUIDANCE_ID, ['gone'], 'official_guidance'), manifest: { retrieval: { status: 'removed_upstream' } } },
    ]);
    const d = (await describeDownloaded(s, OPP_A))!;
    expect(d.documents).toHaveLength(1);
  });

  it('says a file could not be read instead of counting it', async () => {
    const s = await store();
    await writePackage(s, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { processing: { status: 'parse_failed', error: 'bad file' } } }]);
    const d = (await describeDownloaded(s, OPP_A))!;
    expect(d.documents[0]).toMatchObject({ parsed: false, pages: null, words: null });
    expect(d.totalPages).toBe(0);
    expect(d.totalWords).toBe(0);
  });

  it('counts the extracted requirements by category, with the forms to prepare and the ones checked by code', async () => {
    const s = await store();
    await writePackage(s, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { processing: PARSED(PAGE_TEXTS.length) } }]);
    await s.writeRequirements(OPP_A, reqFile(RULEBOOK));
    const r = (await describeDownloaded(s, OPP_A))!.requirements!;
    expect(r.total).toBe(RULEBOOK.length);
    expect(r.byCategory.reduce((n, c) => n + c.count, 0)).toBe(RULEBOOK.length);
    expect(r.toPrepare).toBe(RULEBOOK.filter((x) => x.check?.kind === 'document_required').length);
    expect(r.checkedByCode).toBe(RULEBOOK.filter((x) => x.check).length);
    expect(r.mandatory).toBe(RULEBOOK.filter((x) => x.mandatory).length);
    expect(r.verified).toBe(0);
  });

  it('returns nothing for an opportunity that has no package here', async () => {
    const s = await store();
    expect(await describeDownloaded(s, OPP_B)).toBeNull();
  });

  it('returns nothing, rather than failing, when the package is damaged', async () => {
    const s = await store();
    await writePackage(s, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS) }]);
    await s.writeNormalized(OPP_A, DOC_ID, { not: 'a document' } as never).catch(() => undefined);
    await expect(describeDownloaded(s, OPP_A)).resolves.not.toThrow();
  });
});

describe('downloadedTotals', () => {
  it('adds up the listings that have documents and ignores the rest', async () => {
    const s = await store();
    await writePackage(s, [{ doc: pdfDoc(DOC_ID, PAGE_TEXTS), manifest: { processing: PARSED(PAGE_TEXTS.length) } }]);
    await s.writeRequirements(OPP_A, reqFile(RULEBOOK));
    const d = (await describeDownloaded(s, OPP_A))!;
    const totals = downloadedTotals([{ downloaded: d }, {}, { downloaded: d }])!;
    expect(totals).toEqual({ listings: 2, documents: 2, pages: PAGE_TEXTS.length * 2, words: d.totalWords * 2, requirements: RULEBOOK.length * 2, toPrepare: d.requirements!.toPrepare * 2 });
    expect(downloadedTotals([{}, {}])).toBeNull();
  });
});
