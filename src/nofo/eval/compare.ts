import { z } from 'zod';
import { verifySource, type VerifiableDocument } from '../citations.js';
import { matchKey, textContainsQuote } from '../ingest/normalize.js';
import { DOCUMENT_ID_PATTERN, UUID_PATTERN, type NormalizedDocument } from '../schemas.js';
import { longestCommonSubstring, quotesOverlap } from '../quotes.js';
import { RequirementCategorySchema, RequirementTopicSchema, type Requirement, type RequirementsFile } from '../extraction/schemas.js';

/**
 * Evaluation of extracted requirements against a reference ("gold") set.
 * Everything here is deterministic. The model never grades itself.
 */

export const GoldSchema = z.object({
  schemaVersion: z.literal(1),
  opportunityId: z.string().regex(UUID_PATTERN),
  verification: z.object({
    status: z.string(),
    draftedBy: z.string().nullable().optional(),
    draftedOn: z.string().nullable().optional(),
    verifiedBy: z.string().nullable(),
    verifiedOn: z.string().nullable(),
    note: z.string().optional(),
  }),
  items: z
    .array(
      z.object({
        id: z.string(),
        category: RequirementCategorySchema,
        topic: RequirementTopicSchema,
        title: z.string(),
        mandatory: z.boolean().nullable(),
        programVariant: z.enum(['capital', 'planning', 'both']).nullable(),
        sources: z.array(z.object({ documentId: z.string().regex(DOCUMENT_ID_PATTERN), page: z.number().int().min(1), quote: z.string().min(1) })).min(1),
      })
    )
    .min(1),
});
export type Gold = z.infer<typeof GoldSchema>;

export interface GoldIssue {
  goldId: string;
  problem: string;
}

/** Are the reference quotes themselves real? Each must be found on its stated page of the stored document. */
export function validateGold(gold: Gold, documents: Map<string, VerifiableDocument>): GoldIssue[] {
  const issues: GoldIssue[] = [];
  for (const item of gold.items) {
    for (const source of item.sources) {
      const doc = documents.get(source.documentId);
      if (!doc) {
        issues.push({ goldId: item.id, problem: `document ${source.documentId} is not in the package` });
        continue;
      }
      if (doc.normalized.kind !== 'pdf') {
        issues.push({ goldId: item.id, problem: 'only page-based documents are supported in the reference set' });
        continue;
      }
      const page = doc.normalized.pages[source.page - 1];
      if (!page || !textContainsQuote(page.text, source.quote)) {
        issues.push({ goldId: item.id, problem: `quote not found on page ${source.page}` });
      }
    }
  }
  return issues;
}

export interface GoldRow {
  goldId: string;
  title: string;
  matchedRequirementId: string | null;
  /** quote = an extracted quote overlaps the reference quote; page_topic = same page and topic, different sentence. */
  matchKind: 'quote' | 'page_topic' | null;
  categoryAgrees: boolean | null;
  mandatoryAgrees: boolean | null;
  matchedNeedsReview: boolean | null;
}

export interface Comparison {
  total: number;
  /** Strict: a reference item counts only when an extracted quote overlaps its quote. */
  covered: number;
  coverage: number;
  /** Lenient: also counts a requirement on the same page and topic that cites a different sentence. */
  lenientCovered: number;
  lenientCoverage: number;
  rows: GoldRow[];
  categoryAgreement: { agree: number; of: number };
  mandatoryAgreement: { agree: number; of: number };
  /** Extracted requirements that match no reference item. They are NOT necessarily wrong. */
  unmatchedExtracted: Array<{ id: string; title: string; category: string }>;
  sources: { total: number; reverified: number; failures: Array<{ requirementId: string; detail: string }> };
  reviewStatus: { unreviewed: number; needs_review: number; verified: number };
}

/**
 * Coverage: a reference item is covered when some extracted requirement cites
 * an overlapping passage on the same page of the same document.
 * Citation accuracy: every stored source is re-verified here, independently
 * of the extraction run, against the stored document text.
 */
