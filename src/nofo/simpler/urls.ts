import { UUID_PATTERN } from '../schemas.js';

/**
 * The public page for an opportunity on Simpler.Grants.gov. Checked against the live site on 2026-11-05: the
 * pattern returns the opportunity (page title "Opportunity Listing - <title>") for real IDs and a 404 page for an
 * unknown one. The site, not this API, owns the pattern, so treat it as a convenience link and re-check it if
 * links ever stop working.
 */
export const SIMPLER_OPPORTUNITY_PAGE = 'https://simpler.grants.gov/opportunity/';

/** The page URL for an opportunity UUID, or null if the ID is not a UUID (so nothing odd is ever put in a link). */
export function simplerOpportunityUrl(opportunityId: string): string | null {
  const id = String(opportunityId).toLowerCase();
  return UUID_PATTERN.test(id) ? `${SIMPLER_OPPORTUNITY_PAGE}${id}` : null;
}
