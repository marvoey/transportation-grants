import { z } from 'zod';
import { UUID_PATTERN } from '../schemas.js';

/**
 * Zod for ONLY the fields of the Simpler.Grants.gov detail response that we
 * use (verified against the published OpenAPI spec and live responses).
 * Strict about the fields we rely on, tolerant of everything else, because
 * the API is "in active development" and may add fields.
 */

export const SimplerAttachmentSchema = z
  .object({
    opportunity_attachment_id: z.string().min(1),
    file_name: z.string().min(1),
    file_description: z.string().nullish(),
    mime_type: z.string().nullish(),
    file_size_bytes: z.number().int().nonnegative().nullish(),
    download_path: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();

export const SimplerSummarySchema = z
  .object({
    award_ceiling: z.number().nullish(),
    award_floor: z.number().nullish(),
    estimated_total_program_funding: z.number().nullish(),
    expected_number_of_awards: z.number().nullish(),
    post_date: z.string().nullish(),
    close_date: z.string().nullish(),
    archive_date: z.string().nullish(),
    fiscal_year: z.number().nullish(),
    is_cost_sharing: z.boolean().nullish(),
    applicant_types: z.array(z.string()).nullish(),
    additional_info_url: z.string().nullish(),
    applicant_eligibility_description: z.string().nullish(),
  })
  .passthrough();

export const SimplerOpportunitySchema = z
  .object({
    opportunity_id: z.string().regex(UUID_PATTERN),
    opportunity_number: z.string().nullish(),
    legacy_opportunity_id: z.number().int().nullish(),
    opportunity_title: z.string().nullish(),
    opportunity_status: z.string(),
    category: z.string().nullish(),
    agency_code: z.string().nullish(),
    agency_name: z.string().nullish(),
    top_level_agency_code: z.string().nullish(),
    top_level_agency_name: z.string().nullish(),
    summary: SimplerSummarySchema.nullish(),
    // Required to be an array: a missing/odd value is a malformed response,
    // not "zero attachments", so we never silently under-report coverage.
    attachments: z.array(SimplerAttachmentSchema),
    updated_at: z.string().nullish(),
  })
  .passthrough();

export const SimplerDetailResponseSchema = z
  .object({
    data: SimplerOpportunitySchema,
  })
  .passthrough();

export type SimplerOpportunity = z.infer<typeof SimplerOpportunitySchema>;
export type SimplerAttachment = z.infer<typeof SimplerAttachmentSchema>;
