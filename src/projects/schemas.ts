import { z } from 'zod';
import { VALID_APPLICANT_TYPES } from '../config/constants.js';
import type { ApplicantType } from '../types/index.js';

/**
 * Runtime schemas (and inferred types) for the project profile. Every write
 * path (PATCH, accepted suggestions, agent output) is validated against these
 * and against the field-path registry in field-paths.ts.
 */

export const SCHEMA_VERSION = 1;

export const LIMITS = {
  name: 120,
  text: 2000,
  item: 200,
  url: 2000,
  listMax: 50,
  changesMax: 50,
  messageMax: 4000,
  idMax: 64,
  numberAbs: 1e12,
} as const;

// ---------------------------------------------------------------------------
// Primitives

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed, non-empty, bounded string without control characters. Unknown is null, never ''. */
export function boundedString(max: number) {
  return z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`)
    .refine((s) => !CONTROL_CHARS.test(s), 'contains control characters');
}

export const ApplicantTypeSchema = z.enum(
  VALID_APPLICANT_TYPES as [ApplicantType, ...ApplicantType[]]
);

export const USPS_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY', 'AS', 'GU', 'MP', 'PR', 'VI',
] as const;

export const StateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(USPS_CODES));

export const PHASES = ['planning', 'design', 'environmental', 'construction', 'operations'] as const;
export const MODES = [
  'road', 'transit', 'bike_ped', 'rail', 'freight', 'aviation', 'port', 'other',
] as const;
export const READINESS_STATUSES = ['not_started', 'in_progress', 'complete', 'not_applicable'] as const;

export const PhaseSchema = z.enum(PHASES);
export const ModeSchema = z.enum(MODES);
export const ReadinessStatusSchema = z.enum(READINESS_STATUSES);

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(isRealDate, 'is not a real calendar date');

/** Whole US cents; a safe nonnegative integer. Zero is a real value, distinct from null (unknown). */
export const CentsSchema = z.number().int().safe().min(0);

export const HttpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.url)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http or https URL');

const MetricNumber = z.number().finite().min(-LIMITS.numberAbs).max(LIMITS.numberAbs);
const IdSchema = z.string().min(1).max(LIMITS.idMax);

// ---------------------------------------------------------------------------
// Profile

export const EvidenceSchema = z
  .object({
    id: IdSchema,
    description: boundedString(LIMITS.text),
    sourceUrl: HttpUrlSchema.nullable(),
    suppliedBy: z.enum(['user', 'agent']),
    /** Read-only in MVP: no verification workflow exists. */
    verified: z.literal(false),
  })
  .strict();

export const OutcomeSchema = z
  .object({
    id: IdSchema,
    description: boundedString(LIMITS.text),
    metric: boundedString(LIMITS.item).nullable(),
    baseline: MetricNumber.nullable(),
    target: MetricNumber.nullable(),
    unit: boundedString(LIMITS.item).nullable(),
  })
  .strict();

export const MilestoneSchema = z
  .object({
    id: IdSchema,
    name: boundedString(LIMITS.item),
    date: IsoDateSchema.nullable(),
  })
  .strict();

export const AssumptionSchema = z
  .object({
    id: IdSchema,
    text: boundedString(LIMITS.text),
    confirmed: z.boolean(),
  })
  .strict();

const stringList = (item: z.ZodTypeAny) => z.array(item).max(LIMITS.listMax);

export const ProfileObjectSchema = z
  .object({
    name: boundedString(LIMITS.name),
    summary: boundedString(LIMITS.text).nullable(),
    applicant: z
      .object({
        name: boundedString(LIMITS.item).nullable(),
        type: ApplicantTypeSchema.nullable(),
        partners: stringList(boundedString(LIMITS.item)),
      })
      .strict(),
    location: z
      .object({
        state: StateCodeSchema.nullable(),
        county: boundedString(LIMITS.item).nullable(),
        city: boundedString(LIMITS.item).nullable(),
        serviceArea: boundedString(LIMITS.item).nullable(),
      })
      .strict(),
    need: z
      .object({
        problem: boundedString(LIMITS.text).nullable(),
        evidence: z.array(EvidenceSchema).max(LIMITS.listMax),
        beneficiaries: stringList(boundedString(LIMITS.item)),
      })
      .strict(),
    scope: z
      .object({
        modes: stringList(ModeSchema),
        activities: stringList(boundedString(LIMITS.item)),
        assets: stringList(boundedString(LIMITS.item)),
        phase: PhaseSchema.nullable(),
      })
      .strict(),
    outcomes: z.array(OutcomeSchema).max(LIMITS.listMax),
    budget: z
      .object({
        currency: z.literal('USD'),
        totalCostCents: CentsSchema.nullable(),
        requestedFundingCents: CentsSchema.nullable(),
        matchAmountCents: CentsSchema.nullable(),
        matchSources: stringList(boundedString(LIMITS.item)),
        estimateBasis: boundedString(LIMITS.text).nullable(),
      })
      .strict(),
    schedule: z
      .object({
        startDate: IsoDateSchema.nullable(),
        endDate: IsoDateSchema.nullable(),
        milestones: z.array(MilestoneSchema).max(LIMITS.listMax),
      })
      .strict(),
    readiness: z
      .object({
        planningStatus: ReadinessStatusSchema.nullable(),
        designStatus: ReadinessStatusSchema.nullable(),
        environmentalStatus: ReadinessStatusSchema.nullable(),
        rightOfWayStatus: ReadinessStatusSchema.nullable(),
      })
      .strict(),
    constraints: stringList(boundedString(LIMITS.item)),
    /** Allowlisted field paths the user said they do not know (checked by validateProfile). */
    unknowns: stringList(z.string().max(100)),
    assumptions: z.array(AssumptionSchema).max(LIMITS.listMax),
  })
  .strict();

/** Profile plus the cross-field rules. */
export const ProfileSchema = ProfileObjectSchema.superRefine((p, ctx) => {
  const { startDate, endDate } = p.schedule;
  if (startDate && endDate && endDate < startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule', 'endDate'],
      message: 'end date cannot precede start date',
    });
  }
  const { totalCostCents: total, requestedFundingCents: requested, matchAmountCents: match } = p.budget;
  if (total !== null && requested !== null && requested > total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['budget', 'requestedFundingCents'],
      message: 'requested funding cannot exceed total cost',
    });
  }
  if (total !== null && match !== null && match > total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['budget', 'matchAmountCents'],
      message: 'match amount cannot exceed total cost',
    });
  }
});

export type Profile = z.infer<typeof ProfileObjectSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Assumption = z.infer<typeof AssumptionSchema>;

export function emptyProfile(name: string): Profile {
  return {
    name,
    summary: null,
    applicant: { name: null, type: null, partners: [] },
    location: { state: null, county: null, city: null, serviceArea: null },
    need: { problem: null, evidence: [], beneficiaries: [] },
    scope: { modes: [], activities: [], assets: [], phase: null },
    outcomes: [],
    budget: {
      currency: 'USD',
      totalCostCents: null,
      requestedFundingCents: null,
      matchAmountCents: null,
      matchSources: [],
      estimateBasis: null,
    },
    schedule: { startDate: null, endDate: null, milestones: [] },
    readiness: {
      planningStatus: null,
      designStatus: null,
      environmentalStatus: null,
      rightOfWayStatus: null,
    },
    constraints: [],
    unknowns: [],
    assumptions: [],
  };
}

// ---------------------------------------------------------------------------
// Project record

export const PROJECT_STATUSES = ['draft', 'ready', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);

export const FieldMetadataEntrySchema = z
  .object({
    source: z.enum(['user_edit', 'accepted_suggestion']),
    messageId: z.string().nullable(),
    confirmedAt: z.string().nullable(),
  })
  .strict();

export const ReadinessItemSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    state: z.enum(['missing', 'unknown']),
  })
  .strict();

export const ReadinessAssessmentSchema = z
  .object({
    ruleVersion: z.number().int(),
    completeCount: z.number().int().min(0),
    requiredCount: z.number().int().min(1),
    missingFields: z.array(ReadinessItemSchema),
    warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  })
  .strict();

export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    ownerId: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().min(1),
    status: ProjectStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    profile: ProfileObjectSchema,
    fieldMetadata: z.record(FieldMetadataEntrySchema),
    readinessAssessment: ReadinessAssessmentSchema,
  })
  .strict();

export type Project = z.infer<typeof ProjectSchema>;
export type FieldMetadataEntry = z.infer<typeof FieldMetadataEntrySchema>;
export type ReadinessAssessment = z.infer<typeof ReadinessAssessmentSchema>;

// ---------------------------------------------------------------------------
// Changes (PATCH bodies, agent output, suggestion batches)

export const CHANGE_OPS = ['set', 'add', 'update', 'remove'] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];

/** Shape of a change as supplied by a client or the agent. Detailed rules: field-paths.ts. */
export const ChangeInputSchema = z
  .object({
    op: z.enum(CHANGE_OPS),
    path: z.string().min(1).max(100),
    value: z.unknown().optional(),
    itemId: z.string().min(1).max(LIMITS.idMax).optional(),
  })
  .strict();

export type ChangeInput = z.infer<typeof ChangeInputSchema>;

// ---------------------------------------------------------------------------
// Stored records (internal; not exposed verbatim)

export interface SessionRecord {
  /** SHA-256 of the cookie value; the cookie value itself is never stored. */
  id: string;
  ownerId: string;
  createdAt: string;
}

export interface DiscoveryMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  requestId: string;
}

export type Disposition = 'pending' | 'applied' | 'dismissed' | 'conflict';

export interface StoredChange {
  id: string;
  op: ChangeOp;
  path: string;
  value?: unknown;
  itemId?: string;
  rationale: string;
  sourceMessageIds: string[];
  /** Precondition checked at apply time; absent for `add`. */
  basis?: unknown;
  disposition: Disposition;
}

export type BatchState = 'pending' | 'applied' | 'dismissed' | 'stale';

export interface SuggestionBatch {
  id: string;
  projectId: string;
  baseRevision: number;
  state: BatchState;
  changes: StoredChange[];
  createdAt: string;
}

export type DiscoveryRequestState = 'in_progress' | 'complete' | 'failed';

export interface DiscoveryRequestRecord {
  requestId: string;
  projectId: string;
  state: DiscoveryRequestState;
  bodyHash: string;
  userMessageId: string;
  assistantMessageId: string | null;
  batchId: string | null;
  /** Safe, stable result returned on replay of a complete request. */
  result: unknown;
  errorCode: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface IdempotencyRecord {
  bodyHash: string;
  result: unknown;
  projectId: string | null;
  createdAt: string;
}
