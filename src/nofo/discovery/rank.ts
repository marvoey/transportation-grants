import type { SearchCandidate } from '../simpler/search.js';
import { simplerOpportunityUrl } from '../simpler/urls.js';
import { detectProjectTypes } from './profile.js';
import { PROJECT_TYPE_LABELS, type DiscoveryApplicantType, type ProjectProfile, type ProjectType, type ShortlistItem } from './schemas.js';

/**
 * Transparent ranking. No model is involved: every score comes from a listed signal, and every line
 * shown to the user ("why it may fit", "watch out") is written here from API fields. Applicant type,
 * award size, cost sharing and category are scored, never filtered (see filters.ts for why).
 */

const GENERIC_TERMS = new Set(['infrastructure']);
/** Project types that are a whole mode or topic of their own. Roadway, safety, planning and technology cut across modes, so they are not here. */
const MODE_SPECIFIC = new Set<ProjectType>(['transit', 'rail', 'freight_port', 'aviation', 'bike_ped', 'wildlife_connectivity']);
const DAY_MS = 24 * 60 * 60 * 1000;

const APPLICANT_API_TYPES: Record<DiscoveryApplicantType, string[]> = {
  state: ['state_governments'],
  county: ['county_governments'],
  city_or_township: ['city_or_township_governments'],
  special_district: ['special_district_governments'],
  tribal: ['federally_recognized_native_american_tribal_governments', 'other_native_american_tribal_organizations'],
  mpo: [],
  other: [],
};

const APPLICANT_LABELS: Record<DiscoveryApplicantType, string> = {
  state: 'state governments',
  county: 'county governments',
  city_or_township: 'city or township governments',
  special_district: 'special district governments',
  tribal: 'tribal governments',
  mpo: 'metropolitan planning organizations',
  other: 'your organization type',
};

export interface Ranked {
  candidate: SearchCandidate;
  score: number;
  match: 'likely' | 'weaker';
  historical: boolean;
  why: string[];
  watch: string[];
  family: string;
  /** A program for a different mode than the project's (rail, port, ...). Never used to pad the list. */
  modeConflict: boolean;
}

export interface RankOptions {
  profile: ProjectProfile;
  now: Date;
}

