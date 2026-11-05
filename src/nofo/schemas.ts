import { z } from 'zod';
import { GrantServerError } from '../types/index.js';

/**
 * Zod schemas for the opportunity package that `ingestOpportunity()` persists
 * under data/opportunities/<uuid>/. They are the single source of truth for the
 * on-disk format: every read from disk is validated, so a corrupt or tampered
 * package fails closed instead of feeding bad data downstream.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Server-generated document IDs only; never derived from user-supplied file names. */
export const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const OpportunityIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(UUID_PATTERN, 'Expected a Simpler.Grants.gov opportunity UUID');

/**
 * Validates and normalizes (lower-cases) a Simpler.Grants.gov opportunity UUID.
 * This is the boundary every ID passes through before it reaches a URL or a
 * file path. The error deliberately does not echo the rejected input.
 */
export function parseOpportunityId(input: unknown): string {
  const parsed = OpportunityIdSchema.safeParse(input);
  if (!parsed.success) {
    throw new GrantServerError(
      'VALIDATION_ERROR',
      'Invalid opportunity ID: expected a Simpler.Grants.gov opportunity UUID (a 36-character ID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
      false
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Opportunity metadata (normalized from the Simpler.Grants.gov detail response)
// ---------------------------------------------------------------------------

export const OpportunitySchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('simpler.grants.gov'),
  /** The Simpler.Grants.gov UUID. NOT the official opportunity number. */
  opportunityId: z.string().regex(UUID_PATTERN),
  /** The official funding opportunity number, kept separate from the UUID. */
  opportunityNumber: z.string().nullable(),
  legacyOpportunityId: z.number().int().nullable(),
  title: z.string().nullable(),
  status: z.string(),
  category: z.string().nullable(),
  agency: z.object({
    code: z.string().nullable(),
    name: z.string().nullable(),
    topLevelCode: z.string().nullable(),
    topLevelName: z.string().nullable(),
  }),
  /** Simpler's structured metadata. `metadata` authority only: never a requirement source. */
  summary: z.object({
    awardCeiling: z.number().nullable(),
    awardFloor: z.number().nullable(),
    estimatedTotalProgramFunding: z.number().nullable(),
    expectedNumberOfAwards: z.number().nullable(),
    postDate: z.string().nullable(),
    closeDate: z.string().nullable(),
    archiveDate: z.string().nullable(),
    fiscalYear: z.number().nullable(),
    isCostSharing: z.boolean().nullable(),
    applicantTypes: z.array(z.string()),
    additionalInfoUrl: z.string().nullable(),
    applicantEligibilityDescription: z.string().nullable(),
  }),
  sourceUpdatedAt: z.string().nullable(),
  /** sha256 of the raw API response body this record was derived from. */
  responseSha256: z.string().regex(/^[0-9a-f]{64}$/),
  retrievedAt: z.string(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const AttachmentSchema = z.object({
  attachmentId: z.string(),
  fileName: z.string(),
  description: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  downloadPath: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const AuthoritySchema = z.enum(['controlling', 'official_guidance', 'metadata', 'unclassified']);
export type Authority = z.infer<typeof AuthoritySchema>;

export const DetectedTypeSchema = z.enum(['pdf', 'html', 'zip', 'ole', 'text', 'unknown']);
export type DetectedType = z.infer<typeof DetectedTypeSchema>;

export const RetrievalStatusSchema = z.enum([
  'downloaded',
  'cached',
  'failed',
  'skipped_too_large',
  'skipped_unsafe',
  'manual_required',
  'removed_upstream',
]);
export type RetrievalStatus = z.infer<typeof RetrievalStatusSchema>;

export const ProcessingStatusSchema = z.enum([
  'parsed',
  'unsupported_format',
  'parse_failed',
  'empty_text',
  'not_attempted',
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const ManifestDocumentSchema = z.object({
  documentId: z.string().regex(DOCUMENT_ID_PATTERN),
  origin: z.enum(['simpler_attachment', 'curated_supplemental']),
  title: z.string(),
  /** Display only. Never used to build a path. */
  fileName: z.string(),
  declaredMimeType: z.string().nullable(),
  detectedType: DetectedTypeSchema.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  sourceAttachmentId: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  /** Size the API declared; with sourceUpdatedAt it is the cache key for re-ingestion. */
  sourceSizeBytes: z.number().int().nonnegative().nullable(),
  /** Original URL with any query string (e.g. a presigned signature) removed. */
  originalUrl: z.string().nullable(),
  urlKind: z.enum(['relative', 'absolute', 'presigned']).nullable(),
  retrievedAt: z.string().nullable(),
  retrievalMethod: z.enum(['api_download', 'curated_url', 'manual_file']),
  /** Paths relative to the package directory. */
  storedFile: z.string().nullable(),
  normalizedFile: z.string().nullable(),
  authority: AuthoritySchema,
  authorityMethod: z.enum(['heuristic', 'manual']),
  authorityReason: z.string(),
  retrieval: z.object({
    status: RetrievalStatusSchema,
    error: z.string().optional(),
  }),
  processing: z.object({
    status: ProcessingStatusSchema,
    processorId: z.string().optional(),
    processorVersion: z.string().optional(),
    pages: z.number().int().nonnegative().optional(),
    sections: z.number().int().nonnegative().optional(),
    /** Why a document is unsupported or has no text (not an error). */
    detail: z.string().optional(),
    error: z.string().optional(),
  }),
  notes: z.array(z.string()),
});
export type ManifestDocument = z.infer<typeof ManifestDocumentSchema>;

export const CoverageSchema = z.object({
  status: z.enum(['none', 'partial', 'api_listed_processed']),
  reasons: z.array(z.string()),
  completenessNote: z.string(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const PotentialMissingSourceSchema = z.object({
  kind: z.string(),
  description: z.string(),
  url: z.string().optional(),
  documentId: z.string().optional(),
});
export type PotentialMissingSource = z.infer<typeof PotentialMissingSourceSchema>;

export const PackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  opportunityId: z.string().regex(UUID_PATTERN),
  /** First retrieval of this package; preserved across re-ingestion. */
  retrievedAt: z.string(),
  lastCheckedAt: z.string(),
  coverage: CoverageSchema,
  documents: z.array(ManifestDocumentSchema),
  potentialMissingSources: z.array(PotentialMissingSourceSchema),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export interface OpportunityPackage {
  opportunity: Opportunity;
  manifest: PackageManifest;
}

// ---------------------------------------------------------------------------
// Normalized document content
// ---------------------------------------------------------------------------

const normalizedBase = {
  schemaVersion: z.literal(1),
  documentId: z.string().regex(DOCUMENT_ID_PATTERN),
  processorId: z.string(),
  processorVersion: z.string(),
  warnings: z.array(z.string()),
};

export const PdfNormalizedSchema = z.object({
  ...normalizedBase,
  kind: z.literal('pdf'),
  pageCount: z.number().int().nonnegative(),
  pages: z.array(
    z.object({
      page: z.number().int().min(1),
      text: z.string(),
      headings: z.array(z.object({ text: z.string(), level: z.number().int().min(1) })),
    })
  ),
});
export type PdfNormalized = z.infer<typeof PdfNormalizedSchema>;

export const HtmlNormalizedSchema = z.object({
  ...normalizedBase,
  kind: z.literal('html'),
  title: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sections: z.array(
    z.object({
      id: z.string(),
      heading: z.string().nullable(),
      level: z.number().int().min(1).max(6).nullable(),
      text: z.string(),
    })
  ),
  links: z.array(z.object({ text: z.string(), url: z.string() })),
});
export type HtmlNormalized = z.infer<typeof HtmlNormalizedSchema>;

export const NormalizedDocumentSchema = z.discriminatedUnion('kind', [PdfNormalizedSchema, HtmlNormalizedSchema]);
export type NormalizedDocument = z.infer<typeof NormalizedDocumentSchema>;

// ---------------------------------------------------------------------------
// Curated supplemental sources (optional, hand-authored; designed now, used later)
// ---------------------------------------------------------------------------

export const SupplementalConfigSchema = z.object({
  sources: z
    .array(
      z
        .object({
          title: z.string().min(1).max(200),
          /** https URL of an official source. Fetched only because it is listed here. */
          url: z.string().url().optional(),
          /** File name inside the package's supplemental/ folder (manually placed). */
          localFile: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/)
            .optional(),
          authority: z.enum(['controlling', 'official_guidance']).default('official_guidance'),
          note: z.string().max(500).optional(),
        })
        .refine((s) => (s.url ? 1 : 0) + (s.localFile ? 1 : 0) === 1, {
          message: 'Each supplemental source needs exactly one of url or localFile',
        })
    )
    .default([]),
  /** Manual authority overrides keyed by documentId. */
  overrides: z
    .record(z.string().regex(DOCUMENT_ID_PATTERN), z.enum(['controlling', 'official_guidance', 'unclassified']))
    .default({}),
});
export type SupplementalConfig = z.infer<typeof SupplementalConfigSchema>;
