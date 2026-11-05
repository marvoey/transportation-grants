import { z } from 'zod';
import { AuthoritySchema, DOCUMENT_ID_PATTERN, UUID_PATTERN } from '../schemas.js';

/**
 * Requirement schemas. `RequirementSchema` is what is persisted and what
 * later milestones consume. The `Wire*` schemas describe what the model is
 * asked to return; they are deliberately flat (no nulls) so they work with
 * JSON-schema structured outputs, and are converted to the persisted shape
 * only after validation.
 */

export const REQUIREMENT_CATEGORIES = ['eligibility', 'funding', 'application', 'readiness', 'evaluation', 'post_award'] as const;
/** What the extractor is asked to produce (evaluation and post-award are out of scope for the MVP). */
export const EXTRACTED_CATEGORIES = ['eligibility', 'funding', 'application', 'readiness'] as const;
export const RequirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export type RequirementCategory = z.infer<typeof RequirementCategorySchema>;

export const REQUIREMENT_TOPICS = [
  'applicant_type',
  'minimum_request',
  'maximum_request',
  'federal_share',
  'non_federal_match',
  'funding_restriction',
  'application_limit',
  'project_type',
  'project_location',
  'pre_award_costs',
  'deadline',
  'submission_method',
  'application_content',
  'budget',
  'benefit_cost_analysis',
  'environmental_nepa',
  'planning_consistency',
  'design_status',
  'schedule',
  'right_of_way',
  'risk',
  'applicant_capacity',
  'registration',
  'other',
] as const;
export const RequirementTopicSchema = z.enum(REQUIREMENT_TOPICS);

const AppliesToSchema = z.object({
  areaType: z.enum(['rural', 'urban', 'any']),
  grantCategory: z.enum(['capital', 'planning', 'any']),
});

/** Machine-checkable constraint. Only numeric checks are verified against the quote in code. */
export const CheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount_min'), amountUsd: z.number().positive(), appliesTo: AppliesToSchema }),
  z.object({ kind: z.literal('amount_max'), amountUsd: z.number().positive(), appliesTo: AppliesToSchema }),
  z.object({ kind: z.literal('federal_share_max_pct'), pct: z.number().gt(0).max(100), appliesTo: AppliesToSchema }),
  z.object({ kind: z.literal('match_min_pct'), pct: z.number().gt(0).max(100), appliesTo: AppliesToSchema }),
  z.object({ kind: z.literal('applicant_type_in'), values: z.array(z.string().min(1).max(100)).min(1).max(30) }),
  z.object({ kind: z.literal('document_required'), documentKey: z.string().min(1).max(80) }),
]);
export type Check = z.infer<typeof CheckSchema>;

export const RequirementSourceSchema = z.object({
  documentId: z.string().regex(DOCUMENT_ID_PATTERN),
  page: z.number().int().min(1).nullable(),
  section: z.string().nullable(),
  quote: z.string().min(1).max(1500),
  authority: AuthoritySchema,
  /** Only verified sources are ever stored. */
  verified: z.literal(true),
  /** The model cited the wrong page/section; code found the quote elsewhere in the same document. */
  locationCorrected: z.boolean(),
  note: z.string().optional(),
});
export type RequirementSource = z.infer<typeof RequirementSourceSchema>;

