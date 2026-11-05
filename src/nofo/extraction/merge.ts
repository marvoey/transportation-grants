import { sha256Hex } from '../util.js';
import { matchKey } from '../ingest/normalize.js';
import { quotesOverlap } from '../quotes.js';
import type { Check, Requirement, RequirementCategory, RequirementSource } from './schemas.js';
import type { Candidate } from './schemas.js';

/** A verified candidate on its way to becoming a Requirement. `flags` are reasons a human should look at it. */
export interface Draft {
  category: RequirementCategory;
  topic: Candidate['topic'];
  title: string;
  description: string;
  mandatory: boolean | null;
  programVariant: 'capital' | 'planning' | 'both' | null;
  appliesWhen: string[];
  evidenceNeeded: string[];
  check: Check | undefined;
  sources: RequirementSource[];
  flags: string[];
}

function unionStrings(a: string[], b: string[]): string[] {
  const seen = new Set(a.map((s) => s.toLowerCase()));
  return [...a, ...b.filter((s) => !seen.has(s.toLowerCase()))];
}

function sameSource(a: RequirementSource, b: RequirementSource): boolean {
  return a.documentId === b.documentId && a.page === b.page && a.section === b.section && quotesOverlap(a.quote, b.quote, 'strict');
}

function sharesPassage(a: Draft, b: Draft): boolean {
  return a.sources.some((sa) => b.sources.some((sb) => sa.documentId === sb.documentId && quotesOverlap(sa.quote, sb.quote, 'strict')));
}

function mergeInto(target: Draft, other: Draft): void {
  for (const source of other.sources) {
    if (!target.sources.some((s) => sameSource(s, source))) target.sources.push(source);
  }
  if (other.description.length > target.description.length) target.description = other.description;

  if (target.mandatory !== other.mandatory) {
    if (target.mandatory !== null && other.mandatory !== null) {
      target.flags.push('batches disagreed on whether this is mandatory');
    }
    target.mandatory = null; // conservative: never promote ambiguity to a definite answer
  }
  if (target.programVariant !== other.programVariant) {
    target.flags.push('batches disagreed on the program variant');
    target.programVariant = null;
  }
  target.appliesWhen = unionStrings(target.appliesWhen, other.appliesWhen);
  target.evidenceNeeded = unionStrings(target.evidenceNeeded, other.evidenceNeeded);

  // Candidates with different checks never reach this point (see mergeDrafts), so a check is either
  // identical on both sides or present on one side only.
  if (!target.check && other.check) target.check = other.check;
  for (const flag of other.flags) if (!target.flags.includes(flag)) target.flags.push(flag);
}

/**
 * Merges candidates that cite the same passage under the same category and
 * topic. Merging is conservative: conflicting facts become `null`/dropped and
 * are flagged for review rather than resolved silently.
 */
export function mergeDrafts(drafts: Draft[]): { merged: Draft[]; mergedCount: number } {
  const merged: Draft[] = [];
  let mergedCount = 0;
  for (const draft of drafts) {
    const titleKey = matchKey(draft.title);
    const existing = merged.find(
      (m) =>
        m.category === draft.category &&
        m.topic === draft.topic &&
        // Two candidates with DIFFERENT machine-checkable checks are different requirements, even when they cite
        // the same sentence (for example one sentence that states both an urban and a rural threshold).
        !(m.check !== undefined && draft.check !== undefined && JSON.stringify(m.check) !== JSON.stringify(draft.check)) &&
        (sharesPassage(m, draft) ||
          matchKey(m.title) === titleKey ||
          // The same constraint (identical machine-checkable check) under the same topic is the same requirement.
          (m.check !== undefined && draft.check !== undefined && JSON.stringify(m.check) === JSON.stringify(draft.check)))
    );
    if (existing) {
      mergeInto(existing, draft);
      mergedCount += 1;
    } else {
      merged.push({ ...draft, sources: [...draft.sources], flags: [...draft.flags] });
    }
  }
  return { merged, mergedCount };
}

/** Stable IDs: derived from category, topic and the first cited passage, so re-runs keep IDs for the same requirement. */
export function finalizeRequirements(opportunityId: string, drafts: Draft[]): Requirement[] {
  const used = new Map<string, number>();
  return drafts.map((draft) => {
    const first = draft.sources[0];
    const seed = [draft.category, draft.topic, first.documentId, matchKey(first.quote).slice(0, 80)].join('|');
    const base = `req-${sha256Hex(seed).slice(0, 8)}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);

    const flags = [...draft.flags];
    if (draft.mandatory === null) flags.push('mandatory status unclear (guidance wording or ambiguous)');
    if (draft.sources.some((s) => s.locationCorrected)) flags.push('a cited location was corrected by code');
    if (draft.sources.some((s) => s.note?.startsWith('quote spans'))) flags.push('a quote spans a page break');

    return {
      id: count === 1 ? base : `${base}-${count}`,
      opportunityId,
      category: draft.category,
      topic: draft.topic,
      title: draft.title,
      description: draft.description,
      mandatory: draft.mandatory,
      programVariant: draft.programVariant,
      appliesWhen: draft.appliesWhen,
      evidenceNeeded: draft.evidenceNeeded,
      ...(draft.check ? { check: draft.check } : {}),
      sources: draft.sources,
      reviewStatus: flags.length > 0 ? 'needs_review' : 'unreviewed',
      ...(flags.length > 0 ? { reviewNote: [...new Set(flags)].join('; ') } : {}),
    };
  });
}
