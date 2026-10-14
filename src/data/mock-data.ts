import { SAMOpportunity, SAMOpportunitiesResponse } from '../types/index.js';

/**
 * Mock DOT grant data for testing when API is unavailable
 */
export const MOCK_DOT_GRANTS: SAMOpportunity[] = [
  {
    noticeId: 'MOCK-DOT-001',
    title: 'Infrastructure for Rebuilding America (INFRA) Grant',
    department: 'Department of Transportation',
    subTier: 'Office of the Secretary',
    office: 'BUILD and INFRA Grants Program',
    postedDate: '2026-09-15',
    responseDeadLine: '2027-01-15',
    description: 'The INFRA program advances a grant program to address critical issues facing our nation\'s highways and bridges. INFRA grants will support the Administration\'s commitment to fixing our nation\'s crumbling infrastructure by creating opportunities for all levels of government and the private sector to fund infrastructure.',
    award: {
      amount: '$50,000,000',
    },
    uiLink: 'https://www.transportation.gov/buildamerica/financing/infra-grants',
  },
  {
    noticeId: 'MOCK-DOT-002',
    title: 'Federal Transit Capital Investment Grants',
    department: 'Department of Transportation',
    subTier: 'Federal Transit Administration',
    office: 'Office of Planning and Environment',
    postedDate: '2026-08-20',
    responseDeadLine: '2027-02-28',
    description: 'Provides funding for major transit capital investments, including heavy rail, commuter rail, light rail, streetcars, and bus rapid transit.',
    award: {
      amount: '$25,000,000',
    },
    uiLink: 'https://www.transit.dot.gov/CIG',
  },
  {
    noticeId: 'MOCK-DOT-003',
    title: 'Highway Safety Improvement Program (HSIP)',
    department: 'Department of Transportation',
    subTier: 'Federal Highway Administration',
    office: 'Office of Safety',
    postedDate: '2026-09-01',
    responseDeadLine: '2026-12-31',
    description: 'The HSIP is a core Federal-aid program with the purpose of achieving a significant reduction in traffic fatalities and serious injuries on all public roads.',
    award: {
      amount: '$10,000,000',
    },
    uiLink: 'https://highways.dot.gov/highway-safety',
  },
  {
    noticeId: 'MOCK-DOT-004',
    title: 'Tribal Transportation Program Safety Fund',
    department: 'Department of Transportation',
    subTier: 'Federal Highway Administration',
    office: 'Office of Tribal Transportation',
    postedDate: '2026-08-15',
    responseDeadLine: '2026-11-30',
    description: 'Provides funding to federally recognized Indian tribes for transportation safety projects on tribal lands.',
    award: {
      amount: '$5,000,000',
    },
    uiLink: 'https://highways.dot.gov/federal-lands/programs/tribal',
  },
  {
    noticeId: 'MOCK-DOT-005',
    title: 'Airport Improvement Program',
    department: 'Department of Transportation',
    subTier: 'Federal Aviation Administration',
    office: 'Office of Airport Planning and Programming',
    postedDate: '2026-07-10',
    responseDeadLine: '2026-12-15',
    description: 'Provides grants to public agencies for airport planning and development projects.',
    award: {
      amount: '$15,000,000',
    },
    uiLink: 'https://www.faa.gov/airports/aip',
  },
];

/**
 * Mock search function
 */
export function mockSearch(params: {
  keyword?: string;
  postedFrom?: string;
  postedTo?: string;
  limit?: number;
  offset?: number;
}): SAMOpportunitiesResponse {
  let results = [...MOCK_DOT_GRANTS];

  // Filter by keyword
  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    results = results.filter(grant => {
      const text = `${grant.title} ${grant.description}`.toLowerCase();
      return text.includes(kw);
    });
  }

  // Apply pagination
  const offset = params.offset || 0;
  const limit = params.limit || 100;
  const paginated = results.slice(offset, offset + limit);

  return {
    totalRecords: results.length,
    limit,
    offset,
    opportunitiesData: paginated,
  };
}

/**
 * Mock get by ID
 */
export function mockGetById(noticeId: string): SAMOpportunity | null {
  return MOCK_DOT_GRANTS.find(g => g.noticeId === noticeId) || null;
}

/**
 * Mock eligibility data
 */
export function mockCheckEligibility(applicantType: string): any[] {
  const eligibilityRules: any = {
    state: [
      { programTitle: 'Highway Planning and Construction', programNumber: '20.205', status: 'eligible', reasoning: 'State DOTs are primary recipients of federal highway funds' },
      { programTitle: 'Highway Safety Improvement Program', programNumber: '20.218', status: 'eligible', reasoning: 'States administer HSIP funds for safety improvements' },
      { programTitle: 'INFRA Grants', programNumber: '20.933', status: 'eligible', reasoning: 'States are explicitly eligible for INFRA competitive grants' },
    ],
    city: [
      { programTitle: 'INFRA Grants', programNumber: '20.933', status: 'eligible', reasoning: 'Cities and municipalities can apply for INFRA grants' },
      { programTitle: 'Federal Transit Capital Investment', programNumber: '20.500', status: 'conditional', reasoning: 'Cities with transit agencies can apply if they meet minimum service requirements' },
      { programTitle: 'Tribal Transportation', programNumber: '20.205', status: 'not_eligible', reasoning: 'This program is specifically for federally recognized tribes' },
    ],
    county: [
      { programTitle: 'INFRA Grants', programNumber: '20.933', status: 'eligible', reasoning: 'County governments are eligible for INFRA competitive grants' },
      { programTitle: 'Highway Safety Improvement Program', programNumber: '20.218', status: 'conditional', reasoning: 'Counties can apply through state DOTs or directly if authorized' },
      { programTitle: 'Bridge Investment Program', programNumber: '20.936', status: 'eligible', reasoning: 'Counties that own bridges are eligible applicants' },
    ],
    tribal: [
      { programTitle: 'Tribal Transportation Program', programNumber: '20.205', status: 'eligible', reasoning: 'Federally recognized tribes have dedicated transportation funding' },
      { programTitle: 'Tribal Transportation Safety Funds', programNumber: '20.205', status: 'eligible', reasoning: 'Tribes are primary recipients of TTF safety funds' },
      { programTitle: 'INFRA Grants', programNumber: '20.933', status: 'eligible', reasoning: 'Tribal governments can compete for INFRA grants' },
    ],
    mpo: [
      { programTitle: 'Highway Planning and Construction', programNumber: '20.205', status: 'conditional', reasoning: 'MPOs receive planning funds through state DOTs' },
      { programTitle: 'INFRA Grants', programNumber: '20.933', status: 'eligible', reasoning: 'MPOs can apply for INFRA grants for regional projects' },
      { programTitle: 'Federal Transit Planning', programNumber: '20.505', status: 'eligible', reasoning: 'MPOs conduct regional transit planning with FTA funds' },
    ],
    transit_agency: [
      { programTitle: 'Federal Transit Capital Investment', programNumber: '20.500', status: 'eligible', reasoning: 'Transit agencies are primary recipients of FTA capital grants' },
      { programTitle: 'Federal Transit Formula Grants', programNumber: '20.507', status: 'eligible', reasoning: 'Transit agencies receive formula funds for operations and capital' },
      { programTitle: 'Bus and Bus Facilities Program', programNumber: '20.526', status: 'eligible', reasoning: 'Transit agencies can apply for bus program competitive grants' },
    ],
  };

  return eligibilityRules[applicantType] || [];
}
