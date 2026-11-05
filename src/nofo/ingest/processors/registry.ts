import type { DetectedType } from '../../schemas.js';
import { createHtmlProcessor } from './html.js';
import { createPdfProcessor } from './pdf.js';
import type { DocumentProcessor } from './types.js';

/** The adapters this milestone supports. Everything else is registered, not parsed. */
export function defaultProcessors(): DocumentProcessor[] {
  return [createPdfProcessor(), createHtmlProcessor()];
}

/** First adapter that supports the detected type, or null (=> `unsupported_format`). */
export function pickProcessor(
  processors: DocumentProcessor[],
  detectedType: DetectedType,
  mimeType: string | null,
  fileName: string
): DocumentProcessor | null {
  return processors.find((p) => p.supports(detectedType, mimeType, fileName)) ?? null;
}
