import { GrantServerError } from '../types/index.js';
import {
  SearchGrantsSchema,
  GetGrantDetailsSchema,
  CheckEligibilitySchema,
  TrackDeadlinesSchema,
  validateParams,
} from '../utils/validators.js';
import { searchDOTGrants } from '../tools/search-grants.js';
import { getGrantDetails } from '../tools/grant-details.js';
import { checkEligibility } from '../tools/eligibility.js';
import { trackUpcomingDeadlines } from '../tools/deadlines.js';

/**
 * Shared dispatch for the 4 tools, reused by the MCP server
 * (src/server.ts) and the web chat route (src/web/routes/chat.ts).
 */
export async function executeTool(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case 'search_dot_grants': {
      const validation = validateParams(SearchGrantsSchema, args);
      if (!validation.success) {
        throw new GrantServerError('VALIDATION_ERROR', validation.error, false);
      }
      return searchDOTGrants(validation.data);
    }

    case 'get_grant_details': {
      const validation = validateParams(GetGrantDetailsSchema, args);
      if (!validation.success) {
        throw new GrantServerError('VALIDATION_ERROR', validation.error, false);
      }
      return getGrantDetails(validation.data);
    }

    case 'check_eligibility': {
      const validation = validateParams(CheckEligibilitySchema, args);
      if (!validation.success) {
        throw new GrantServerError('VALIDATION_ERROR', validation.error, false);
      }
      return checkEligibility(validation.data);
    }

    case 'track_upcoming_deadlines': {
      const validation = validateParams(TrackDeadlinesSchema, args);
      if (!validation.success) {
        throw new GrantServerError('VALIDATION_ERROR', validation.error, false);
      }
      const params = {
        ...validation.data,
        daysAhead: validation.data.daysAhead ?? 30,
      };
      return trackUpcomingDeadlines(params);
    }

    default:
      throw new GrantServerError('NOT_FOUND', `Unknown tool: ${name}`, false);
  }
}
