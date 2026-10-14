export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Shared tool definitions, reused by the MCP server (src/server.ts) and
 * by the web chat route (src/web/routes/chat.ts) which maps `inputSchema`
 * to Anthropic's `input_schema` key.
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'search_dot_grants',
    description:
      'Search for U.S. Department of Transportation grant opportunities. Filter by applicant type (state, city, county, tribal, mpo, transit_agency), funding amount, keywords, and deadline dates. Returns a list of matching grant opportunities with basic information.',
    inputSchema: {
      type: 'object',
      properties: {
        applicantType: {
          type: 'string',
          enum: ['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency'],
          description:
            'Type of applicant organization (state, city, county, tribal government, MPO, or transit agency)',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum grant amount in dollars',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum grant amount in dollars',
        },
        keywords: {
          type: 'string',
          description: 'Keywords to search in grant titles and descriptions',
        },
        deadlineAfter: {
          type: 'string',
          description: 'Only include grants with deadlines after this date (ISO format or MM/DD/YYYY)',
        },
        deadlineBefore: {
          type: 'string',
          description: 'Only include grants with deadlines before this date (ISO format or MM/DD/YYYY)',
        },
      },
    },
  },
  {
    name: 'get_grant_details',
    description:
      'Get comprehensive details about a specific DOT grant program or opportunity. Includes eligibility requirements, application procedures, deadlines, contact information, matching requirements, and compliance information. Provide either an opportunityId (from SAM.gov) or a programNumber (CFDA code like "20.205").',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'SAM.gov opportunity/notice ID',
        },
        programNumber: {
          type: 'string',
          description: 'CFDA program number (e.g., "20.205" for Highway Planning and Construction)',
        },
      },
    },
  },
  {
    name: 'check_eligibility',
    description:
      'Check if a specific applicant type is eligible for DOT grant programs. Returns eligibility status (eligible, conditional, not_eligible) with reasoning and requirements. Can check all DOT programs or a specific program by opportunityId or programNumber.',
    inputSchema: {
      type: 'object',
      properties: {
        applicantType: {
          type: 'string',
          enum: ['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency'],
          description: 'Type of applicant organization',
        },
        opportunityId: {
          type: 'string',
          description: 'Optional: Check eligibility for a specific opportunity',
        },
        programNumber: {
          type: 'string',
          description: 'Optional: Check eligibility for a specific program (CFDA code)',
        },
      },
      required: ['applicantType'],
    },
  },
  {
    name: 'track_upcoming_deadlines',
    description:
      'Get a list of DOT grant opportunities with upcoming deadlines, sorted by deadline (soonest first). Optionally filter by applicant type to see only relevant opportunities.',
    inputSchema: {
      type: 'object',
      properties: {
        daysAhead: {
          type: 'number',
          description: 'Number of days ahead to look for deadlines (default: 30, max: 365)',
          default: 30,
        },
        applicantType: {
          type: 'string',
          enum: ['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency'],
          description: 'Optional: Filter by applicant type',
        },
      },
    },
  },
];
