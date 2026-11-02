import { hasValue } from './field-paths.js';
import type { Profile, ReadinessAssessment } from './schemas.js';

export const READINESS_RULE_VERSION = 1;

interface RequiredItem {
  key: string;
  label: string;
  complete: (p: Profile) => boolean;
  /** Paths that, if listed in `unknowns`, make a missing item "unknown" rather than "missing". */
  paths: string[];
}

/** The six completeness items from the plan (§5). Values only exist if a user supplied or accepted them. */
export const REQUIRED_ITEMS: RequiredItem[] = [
  { key: 'name', label: 'Project name', complete: (p) => hasValue(p, 'name'), paths: ['name'] },
  {
    key: 'applicant.type',
    label: 'Applicant type',
    complete: (p) => p.applicant.type !== null,
    paths: ['applicant.type'],
  },
  {
    key: 'location',
    label: 'Location (state plus service area, city or county)',
    complete: (p) =>
      p.location.state !== null &&
      (p.location.serviceArea !== null || p.location.city !== null || p.location.county !== null),
    paths: ['location.state', 'location.serviceArea', 'location.city', 'location.county'],
  },
  { key: 'need.problem', label: 'Problem statement', complete: (p) => hasValue(p, 'need.problem'), paths: ['need.problem'] },
  {
    key: 'scope.activities',
    label: 'At least one activity',
    complete: (p) => p.scope.activities.length > 0,
    paths: ['scope.activities'],
  },
  {
    key: 'outcomes',
    label: 'At least one outcome',
    complete: (p) => p.outcomes.some((o) => o.description.trim().length > 0),
    paths: ['outcomes'],
  },
];

export const REQUIRED_COUNT = REQUIRED_ITEMS.length;

/** Budget and readiness items that produce separate warnings (never block completeness). */
const WARNING_PATHS: Array<{ path: string; label: string }> = [
  { path: 'budget.totalCostCents', label: 'Total cost' },
  { path: 'budget.matchAmountCents', label: 'Match amount' },
  { path: 'readiness.planningStatus', label: 'Planning status' },
  { path: 'readiness.designStatus', label: 'Design status' },
  { path: 'readiness.environmentalStatus', label: 'Environmental status' },
  { path: 'readiness.rightOfWayStatus', label: 'Right-of-way status' },
];

/** Deterministic, server-side completeness. Recomputed after every accepted mutation. */
export function computeReadiness(profile: Profile): ReadinessAssessment {
  const unknowns = new Set(profile.unknowns);
  let completeCount = 0;
  const missingFields: ReadinessAssessment['missingFields'] = [];

  for (const item of REQUIRED_ITEMS) {
    if (item.complete(profile)) {
      completeCount++;
    } else {
      missingFields.push({
        key: item.key,
        label: item.label,
        state: item.paths.some((p) => unknowns.has(p)) ? 'unknown' : 'missing',
      });
    }
  }

  const warnings: ReadinessAssessment['warnings'] = [];
  for (const w of WARNING_PATHS) {
    if (!hasValue(profile, w.path)) {
      warnings.push({
        code: w.path,
        message: unknowns.has(w.path) ? `${w.label} is marked unknown` : `${w.label} has not been provided`,
      });
    }
  }

  return {
    ruleVersion: READINESS_RULE_VERSION,
    completeCount,
    requiredCount: REQUIRED_COUNT,
    missingFields,
    warnings,
  };
}
