import type { AssessmentResult } from './assessment/assess.js';
import type { Finding, FindingSource, Question } from './assessment/schemas.js';

/**
 * The advisory summary, written by code from the findings. It never calls a
 * model, so it cannot add a requirement, a number or a citation that is not in
 * a finding. Every item names its requirement and carries its evidence.
 */

export const DISCLAIMER =
  'Preliminary screening based only on what you have told us and on requirements extracted from the notice. It is not an official eligibility determination and does not predict an award. Confirm with the program office.';

export interface AdvisoryItem {
  requirementId: string;
  /** Other requirements with the same topic and outcome, folded into this item (the extraction can state one rule in several places). */
  relatedCount: number;
  relatedRequirementIds: string[];
  title: string;
  status: Finding['status'];
  gap: boolean;
  provisional: boolean;
  text: string;
  source: FindingSource | null;
}

/** Where the applicant stands, in one line and three counts (written by code from the findings). */
export interface Standing {
  line: string;
  /** Requirements that look consistent with what the applicant said. */
  workable: number;
  /** Distinct issues that may stand in the way or need a specialist's judgment. */
  attention: number;
  /** Requirements that cannot be checked until more is known. */
  unknown: number;
}

export interface Advisory {
  label: 'Preliminary assessment';
  standing: Standing;
  headline: string;
  counts: { assessed: number; supported: number; conflicts: number; gaps: number; needsSpecialistReview: number; unknown: number; notApplicable: number };
  /** The findings a person should look at first, each with its evidence. */
  keyFindings: AdvisoryItem[];
  nextSteps: string[];
  disclaimer: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface Group {
  lead: Finding;
  related: Finding[];
}

/** Findings with the same topic, status and explanation are one issue stated in several places. */
function group(findings: Finding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const finding of findings) {
    const key = `${finding.topic}|${finding.status}|${finding.gap}|${finding.explanation}`;
    const existing = groups.get(key);
    if (existing) existing.related.push(finding);
    else groups.set(key, { lead: finding, related: [] });
  }
  return [...groups.values()];
}

const withRelated = (n: number, noun: string, nounPlural: string, g: Group[]): string => {
  const total = g.reduce((sum, x) => sum + 1 + x.related.length, 0);
  return total === n && g.length === n ? plural(n, noun, nounPlural) : `${plural(g.length, noun, nounPlural)} (across ${total} requirements)`;
};

export function buildAdvisory(result: AssessmentResult, questions: Question[]): Advisory {
  const f = result.findings;
  const conflicts = f.filter((x) => x.status === 'conflict' && !x.gap);
  const gaps = f.filter((x) => x.status === 'conflict' && x.gap);
  const specialist = f.filter((x) => x.status === 'needs_specialist_review');
  const unknown = f.filter((x) => x.status === 'unknown');
  const supported = f.filter((x) => x.status === 'supported');
  const conflictGroups = group(conflicts);
  const gapGroups = group(gaps);
  const specialistGroups = group(specialist);

  const counts = {
    assessed: f.length,
    supported: supported.length,
    conflicts: conflicts.length,
    gaps: gaps.length,
    needsSpecialistReview: specialist.length,
    unknown: unknown.length,
    notApplicable: result.notApplicable.length,
  };

  const parts: string[] = [];
  if (conflicts.length) parts.push(withRelated(conflicts.length, 'possible conflict', 'possible conflicts', conflictGroups));
  if (gaps.length) parts.push(withRelated(gaps.length, 'preparation gap', 'preparation gaps', gapGroups));
  if (specialist.length) parts.push(`${withRelated(specialist.length, 'item', 'items', specialistGroups)} needing specialist review`);
  parts.push(`${plural(supported.length, 'condition that looks', 'conditions that look')} supported by what you stated`);
  parts.push(`${unknown.length} not yet evaluated`);
  const headline = `Of ${f.length} requirements considered: ${parts.join(', ')}.`;

  const item = (g: Group): AdvisoryItem => ({
    requirementId: g.lead.requirementId,
    relatedCount: g.related.length,
    relatedRequirementIds: g.related.map((r) => r.requirementId),
    title: g.lead.title,
    status: g.lead.status,
    gap: g.lead.gap,
    provisional: g.lead.provisional,
    text: g.lead.explanation,
    source: g.lead.sources[0] ?? null,
  });
  const keyFindings = [...conflictGroups, ...gapGroups, ...specialistGroups].slice(0, 8).map(item);

  const more = (g: Group): string => (g.related.length > 0 ? ` (and ${plural(g.related.length, 'related requirement', 'related requirements')})` : '');
  const nextSteps: string[] = [];
  for (const g of conflictGroups.slice(0, 3)) nextSteps.push(`Resolve with the program office or adjust the project: ${g.lead.title}${more(g)}. ${g.lead.explanation}`);
  for (const g of gapGroups.slice(0, 3)) nextSteps.push(`Prepare: ${g.lead.title}${more(g)}. ${g.lead.explanation}`);
  for (const g of specialistGroups.slice(0, 3)) nextSteps.push(`Get a specialist or the program office to confirm: ${g.lead.title}${more(g)}.`);
  const checklist = unknown.filter((x) => x.method === 'none' && x.missingFacts.length === 0 && x.category === 'application').length;
  if (checklist > 0) nextSteps.push(`Work through the application checklist: ${plural(checklist, 'application item has', 'application items have')} not been evidenced yet.`);
  nextSteps.push('Confirm the final requirements and any amendments with the program office before relying on this screening.');

  // "Where you stand": a plain bottom line and three numbers, instead of leading with a count of requirements.
  const issues = conflictGroups.length + gapGroups.length + specialistGroups.length;
  const first = keyFindings[0]?.title;
  const line =
    issues > 0
      ? issues === 1
        ? `One thing may stand in the way or needs a specialist's eye: "${first}".`
        : `${issues} things may stand in the way or need a specialist's eye. The most important is "${first}".`
      : unknown.length > 0
        ? `Nothing you have told me stands in the way so far, but ${plural(unknown.length, 'requirement', 'requirements')} cannot be checked until I know more.`
        : 'Everything checked so far looks consistent with what you have told me.';
  const standing: Standing = { line, workable: supported.length, attention: issues, unknown: unknown.length };

  return { label: 'Preliminary assessment', standing, headline, counts, keyFindings, nextSteps, disclaimer: DISCLAIMER };
}
