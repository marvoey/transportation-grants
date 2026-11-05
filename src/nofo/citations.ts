import { matchKey, textContainsQuote } from './ingest/normalize.js';
import type { Authority, NormalizedDocument } from './schemas.js';
import type { RequirementSource } from './extraction/schemas.js';

/**
 * Citation verification: the central quality gate. A source claimed by the
 * model survives only if code can find its quote in the stored text of a
 * document that really is in the package. This never asks a model.
 */

export interface VerifiableDocument {
  documentId: string;
  authority: Authority;
  normalized: NormalizedDocument;
}

export const MIN_QUOTE_KEY_LENGTH = 20;
const MAX_QUOTE_CHARS = 1500;

export interface SourceClaim {
  documentId: string;
  page: number | null;
  section: string | null;
  quote: string;
}

export type SourceRejection = 'unknown_document' | 'location_out_of_range' | 'quote_too_short' | 'quote_not_found';

export type VerifyResult =
  | { ok: true; source: RequirementSource }
  | { ok: false; reason: SourceRejection; detail: string };

function accepted(
  claim: SourceClaim,
  doc: VerifiableDocument,
  location: { page: number | null; section: string | null },
  corrected: boolean,
  note?: string
): VerifyResult {
  return {
    ok: true,
    source: {
      documentId: claim.documentId,
      page: location.page,
      section: location.section,
      quote: claim.quote,
      authority: doc.authority,
      verified: true,
      locationCorrected: corrected,
      ...(note ? { note } : {}),
    },
  };
}

export function verifySource(claim: SourceClaim, documents: Map<string, VerifiableDocument>): VerifyResult {
  const doc = documents.get(claim.documentId);
  if (!doc) {
    return { ok: false, reason: 'unknown_document', detail: 'The cited document is not one of the documents provided.' };
  }
  const quote = claim.quote.trim();
  if (matchKey(quote).length < MIN_QUOTE_KEY_LENGTH) {
    return { ok: false, reason: 'quote_too_short', detail: 'The quote is too short to be evidence.' };
  }
  if (quote.length > MAX_QUOTE_CHARS) {
    return { ok: false, reason: 'quote_not_found', detail: 'The quote is longer than a passage can reasonably be.' };
  }
  const claimTrimmed = { ...claim, quote };

  if (doc.normalized.kind === 'pdf') {
    const pages = doc.normalized.pages;
    const claimed = claim.page;
    const inRange = claimed !== null && claimed >= 1 && claimed <= pages.length;

    // 1. On the cited page.
    if (inRange && textContainsQuote(pages[claimed - 1].text, quote)) {
      return accepted(claimTrimmed, doc, { page: claimed, section: null }, false);
    }

    // 2. Wholly on some other single page: the model cited the wrong page (or none). Correct it and say so.
    for (const page of pages) {
      if (textContainsQuote(page.text, quote)) {
        return accepted(
          claimTrimmed,
          doc,
          { page: page.page, section: null },
          true,
          `model cited ${claimed === null ? 'no page' : `page ${claimed}`}; found on page ${page.page}`
        );
      }
    }

    // 3. On no single page: it may run across a page break. Only now is a two-page match meaningful, because
    //    a quote that sits wholly on one page would also match the concatenation of that page and its neighbour.
    for (let i = 0; i + 1 < pages.length; i++) {
      if (textContainsQuote(`${pages[i].text}\n${pages[i + 1].text}`, quote)) {
        const touchesClaimed = claimed === pages[i].page || claimed === pages[i + 1].page;
        return accepted(
          claimTrimmed,
          doc,
          { page: pages[i].page, section: null },
          !touchesClaimed,
          `quote spans pages ${pages[i].page} and ${pages[i + 1].page}`
        );
      }
    }
    return claimed !== null && !inRange
      ? { ok: false, reason: 'location_out_of_range', detail: `The cited page ${claimed} does not exist (document has ${pages.length} pages) and the quote was not found.` }
      : { ok: false, reason: 'quote_not_found', detail: 'The quote does not appear in the cited document.' };
  }

  // HTML / Word: sections.
  const sections = doc.normalized.sections;
  const sectionText = (s: { heading: string | null; text: string }): string => `${s.heading ?? ''}\n${s.text}`;
  const claimedSection = claim.section ? sections.find((s) => s.id === claim.section) : undefined;
  if (claimedSection && textContainsQuote(sectionText(claimedSection), quote)) {
    return accepted(claimTrimmed, doc, { page: null, section: claimedSection.id }, false);
  }
  for (const section of sections) {
    if (textContainsQuote(sectionText(section), quote)) {
      return accepted(
        claimTrimmed,
        doc,
        { page: null, section: section.id },
        true,
        `model cited ${claim.section ? `section ${claim.section}` : 'no section'}; found in section ${section.id}`
      );
    }
  }
  return claim.section && !claimedSection
    ? { ok: false, reason: 'location_out_of_range', detail: `The cited section "${claim.section}" does not exist and the quote was not found.` }
    : { ok: false, reason: 'quote_not_found', detail: 'The quote does not appear in the cited document.' };
}
