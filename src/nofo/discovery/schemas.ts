import { z } from 'zod';

/**
 * Project profile for grant discovery. Deliberately small: only what can change a search or a ranking.
 * Everything here comes from the applicant's own words (each value carries a verbatim quote that code
 * verified); nothing is inferred. Search `terms` are the one exception: they are search hints, not
 * facts, so they are sanitized in code instead of quoted.
 */

export const PROJECT_TYPES = [
  'bridge',
  'roadway',
  'safety',
  'bike_ped',
  'transit',
  'rail',
  'freight_port',
  'aviation',
  'wildlife_connectivity',
  'resilience',
  'planning',
  'technology',
  'other',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  bridge: 'Bridge',
  roadway: 'Roadway / highway',
  safety: 'Safety',
  bike_ped: 'Bicycle / pedestrian',
  transit: 'Transit',
  rail: 'Rail',
  freight_port: 'Freight / port',
  aviation: 'Aviation',
  wildlife_connectivity: 'Wildlife crossing / connectivity',
  resilience: 'Resilience / disaster',
  planning: 'Planning',
  technology: 'Technology / ITS',
  other: 'Other',
};

export const DISCOVERY_APPLICANT_TYPES = ['state', 'county', 'city_or_township', 'special_district', 'tribal', 'mpo', 'other'] as const;
export type DiscoveryApplicantType = (typeof DISCOVERY_APPLICANT_TYPES)[number];

export const DISCOVERY_PHASES = ['planning', 'design', 'construction_ready'] as const;
export type DiscoveryPhase = (typeof DISCOVERY_PHASES)[number];

const quoted = <T extends z.ZodTypeAny>(value: T) => z.object({ value, quote: z.string().min(1).max(1000) }).strict();

export const ProjectProfileSchema = z
  .object({
    projectTypes: z.array(quoted(z.enum(PROJECT_TYPES))).max(4),
    applicantType: quoted(z.enum(DISCOVERY_APPLICANT_TYPES)).optional(),
    phase: quoted(z.enum(DISCOVERY_PHASES)).optional(),
    /** What they plan to ask for. Never the total project cost. */
    federalAskUsd: quoted(z.number().positive().max(1e11)).optional(),
    totalCostUsd: quoted(z.number().positive().max(1e11)).optional(),
    stateName: quoted(z.string().min(1).max(100)).optional(),
    /** Sanitized search hints (see sanitizeTerms). Not facts. */
    terms: z.array(z.string().min(2).max(40)).max(6),
  })
  .strict();
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

export const EMPTY_PROFILE: ProjectProfile = { projectTypes: [], terms: [] };

// ---------------------------------------------------------------------------
// Request / response
// ---------------------------------------------------------------------------

export const MAX_USER_MESSAGES = 6;

export const DiscoverInputSchema = z
  .object({
    /** The applicant's messages only (the app writes the other side in code). */
    messages: z
      .array(z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(4000) }).strict())
      .min(1)
      .max(MAX_USER_MESSAGES),
    /** Also search closed and archived opportunities (labeled historical). */
    includeHistorical: z.boolean().optional(),
    /** "Show grants now": never ask, search with what is known. */
    forceResults: z.boolean().optional(),
    /** Also return the exact Simpler.Grants.gov requests and responses, for inspection. */
    inspect: z.boolean().optional(),
  })
  .strict();
export type DiscoverInput = z.infer<typeof DiscoverInputSchema>;

export interface ShortlistItem {
  opportunityId: string;
  opportunityNumber: string | null;
  title: string;
  agency: string | null;
  status: string;
  /** True for closed or archived opportunities. */
  historical: boolean;
  closeDate: string | null;
  postDate: string | null;
  awardCeiling: number | null;
  awardFloor: number | null;
  isCostSharing: boolean | null;
  applicantTypes: string[];
  /** 'likely' = a project term matched or the category fits; 'weaker' = closest remaining. */
  match: 'likely' | 'weaker';
  /** Written by code from API fields. */
  whyItMayFit: string[];
  watchOuts: string[];
  /** Earlier or other editions of the same program that were folded into this entry. */
  otherEditions: number;
  additionalInfoUrl: string | null;
  /** The opportunity's page on Simpler.Grants.gov (built from its ID, never from listing text). */
  simplerUrl: string | null;
  /**
   * Filled in by the web route (not the service): true when this server already holds extracted
   * requirements for the opportunity, so it can be opened in the Assess tab.
   */
  readyToAssess?: boolean;
}

export type { ProgressEvent } from '../progress.js';

export interface FilterNote {
  /** Plain-language description of one search that was run. */
  label: string;
  detail: string;
  records: number | null;
}

/** One Simpler.Grants.gov search as it really happened. Contains no credentials: the key is a header and is never recorded. */
export interface SearchInspection {
  /** Which search this was (open_all, historical_recent, keywords, beyond_dot). */
  planId: string;
  label: string;
  /** The JSON body that was POSTed to /v1/opportunities/search. */
  request: unknown;
  /** The JSON body that came back, exactly as received. Null when the search failed. */
  response: unknown;
  ok: boolean;
  /** Set when the search failed. Safe to show. */
  error: string | null;
  /** True when no request was sent because a recent identical search was reused. */
  cached: boolean;
  elapsedMs: number;
  /** Listings in this response / the API's total for the query / listings that did not fit the expected shape. */
  returned: number;
  totalRecords: number | null;
  skipped: number;
}

export interface DiscoverResult {
  preliminary: true;
  stage: 'ask' | 'results';
  /** The facts understood so far, each with the applicant's own words. */
  profile: ProjectProfile;
  /** stage "ask": exactly one required question. stage "results": up to two optional refinements. */
  questions: string[];
  shortlist: ShortlistItem[];
  searches: FilterNote[];
  /** Plain-language summary of what was found, written by code. */
  summary: string;
  warnings: string[];
  includeHistorical: boolean;
  disclaimer: string;
  /** Present only when the request asked to inspect the Simpler.Grants.gov traffic. */
  inspection?: SearchInspection[];
}

export const DISCOVERY_DISCLAIMER =
  'Preliminary starting point only. This list is built from public Simpler.Grants.gov listings and what you told us. It is not an eligibility determination, a recommendation, or a prediction of success. Check each notice of funding opportunity before deciding.';
