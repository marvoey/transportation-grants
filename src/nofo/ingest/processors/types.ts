import type { DetectedType, NormalizedDocument } from '../../schemas.js';

export interface ProcessInput {
  documentId: string;
  file: Buffer;
  /** Display name only. */
  fileName: string;
  mimeType: string | null;
  detectedType: DetectedType;
  /** Original source URL (query stripped); used to resolve relative links. */
  sourceUrl?: string;
}

/**
 * Format adapter contract. Adapters turn bytes into page/section-addressed
 * text and nothing else: no OCR, no spreadsheet math, no GIS. A new format is
 * a new adapter, not a new platform.
 */
export interface DocumentProcessor {
  id: string;
  /** Bump when extraction output changes; cached documents are re-parsed from the stored original. */
  version: string;
  /** `detectedType` comes from the file's bytes; MIME type and name are only hints. */
  supports(detectedType: DetectedType, mimeType: string | null, fileName: string): boolean;
  process(input: ProcessInput): Promise<NormalizedDocument>;
}

/** A parse failure with a message safe to store in the manifest. */
export class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessingError';
  }
}

/** Bounds applied to every parse so a hostile or enormous file cannot exhaust memory or time. */
export interface ProcessingLimits {
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ProcessingLimits = {
  maxPages: 600,
  maxChars: 5_000_000,
  timeoutMs: 90_000,
};
