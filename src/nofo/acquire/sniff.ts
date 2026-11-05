import type { DetectedType } from '../schemas.js';

/**
 * Content-based type detection from the first bytes. The declared MIME type
 * and file extension are metadata from the source and are never trusted to
 * pick a parser.
 */
export function detectType(buf: Buffer): DetectedType {
  if (buf.length === 0) return 'unknown';

  // PDF header may be preceded by a little junk (the spec allows 1024 bytes).
  if (buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';

  // ZIP container (docx/xlsx/pptx/zip/...): PK\x03\x04 or empty-archive PK\x05\x06.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05) && (buf[3] === 0x04 || buf[3] === 0x06)) {
    return 'zip';
  }

  // OLE2 compound file (legacy .doc/.xls/.ppt).
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return 'ole';
  }

  const head = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || /<html[\s>]/.test(head)) return 'html';
  if (head.startsWith('<') && /<(head|body|title)[\s>]/.test(head)) return 'html';

  // Plain text: no NUL bytes in the first 4 KB.
  if (!buf.subarray(0, 4096).includes(0)) return 'text';
  return 'unknown';
}

const ZIP_FAMILY_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'zip']);
const OLE_EXTENSIONS = new Set(['doc', 'xls', 'ppt']);

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

/** Server-generated storage extension from the detected type (never from the raw file name). */
export function storageExtension(detected: DetectedType, fileName: string): string {
  const ext = extensionOf(fileName);
  switch (detected) {
    case 'pdf':
      return 'pdf';
    case 'html':
      return 'html';
    case 'zip':
      return ZIP_FAMILY_EXTENSIONS.has(ext) ? ext : 'zip';
    case 'ole':
      return OLE_EXTENSIONS.has(ext) ? ext : 'ole';
    case 'text':
      return 'txt';
    default:
      return 'bin';
  }
}

/** What content type the declared MIME type / extension implies, if it implies one. */
export function expectedType(mimeType: string | null, fileName: string): DetectedType | null {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = extensionOf(fileName);
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || ext === 'html' || ext === 'htm') return 'html';
  if (
    mime.startsWith('application/vnd.openxmlformats-officedocument') ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    ZIP_FAMILY_EXTENSIONS.has(ext)
  ) {
    return 'zip';
  }
  if (mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint' || OLE_EXTENSIONS.has(ext)) {
    return 'ole';
  }
  return null;
}

/** Human-readable reason a detected type is registered but not parsed. */
export function describeUnsupported(detected: DetectedType, mimeType: string | null, fileName: string): string {
  const ext = extensionOf(fileName);
  switch (detected) {
    case 'zip':
      if (ext === 'docx') return 'Word document (.docx): registered, not parsed in this milestone.';
      if (ext === 'xlsx') return 'Excel workbook (.xlsx): registered, not parsed in this milestone.';
      if (ext === 'pptx') return 'PowerPoint (.pptx): registered, not parsed in this milestone.';
      return 'ZIP archive: registered, never extracted.';
    case 'ole':
      return 'Legacy Office document: registered, not parsed in this milestone.';
    case 'text':
      return 'Plain text: registered, not parsed in this milestone.';
    default:
      return `Unrecognized content${mimeType ? ` (declared ${mimeType})` : ''}: registered, not parsed.`;
  }
}
