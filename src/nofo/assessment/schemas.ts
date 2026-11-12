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
  'onNoticeList',
  'statedGaps',
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
    /**
     * Whether the applicant says its organization or state is one of the specific ones the notice names, lists or
     * selects. Never inferred from the applicant type or a place name.
     */
    onNoticeList: fact(z.boolean()).optional(),
    /** Things the applicant says it does NOT have or has NOT done (records, certifications, approvals, plans, staff). */
    statedGaps: fact(z.array(z.string().min(1).max(200)).max(30)).optional(),
  })
  .strict();
export type ProjectFacts = z.infer<typeof ProjectFactsSchema>;

// ---------------------------------------------------------------------------
// Answers to detail questions (questions made from the notice's own requirements)
// ---------------------------------------------------------------------------

/** The extractor's id (`req-` and eight hex digits), with the `-2`, `-3`… it adds when two requirements would otherwise collide. */
export const REQUIREMENT_ID_PATTERN = /^req-[0-9a-f]{4,16}(-\d{1,3})?$/;
const requirementId = z.string().regex(REQUIREMENT_ID_PATTERN);

/** What kind of question a detail question is; the model chooses the one that fits the requirement, code checks it. */
export const DETAIL_TYPES = ['yes_no', 'choice', 'number', 'describe'] as const;
export type DetailType = (typeof DETAIL_TYPES)[number];

/**
 * How a detail question is asked and how an answer to it counts. A choice lists 2 to 4 options, each marked beforehand as
 * meeting the requirement, not meeting it, or unclear; a number question carries the comparison the requirement itself
 * states (code re-checks that its number is in the requirement's own text); yes/no and describe need nothing more.
 */
export const DetailSpecSchema = z
  .object({
    type: z.enum(DETAIL_TYPES),
    /** One short sentence on why this kind of question fits (shown to the person). */
    reason: z.string().max(200).optional(),
    options: z.array(z.object({ label: z.string().min(1).max(80), outcome: z.enum(['meets', 'does_not_meet', 'unclear']) }).strict()).min(2).max(4).optional(),
    comparison: z
      .object({ op: z.enum(['at_most', 'at_least', 'exactly']), value: z.number().finite().min(0).max(1e12), unit: z.string().max(30).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type DetailSpec = z.infer<typeof DetailSpecSchema>;

/**
 * What the applicant said to one detail question: yes (they meet what the requirement asks), no, not sure, or (for a choice,
 * a number or a description) the answer itself. It is the applicant's own statement with the words that show it, never
 * checked against the notice. `covers` lists the requirements the question stood for (the question's own requirement, or
 * the related checklist items it grouped).
 */
export const DetailAnswerSchema = z
  .object({
    answer: z.enum(['yes', 'no', 'unsure', 'answered']),
    kind: z.enum(DETAIL_TYPES).optional(),
    /** A choice: the index of the option chosen. */
    option: z.number().int().min(0).max(3).optional(),
    /** A number question: the number the applicant gave. */
    number: z.number().finite().min(0).max(1e12).optional(),
    /** A description: the applicant's own words. */
    text: z.string().max(1000).optional(),
    /** How the question was asked, so the answer can be counted on later turns. */
    spec: DetailSpecSchema.optional(),
    quote: z.string().max(1000).optional(),
    /** The question as the applicant saw it, kept so a finding can quote it on later turns (display only). */
    question: z.string().max(600).optional(),
    covers: z.array(requirementId).min(1).max(12),
    turn: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type DetailAnswer = z.infer<typeof DetailAnswerSchema>;

export const DetailAnswersSchema = z
  .record(requirementId, DetailAnswerSchema)
  .refine((all) => Object.keys(all).length <= 40, { message: 'too many answers' });
export type DetailAnswers = z.infer<typeof DetailAnswersSchema>;

/** A detail question the page was shown, sent back with the next message so the reply can be read as an answer to it. */
export const AskedDetailSchema = z
  .object({
    id: requirementId,
    covers: z.array(requirementId).min(1).max(12),
    /** The question text the page showed (untrusted, display and context only). */
    question: z.string().max(600).optional(),
    /** How the question was asked (re-checked against the requirement's text before it is used). */
    spec: DetailSpecSchema.optional(),
    /**
     * False for a requirement the page only listed in the Answers drawer (not asked in the conversation): it can still be
     * answered, but a bare "yes" is never read as an answer to it. Absent means it was asked.
     */
    shown: z.boolean().optional(),
  })
  .strict();
export type AskedDetail = z.infer<typeof AskedDetailSchema>;

export const ChatMessageSchema = z
  .object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AssessInputSchema = z
  .object({
    opportunityId: z.string().max(100),
    messages: z.array(ChatMessageSchema).min(1).max(40),
    facts: z.unknown().optional(),
    /** false = re-assess the given facts without reading facts from the latest message again. */
    readMessage: z.boolean().optional(),
    /**
     * Facts the applicant said they do not know yet ("I don't know yet"). No question is asked about them; the
     * requirements waiting on them stay unknown (never a pass, never a fail).
     */
    skipFacts: z.array(z.enum(FACT_KEYS)).max(FACT_KEYS.length).optional(),
    /** Answers to detail questions given so far (carried by the page, like `facts`). */
    answers: DetailAnswersSchema.optional(),
    /** The detail questions shown with the last result: the latest message is read as an answer to them. */
    asked: z.array(AskedDetailSchema).max(80).optional(),
    /** Detail questions the applicant said they do not know yet: not asked again. */
    skipDetails: z.array(requirementId).max(40).optional(),
    /** The stage (1 to 3) of questions the applicant was last asked; 0 or absent for none. At most three stages are asked. */
    round: z.number().int().min(0).max(3).optional(),
    /** The status of each finding at the last result, so this turn can say what changed. */
    previous: z
      .record(requirementId, z.enum(['supported', 'conflict', 'unknown', 'needs_specialist_review']))
      .refine((all) => Object.keys(all).length <= 300, { message: 'too many statuses' })
      .optional(),
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
  /**
   * deterministic = plain code on stated numbers/facts; llm = model interpretation; answer = the applicant's own yes or no
   * to a detail question made from this requirement (their statement, not checked); none = nothing to evaluate yet.
   */
  method: 'deterministic' | 'llm' | 'answer' | 'none';
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
  /** Which group of facts this asks for; `detail:<requirement id>` for a question made from a requirement. */
  group: string;
  /** 'fact' = a fixed template over a fact the app reads; 'detail' = a yes/no question made from the notice's own requirement. */
  kind?: 'fact' | 'detail';
  factKeys: FactKey[];
  /** For a detail question: the requirements an answer stands for. */
  requirementIds?: string[];
  /** For a detail question: the category of its requirement (eligibility, funding, readiness, application). */
  category?: string;
  /** For a detail question: what kind of question it is, why, its options (choice) and how an answer is counted. */
  answerType?: DetailType;
  reason?: string;
  options?: string[];
  spec?: DetailSpec;
  text: string;
  /** The requirements that make the answer matter, with their evidence. */
  because: Array<{ requirementId: string; title: string; source: FindingSource | null }>;
}
