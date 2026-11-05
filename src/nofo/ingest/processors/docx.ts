import { Open } from 'unzipper';
import type { NormalizedDocument } from '../../schemas.js';
import { htmlToSections } from './html.js';
import {
  DEFAULT_LIMITS,
  ProcessingError,
  type DocumentProcessor,
  type ProcessingLimits,
  type ProcessInput,
} from './types.js';

export const DOCX_PROCESSOR_ID = 'mammoth-docx';
export const DOCX_PROCESSOR_VERSION = '1';

// A .docx is a ZIP. Inspect its table of contents BEFORE converting, and
// refuse archives that look like decompression bombs. These use the sizes the
// archive declares, so they are a screen, not a guarantee (see the plan's
// limitations); images are never decompressed at all (see convertImage below).
const MAX_ENTRIES = 5_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 300;

// Loaded lazily and only by the offline ingestion path, like the other adapters.
const MAMMOTH_SPECIFIER = 'mammoth';

interface MammothApi {
  convertToHtml(
    input: { buffer: Buffer },
    options?: { convertImage?: unknown }
  ): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
  images: { imgElement(convert: (image: unknown) => Promise<{ src: string }>): unknown };
}

async function loadMammoth(): Promise<MammothApi> {
  try {
    const mod = (await import(MAMMOTH_SPECIFIER)) as { default?: MammothApi } & Partial<MammothApi>;
    return (mod.default ?? mod) as MammothApi;
  } catch {
    throw new ProcessingError('The Word converter (mammoth) is not installed or failed to load.');
  }
}

/** Reject non-Word archives and decompression-bomb-shaped archives without extracting anything. */
async function assertSafeDocx(file: Buffer): Promise<void> {
  let directory;
  try {
    directory = await Open.buffer(file);
  } catch {
    throw new ProcessingError('The file is not a valid Word document (it is not a readable ZIP container).');
  }
  const entries = directory.files;
  if (entries.length > MAX_ENTRIES) {
    throw new ProcessingError('The Word document has an unreasonable number of internal files.');
  }
  const uncompressed = entries.reduce((sum, e) => sum + (e.uncompressedSize ?? 0), 0);
  const compressed = entries.reduce((sum, e) => sum + (e.compressedSize ?? 0), 0);
  if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
    throw new ProcessingError('The Word document expands to more than the size limit allows.');
  }
  if (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
    throw new ProcessingError('The Word document has a suspicious compression ratio.');
  }
  if (!entries.some((e) => e.path === 'word/document.xml')) {
    throw new ProcessingError('The file is a ZIP archive but not a Word document (no word/document.xml).');
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProcessingError('Converting the Word document timed out.')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Word (.docx) adapter: converts to HTML with mammoth, then reuses the HTML
 * section extraction, so Word headings become sections the same way HTML
 * headings do. The HTML is only parsed for text, never rendered or served.
 * Embedded images are dropped without being read.
 */
export function createDocxProcessor(limits: ProcessingLimits = DEFAULT_LIMITS): DocumentProcessor {
  return {
    id: DOCX_PROCESSOR_ID,
    version: DOCX_PROCESSOR_VERSION,
    // File type comes from content (a ZIP); the MIME type / name only say it is Word rather than Excel etc.
    // process() then confirms word/document.xml exists, so a mislabeled file fails cleanly.
    supports: (detectedType, mimeType, fileName) =>
      detectedType === 'zip' &&
      (/wordprocessingml\.document/i.test(mimeType ?? '') || /\.docx$/i.test(fileName)),

    async process(input: ProcessInput): Promise<NormalizedDocument> {
      const mammoth = await loadMammoth();
      await assertSafeDocx(input.file);

      let converted;
      try {
        converted = await withDeadline(
          mammoth.convertToHtml(
            { buffer: input.file },
            // Never read image bytes: images are irrelevant to requirements text and are the main inflation risk.
            { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) }
          ),
          limits.timeoutMs
        );
      } catch (error) {
        if (error instanceof ProcessingError) throw error;
        throw new ProcessingError('The Word document could not be converted (it may be corrupt or unsupported).');
      }

      const parsed = await htmlToSections(converted.value, undefined, limits);
      const warnings = [...new Set(converted.messages.map((m) => `${m.type}: ${m.message}`.slice(0, 200)))].slice(0, 10);

      return {
        schemaVersion: 1,
        kind: 'html',
        documentId: input.documentId,
        processorId: DOCX_PROCESSOR_ID,
        processorVersion: DOCX_PROCESSOR_VERSION,
        warnings,
        title: parsed.title,
        sourceUrl: null,
        sections: parsed.sections,
        links: parsed.links,
      };
    },
  };
}
