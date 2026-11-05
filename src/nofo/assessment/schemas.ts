import { z } from 'zod';
import type { Authority } from '../schemas.js';
import type { RequirementCategory } from '../extraction/schemas.js';

/**
 * Project facts and assessment results.
 *
 * Facts are what the applicant has told us in conversation. There is no
 * project-profile form: the facts live in the conversation and are carried by
 * the client from turn to turn. Everything read from a client is validated.
 */

export const APPLICANT_TYPES = ['state', 'city', 'county', 'tribal', 'mpo', 'transit_agency', 'other'] as const;

const fact = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value,
      /** Only what the user said. Nothing is inferred or assumed into a fact. */
      provenance: z.literal('user'),
      /** The user's own words that support this value (verified to appear in a user message). */
      quote: z.string().max(1000).optional(),
      turn: z.number().int().min(0).max(1000).optional(),
    })
    .strict();

const money = z.number().finite().min(0).max(1e12);

export const FACT_KEYS = [
  'applicantType',
  'stateName',
  'grantCategory',
  'areaType',
  'totalProjectCostUsd',
  'requestedFederalUsd',
  'otherFederalFundsUsd',
  'nonFederalMatchUsd',
  'matchCommitted',
  'bcaCompleted',
  'projectDescription',
  'activities',
  'designStatus',
  'environmentalStatus',
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const ProjectFactsSchema = z
  .object({
    applicantType: fact(z.enum(APPLICANT_TYPES)).optional(),
    stateName: fact(z.string().min(1).max(100)).optional(),
    grantCategory: fact(z.enum(['capital', 'planning'])).optional(),
    areaType: fact(z.enum(['urban', 'rural'])).optional(),
    /** Total future eligible project cost. NOT the federal request. */
    totalProjectCostUsd: fact(money).optional(),
    /** The amount requested from the program. NOT the total project cost. */
    requestedFederalUsd: fact(money).optional(),
    otherFederalFundsUsd: fact(money).optional(),
    nonFederalMatchUsd: fact(money).optional(),
    matchCommitted: fact(z.boolean()).optional(),
    bcaCompleted: fact(z.boolean()).optional(),
    projectDescription: fact(z.string().min(1).max(2000)).optional(),
    activities: fact(z.array(z.string().min(1).max(200)).max(30)).optional(),
    designStatus: fact(z.string().min(1).max(500)).optional(),
    environmentalStatus: fact(z.string().min(1).max(500)).optional(),
  })
  .strict();
export type ProjectFacts = z.infer<typeof ProjectFactsSchema>;

export const ChatMessageSchema = z
  .object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AssessInputSchema = z
  .object({
    opportunityId: z.string().max(100),
    messages: z.array(ChatMessageSchema).min(1).max(40),
    facts: z.unknown().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type FindingStatus = 'supported' | 'conflict' | 'unknown' | 'needs_specialist_review';

export interface FindingSource {
  documentId: string;
  page: number | null;
  section: string | null;
  quote: string;
  authority: Authority;
}

export interface Finding {
  requirementId: string;
  title: string;
  category: RequirementCategory;
  topic: string;
  mandatory: boolean | null;
  status: FindingStatus;
  /**
   * True when a required deliverable is known not to exist yet (for example a benefit-cost analysis that has
   * not been done). Shown as a preparation gap, not as an eligibility conflict.
   */
  gap: boolean;
  /** deterministic = plain code on stated numbers/facts; llm = model interpretation; none = nothing to evaluate yet. */
  method: 'deterministic' | 'llm' | 'none';
  /**
   * True unless a human has verified the underlying requirement AND the result is deterministic. Every model
   * judgment is provisional, and so is anything resting on an unreviewed requirement.
   */
  provisional: boolean;
  explanation: string;
  factsUsed: FactKey[];
  /** Facts that, if provided, would let this requirement be evaluated. Drives the follow-up questions. */
  missingFacts: FactKey[];
  sources: FindingSource[];
  requirementReviewStatus: 'unreviewed' | 'verified' | 'needs_review';
}

export interface NotApplicable {
  requirementId: string;
  title: string;
  reason: string;
}

export interface Question {
  /** Which group of facts this asks for. */
  group: string;
  factKeys: FactKey[];
  text: string;
  /** The requirements that make the answer matter, with their evidence. */
  because: Array<{ requirementId: string; title: string; source: FindingSource | null }>;
}
