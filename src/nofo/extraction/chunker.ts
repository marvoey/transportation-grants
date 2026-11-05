import type { Authority, NormalizedDocument } from '../schemas.js';

/** One citable unit of a document: a PDF page, or a section of an HTML/Word document. */
export interface BatchUnit {
  page: number | null;
  sectionId: string | null;
  /** Human-readable label used in batch IDs, e.g. "p6" or "s2". */
  label: string;
  text: string;
}

export interface Batch {
  id: string;
  documentId: string;
  title: string;
  authority: Authority;
  units: BatchUnit[];
  /** How many leading units repeat the end of the previous batch (context only). */
  overlapUnits: number;
}

export interface BatchLimits {
  maxUnitsPerBatch: number;
  maxCharsPerBatch: number;
  /** Units repeated from the previous batch so a requirement spanning a boundary is seen whole. */
  overlapUnits: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxUnitsPerBatch: 6, maxCharsPerBatch: 16_000, overlapUnits: 1 };

export interface ChunkableDocument {
  documentId: string;
  title: string;
  authority: Authority;
  normalized: NormalizedDocument;
}

function unitsOf(doc: NormalizedDocument): BatchUnit[] {
  if (doc.kind === 'pdf') {
    return doc.pages
      .filter((p) => p.text.trim() !== '')
      .map((p) => ({ page: p.page, sectionId: null, label: `p${p.page}`, text: p.text }));
  }
  return doc.sections
    .map((s) => ({ page: null, sectionId: s.id, label: s.id, text: s.heading ? `${s.heading}\n${s.text}` : s.text }))
    .filter((u) => u.text.trim() !== '');
}

/** A unit larger than a whole batch is split on line boundaries; the parts keep the same page/section. */
function splitOversize(unit: BatchUnit, maxChars: number): BatchUnit[] {
  if (unit.text.length <= maxChars) return [unit];
  const parts: BatchUnit[] = [];
  let current = '';
  for (const line of unit.text.split('\n')) {
    if (current.length + line.length + 1 > maxChars && current !== '') {
      parts.push({ ...unit, text: current });
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) parts.push({ ...unit, text: current });
  return parts.map((p, i) => ({ ...p, label: `${unit.label}.${i + 1}` }));
}

/** Bounded, overlapping batches over one document, in reading order. */
export function makeBatches(doc: ChunkableDocument, limits: BatchLimits = DEFAULT_BATCH_LIMITS): Batch[] {
  const units = unitsOf(doc.normalized).flatMap((u) => splitOversize(u, limits.maxCharsPerBatch));
  const batches: Batch[] = [];
  let current: BatchUnit[] = [];
  let currentOverlap = 0;
  let chars = 0;

  const flush = (): void => {
    if (current.length === currentOverlap) return; // nothing new in this batch
    batches.push({
      id: `${doc.documentId}:${current[0].label}-${current[current.length - 1].label}`,
      documentId: doc.documentId,
      title: doc.title,
      authority: doc.authority,
      units: current,
      overlapUnits: currentOverlap,
    });
  };

  for (const unit of units) {
    const wouldOverflow =
      current.length > currentOverlap && (current.length >= limits.maxUnitsPerBatch || chars + unit.text.length > limits.maxCharsPerBatch);
    if (wouldOverflow) {
      flush();
      const carried = current.slice(-limits.overlapUnits).filter(() => limits.overlapUnits > 0);
      current = carried;
      currentOverlap = carried.length;
      chars = carried.reduce((sum, u) => sum + u.text.length, 0);
    }
    current.push(unit);
    chars += unit.text.length;
  }
  flush();
  return batches;
}

/**
 * Splits a batch in two when the model's output was cut off. The second half
 * repeats the last unit of the first half as context. Returns null when the
 * batch is already a single unit and cannot be split further.
 */
export function splitBatch(batch: Batch): [Batch, Batch] | null {
  if (batch.units.length < 2) return null;
  const mid = Math.ceil(batch.units.length / 2);
  const first = batch.units.slice(0, mid);
  const second = batch.units.slice(mid - 1);
  return [
    { ...batch, id: `${batch.id}/a`, units: first },
    { ...batch, id: `${batch.id}/b`, units: second, overlapUnits: 1 },
  ];
}
