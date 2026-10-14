import { ApplicantType, ApplicantTypeMapping } from '../types/index.js';

/**
 * Mapping of applicant types to SAM.gov codes and keywords for eligibility matching
 * SAM codes based on SAM.gov entity type classifications
 */
export const APPLICANT_TYPE_MAPPING: Record<ApplicantType, ApplicantTypeMapping> = {
  state: {
    samCodes: ['00', '01'], // State governments
    keywords: ['state', 'state government', 'state agency', 'state department'],
  },
  city: {
    samCodes: ['02'], // City or township governments
    keywords: ['city', 'municipal', 'municipality', 'town', 'township'],
  },
  county: {
    samCodes: ['03'], // County governments
    keywords: ['county', 'county government', 'parish'],
  },
  tribal: {
    samCodes: ['04'], // Native American tribal governments (Federally Recognized)
    keywords: [
      'tribal',
      'tribe',
      'native american',
      'indian',
      'alaska native',
      'indigenous',
      'federally recognized',
    ],
  },
  mpo: {
    samCodes: ['05', '25'], // Special district governments, regional planning organizations
    keywords: [
      'mpo',
      'metropolitan planning',
      'regional planning',
      'planning organization',
      'council of governments',
      'cog',
    ],
  },
  transit_agency: {
    samCodes: ['06', '25', '21'], // Public transit systems, authorities, special districts
    keywords: [
      'transit',
      'transportation authority',
      'public transportation',
      'transit authority',
      'transit agency',
      'bus',
      'rail',
      'metro',
    ],
  },
};

/**
 * Department of Transportation agency codes across different systems
 */
export const DOT_AGENCY_CODES = {
  sam: '6900', // SAM.gov organization code for DOT
  usaspending: '069', // USASpending.gov toptier agency code for DOT
  cfda: '20', // CFDA prefix for DOT programs (e.g., 20.205)
};

/**
 * Grant type codes for USASpending API
 */
export const GRANT_TYPE_CODES = {
  block_grant: '02',
  formula_grant: '03',
  project_grant: '04',
  cooperative_agreement: '05',
};

/**
 * All grant types for filtering
 */
export const ALL_GRANT_TYPES = Object.values(GRANT_TYPE_CODES);

/**
 * Common DOT programs (for reference and quick lookups)
 */
export const COMMON_DOT_PROGRAMS = {
  'highway_planning': '20.205', // Highway Planning and Construction (Federal-Aid Highway Program)
  'transit_capital': '20.500', // Federal Transit Capital Investment Grants
  'transit_formula': '20.507', // Federal Transit Formula Grants
  'airport_improvement': '20.106', // Airport Improvement Program
  'railroad_safety': '20.301', // Railroad Safety
  'pipeline_safety': '20.700', // Pipeline Safety Program
  'highway_safety': '20.600', // State and Community Highway Safety
  'tribal_transportation': '20.205', // Tribal Transportation Program (part of 20.205)
};

/**
 * Valid applicant types for validation
 */
export const VALID_APPLICANT_TYPES: ApplicantType[] = [
  'state',
  'city',
  'county',
  'tribal',
  'mpo',
  'transit_agency',
];

/**
 * DOT sub-agencies and offices
 */
export const DOT_SUB_AGENCIES = {
  fhwa: 'Federal Highway Administration',
  fta: 'Federal Transit Administration',
  faa: 'Federal Aviation Administration',
  fra: 'Federal Railroad Administration',
  fmcsa: 'Federal Motor Carrier Safety Administration',
  nhtsa: 'National Highway Traffic Safety Administration',
  phmsa: 'Pipeline and Hazardous Materials Safety Administration',
  marad: 'Maritime Administration',
  ost: 'Office of the Secretary of Transportation',
};