export const money = (n: number): string => {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every word of the term appears (by its first letters, at a word start) in the text. */
function termHits(term: string, text: string): boolean {
  return term.split(' ').every((word) => {
    const stem = word.slice(0, Math.max(4, Math.min(word.length, 6)));
    return new RegExp(`\\b${escapeRe(stem)}`, 'i').test(text);
  });
}

function parseDay(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

const isHistorical = (status: string): boolean => status === 'closed' || status === 'archived';

/** Program "family" so earlier editions (the same title with a different fiscal year) of one program fold into one entry. */
export function familyKey(title: string | null): string {
  return (title ?? '')
    .toLowerCase()
    // "FY25-26", "FYs 2024 through 2026", "Fiscal Years 2024 and 2026": the whole year range goes.
    .replace(/\b(fys?|fiscal years?)\s*'?\d{2,4}(\s*(-|–|through|thru|to|and)\s*(fys?\s*)?'?\d{2,4})*\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function scoreCandidate(candidate: SearchCandidate, options: RankOptions): Ranked {
  const { profile, now } = options;
  const why: string[] = [];
  const watch: string[] = [];
  let score = 0;

  const title = candidate.title ?? '';
  const body = [candidate.purpose, candidate.description].filter(Boolean).join(' ');
  const historical = isHistorical(candidate.status);

  // --- Mode-specific programs (aviation, rail, port, transit...) that are not the user's mode ---
  // A broad word such as "infrastructure" appears in many titles; without this, an airport-tower or
  // port program would look as good for a bridge as a bridge program does.
  const userTypes: ProjectType[] = profile.projectTypes.map((t) => t.value).filter((t) => t !== 'other');
  const candidateModes = detectProjectTypes(`${title} ${candidate.agencyName ?? ''}`);
  const modeConflicts =
    userTypes.length > 0 && !userTypes.some((t) => candidateModes.includes(t))
      ? candidateModes.filter((m) => MODE_SPECIFIC.has(m) && !userTypes.includes(m))
      : [];
  if (modeConflicts.length > 0) {
    score -= 12;
    watch.push(`Focused on ${modeConflicts.map((m) => PROJECT_TYPE_LABELS[m].toLowerCase()).join(' / ')}, which is not what you described`);
  }

  // --- Text match: the main relevance signal -------------------------------------------------
  let termMatched = false;
  let specificMatched = false;
  for (const term of profile.terms) {
    const generic = GENERIC_TERMS.has(term);
    if (termHits(term, title)) {
      score += generic ? 4 : 12;
      termMatched = true;
      if (!generic) specificMatched = true;
      why.push(`"${term}" appears in the title`);
    } else if (body && termHits(term, body)) {
      score += generic ? 2 : 6;
      termMatched = true;
      if (!generic) specificMatched = true;
      why.push(`Its description mentions "${term}"`);
    }
  }

  // --- Category (tags are sometimes wrong, so this is a small nudge) -------------------------
  const categories = candidate.fundingCategories;
  const transportTagged = categories.some((c) => c === 'transportation' || c === 'infrastructure_investment_and_jobs_act');
  if (transportTagged) {
    score += 8;
    why.push('Tagged as a transportation program');
  } else if (categories.length > 0) {
    score -= 4;
  }

  // --- Applicant type (soft: large general-purpose programs list only "other") ---------------
  const types = candidate.applicantTypes;
  const wanted = profile.applicantType ? APPLICANT_API_TYPES[profile.applicantType.value] : [];
  if (profile.applicantType && wanted.length > 0) {
    const label = APPLICANT_LABELS[profile.applicantType.value];
    if (types.some((t) => wanted.includes(t))) {
      score += 6;
      why.push(`Lists ${label} as eligible applicants`);
    } else if (types.includes('unrestricted')) {
      score += 3;
    } else if (types.length > 0 && types.every((t) => t === 'other')) {
      watch.push(`Applicant types are listed only as "other", so check the notice to see whether ${label} can apply`);
    } else if (types.length > 0) {
      score -= 10;
      watch.push(`The listing's applicant types do not include ${label}; check the notice`);
    }
  }

  // --- Status and timing ---------------------------------------------------------------------
  const closeAt = parseDay(candidate.closeDate);
  if (historical) {
    watch.push('Closed or archived: not open for applications. Useful only to see what a past round required');
    if (closeAt !== null) score += now.getTime() - closeAt <= 450 * DAY_MS ? 4 : -4;
  } else if (candidate.status === 'posted') {
    score += 6;
    why.push('Open for applications (posted)');
    if (closeAt !== null) {
      const days = Math.ceil((closeAt - now.getTime()) / DAY_MS);
      if (days < 0) {
        score -= 10;
        watch.push(`The listed close date (${candidate.closeDate}) has passed`);
      } else if (days <= 30) {
        watch.push(`Closes in ${days} day${days === 1 ? '' : 's'} (${candidate.closeDate})`);
      }
    }
  } else if (candidate.status === 'forecasted') {
    score += 2;
    watch.push('Forecasted: not yet open, and details may change');
  }

  // --- Award size against the stated federal request (never against total project cost) ------
  const ask = profile.federalAskUsd?.value;
  if (ask !== undefined) {
    if (candidate.awardCeiling !== null && candidate.awardCeiling > 0) {
      if (candidate.awardCeiling >= ask) {
        score += 4;
        why.push(`Maximum award (${money(candidate.awardCeiling)}) covers your stated request (${money(ask)})`);
      } else {
        score -= 6;
        watch.push(`Maximum award (${money(candidate.awardCeiling)}) is below your stated request (${money(ask)})`);
      }
    }
    if (candidate.awardFloor !== null && candidate.awardFloor > ask) {
      watch.push(`Minimum award (${money(candidate.awardFloor)}) is above your stated request (${money(ask)})`);
    }
  }

  if (candidate.isCostSharing === true) watch.push('The listing says cost sharing or matching funds are required');

  const termsKnown = profile.terms.length > 0;
  // A mode conflict needs a specific (non-generic) term match to stay "likely".
  const match: Ranked['match'] = termsKnown && termMatched && (modeConflicts.length === 0 || specificMatched) ? 'likely' : 'weaker';
  if (match === 'weaker' && termsKnown && transportTagged) why.push('No project keyword matched closely; shown because it is a transportation program');

  return { candidate, score, match, historical, why, watch, family: familyKey(candidate.title), modeConflict: modeConflicts.length > 0 };
}

/** Scores, folds editions of one program into the best entry, and sorts best first. */
export function rankCandidates(candidates: SearchCandidate[], options: RankOptions): Array<Ranked & { otherEditions: number }> {
  const byId = new Map<string, SearchCandidate>();
  for (const c of candidates) if (!byId.has(c.opportunityId)) byId.set(c.opportunityId, c);

  const scored = [...byId.values()].map((c) => scoreCandidate(c, options));
  const families = new Map<string, Ranked[]>();
  for (const r of scored) {
    const key = r.family || r.candidate.opportunityId;
    families.set(key, [...(families.get(key) ?? []), r]);
  }

  const folded = [...families.values()].map((group) => {
    const best = [...group].sort(
      (a, b) => b.score - a.score || (parseDay(b.candidate.closeDate) ?? 0) - (parseDay(a.candidate.closeDate) ?? 0)
    )[0];
    return { ...best, otherEditions: group.length - 1 };
  });
  return folded.sort((a, b) => b.score - a.score || (a.candidate.title ?? '').localeCompare(b.candidate.title ?? ''));
}

/** Count of candidates that matched a project term (used to decide whether to widen the search). */
export const likelyCount = (ranked: Ranked[]): number => ranked.filter((r) => r.match === 'likely').length;

export const SHORTLIST_MAX = 5;
export const SHORTLIST_MIN = 4;

/**
 * Up to five entries: every likely match first, then (only to reach four) the closest transportation
 * programs, marked "weaker". Candidates that neither matched a term nor look like transportation
 * programs are left out entirely rather than padding the list.
 */
export function selectShortlist(ranked: Array<Ranked & { otherEditions: number }>): ShortlistItem[] {
  const likely = ranked.filter((r) => r.match === 'likely');
  const weaker = ranked.filter(
    (r) =>
      r.match === 'weaker' &&
      !r.modeConflict &&
      r.candidate.fundingCategories.some((c) => c === 'transportation' || c === 'infrastructure_investment_and_jobs_act')
  );
  const picked = likely.slice(0, SHORTLIST_MAX);
  if (picked.length < SHORTLIST_MIN) picked.push(...weaker.slice(0, SHORTLIST_MIN - picked.length));
  return picked.map(toItem);
}

function toItem(r: Ranked & { otherEditions: number }): ShortlistItem {
  const c = r.candidate;
  return {
    opportunityId: c.opportunityId,
    opportunityNumber: c.opportunityNumber,
    title: c.title ?? '(untitled)',
    agency: c.agencyName ?? c.agencyCode,
    status: c.status,
    historical: r.historical,
    closeDate: c.closeDate,
    postDate: c.postDate,
    awardCeiling: c.awardCeiling,
    awardFloor: c.awardFloor,
    isCostSharing: c.isCostSharing,
    applicantTypes: c.applicantTypes,
    match: r.match,
    whyItMayFit: r.why,
    watchOuts: r.watch,
    otherEditions: r.otherEditions,
    additionalInfoUrl: c.additionalInfoUrl,
    simplerUrl: simplerOpportunityUrl(c.opportunityId),
  };
}
