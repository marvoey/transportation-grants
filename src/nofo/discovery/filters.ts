import type { SearchRequestBody, SearchStatus } from '../simpler/search.js';
import { buildQuery } from './profile.js';
import type { ProjectProfile } from './schemas.js';

/**
 * Turns a project profile into Simpler.Grants.gov searches.
 *
 * What live probing showed (2026-11-04), and what this file does about it:
 * - Only 11 DOT opportunities were open (posted or forecasted), so pulling ALL of them is cheap and
 *   is always done. A keyword-only search misses broad programs: "bridge" matched none of the 11.
 * - The text query is still the best relevance signal, so a keyword search runs next to the broad pull.
 * - applicant_type, funding_category, award size and cost sharing are NOT hard filters (see
 *   SearchRequestBody); they are scored in rank.ts. Funding category is used only to widen beyond DOT.
 * - The query is capped at 100 characters (HTTP 422 otherwise).
 * - closed/archived DOT records number in the thousands, so historical mode sorts newest-posted first
 *   and adds a keyword search instead of paging through everything.
 */

export const DOT_TOP_LEVEL_AGENCY = 'DOT';
export const OPEN_STATUSES: SearchStatus[] = ['posted', 'forecasted'];
export const HISTORICAL_STATUSES: SearchStatus[] = ['closed', 'archived'];
/** Categories used only when widening beyond DOT. */
export const TRANSPORTATION_CATEGORIES = ['transportation', 'infrastructure_investment_and_jobs_act'];

export type PlanId = 'open_all' | 'historical_recent' | 'keywords' | 'beyond_dot';

export interface SearchPlan {
  id: PlanId;
  /** Plain-language description shown to the user. */
  label: string;
  detail: string;
  body: SearchRequestBody;
}

const page = (pageSize: number, order_by: 'relevancy' | 'post_date' | 'close_date', sort_direction: 'ascending' | 'descending') => ({
  page_offset: 1,
  page_size: pageSize,
  sort_order: [{ order_by, sort_direction }],
});

export interface PlanOptions {
  includeHistorical: boolean;
}

/** Searches that always run for a turn. */
export function primaryPlans(profile: ProjectProfile, options: PlanOptions): SearchPlan[] {
  const plans: SearchPlan[] = [
    {
      id: 'open_all',
      label: 'All open U.S. DOT opportunities',
      detail: 'Agency: U.S. Department of Transportation. Status: posted or forecasted. Soonest deadline first.',
      body: {
        filters: { top_level_agency: { one_of: [DOT_TOP_LEVEL_AGENCY] }, opportunity_status: { one_of: OPEN_STATUSES } },
        pagination: page(50, 'close_date', 'ascending'),
      },
    },
  ];

  if (options.includeHistorical) {
    plans.push({
      id: 'historical_recent',
      label: 'Recent closed and archived U.S. DOT opportunities',
      detail: 'Agency: U.S. Department of Transportation. Status: closed or archived. Most recently posted first (historical, not open for applications).',
      body: {
        filters: { top_level_agency: { one_of: [DOT_TOP_LEVEL_AGENCY] }, opportunity_status: { one_of: HISTORICAL_STATUSES } },
        pagination: page(100, 'post_date', 'descending'),
      },
    });
  }

  const keywords = keywordPlan(profile, options, 'dot');
  if (keywords) plans.push(keywords);
  return plans;
}

/** Runs only when the primary searches leave too few relevant candidates. */
export function wideningPlan(profile: ProjectProfile, options: PlanOptions): SearchPlan | null {
  return keywordPlan(profile, options, 'any_agency');
}

function keywordPlan(profile: ProjectProfile, options: PlanOptions, scope: 'dot' | 'any_agency'): SearchPlan | null {
  const query = buildQuery(profile.terms);
  if (!query) return null;
  const statuses: SearchStatus[] = options.includeHistorical ? [...OPEN_STATUSES, ...HISTORICAL_STATUSES] : OPEN_STATUSES;
  const statusText = options.includeHistorical ? 'any status including closed and archived' : 'posted or forecasted';
  if (scope === 'dot') {
    return {
      id: 'keywords',
      label: `U.S. DOT opportunities matching: ${profile.terms.slice(0, 4).join(', ')}`,
      detail: `Agency: U.S. Department of Transportation. Status: ${statusText}. Any of the words, best text match first.`,
      body: {
        query,
        query_operator: 'OR',
        filters: { top_level_agency: { one_of: [DOT_TOP_LEVEL_AGENCY] }, opportunity_status: { one_of: statuses } },
        pagination: page(25, 'relevancy', 'descending'),
      },
    };
  }
  return {
    id: 'beyond_dot',
    label: `Transportation-tagged opportunities from any agency matching: ${profile.terms.slice(0, 4).join(', ')}`,
    detail: `Any agency. Category: transportation or infrastructure investment. Status: ${statusText}. Any of the words, best text match first.`,
    body: {
      query,
      query_operator: 'OR',
      filters: { opportunity_status: { one_of: statuses }, funding_category: { one_of: TRANSPORTATION_CATEGORIES } },
      pagination: page(25, 'relevancy', 'descending'),
    },
  };
}
