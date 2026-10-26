export type Intent = 'search' | 'eligibility' | 'deadlines' | 'details' | 'general';

/**
 * Tools the retrieval agent is allowed to call for each classified intent.
 * Keeps each retrieval call scoped to only what that intent needs.
 */
export const INTENT_TOOLS: Record<Intent, string[]> = {
  search: ['search_dot_grants', 'get_grant_details'],
  eligibility: ['check_eligibility', 'get_grant_details'],
  deadlines: ['track_upcoming_deadlines'],
  details: ['get_grant_details'],
  general: [],
};
