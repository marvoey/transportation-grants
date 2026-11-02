import { z } from 'zod';
import { VALID_APPLICANT_TYPES } from '../config/constants.js';

/**
 * Validator for search_dot_grants parameters
 */
export const SearchGrantsSchema = z.object({
  applicantType: z.enum(['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency']).optional(),
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  keywords: z.string().optional(),
  deadlineAfter: z.string().optional(), // ISO date or MM/DD/YYYY
  deadlineBefore: z.string().optional(), // ISO date or MM/DD/YYYY
}).refine(
  (data) => !data.minAmount || !data.maxAmount || data.minAmount <= data.maxAmount,
  {
    message: 'minAmount must be less than or equal to maxAmount',
    path: ['minAmount'],
  }
);

export type SearchGrantsParams = z.infer<typeof SearchGrantsSchema>;

/**
 * Validator for get_grant_details parameters
 */
export const GetGrantDetailsSchema = z.object({
  opportunityId: z.string().optional(),
  programNumber: z.string().optional(),
}).refine(
  (data) => data.opportunityId || data.programNumber,
  {
    message: 'Either opportunityId or programNumber must be provided',
    path: ['opportunityId'],
  }
);

export type GetGrantDetailsParams = z.infer<typeof GetGrantDetailsSchema>;

/**
 * Validator for check_eligibility parameters
 */
export const CheckEligibilitySchema = z.object({
  applicantType: z.enum(['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency']),
  opportunityId: z.string().optional(),
  programNumber: z.string().optional(),
});

export type CheckEligibilityParams = z.infer<typeof CheckEligibilitySchema>;

/**
 * Validator for track_upcoming_deadlines parameters
 */
export const TrackDeadlinesSchema = z.object({
  daysAhead: z.number().int().positive().max(365).optional().default(30),
  applicantType: z.enum(['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency']).optional(),
});

export type TrackDeadlinesParams = z.infer<typeof TrackDeadlinesSchema>;

/**
 * Validator for POST /api/chat request body
 */
export const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ).min(1),
  /** Optional saved project to use as read-only context. Ownership is resolved server-side. */
  projectId: z.string().uuid().optional(),
});

export type ChatRequestParams = z.infer<typeof ChatRequestSchema>;

/**
 * Helper to validate and parse parameters
 */
export function validateParams<T>(
  schema: z.ZodSchema<T>,
  params: unknown
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = schema.parse(params);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return {
        success: false,
        error: `Validation error: ${messages.join(', ')}`,
      };
    }
    return {
      success: false,
      error: `Validation error: ${(error as Error).message}`,
    };
  }
}
