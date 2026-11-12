import type { Check, Requirement } from '../extraction/schemas.js';
import { formatUsd, type Derived } from './arithmetic.js';
import type { FactKey, FindingStatus, ProjectFacts } from './schemas.js';

/**
 * Deterministic evaluation of a requirement's machine-checkable `check`.
 * Plain code on stated numbers and facts. The model is never involved, and a
 * missing fact is always `unknown`, never a pass or a fail.
 */

export interface CheckOutcome {
  /** `not_applicable`: the project is outside the situation this requirement covers. */
  applicability: 'applies' | 'not_applicable';
  status: FindingStatus;
  /** A required deliverable is known not to exist yet. */
  gap: boolean;
  explanation: string;
  factsUsed: FactKey[];
  missingFacts: FactKey[];
}

const unknown = (explanation: string, missingFacts: FactKey[], factsUsed: FactKey[] = []): CheckOutcome => ({
  applicability: 'applies',
  status: 'unknown',
  gap: false,
  explanation,
  factsUsed,
  missingFacts,
});

type Situation = { area: 'any' | 'urban' | 'rural'; category: 'any' | 'capital' | 'planning' };

function describeSituation(s: Situation): string {
  const parts = [s.area !== 'any' ? s.area : '', s.category !== 'any' ? s.category : ''].filter(Boolean);
  return parts.length ? `${parts.join(' ')} projects` : 'all projects';
}

/**
 * Does the requirement's situation (area type, grant category) cover this
 * project? Unknown facts that the situation depends on make the result unknown
 * (we cannot tell yet whether the requirement applies).
 */
export function situationFor(
  situation: Situation,
  facts: ProjectFacts
): { result: 'applies' | 'not_applicable' | 'undetermined'; missing: FactKey[]; used: FactKey[]; reason?: string } {
  const missing: FactKey[] = [];
  const used: FactKey[] = [];
  if (situation.area !== 'any') {
    const area = facts.areaType?.value;
    if (!area) missing.push('areaType');
    else {
      used.push('areaType');
      if (area !== situation.area) return { result: 'not_applicable', missing: [], used, reason: `covers ${describeSituation(situation)}; this project is ${area}` };
    }
  }
  if (situation.category !== 'any') {
    const category = facts.grantCategory?.value;
    if (!category) missing.push('grantCategory');
    else {
      used.push('grantCategory');
      if (category !== situation.category) return { result: 'not_applicable', missing: [], used, reason: `covers ${describeSituation(situation)}; this is a ${category} project` };
    }
  }
  return missing.length ? { result: 'undetermined', missing, used } : { result: 'applies', missing: [], used };
}

const EXCEPTION_WORDS = /\b(unless|except|exception|designat)/i;

// Which stated applicant type matches which wording a notice might use. These are general terms, not program names.
const APPLICANT_WORDING: Record<string, RegExp> = {
  state: /\bstates?\b/i,
  city: /(local (government|agenc)|municipal|\bcity\b|\bcities\b|\btown)/i,
  county: /(\bcount(y|ies)\b|local (government|agenc))/i,
  tribal: /\btrib(e|es|al)\b/i,
  mpo: /(metropolitan planning|\bmpo\b)/i,
  transit_agency: /\btransit\b/i,
};

/**
 * Wording that makes an eligibility rule about WHO is on a closed list the notice itself provides (specific states or
 * agencies that were selected, are participating or are named), rather than about what KIND of organization may apply.
 * General terms, not program names.
 */
const CLOSED_LIST_WORDING = /\b(pre-?selected|participating|sample design|named (in|by)|listed (in|below|above)|identified (agenc|state|entit|applicant|local))/i;

/**
 * "Only organizations the notice names may apply." The kind of organization (a state, a city) can never settle that: a
 * state applicant is not necessarily one of the states the notice names. So the answer waits for the applicant's own
 * statement of whether it is on the notice's list; with none it is unknown, never a pass, and the question is asked.
 * Returns null when the requirement is not of this kind.
 */
