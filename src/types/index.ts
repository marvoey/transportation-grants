// Applicant Types
export type ApplicantType = 'state' | 'city' | 'county' | 'tribal' | 'mpo' | 'transit_agency';

export interface ApplicantTypeMapping {
  samCodes: string[];
  keywords: string[];
}

// SAM.gov Opportunities API Types
export interface SAMOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  department?: string;
  subTier?: string;
  office?: string;
  postedDate?: string;
  type?: string;
  baseType?: string;
  archiveType?: string;
  archiveDate?: string;
  typeOfSetAsideDescription?: string;
  typeOfSetAside?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  active?: string;
  award?: {
    date?: string;
    number?: string;
    amount?: string;
    awardee?: {
      name?: string;
      location?: string;
      ueiSAM?: string;
    };
  };
  pointOfContact?: Array<{
    type?: string;
    title?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    fax?: string;
  }>;
  description?: string;
  organizationLocationState?: string;
  organizationLocationCity?: string;
  organizationLocationZip?: string;
  organizationLocationCountryCode?: string;
  links?: Array<{
    rel?: string;
    href?: string;
  }>;
  uiLink?: string;
  additionalInfoLink?: string;
  resourceLinks?: string[];
}

export interface SAMOpportunitiesResponse {
  totalRecords: number;
  limit: number;
  offset: number;
  opportunitiesData: SAMOpportunity[];
}

// SAM.gov Assistance Listings API Types
export interface SAMAssistanceProgram {
  programNumber?: string; // CFDA number (e.g., "20.205")
  programTitle?: string;
  popularName?: string;
  federalAgency?: string;
  authorizingLegislation?: string;
  objectivesAndUses?: string;
  typesOfAssistance?: string[];
  usesAndUseRestrictions?: string;
  applicantEligibility?: {
    description?: string;
    eligibleApplicants?: string[];
  };
  beneficiaryEligibility?: {
    description?: string;
    eligibleBeneficiaries?: string[];
  };
  credentials?: string;
  preapplicationCoordination?: string;
  applicationProcedures?: string;
  awardProcedure?: string;
  deadlines?: string;
  rangeOfApprovalDisapprovalTime?: string;
  appeals?: string;
  renewals?: string;
  formulaAndMatchingRequirements?: {
    formula?: string;
    matchingRequirements?: string;
  };
  lengthAndTimePhasing?: string;
  financialInformation?: {
    accountIdentification?: string;
    obligations?: Array<{
      fiscalYear?: string;
      amount?: number;
    }>;
    rangeAndAverageOfFinancialAssistance?: {
      minimumAward?: number;
      maximumAward?: number;
      averageAward?: number;
    };
  };
  programAccomplishments?: string;
  regulations?: string;
  regionalOrLocalOffice?: {
    office?: string;
    address?: string;
    phone?: string;
  };
  headquartersOffice?: {
    office?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  websiteAddress?: string;
  relatedPrograms?: string[];
  examplesOfFundedProjects?: string;
  criteriaForSelectingProposals?: string;
  url?: string;
  recoveryAct?: boolean;
  lastUpdatedDate?: string;
}

export interface SAMAssistanceListingsResponse {
  total: number;
  programs: SAMAssistanceProgram[];
}

// USASpending API Types
export interface USASpendingAward {
  award_id?: string;
  generated_unique_award_id?: string;
  recipient_name?: string;
  recipient_duns?: string;
  recipient_uei?: string;
  recipient_parent_name?: string;
  recipient_country?: string;
  recipient_state?: string;
  recipient_city?: string;
  recipient_zip?: string;
  award_amount?: number;
  total_obligation?: number;
  description?: string;
  award_type?: string;
  award_type_code?: string;
  cfda_number?: string;
  cfda_title?: string;
  awarding_agency_name?: string;
  awarding_sub_agency_name?: string;
  funding_agency_name?: string;
  funding_sub_agency_name?: string;
  period_of_performance_start_date?: string;
  period_of_performance_current_end_date?: string;
  date_signed?: string;
}

export interface USASpendingResponse {
  results: USASpendingAward[];
  page_metadata?: {
    page: number;
    hasNext: boolean;
    count: number;
  };
}

// Domain Types (what our tools return)
export interface GrantOpportunity {
  id: string;
  title: string;
  organization: string;
  deadline?: string;
  postedDate?: string;
  amount?: string;
  description?: string;
  eligibleApplicants?: string[];
  link?: string;
  contactInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
}

export interface GrantDetails {
  id: string;
  programNumber?: string;
  title: string;
  organization: string;
  description?: string;
  objectives?: string;
  deadline?: string;
  postedDate?: string;
  amount?: {
    min?: number;
    max?: number;
    average?: number;
    total?: string;
  };
  eligibility?: {
    description?: string;
    applicantTypes?: string[];
    beneficiaryTypes?: string[];
    requirements?: string;
  };
  applicationProcedures?: {
    description?: string;
    deadlines?: string;
    whereToApply?: string;
    howToApply?: string;
  };
  matchingRequirements?: {
    formula?: string;
    matchingRequired?: boolean;
  };
  compliance?: {
    regulations?: string;
    reporting?: string;
    audits?: string;
  };
  contacts?: {
    pointOfContact?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    headquarters?: {
      office?: string;
      address?: string;
      phone?: string;
      email?: string;
    };
    regional?: {
      office?: string;
      address?: string;
      phone?: string;
    };
  };
  resources?: {
    website?: string;
    applicationLink?: string;
    additionalLinks?: string[];
    attachments?: string[];
  };
  examples?: string;
  relatedPrograms?: string[];
}

export interface EligibilityCheck {
  applicantType: ApplicantType;
  status: 'eligible' | 'not_eligible' | 'conditional' | 'unknown';
  reasoning: string;
  requirements?: string[];
  programNumber?: string;
  programTitle?: string;
}

export interface DeadlineInfo {
  id: string;
  title: string;
  deadline: string;
  daysUntilDeadline: number;
  organization: string;
  amount?: string;
  eligibleApplicants?: string[];
  link?: string;
}

// Cache Types
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface RateLimitInfo {
  requests: number;
  windowStart: number;
  windowMs: number;
  limit: number;
}

// Configuration Types
export interface Config {
  sam: {
    apiKey: string;
    baseUrl: string;
    opportunitiesPath: string;
    assistancePath: string;
    timeout: number;
  };
  usaspending: {
    baseUrl: string;
    timeout: number;
  };
  cache: {
    enabled: boolean;
    directory: string;
    ttl: {
      assistance: number;
      opportunities: number;
      awards: number;
    };
  };
  rateLimits: {
    sam: {
      requests: number;
      windowMs: number;
    };
  };
  anthropic: {
    apiKey?: string;
    model: string;
    maxTokens: number;
  };
  server: {
    name: string;
    version: string;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// Error Types
export class GrantServerError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
    this.name = 'GrantServerError';
  }
}

// Tool Parameter Types
export interface SearchGrantsParams {
  applicantType?: ApplicantType;
  minAmount?: number;
  maxAmount?: number;
  keywords?: string;
  deadlineAfter?: string;
  deadlineBefore?: string;
}

export interface GetGrantDetailsParams {
  opportunityId?: string;
  programNumber?: string;
}

export interface CheckEligibilityParams {
  applicantType: ApplicantType;
  opportunityId?: string;
  programNumber?: string;
}

export interface TrackDeadlinesParams {
  daysAhead: number;
  applicantType?: ApplicantType;
}
