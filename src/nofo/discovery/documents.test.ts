import { describe, expect, it } from 'vitest';
import { WCPP_ID, fixtureSearchSource, profileLlm } from '../__fixtures__/discovery.js';
import type { Attachment } from '../schemas.js';
import { DocumentsCache, MAX_FILE_NAMES, MAX_FILE_NAME_CHARS, cannotPrepare, checkDocuments, cleanFileName, describeAttachments, documentsLast, type AttachmentListSource, type DocumentsInfo } from './documents.js';
import { discoverTurn } from './service.js';
import { GUIDED_QUESTION_IDS, type ProgressEvent } from './schemas.js';

const attachment = (fileName: unknown, n = 0): Attachment => ({
  attachmentId: `att-${n}`,
  fileName: fileName as string,
  description: null,
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  downloadPath: `https://files.example.test/${n}.pdf`,
  createdAt: null,
  updatedAt: null,
});

/** An attachment source that records every lookup. `answers` maps an ID to its list, or to an Error to fail with. */
function fakeAttachments(answers: Record<string, Attachment[] | Error>, fallback: Attachment[] | Error = []) {
  const calls: string[] = [];
  const source: AttachmentListSource & { calls: string[] } = {
    calls,
    async getAttachments(id) {
      calls.push(id);
      const answer = answers[id] ?? fallback;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return source;
}

describe('cleanFileName', () => {
  it('strips control and direction-override characters, collapses spaces and trims', () => {
    expect(cleanFileName('  NOFO‮\u0000\n final .pdf ')).toBe('NOFO final .pdf');
  });
  it('shortens a very long name', () => {
    const cleaned = cleanFileName('a'.repeat(500) + '.pdf');
    expect(cleaned.length).toBe(MAX_FILE_NAME_CHARS);
    expect(cleaned.endsWith('…')).toBe(true);
  });
  it('never returns an empty name', () => {
    expect(cleanFileName('')).toBe('(unnamed file)');
    expect(cleanFileName(undefined)).toBe('(unnamed file)');
    expect(cleanFileName(42)).toBe('(unnamed file)');
  });
});

describe('describeAttachments', () => {
  it('says "none" for an empty list and "listed" with a count otherwise', () => {
    expect(describeAttachments([])).toEqual({ status: 'none', count: 0, files: [] });
    expect(describeAttachments([attachment('a.pdf', 1), attachment('b.docx', 2)])).toEqual({ status: 'listed', count: 2, files: ['a.pdf', 'b.docx'], hasNotice: false });
  });
  it('says whether any listed file looks like the notice, by the same name rule extraction uses', () => {
    expect(describeAttachments([attachment('State_Electronic_Crash_Data_Collection_Notice_of_Intent_2023_.pdf', 1)]).hasNotice).toBe(false);
    expect(describeAttachments([attachment('Final_WCPP_NOFO_HAD-260512-001.pdf', 1)]).hasNotice).toBe(true);
    expect(describeAttachments([attachment('Notice of Funding Opportunity.pdf', 1)]).hasNotice).toBe(true);
    expect(describeAttachments([attachment('Amendment 1.pdf', 1)]).hasNotice).toBe(true);
    // A template or Q&A is guidance, not the notice, even though its name mentions the NOFO.
    expect(describeAttachments([attachment('NOFO_Questions_and_Answers.pdf', 1), attachment('Application_Template.docx', 2)]).hasNotice).toBe(false);
    // One notice among other files is enough.
    expect(describeAttachments([attachment('Budget_Template.docx', 1), attachment('FY_2027_CCFP_NOFO.pdf', 2)]).hasNotice).toBe(true);
    // No documents at all: there is nothing to say about a notice.
    expect(describeAttachments([]).hasNotice).toBeUndefined();
  });
  it('caps the file names but keeps the true count', () => {
    const many = Array.from({ length: MAX_FILE_NAMES + 4 }, (_, i) => attachment(`f${i}.pdf`, i));
    const info = describeAttachments(many);
    expect(info.count).toBe(MAX_FILE_NAMES + 4);
    expect(info.files).toHaveLength(MAX_FILE_NAMES);
  });
  it('never carries a download link, only names', () => {
    expect(JSON.stringify(describeAttachments([attachment('a.pdf', 1)]))).not.toMatch(/files\.example\.test/);
  });
});

describe('cannotPrepare and documentsLast', () => {
  const info = (over: Partial<DocumentsInfo>): DocumentsInfo => ({ status: 'listed', count: 1, files: ['x.pdf'], hasNotice: true, ...over });
  const item = (name: string, documents?: DocumentsInfo) => ({ name, documents });

  it('cannot prepare when none are listed, or when some are listed but none looks like the notice', () => {
    expect(cannotPrepare(info({ status: 'none', count: 0, files: [], hasNotice: undefined }))).toBe(true);
    expect(cannotPrepare(info({ hasNotice: false }))).toBe(true);
  });
  it('can prepare when a notice is listed, and assumes nothing when the check failed or was not run', () => {
    expect(cannotPrepare(info({ hasNotice: true }))).toBe(false);
    expect(cannotPrepare(info({ status: 'unknown', count: null, files: [], hasNotice: undefined }))).toBe(false);
    expect(cannotPrepare(undefined)).toBe(false);
  });
  it('moves listings that cannot be prepared to the end and keeps the order within each group', () => {
    const items = [
      item('A none', info({ status: 'none', count: 0, files: [], hasNotice: undefined })),
      item('B notice', info({})),
      item('C no notice', info({ hasNotice: false })),
      item('D unknown', info({ status: 'unknown', count: null, files: [], hasNotice: undefined })),
      item('E not checked'),
      item('F notice', info({})),
    ];
    expect(documentsLast(items).map((i) => i.name)).toEqual(['B notice', 'D unknown', 'E not checked', 'F notice', 'A none', 'C no notice']);
  });
});

describe('checkDocuments', () => {
  it('reports listed, none and unknown per listing; one failure does not affect the others', async () => {
    const source = fakeAttachments({ A: [attachment('nofo.pdf', 1)], B: [], C: new Error('boom: secret-token-123') });
    const { byId } = await checkDocuments(source, ['A', 'B', 'C']);
    expect(byId.get('A')).toMatchObject({ status: 'listed', count: 1 });
    expect(byId.get('B')).toMatchObject({ status: 'none', count: 0 });
    expect(byId.get('C')).toEqual({ status: 'unknown', count: null, files: [] });
    // The failure's message is dropped, never carried into the result.
    expect(JSON.stringify([...byId.values()])).not.toMatch(/secret-token/);
  });

  it('reuses a recent answer without another request, but never caches a failed check', async () => {
    const cache = new DocumentsCache();
    const source = fakeAttachments({ A: [attachment('x.pdf', 1)], B: new Error('down') });
    await checkDocuments(source, ['A', 'B'], cache);
    const again = await checkDocuments(source, ['A', 'B'], cache);
    expect(source.calls.filter((c) => c === 'A')).toHaveLength(1);
    expect(source.calls.filter((c) => c === 'B')).toHaveLength(2);
    expect(again.cached).toBe(1);
  });

  it('forgets a cached answer after its time is up', async () => {
    let now = 0;
    const cache = new DocumentsCache(1000, 10, () => now);
    const source = fakeAttachments({ A: [] });
    await checkDocuments(source, ['A'], cache);
    now = 1500;
    await checkDocuments(source, ['A'], cache);
    expect(source.calls).toEqual(['A', 'A']);
  });
});

describe('discoverTurn: the documents check', () => {
  const ASKED = [...GUIDED_QUESTION_IDS];
  const NOW = () => new Date('2026-11-05T12:00:00Z');
  const llm = () =>
    profileLlm({
      projectTypes: [{ type: 'wildlife_connectivity', quote: 'wildlife overpass' }],
      applicantType: { present: true, value: 'county', quote: 'Our county' },
      terms: ['wildlife crossing'],
    });
  const input = { asked: ASKED, messages: [{ role: 'user' as const, content: 'Our county wants a wildlife overpass on a rural highway.' }] };

  it('adds each shortlisted listing\'s documents, between scoring and the explanation', async () => {
    const events: ProgressEvent[] = [];
    const documents = fakeAttachments({ [WCPP_ID]: [attachment('NOFO.pdf', 1), attachment('Template.docx', 2)] }, []);
    const result = await discoverTurn(input, { source: fixtureSearchSource(), llm: llm(), now: NOW, documents, onProgress: (e) => events.push(e) });
    const first = result.shortlist.find((s) => s.opportunityId === WCPP_ID)!;
    expect(first.documents).toEqual({ status: 'listed', count: 2, files: ['NOFO.pdf', 'Template.docx'], hasNotice: true });
    const others = result.shortlist.filter((s) => s.opportunityId !== WCPP_ID);
    expect(others.length).toBeGreaterThan(0);
    for (const item of others) expect(item.documents).toMatchObject({ status: 'none', count: 0 });
    // Only the shortlist was checked, and each listing once.
    expect(documents.calls.sort()).toEqual(result.shortlist.map((s) => s.opportunityId).sort());
    const steps = events.map((e) => `${e.id}:${e.status}`);
    expect(steps.indexOf('rank:done')).toBeLessThan(steps.indexOf('documents:running'));
    expect(steps.indexOf('documents:running')).toBeLessThan(steps.indexOf('documents:done'));
    expect(steps.indexOf('documents:done')).toBeLessThan(steps.indexOf('explain:running'));
    expect(events.find((e) => e.id === 'documents' && e.status === 'done')!.message).toMatch(/1 of \d+ listings list a notice document; \d+ do not and go last\./);
  });

  it('marks a listing "unknown" and warns when its check fails, and the search still succeeds', async () => {
    const documents = fakeAttachments({}, new Error('network down'));
    const result = await discoverTurn(input, { source: fixtureSearchSource(), llm: llm(), now: NOW, documents });
    expect(result.stage).toBe('results');
    expect(result.shortlist.length).toBeGreaterThan(0);
    for (const item of result.shortlist) expect(item.documents).toEqual({ status: 'unknown', count: null, files: [] });
    expect(result.warnings.join(' ')).toMatch(/Could not check which documents are listed for \d+ opportunit/);
  });

  it('skips the check, with no step and no field, when no attachment source is given', async () => {
    const events: ProgressEvent[] = [];
    const result = await discoverTurn(input, { source: fixtureSearchSource(), llm: llm(), now: NOW, onProgress: (e) => events.push(e) });
    expect(events.some((e) => e.id === 'documents')).toBe(false);
    for (const item of result.shortlist) expect(item.documents).toBeUndefined();
  });

  it('reuses recent answers when the same listings are searched again', async () => {
    const documents = fakeAttachments({}, []);
    const documentsCache = new DocumentsCache();
    await discoverTurn(input, { source: fixtureSearchSource(), llm: llm(), now: NOW, documents, documentsCache });
    const firstRound = documents.calls.length;
    await discoverTurn(input, { source: fixtureSearchSource(), llm: llm(), now: NOW, documents, documentsCache });
    expect(documents.calls.length).toBe(firstRound);
  });
});
