import { describe, expect, it } from 'vitest';
import { MIN_QUOTE_KEY_LENGTH, verifySource } from './citations.js';
import { DOC_ID, LIMIT_QUOTE, PAGE_TEXTS, RURAL_QUOTE, URBAN_QUOTE, docsMap, htmlDoc, pdfDoc } from './__fixtures__/extraction.js';

const docs = docsMap(pdfDoc(DOC_ID, PAGE_TEXTS), htmlDoc('sg-faq', [
  { id: 's0', heading: null, text: 'Intro text that is long enough to be a quote on its own.' },
  { id: 's1', heading: 'Cost share', text: 'Recipients must provide a non-Federal match of at least twenty percent.' },
]));

function ok(result: ReturnType<typeof verifySource>) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}: ${result.detail}`);
  return result.source;
}
function rejected(result: ReturnType<typeof verifySource>) {
  if (result.ok) throw new Error('expected a rejection');
  return result;
}

describe('verifySource: PDF pages', () => {
  it('accepts a quote found on the cited page', () => {
    const source = ok(verifySource({ documentId: DOC_ID, page: 3, section: null, quote: URBAN_QUOTE }, docs));
    expect(source).toMatchObject({ page: 3, section: null, verified: true, locationCorrected: false, authority: 'controlling' });
  });

  it('matches despite hyphenation, line breaks, case and punctuation differences', () => {
    const quote = 'each applicant can submit up to THREE applications. unrelated components should not be combined in one application';
    expect(ok(verifySource({ documentId: DOC_ID, page: 4, section: null, quote }, docs)).locationCorrected).toBe(false);
  });

  it('rejects an invented document id', () => {
    const r = rejected(verifySource({ documentId: 'sg-does-not-exist', page: 3, section: null, quote: URBAN_QUOTE }, docs));
    expect(r.reason).toBe('unknown_document');
  });

  it('corrects a wrong page when the quote is really elsewhere in the document', () => {
    const source = ok(verifySource({ documentId: DOC_ID, page: 2, section: null, quote: LIMIT_QUOTE }, docs));
    expect(source.page).toBe(4);
    expect(source.locationCorrected).toBe(true);
    expect(source.note).toMatch(/cited page 2; found on page 4/);
  });

  it('corrects a missing page', () => {
    const source = ok(verifySource({ documentId: DOC_ID, page: null, section: null, quote: RURAL_QUOTE }, docs));
    expect(source).toMatchObject({ page: 3, locationCorrected: true });
  });

  it('rejects a page that does not exist when the quote is not found anywhere', () => {
    const r = rejected(verifySource({ documentId: DOC_ID, page: 99, section: null, quote: 'A sentence the document never says anywhere at all.' }, docs));
    expect(r.reason).toBe('location_out_of_range');
  });

  it('still finds a real quote cited on a page that does not exist', () => {
    const source = ok(verifySource({ documentId: DOC_ID, page: 99, section: null, quote: LIMIT_QUOTE }, docs));
    expect(source).toMatchObject({ page: 4, locationCorrected: true });
  });

  it('rejects a quote that is not in the document (an unsupported claim)', () => {
    const r = rejected(verifySource({ documentId: DOC_ID, page: 3, section: null, quote: 'Applicants must request at least ten million dollars in program funding.' }, docs));
    expect(r.reason).toBe('quote_not_found');
  });

  it('rejects quotes too short to be evidence', () => {
    expect(MIN_QUOTE_KEY_LENGTH).toBeGreaterThan(5);
    expect(rejected(verifySource({ documentId: DOC_ID, page: 3, section: null, quote: 'must request' }, docs)).reason).toBe('quote_too_short');
    expect(rejected(verifySource({ documentId: DOC_ID, page: 3, section: null, quote: '   ' }, docs)).reason).toBe('quote_too_short');
  });

  it('rejects an absurdly long quote', () => {
    expect(rejected(verifySource({ documentId: DOC_ID, page: 3, section: null, quote: 'word '.repeat(400) }, docs)).reason).toBe('quote_not_found');
  });

  it('accepts a passage that runs across a page break, noting it', () => {
    const split = docsMap(pdfDoc('d', ['Intro page.\nApplicants must submit the complete budget table and', 'the narrative together with the signed forms.\nMore text.']));
    const source = ok(verifySource({ documentId: 'd', page: 1, section: null, quote: 'Applicants must submit the complete budget table and the narrative together with the signed forms.' }, split));
    expect(source).toMatchObject({ page: 1, locationCorrected: false });
    expect(source.note).toMatch(/spans pages 1 and 2/);
  });
});

describe('verifySource: HTML / Word sections', () => {
  it('accepts a quote in the cited section (heading text counts)', () => {
    const source = ok(verifySource({ documentId: 'sg-faq', page: null, section: 's1', quote: 'Recipients must provide a non-Federal match of at least twenty percent.' }, docs));
    expect(source).toMatchObject({ page: null, section: 's1', locationCorrected: false, authority: 'official_guidance' });
  });

  it('corrects a wrong section and rejects an unknown one that has no quote match', () => {
    const corrected = ok(verifySource({ documentId: 'sg-faq', page: null, section: 's0', quote: 'Recipients must provide a non-Federal match of at least twenty percent.' }, docs));
    expect(corrected).toMatchObject({ section: 's1', locationCorrected: true });
    const missing = rejected(verifySource({ documentId: 'sg-faq', page: null, section: 's99', quote: 'This sentence is not anywhere in the document at all.' }, docs));
    expect(missing.reason).toBe('location_out_of_range');
  });
});
