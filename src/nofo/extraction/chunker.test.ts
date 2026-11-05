import { describe, expect, it } from 'vitest';
import { makeBatches, splitBatch } from './chunker.js';
import { htmlDoc, pdfDoc } from '../__fixtures__/extraction.js';

const chunkable = (d: ReturnType<typeof pdfDoc>) => ({ documentId: d.documentId, title: 'Test NOFO', authority: d.authority, normalized: d.normalized });
const pages = (n: number, text = 'x'.repeat(100)) => Array.from({ length: n }, (_, i) => `${text} page ${i + 1}`);

describe('makeBatches', () => {
  it('groups pages into bounded batches with the requested overlap, in order', () => {
    const batches = makeBatches(chunkable(pdfDoc('d', pages(7))), { maxUnitsPerBatch: 3, maxCharsPerBatch: 100_000, overlapUnits: 1 });
    const layout = batches.map((b) => b.units.map((u) => u.page));
    expect(layout).toEqual([[1, 2, 3], [3, 4, 5], [5, 6, 7]]);
    expect(batches.map((b) => b.overlapUnits)).toEqual([0, 1, 1]);
    expect(batches[0].id).toBe('d:p1-p3');
    for (const b of batches) expect(b.units.length).toBeLessThanOrEqual(3);
  });

  it('covers every page at least once', () => {
    const batches = makeBatches(chunkable(pdfDoc('d', pages(20))), { maxUnitsPerBatch: 4, maxCharsPerBatch: 100_000, overlapUnits: 1 });
    const covered = new Set(batches.flatMap((b) => b.units.map((u) => u.page)));
    expect([...covered].sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('respects the character budget', () => {
    const batches = makeBatches(chunkable(pdfDoc('d', pages(6, 'y'.repeat(900)))), { maxUnitsPerBatch: 50, maxCharsPerBatch: 2_000, overlapUnits: 0 });
    expect(batches.length).toBeGreaterThan(2);
    for (const b of batches) expect(b.units.reduce((n, u) => n + u.text.length, 0)).toBeLessThanOrEqual(2_000 + 1_000);
  });

  it('supports no overlap', () => {
    const batches = makeBatches(chunkable(pdfDoc('d', pages(4))), { maxUnitsPerBatch: 2, maxCharsPerBatch: 100_000, overlapUnits: 0 });
    expect(batches.map((b) => b.units.map((u) => u.page))).toEqual([[1, 2], [3, 4]]);
  });

  it('skips empty pages and returns no batches for an empty document', () => {
    const batches = makeBatches(chunkable(pdfDoc('d', ['', 'real text here that matters', '   '])));
    expect(batches).toHaveLength(1);
    expect(batches[0].units.map((u) => u.page)).toEqual([2]);
    expect(makeBatches(chunkable(pdfDoc('d', ['', ''])))).toEqual([]);
  });

  it('splits an oversize page on line boundaries, keeping its page number', () => {
    const big = Array.from({ length: 40 }, (_, i) => `line ${i} ${'z'.repeat(80)}`).join('\n');
    const batches = makeBatches(chunkable(pdfDoc('d', [big])), { maxUnitsPerBatch: 50, maxCharsPerBatch: 1_000, overlapUnits: 0 });
    const units = batches.flatMap((b) => b.units);
    expect(units.length).toBeGreaterThan(2);
    expect(units.every((u) => u.page === 1)).toBe(true);
    expect(units.map((u) => u.label)[0]).toBe('p1.1');
    expect(units.map((u) => u.text).join('\n')).toBe(big);
  });

  it('batches HTML/Word sections by section id, with the heading included in the text', () => {
    const doc = htmlDoc('h', [
      { id: 's0', heading: null, text: 'Intro paragraph.' },
      { id: 's1', heading: 'Eligibility', text: 'Only states may apply.' },
    ]);
    const [batch] = makeBatches({ documentId: 'h', title: 'FAQ', authority: 'official_guidance', normalized: doc.normalized });
    expect(batch.units.map((u) => [u.page, u.sectionId])).toEqual([[null, 's0'], [null, 's1']]);
    expect(batch.units[1].text).toBe('Eligibility\nOnly states may apply.');
  });
});

describe('splitBatch', () => {
  const [batch] = makeBatches(chunkable(pdfDoc('d', pages(5))), { maxUnitsPerBatch: 5, maxCharsPerBatch: 100_000, overlapUnits: 1 });

  it('splits in two, repeating the boundary unit as context in the second half', () => {
    const [a, b] = splitBatch(batch)!;
    expect(a.units.map((u) => u.page)).toEqual([1, 2, 3]);
    expect(b.units.map((u) => u.page)).toEqual([3, 4, 5]);
    expect(b.overlapUnits).toBe(1);
    expect(a.id).toBe(`${batch.id}/a`);
    expect(b.id).toBe(`${batch.id}/b`);
  });

  it('cannot split a single unit', () => {
    const [single] = makeBatches(chunkable(pdfDoc('d', pages(1))));
    expect(splitBatch(single)).toBeNull();
  });

  it('every page of the original is in one of the halves', () => {
    const [a, b] = splitBatch(batch)!;
    const covered = new Set([...a.units, ...b.units].map((u) => u.page));
    expect([...covered].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
