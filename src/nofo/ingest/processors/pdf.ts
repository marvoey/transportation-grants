import type { NormalizedDocument } from '../../schemas.js';
import {
  DEFAULT_LIMITS,
  ProcessingError,
  type DocumentProcessor,
  type ProcessingLimits,
  type ProcessInput,
} from './types.js';

export const PDF_PROCESSOR_ID = 'pdfjs-text';
export const PDF_PROCESSOR_VERSION = '1';

// ---------------------------------------------------------------------------
// Pure text assembly (no pdfjs): unit-testable on synthetic text items.
// ---------------------------------------------------------------------------

export interface PdfTextItem {
  str: string;
  /** PDF text matrix [a, b, c, d, e, f]: e = x, f = y. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface TextLine {
  text: string;
  y: number;
  height: number;
}

/**
 * Groups text items (in content-stream order, which for most documents is
 * reading order) into lines. A new line starts when the baseline moves by
 * more than half a line height, or after an item flagged end-of-line.
 */
export function linesFromItems(items: PdfTextItem[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: TextLine | null = null;
  let lastEnd = 0;

  for (const item of items) {
    const str = item.str ?? '';
    if (str === '' && !item.hasEOL) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height = item.height || Math.abs(item.transform?.[3] ?? 0) || 1;

    if (current && Math.abs(y - current.y) <= 0.5 * Math.max(height, current.height)) {
      const gap = x - lastEnd;
      const needsSpace = gap > 0.15 * height && !current.text.endsWith(' ') && !str.startsWith(' ');
      current.text += (needsSpace ? ' ' : '') + str;
      current.height = Math.max(current.height, height);
    } else {
      if (current) lines.push(current);
      current = { text: str, y, height };
    }
    lastEnd = x + (item.width || 0);
    if (item.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);

  return lines
    .map((line) => ({ ...line, text: line.text.replace(/[ \t]+/g, ' ').trim() }))
    .filter((line) => line.text.length > 0);
}

/**
 * Heading candidates by font size: lines noticeably larger than the document's
 * dominant (body) size. Returns, per page, heading texts with level 1-3 by
 * size rank. A heuristic: callers must treat headings as hints, never as
 * proof of structure.
 */
export function detectHeadings(pages: TextLine[][]): Array<Array<{ text: string; level: number }>> {
  const weightBySize = new Map<number, number>();
  for (const lines of pages) {
    for (const line of lines) {
      const size = Math.round(line.height * 10) / 10;
      weightBySize.set(size, (weightBySize.get(size) ?? 0) + line.text.length);
    }
  }
  let bodySize = 0;
  let bodyWeight = -1;
  for (const [size, weight] of weightBySize) {
    if (weight > bodyWeight) {
      bodySize = size;
      bodyWeight = weight;
    }
  }
  const threshold = bodySize * 1.2;
  const headingSizes = [...weightBySize.keys()].filter((s) => s >= threshold).sort((a, b) => b - a);

  return pages.map((lines) =>
    lines
      .filter((line) => {
        const size = Math.round(line.height * 10) / 10;
        return bodySize > 0 && size >= threshold && line.text.length >= 2 && line.text.length <= 150;
      })
      .map((line) => {
        const size = Math.round(line.height * 10) / 10;
        return { text: line.text, level: Math.min(3, headingSizes.indexOf(size) + 1) };
      })
  );
}

// ---------------------------------------------------------------------------
// pdfjs-dist adapter
// ---------------------------------------------------------------------------

// Minimal structural types so we do not depend on pdfjs's DOM-flavored typings.
interface PdfPage {
  getTextContent(): Promise<{ items: Array<Record<string, unknown>> }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(source: Record<string, unknown>): PdfLoadingTask;
}

// Loaded lazily and only by the offline ingestion path, so the web server
// never imports a PDF parser. A variable specifier keeps this a runtime
// import (and lets us report a clear error if the package is missing).
const PDFJS_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

async function loadPdfjs(): Promise<PdfjsModule> {
  try {
    return (await import(PDFJS_SPECIFIER)) as PdfjsModule;
  } catch {
    throw new ProcessingError('The PDF parser (pdfjs-dist) is not installed or failed to load.');
  }
}

export function createPdfProcessor(limits: ProcessingLimits = DEFAULT_LIMITS): DocumentProcessor {
  return {
    id: PDF_PROCESSOR_ID,
    version: PDF_PROCESSOR_VERSION,
    supports: (detectedType) => detectedType === 'pdf',

    async process(input: ProcessInput): Promise<NormalizedDocument> {
      const pdfjs = await loadPdfjs();
      const deadline = Date.now() + limits.timeoutMs;

      const task = pdfjs.getDocument({
        data: new Uint8Array(input.file), // a copy: pdfjs transfers (neuters) its input buffer
        // Hardened, text-only extraction: no eval, no scripting/XFA, no font loading.
        isEvalSupported: false,
        enableXfa: false,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: 0,
      });

      try {
        const doc = await raceDeadline(task.promise, deadline, 'Opening the PDF');
        if (doc.numPages > limits.maxPages) {
          throw new ProcessingError(`The PDF has ${doc.numPages} pages, over the ${limits.maxPages}-page limit.`);
        }

        const pageLines: TextLine[][] = [];
        let totalChars = 0;
        for (let n = 1; n <= doc.numPages; n++) {
          if (Date.now() > deadline) throw new ProcessingError('Parsing the PDF timed out.');
          const page = await raceDeadline(doc.getPage(n), deadline, 'Reading a PDF page');
          const content = await raceDeadline(page.getTextContent(), deadline, 'Extracting PDF text');
          const items = content.items.filter((i): i is Record<string, unknown> & PdfTextItem => typeof i.str === 'string');
          const lines = linesFromItems(items);
          page.cleanup();
          totalChars += lines.reduce((sum, l) => sum + l.text.length + 1, 0);
          if (totalChars > limits.maxChars) {
            throw new ProcessingError('The PDF contains more text than the size limit allows.');
          }
          pageLines.push(lines);
        }

        const headings = detectHeadings(pageLines);
        const blankPages = pageLines.map((l, i) => (l.length === 0 ? i + 1 : 0)).filter(Boolean);
        const warnings: string[] = [];
        if (blankPages.length > 0) {
          warnings.push(`No extractable text on page(s): ${blankPages.slice(0, 30).join(', ')}${blankPages.length > 30 ? ', …' : ''}`);
        }

        return {
          schemaVersion: 1,
          kind: 'pdf',
          documentId: input.documentId,
          processorId: PDF_PROCESSOR_ID,
          processorVersion: PDF_PROCESSOR_VERSION,
          warnings,
          pageCount: doc.numPages,
          pages: pageLines.map((lines, i) => ({
            page: i + 1,
            text: lines.map((l) => l.text).join('\n'),
            headings: headings[i],
          })),
        };
      } catch (error) {
        if (error instanceof ProcessingError) throw error;
        const name = (error as { name?: string } | null)?.name;
        if (name === 'PasswordException') throw new ProcessingError('The PDF is password protected.');
        throw new ProcessingError('The PDF could not be parsed (it may be corrupt or unsupported).');
      } finally {
        await task.destroy().catch(() => undefined);
      }
    },
  };
}

async function raceDeadline<T>(promise: Promise<T>, deadline: number, what: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ProcessingError(`${what} timed out.`);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProcessingError(`${what} timed out.`)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