export function evaluateClosedList(requirement: Requirement, facts: ProjectFacts): CheckOutcome | null {
  if (requirement.topic !== 'applicant_type' || requirement.category !== 'eligibility' || requirement.mandatory === false) return null;
  const values = requirement.check?.kind === 'applicant_type_in' ? requirement.check.values.join(' ') : '';
  if (!CLOSED_LIST_WORDING.test(`${requirement.title} ${requirement.description} ${values}`)) return null;

  // A rule about one kind of applicant (for example local agencies) does not concern an applicant of another kind.
  const type = facts.applicantType?.value;
  if (type && requirement.appliesWhen.length > 0) {
    const wording = APPLICANT_WORDING[type];
    if (!requirement.appliesWhen.some((w) => wording?.test(w))) {
      return {
        applicability: 'not_applicable',
        status: 'unknown',
        gap: false,
        explanation: `covers: ${requirement.appliesWhen.join('; ')}; this applicant is ${type === 'other' ? 'another kind of organization' : `a ${type.replace('_', ' ')}`}`,
        factsUsed: ['applicantType'],
        missingFacts: [],
      };
    }
  }

  const named = facts.onNoticeList?.value;
  if (named === undefined) {
    return unknown(
      'The notice limits who may apply to specific organizations it names, and the kind of organization is not enough to tell. Whether yours is one of them has not been stated.',
      ['onNoticeList'],
      type ? ['applicantType'] : []
    );
  }
  return {
    applicability: 'applies',
    status: named ? 'supported' : 'conflict',
    gap: false,
    explanation: named
      ? "You stated that your organization is one of those the notice names. That is your statement; it has not been checked against the notice's list."
      : 'You stated that your organization is not one of those the notice names.',
    factsUsed: ['onNoticeList'],
    missingFacts: [],
  };
}

