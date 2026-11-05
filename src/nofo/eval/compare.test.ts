import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { GoldSchema, compareToGold, validateGold, type Gold } from './compare.js';
import { finalizeRequirements, type Draft } from '../extraction/merge.js';
import type { RequirementsFile } from '../extraction/schemas.js';
import { DOC_ID, LIMIT_QUOTE, PAGE_TEXTS, RURAL_QUOTE, URBAN_QUOTE, docsMap, pdfDoc } from '../__fixtures__/extraction.js';
import { OPP_A } from '../__fixtures__/helpers.js';

const docs = docsMap(pdfDoc(DOC_ID, PAGE_TEXTS));

const gold: Gold = {
  schemaVersion: 1,
  opportunityId: OPP_A,
  verification: { status: 'drafted_for_test', verifiedBy: null, verifiedOn: null },
  items: [
    { id: 'g1', category: 'funding', topic: 'minimum_request', title: 'urban minimum', mandatory: true, programVariant: 'capital', sources: [{ documentId: DOC_ID, page: 3, quote: URBAN_QUOTE }] },
    { id: 'g2', category: 'funding', topic: 'minimum_request', title: 'rural minimum', mandatory: true, programVariant: 'capital', sources: [{ documentId: DOC_ID, page: 3, quote: RURAL_QUOTE }] },
    { id: 'g3', category: 'eligibility', topic: 'application_limit', title: 'limit', mandatory: true, programVariant: null, sources: [{ documentId: DOC_ID, page: 4, quote: LIMIT_QUOTE }] },
    { id: 'g4', category: 'eligibility', topic: 'applicant_type', title: 'applicants', mandatory: true, programVariant: null, sources: [{ documentId: DOC_ID, page: 2, quote: 'Eligible applicants are States, units of local government and transit agencies.' }] },
  ],
};

function draft(over: Partial<Draft> & { quote: string; page: number }): Draft {
  const { quote, page, ...rest } = over;
  return {
    category: 'funding',
    topic: 'minimum_request',
    title: 't',
    description: 'd',
    mandatory: true,
    programVariant: null,
    appliesWhen: [],
    evidenceNeeded: [],
    check: undefined,
    sources: [{ documentId: DOC_ID, page, section: null, quote, authority: 'controlling', verified: true, locationCorrected: false }],
    flags: [],
    ...rest,
  };
}

function fileOf(...drafts: Draft[]): RequirementsFile {
  const requirements = finalizeRequirements(OPP_A, drafts);
  return {
    schemaVersion: 1, opportunityId: OPP_A, generatedAt: 'x', model: 'm', promptVersion: '1', passes: 1,
    sourceManifestHash: 'a'.repeat(64), status: 'complete', documents: [],
    batches: { total: 1, succeeded: 1, split: 0, failed: [] }, usage: { inputTokens: 0, outputTokens: 0 },
    stats: { candidates: drafts.length, rejected: 0, merged: 0, kept: requirements.length, sourcesRejected: 0, locationsCorrected: 0, checksDropped: 0 },
    rejections: [], requirements,
  };
}

describe('validateGold', () => {
  it('passes when every reference quote is on its stated page', () => {
    expect(validateGold(gold, docs)).toEqual([]);
  });

  it('reports a quote on the wrong page, a missing document, and an invented quote', () => {
    const bad: Gold = {
      ...gold,
      items: [
        { ...gold.items[0], id: 'wrongPage', sources: [{ documentId: DOC_ID, page: 2, quote: URBAN_QUOTE }] },
        { ...gold.items[0], id: 'noDoc', sources: [{ documentId: 'sg-none', page: 1, quote: URBAN_QUOTE }] },
        { ...gold.items[0], id: 'invented', sources: [{ documentId: DOC_ID, page: 3, quote: 'A sentence nobody ever wrote in this document.' }] },
      ],
    };
    expect(validateGold(bad, docs).map((i) => [i.goldId, i.problem.split(' ')[0]])).toEqual([['wrongPage', 'quote'], ['noDoc', 'document'], ['invented', 'quote']]);
  });
});