export const RequirementSchema = z.object({
  id: z.string().regex(/^req-[0-9a-f]{8}(-\d+)?$/),
  opportunityId: z.string().regex(UUID_PATTERN),
  category: RequirementCategorySchema,
  topic: RequirementTopicSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  /** true = must/required; false = optional; null = ambiguous or guidance ("should"). */
  mandatory: z.boolean().nullable(),
  programVariant: z.enum(['capital', 'planning', 'both']).nullable(),
  appliesWhen: z.array(z.string()),
  evidenceNeeded: z.array(z.string()),
  check: CheckSchema.optional(),
  sources: z.array(RequirementSourceSchema).min(1),
  reviewStatus: z.enum(['unreviewed', 'verified', 'needs_review']),
  reviewNote: z.string().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const REJECTION_REASONS = [
  'invalid_candidate',
  'no_sources',
  'unknown_document',
  'location_out_of_range',
  'quote_too_short',
  'quote_not_found',
] as const;

export const RequirementsFileSchema = z.object({
  schemaVersion: z.literal(1),
  opportunityId: z.string().regex(UUID_PATTERN),
  generatedAt: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  /** Hash of the documents this was extracted from; a change marks the file stale. */
  sourceManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Independent extraction passes whose candidates were combined (more passes = higher recall, more duplicates). */
  passes: z.number().int().min(1),
  /** `partial` means at least one batch failed, so coverage of the documents is incomplete. */
  status: z.enum(['complete', 'partial']),
  documents: z.array(
    z.object({
      documentId: z.string(),
      title: z.string(),
      authority: AuthoritySchema,
      sha256: z.string().nullable(),
      units: z.number().int().nonnegative(),
    })
  ),
  batches: z.object({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    /** Batches whose output was cut off and that were recovered by splitting them in half. */
    split: z.number().int().nonnegative(),
    failed: z.array(z.object({ batchId: z.string(), error: z.string() })),
  }),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  stats: z.object({
    candidates: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    sourcesRejected: z.number().int().nonnegative(),
    locationsCorrected: z.number().int().nonnegative(),
    checksDropped: z.number().int().nonnegative(),
  }),
  /** Why candidates were rejected (capped), so reviewers can see what the checks caught. */
  rejections: z.array(z.object({ title: z.string(), reason: z.string(), detail: z.string() })),
  requirements: z.array(RequirementSchema),
});
export type RequirementsFile = z.infer<typeof RequirementsFileSchema>;

// ---------------------------------------------------------------------------
// What the model returns (flat, no nulls) and how it is converted
// ---------------------------------------------------------------------------

const WireCheckSchema = z.object({
  kind: z.enum(['none', 'amount_min', 'amount_max', 'federal_share_max_pct', 'match_min_pct', 'applicant_type_in', 'document_required']),
  amountUsd: z.number(),
  pct: z.number(),
  values: z.array(z.string()),
  documentKey: z.string(),
  areaType: z.enum(['rural', 'urban', 'any']),
  grantCategory: z.enum(['capital', 'planning', 'any']),
});

export const WireSourceSchema = z.object({
  documentId: z.string(),
  page: z.number().int(),
  section: z.string(),
  quote: z.string(),
});

export const WireRequirementSchema = z.object({
  category: z.enum(EXTRACTED_CATEGORIES),
  topic: RequirementTopicSchema,
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(2000),
  mandatory: z.enum(['yes', 'no', 'unclear']),
  programVariant: z.enum(['capital', 'planning', 'both', 'unspecified']),
  appliesWhen: z.array(z.string().max(300)).max(10),
  evidenceNeeded: z.array(z.string().max(300)).max(10),
  check: WireCheckSchema,
  ambiguous: z.boolean(),
  ambiguityNote: z.string().max(500),
  sources: z.array(WireSourceSchema).min(1).max(5),
});
export type WireRequirement = z.infer<typeof WireRequirementSchema>;

/** The envelope is validated strictly; items are validated one by one so a single bad item does not discard a batch. */
export const WireEnvelopeSchema = z.object({ requirements: z.array(z.unknown()) });

/** A parsed, not yet verified, requirement candidate. */
export interface Candidate {
  category: (typeof EXTRACTED_CATEGORIES)[number];
  topic: z.infer<typeof RequirementTopicSchema>;
  title: string;
  description: string;
  mandatory: boolean | null;
  programVariant: 'capital' | 'planning' | 'both' | null;
  appliesWhen: string[];
  evidenceNeeded: string[];
  check: Check | undefined;
  ambiguous: boolean;
  ambiguityNote: string;
  sources: Array<{ documentId: string; page: number | null; section: string | null; quote: string }>;
}

function toCheck(wire: z.infer<typeof WireCheckSchema>): Check | undefined {
  const appliesTo = { areaType: wire.areaType, grantCategory: wire.grantCategory };
  const candidate =
    wire.kind === 'none'
      ? undefined
      : wire.kind === 'amount_min' || wire.kind === 'amount_max'
        ? { kind: wire.kind, amountUsd: wire.amountUsd, appliesTo }
        : wire.kind === 'federal_share_max_pct' || wire.kind === 'match_min_pct'
          ? { kind: wire.kind, pct: wire.pct, appliesTo }
          : wire.kind === 'applicant_type_in'
            ? { kind: wire.kind, values: wire.values }
            : { kind: wire.kind, documentKey: wire.documentKey };
  if (!candidate) return undefined;
  const parsed = CheckSchema.safeParse(candidate); // a malformed check is dropped, never repaired
  return parsed.success ? parsed.data : undefined;
}

export function toCandidate(wire: WireRequirement): Candidate {
  return {
    category: wire.category,
    topic: wire.topic,
    title: wire.title.trim(),
    description: wire.description.trim(),
    mandatory: wire.mandatory === 'yes' ? true : wire.mandatory === 'no' ? false : null,
    programVariant: wire.programVariant === 'unspecified' ? null : wire.programVariant,
    appliesWhen: wire.appliesWhen.map((s) => s.trim()).filter(Boolean),
    evidenceNeeded: wire.evidenceNeeded.map((s) => s.trim()).filter(Boolean),
    check: toCheck(wire.check),
    ambiguous: wire.ambiguous,
    ambiguityNote: wire.ambiguityNote.trim(),
    sources: wire.sources.map((s) => ({
      documentId: s.documentId.trim(),
      page: s.page >= 1 ? s.page : null,
      section: s.section.trim() === '' ? null : s.section.trim(),
      quote: s.quote.trim(),
    })),
  };
}

/** JSON schema handed to the model (structured outputs). Kept in step with WireRequirementSchema by a test. */
export const WIRE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements'],
  properties: {
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category',
          'topic',
          'title',
          'description',
          'mandatory',
          'programVariant',
          'appliesWhen',
          'evidenceNeeded',
          'check',
          'ambiguous',
          'ambiguityNote',
          'sources',
        ],
        properties: {
          category: { type: 'string', enum: [...EXTRACTED_CATEGORIES] },
          topic: { type: 'string', enum: [...REQUIREMENT_TOPICS] },
          title: { type: 'string' },
          description: { type: 'string' },
          mandatory: { type: 'string', enum: ['yes', 'no', 'unclear'] },
          programVariant: { type: 'string', enum: ['capital', 'planning', 'both', 'unspecified'] },
          appliesWhen: { type: 'array', items: { type: 'string' } },
          evidenceNeeded: { type: 'array', items: { type: 'string' } },
          check: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'amountUsd', 'pct', 'values', 'documentKey', 'areaType', 'grantCategory'],
            properties: {
              kind: {
                type: 'string',
                enum: ['none', 'amount_min', 'amount_max', 'federal_share_max_pct', 'match_min_pct', 'applicant_type_in', 'document_required'],
              },
              amountUsd: { type: 'number' },
              pct: { type: 'number' },
              values: { type: 'array', items: { type: 'string' } },
              documentKey: { type: 'string' },
              areaType: { type: 'string', enum: ['rural', 'urban', 'any'] },
              grantCategory: { type: 'string', enum: ['capital', 'planning', 'any'] },
            },
          },
          ambiguous: { type: 'boolean' },
          ambiguityNote: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['documentId', 'page', 'section', 'quote'],
              properties: {
                documentId: { type: 'string' },
                page: { type: 'integer' },
                section: { type: 'string' },
                quote: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};
