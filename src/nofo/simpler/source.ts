import type { Attachment, Opportunity } from '../schemas.js';
import { parseOpportunityId } from '../schemas.js';
import { SimplerApiError, SimplerGrantsClient } from './client.js';
import { SimplerDetailResponseSchema, type SimplerOpportunity } from './schemas.js';
import { parseSearchResponse, type SearchRequestBody, type SearchResult } from './search.js';

export interface OpportunityDetail {
  opportunity: Opportunity;
  attachments: Attachment[];
  responseSha256: string;
}

/**
 * Where opportunities and their attachment lists come from. Simpler.Grants.gov
 * is the first implementation; the ingestion pipeline depends only on this
 * interface (and never on a program, fiscal year or opportunity ID).
 */
export interface OpportunitySource {
  getOpportunity(id: string): Promise<Opportunity>;
  getAttachments(id: string): Promise<Attachment[]>;
  /** One round-trip for both (the detail response carries the attachment list). */
  getOpportunityWithAttachments(id: string): Promise<OpportunityDetail>;
  /** Base URL used to resolve relative download paths. */
  readonly apiBaseUrl?: string;
  /** Credentials, valid for exactly one host. Never sent anywhere else. */
  readonly downloadAuth?: { host: string; apiKey: string };
}

/** Search is a separate, read-only capability so existing OpportunitySource fakes stay valid. */
export interface OpportunitySearchSource {
  searchOpportunities(body: SearchRequestBody): Promise<SearchResult>;
}

export class SimplerOpportunitySource implements OpportunitySource, OpportunitySearchSource {
  constructor(
    private readonly client: SimplerGrantsClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  async searchOpportunities(body: SearchRequestBody): Promise<SearchResult> {
    const { json } = await this.client.postJson('/v1/opportunities/search', body);
    return parseSearchResponse(json);
  }

  get apiBaseUrl(): string {
    return this.client.baseUrl.toString();
  }

  get downloadAuth(): { host: string; apiKey: string } {
    return this.client.downloadAuth;
  }

  async getOpportunity(id: string): Promise<Opportunity> {
    return (await this.getOpportunityWithAttachments(id)).opportunity;
  }

  async getAttachments(id: string): Promise<Attachment[]> {
    return (await this.getOpportunityWithAttachments(id)).attachments;
  }

  async getOpportunityWithAttachments(id: string): Promise<OpportunityDetail> {
    const opportunityId = parseOpportunityId(id);
    const { json, sha256 } = await this.client.getJson(`/v1/opportunities/${encodeURIComponent(opportunityId)}`);

    const parsed = SimplerDetailResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Report which fields are wrong, never the response content.
      const where = parsed.error.issues
        .slice(0, 5)
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');
      throw new SimplerApiError('malformed_response', `Simpler.Grants.gov response did not match the expected shape (${where}).`);
    }
    const raw = parsed.data.data;
    if (raw.opportunity_id.toLowerCase() !== opportunityId) {
      throw new SimplerApiError('malformed_response', 'Simpler.Grants.gov returned a different opportunity than requested.');
    }

    return {
      opportunity: mapOpportunity(raw, sha256, this.now()),
      attachments: raw.attachments.map((a) => ({
        attachmentId: a.opportunity_attachment_id,
        fileName: a.file_name,
        description: a.file_description ?? null,
        mimeType: a.mime_type ?? null,
        sizeBytes: a.file_size_bytes ?? null,
        downloadPath: a.download_path ?? null,
        createdAt: a.created_at ?? null,
        updatedAt: a.updated_at ?? null,
      })),
      responseSha256: sha256,
    };
  }
}

export function mapOpportunity(raw: SimplerOpportunity, responseSha256: string, retrievedAt: Date): Opportunity {
  const s = raw.summary ?? {};
  return {
    schemaVersion: 1,
    source: 'simpler.grants.gov',
    opportunityId: raw.opportunity_id.toLowerCase(),
    opportunityNumber: raw.opportunity_number ?? null,
    legacyOpportunityId: raw.legacy_opportunity_id ?? null,
    title: raw.opportunity_title ?? null,
    status: raw.opportunity_status,
    category: raw.category ?? null,
    agency: {
      code: raw.agency_code ?? null,
      name: raw.agency_name ?? null,
      topLevelCode: raw.top_level_agency_code ?? null,
      topLevelName: raw.top_level_agency_name ?? null,
    },
    summary: {
      awardCeiling: s.award_ceiling ?? null,
      awardFloor: s.award_floor ?? null,
      estimatedTotalProgramFunding: s.estimated_total_program_funding ?? null,
      expectedNumberOfAwards: s.expected_number_of_awards ?? null,
      postDate: s.post_date ?? null,
      closeDate: s.close_date ?? null,
      archiveDate: s.archive_date ?? null,
      fiscalYear: s.fiscal_year ?? null,
      isCostSharing: s.is_cost_sharing ?? null,
      applicantTypes: s.applicant_types ?? [],
      additionalInfoUrl: s.additional_info_url ?? null,
      applicantEligibilityDescription: s.applicant_eligibility_description ?? null,
    },
    sourceUpdatedAt: raw.updated_at ?? null,
    responseSha256,
    retrievedAt: retrievedAt.toISOString(),
  };
}
