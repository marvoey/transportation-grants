/**
 * Text normalization shared by ingestion and (in Milestone 3) citation
 * verification, so both sides of a quote comparison use identical rules.
 * Stored page text keeps its original wording; these functions are only used
 * to MATCH text.
 */

/** Readable normalized form: NFKC, straight quotes/dashes, joined hyphenated line breaks, single spaces, lower case. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/­/g, '') // soft hyphen
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/-[ \t]*\r?\n[ \t]*/g, '') // "exam-\nple" -> "example"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Loose matching key: letters and digits only. Makes a quote robust against
 * differences in hyphenation, spacing and punctuation introduced by PDF
 * text extraction.
 */
export function matchKey(text: string): string {
  return normalizeForMatch(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Does `haystack` contain `needle` after loose normalization? Empty needles never match. */
export function textContainsQuote(haystack: string, needle: string): boolean {
  const key = matchKey(needle);
  return key.length > 0 && matchKey(haystack).includes(key);
}
