import { SimplerApiError } from './client.js';
import { SimplerSearchItemSchema, SimplerSearchResponseSchema, type SimplerSearchItem } from './schemas.js';

/**
 * Request body for POST /v1/opportunities/search.
 *
 * The `filters` type is deliberately narrow. Live probing showed the metadata behind other filters
 * is unreliable for exactly the grants that matter: large general-purpose programs list applicant
 * type "other" (an applicant_type filter drops every one of them), award ceilings are often null, and
 * funding categories are sometimes wrong. Those fields are scored in code, never used as filters,
 * and the compiler enforces that here.
 */
export type SearchStatus = 'forecasted' | 'posted' | 'closed' | 'archived';

export interface SearchRequestBody {
  /** 1-100 characters (the API answers 422 otherwise). */
  query?: string;
  query_operator?: 'AND' | 'OR';
  filters?: {
    top_level_agency?: { one_of: string[] };
    opportunity_status?: { one_of: SearchStatus[] };
    funding_category?: { one_of: string[] };
  };
  pagination: {
    /** A 1-based page number, not a row offset. */
    page_offset: number;
    page_size: number;
    sort_order: Array<{
      order_by: 'relevancy' | 'post_date' | 'close_date';
      sort_direction: 'ascending' | 'descending';
    }>;
  };
}

/** One search hit, normalized. Everything optional upstream is null here, never guessed. */
export interface SearchCandidate {
  opportunityId: string;
  opportunityNumber: string | null;
  title: string | null;
  status: string;
  category: string | null;
  agencyCode: string | null;
  agencyName: string | null;
  topLevelAgencyCode: string | null;
  purpose: string | null;
  description: string | null;
  postDate: string | null;
  closeDate: string | null;
  awardCeiling: number | null;
  awardFloor: number | null;
  estimatedTotalProgramFunding: number | null;
  expectedNumberOfAwards: number | null;
  isCostSharing: boolean | null;
  applicantTypes: string[];
  fundingCategories: string[];
  assistanceListings: string[];
  additionalInfoUrl: string | null;
}

export interface SearchResult {
  candidates: SearchCandidate[];
  totalRecords: number | null;
  /** Items in the response that did not match the expected shape and were skipped. */
  skipped: number;
  /** The response body exactly as Simpler.Grants.gov sent it (parsed JSON), kept so a person can inspect it. */
  raw?: unknown;
}

export function mapSearchItem(raw: SimplerSearchItem): SearchCandidate {
  const s = raw.summary ?? {};
  return {
    opportunityId: raw.opportunity_id.toLowerCase(),
    opportunityNumber: raw.opportunity_number ?? null,
    title: raw.opportunity_title ?? null,
    status: raw.opportunity_status,
    category: raw.category ?? null,
    agencyCode: raw.agency_code ?? null,
    agencyName: raw.agency_name ?? null,
    topLevelAgencyCode: raw.top_level_agency_code ?? null,
    purpose: raw.purpose_statement ?? null,
    description: s.summary_description ?? null,
    postDate: s.post_date ?? null,
    closeDate: s.close_date ?? null,
    awardCeiling: s.award_ceiling ?? null,
    awardFloor: s.award_floor ?? null,
    estimatedTotalProgramFunding: s.estimated_total_program_funding ?? null,
    expectedNumberOfAwards: s.expected_number_of_awards ?? null,
    isCostSharing: s.is_cost_sharing ?? null,
    applicantTypes: s.applicant_types ?? [],
    fundingCategories: s.funding_categories ?? [],
    assistanceListings: (raw.opportunity_assistance_listings ?? [])
      .map((a) => a.assistance_listing_number)
      .filter((n): n is string => typeof n === 'string' && n.length > 0),
    additionalInfoUrl: s.additional_info_url ?? null,
  };
}

/** Validates a search response. Messages name the failing fields, never the content. */
export function parseSearchResponse(json: unknown): SearchResult {
  const envelope = SimplerSearchResponseSchema.safeParse(json);
  if (!envelope.success) {
    const where = envelope.error.issues
      .slice(0, 5)
      .map((issue) => issue.path.join('.') || '(root)')
      .join(', ');
    throw new SimplerApiError('malformed_response', `Simpler.Grants.gov search response did not match the expected shape (${where}).`);
  }
  const candidates: SearchCandidate[] = [];
  let skipped = 0;
  for (const item of envelope.data.data) {
    const parsed = SimplerSearchItemSchema.safeParse(item);
    if (parsed.success) candidates.push(mapSearchItem(parsed.data));
    else skipped += 1;
  }
  return { candidates, totalRecords: envelope.data.pagination_info?.total_records ?? null, skipped, raw: json };
}