describe('compareToGold', () => {
  it('counts a reference item as covered when an extracted quote overlaps it on the same page', () => {
    const result = compareToGold(gold, fileOf(draft({ quote: URBAN_QUOTE, page: 3 }), draft({ quote: LIMIT_QUOTE, page: 4, category: 'eligibility', topic: 'application_limit' })), docs);
    // g2 (rural) was not quoted, but a requirement with the same page and topic (urban) exists: a lenient, not strict, match.
    expect(result.rows.map((r) => [r.goldId, r.matchKind])).toEqual([['g1', 'quote'], ['g2', 'page_topic'], ['g3', 'quote'], ['g4', null]]);
    expect(result.covered).toBe(2);
    expect(result.coverage).toBe(0.5);
    expect(result.lenientCovered).toBe(3);
    expect(result.total).toBe(4);
  });

  it('picks the BEST match when one quote contains several reference quotes', () => {
    const both = draft({ quote: `${URBAN_QUOTE}\n${RURAL_QUOTE}`, page: 3, title: 'both thresholds' });
    const urbanOnly = draft({ quote: URBAN_QUOTE, page: 3, title: 'urban only', appliesWhen: ['urban'] });
    const result = compareToGold(gold, fileOf(both, urbanOnly), docs);
    const urbanRow = result.rows.find((r) => r.goldId === 'g1')!;
    const matched = finalizeRequirements(OPP_A, [both, urbanOnly]).find((r) => r.id === urbanRow.matchedRequirementId)!;
    expect(matched.title).toBe('urban only'); // the most specific requirement, not the first
  });

  it('reports a lenient match (same page and topic, different sentence) separately from the strict one', () => {
    const differentSentence = draft({
      quote: 'The following are not eligible applicants: Federal agencies and Individuals.',
      page: 2, category: 'eligibility', topic: 'applicant_type',
    });
    const result = compareToGold(gold, fileOf(differentSentence), docs);
    const row = result.rows.find((r) => r.goldId === 'g4')!;
    expect(row.matchKind).toBe('page_topic');
    expect(result.covered).toBe(0); // strict
    expect(result.lenientCovered).toBe(1); // lenient
  });

  it('does not match a requirement on the wrong page', () => {
    const result = compareToGold(gold, fileOf(draft({ quote: URBAN_QUOTE, page: 4 })), docs);
    expect(result.rows[0].matchKind).toBeNull();
  });

  it('measures category and mandatory agreement only over matched items', () => {
    const result = compareToGold(
      gold,
      fileOf(
        draft({ quote: URBAN_QUOTE, page: 3, category: 'eligibility' }), // category differs
        draft({ quote: RURAL_QUOTE, page: 3, mandatory: null, title: 'rural' }) // mandatory differs
      ),
      docs
    );
    expect(result.categoryAgreement).toEqual({ agree: 1, of: 2 });
    expect(result.mandatoryAgreement).toEqual({ agree: 1, of: 2 });
  });

  it('lists extracted requirements that match no reference item, without calling them wrong', () => {
    const extra = draft({ quote: 'Applicants for capital projects located in rural areas must request at least $1 million', page: 3, topic: 'maximum_request', title: 'extra' });
    const unrelated = draft({ quote: 'B. ELIGIBILITY 1. ELIGIBLE APPLICANTS Eligible applicants are States', page: 2, title: 'unrelated', topic: 'other' });
    const result = compareToGold(gold, fileOf(draft({ quote: URBAN_QUOTE, page: 3 }), extra, unrelated), docs);
    expect(result.unmatchedExtracted.length).toBeGreaterThanOrEqual(1);
    expect(result.unmatchedExtracted.every((u) => typeof u.title === 'string')).toBe(true);
  });

  it('re-verifies every stored source against the document text, independently of extraction', () => {
    const good = fileOf(draft({ quote: URBAN_QUOTE, page: 3 }));
    expect(compareToGold(gold, good, docs).sources).toMatchObject({ total: 1, reverified: 1, failures: [] });

    // A stored source whose quote is not in the document (for example a tampered file) is caught.
    const tampered = fileOf(draft({ quote: 'A sentence that is not in the stored document at all, honestly.', page: 3 }));
    const result = compareToGold(gold, tampered, docs);
    expect(result.sources.reverified).toBe(0);
    expect(result.sources.failures[0].detail).toMatch(/does not appear/);

    // A stored page that differs from where the quote really is is also reported.
    const moved = fileOf(draft({ quote: URBAN_QUOTE, page: 2 }));
    expect(compareToGold(gold, moved, docs).sources.failures[0].detail).toMatch(/differs/);
  });

  it('counts review statuses', () => {
    const result = compareToGold(gold, fileOf(draft({ quote: URBAN_QUOTE, page: 3 }), draft({ quote: RURAL_QUOTE, page: 3, mandatory: null, title: 'r' })), docs);
    expect(result.reviewStatus).toEqual({ unreviewed: 1, needs_review: 1, verified: 0 });
  });
});

describe('the committed reference set', () => {
  // This file is tracked in git, so this test needs no ingested package data.
  const path = new URL('../../../data/fixtures/nofo-gold/4d8f5775-ff01-4a6f-ab4e-b125899043b3.gold.json', import.meta.url);
  const parsed = GoldSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));

  it('is valid, within the guide\'s 15-25 items, and honest about not being human-verified', () => {
    expect(parsed.items.length).toBeGreaterThanOrEqual(15);
    expect(parsed.items.length).toBeLessThanOrEqual(25);
    expect(parsed.verification.verifiedBy).toBeNull();
    expect(parsed.verification.status).toMatch(/pending_human_review/);
    expect(new Set(parsed.items.map((i) => i.id)).size).toBe(parsed.items.length);
  });

  it('covers all four in-scope categories', () => {
    expect(new Set(parsed.items.map((i) => i.category))).toEqual(new Set(['eligibility', 'funding', 'application', 'readiness']));
  });
});