export function compareToGold(gold: Gold, file: RequirementsFile, documents: Map<string, VerifiableDocument>): Comparison {
  const matchedIds = new Set<string>();

  /** How well an extracted quote covers a reference quote: 1 when it contains it, else the shared fraction. */
  const score = (goldQuote: string, extractedQuote: string): number => {
    const g = matchKey(goldQuote);
    const e = matchKey(extractedQuote);
    if (!g || !e) return 0;
    if (e.includes(g)) return 1;
    if (g.includes(e)) return e.length / g.length;
    return longestCommonSubstring(g, e) / g.length;
  };

  const rows: GoldRow[] = gold.items.map((item) => {
    // Best quote match on the same page; ties go to the most specific (shortest) extracted quote.
    let best: { req: Requirement; score: number; length: number } | null = null;
    for (const req of file.requirements) {
      for (const src of req.sources) {
        for (const g of item.sources) {
          if (g.documentId !== src.documentId || src.page !== g.page || !quotesOverlap(g.quote, src.quote, 'loose')) continue;
          const candidate = { req, score: score(g.quote, src.quote), length: src.quote.length };
          if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.length < best.length)) best = candidate;
        }
      }
    }
    let match: Requirement | undefined = best?.req;
    let matchKind: GoldRow['matchKind'] = match ? 'quote' : null;
    if (!match) {
      match = file.requirements.find(
        (req) => req.topic === item.topic && req.sources.some((src) => item.sources.some((g) => g.documentId === src.documentId && src.page === g.page))
      );
      if (match) matchKind = 'page_topic';
    }
    if (match) matchedIds.add(match.id);
    return {
      goldId: item.id,
      title: item.title,
      matchedRequirementId: match?.id ?? null,
      matchKind,
      categoryAgrees: match ? match.category === item.category : null,
      mandatoryAgrees: match ? match.mandatory === item.mandatory : null,
      matchedNeedsReview: match ? match.reviewStatus === 'needs_review' : null,
    };
  });

  const covered = rows.filter((r) => r.matchKind === 'quote').length;
  const lenientCovered = rows.filter((r) => r.matchKind !== null).length;
  const agree = (key: 'categoryAgrees' | 'mandatoryAgrees'): { agree: number; of: number } => {
    const matched = rows.filter((r) => r[key] !== null);
    return { agree: matched.filter((r) => r[key] === true).length, of: matched.length };
  };

  const failures: Array<{ requirementId: string; detail: string }> = [];
  let totalSources = 0;
  let reverified = 0;
  for (const req of file.requirements) {
    for (const src of req.sources) {
      totalSources += 1;
      const result = verifySource({ documentId: src.documentId, page: src.page, section: src.section, quote: src.quote }, documents);
      if (result.ok && !result.source.locationCorrected) reverified += 1;
      else failures.push({ requirementId: req.id, detail: result.ok ? 'stored location differs from where the quote is found' : result.detail });
    }
  }

  return {
    total: gold.items.length,
    covered,
    coverage: gold.items.length === 0 ? 0 : covered / gold.items.length,
    lenientCovered,
    lenientCoverage: gold.items.length === 0 ? 0 : lenientCovered / gold.items.length,
    rows,
    categoryAgreement: agree('categoryAgrees'),
    mandatoryAgreement: agree('mandatoryAgrees'),
    unmatchedExtracted: file.requirements.filter((r) => !matchedIds.has(r.id)).map((r) => ({ id: r.id, title: r.title, category: r.category })),
    sources: { total: totalSources, reverified, failures },
    reviewStatus: {
      unreviewed: file.requirements.filter((r) => r.reviewStatus === 'unreviewed').length,
      needs_review: file.requirements.filter((r) => r.reviewStatus === 'needs_review').length,
      verified: file.requirements.filter((r) => r.reviewStatus === 'verified').length,
    },
  };
}

export function documentsFrom(entries: Array<{ documentId: string; authority: VerifiableDocument['authority']; normalized: NormalizedDocument }>): Map<string, VerifiableDocument> {
  return new Map(entries.map((e) => [e.documentId, e]));
}