export function evaluateCheck(requirement: Requirement, facts: ProjectFacts, derived: Derived): CheckOutcome | null {
  const closed = evaluateClosedList(requirement, facts);
  if (closed) return closed;
  const check: Check | undefined = requirement.check;
  if (!check) return null;

  switch (check.kind) {
    case 'amount_min':
    case 'amount_max': {
      const scope = situationFor({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory }, facts);
      if (scope.result === 'not_applicable') return { applicability: 'not_applicable', status: 'unknown', gap: false, explanation: scope.reason ?? '', factsUsed: scope.used, missingFacts: [] };
      const request = facts.requestedFederalUsd?.value;
      const used: FactKey[] = [...scope.used];
      if (request === undefined) {
        return unknown(
          `Need the amount of federal funding requested to check this ${check.kind === 'amount_min' ? 'minimum' : 'maximum'} (${formatUsd(check.amountUsd)} for ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}).`,
          ['requestedFederalUsd', ...scope.missing],
          used
        );
      }
      used.push('requestedFederalUsd');
      if (scope.result === 'undetermined') {
        return unknown(
          `The ${formatUsd(check.amountUsd)} ${check.kind === 'amount_min' ? 'minimum' : 'maximum'} applies only to ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}; it is not yet known whether this project is one.`,
          scope.missing,
          used
        );
      }
      const ok = check.kind === 'amount_min' ? request >= check.amountUsd : request <= check.amountUsd;
      const word = check.kind === 'amount_min' ? 'minimum' : 'maximum';
      return {
        applicability: 'applies',
        status: ok ? 'supported' : 'conflict',
        gap: false,
        explanation: ok
          ? `The requested ${formatUsd(request)} ${check.kind === 'amount_min' ? 'meets' : 'is within'} the ${formatUsd(check.amountUsd)} ${word} for ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}.`
          : `The requested ${formatUsd(request)} ${check.kind === 'amount_min' ? 'is below' : 'exceeds'} the ${formatUsd(check.amountUsd)} ${word} for ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}.`,
        factsUsed: used,
        missingFacts: [],
      };
    }

    case 'federal_share_max_pct': {
      const scope = situationFor({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory }, facts);
      if (scope.result === 'not_applicable') return { applicability: 'not_applicable', status: 'unknown', gap: false, explanation: scope.reason ?? '', factsUsed: scope.used, missingFacts: [] };
      const share = derived.federalSharePct;
      const used: FactKey[] = [...scope.used];
      if (share === null) {
        const missing: FactKey[] = facts.requestedFederalUsd ? ['totalProjectCostUsd', 'nonFederalMatchUsd'] : ['requestedFederalUsd'];
        return unknown(`Need the federal request and either the total project cost or the non-federal match to work out the federal share (limit ${check.pct}%).`, [...missing, ...scope.missing], used);
      }
      used.push('requestedFederalUsd');
      if (facts.totalProjectCostUsd) used.push('totalProjectCostUsd');
      if (facts.nonFederalMatchUsd) used.push('nonFederalMatchUsd');
      const note = derived.assumptions.length ? ` (${derived.assumptions.join(' ')})` : '';
      if (scope.result === 'undetermined') {
        return unknown(`The federal share is ${share}%, against a ${check.pct}% limit that applies to ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}; it is not yet known whether this project is one.${note}`, scope.missing, used);
      }
      if (share <= check.pct) {
        return { applicability: 'applies', status: 'supported', gap: false, explanation: `The federal share is ${share}%, within the ${check.pct}% limit.${note}`, factsUsed: used, missingFacts: [] };
      }
      // Over the limit. If the requirement itself describes exceptions we cannot tell from numbers alone.
      const hasException = EXCEPTION_WORDS.test(`${requirement.description} ${requirement.title}`);
      return {
        applicability: 'applies',
        status: hasException ? 'needs_specialist_review' : 'conflict',
        gap: false,
        explanation: hasException
          ? `The federal share is ${share}%, above the ${check.pct}% limit; the requirement describes exceptions that numbers alone cannot settle, so someone must check whether one applies.${note}`
          : `The federal share is ${share}%, above the ${check.pct}% limit.${note}`,
        factsUsed: used,
        missingFacts: [],
      };
    }

    case 'match_min_pct': {
      const scope = situationFor({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory }, facts);
      if (scope.result === 'not_applicable') return { applicability: 'not_applicable', status: 'unknown', gap: false, explanation: scope.reason ?? '', factsUsed: scope.used, missingFacts: [] };
      const share = derived.nonFederalSharePct;
      if (share === null) {
        return unknown(`Need the non-federal match and the total project cost to check the ${check.pct}% minimum match.`, ['nonFederalMatchUsd', 'totalProjectCostUsd', ...scope.missing], scope.used);
      }
      const used: FactKey[] = [...scope.used, 'nonFederalMatchUsd'];
      if (scope.result === 'undetermined') {
        return unknown(`The non-federal match is ${share}% of the total, against a ${check.pct}% minimum that applies to ${describeSituation({ area: check.appliesTo.areaType, category: check.appliesTo.grantCategory })}; it is not yet known whether this project is one.`, scope.missing, used);
      }
      const ok = share >= check.pct;
      return {
        applicability: 'applies',
        status: ok ? 'supported' : 'conflict',
        gap: false,
        explanation: ok ? `The non-federal match is ${share}% of the total, meeting the ${check.pct}% minimum.` : `The non-federal match is ${share}% of the total, below the ${check.pct}% minimum.`,
        factsUsed: used,
        missingFacts: [],
      };
    }

    case 'applicant_type_in': {
      const type = facts.applicantType?.value;
      if (!type) return unknown('Need the type of organization that is applying.', ['applicantType']);
      const wording = APPLICANT_WORDING[type];
      const matched = wording ? check.values.find((v) => wording.test(v)) : undefined;
      if (matched) {
        return { applicability: 'applies', status: 'supported', gap: false, explanation: `A ${type.replace('_', ' ')} applicant fits the eligible applicant "${matched}".`, factsUsed: ['applicantType'], missingFacts: [] };
      }
      // Free-text lists can describe the same entity in other words, so a non-match is a question for a person, not a conflict.
      return { applicability: 'applies', status: 'needs_specialist_review', gap: false, explanation: `A ${type.replace('_', ' ')} applicant does not clearly match the listed applicant types (${check.values.join('; ')}); someone should confirm.`, factsUsed: ['applicantType'], missingFacts: [] };
    }

    case 'document_required': {
      const isBca = requirement.topic === 'benefit_cost_analysis' || /benefit|bca/i.test(check.documentKey);
      if (!isBca) return null; // no fact exists for other documents: they are checklist items
      const scope = situationFor({ area: 'any', category: requirement.programVariant === 'capital' || requirement.programVariant === 'planning' ? requirement.programVariant : 'any' }, facts);
      if (scope.result === 'not_applicable') return { applicability: 'not_applicable', status: 'unknown', gap: false, explanation: scope.reason ?? '', factsUsed: scope.used, missingFacts: [] };
      const done = facts.bcaCompleted?.value;
      if (done === undefined) return unknown('Need to know whether a benefit-cost analysis has been completed.', ['bcaCompleted', ...scope.missing], scope.used);
      const used: FactKey[] = [...scope.used, 'bcaCompleted'];
      if (scope.result === 'undetermined') return unknown('A benefit-cost analysis is required for some project types; it is not yet known whether this one is covered.', scope.missing, used);
      return done
        ? { applicability: 'applies', status: 'supported', gap: false, explanation: 'The applicant reports a benefit-cost analysis is complete (its content is not assessed here).', factsUsed: used, missingFacts: [] }
        : { applicability: 'applies', status: 'conflict', gap: true, explanation: 'A benefit-cost analysis is required but has not been done yet: an application preparation gap, not a disqualifier.', factsUsed: used, missingFacts: [] };
    }
  }
}
