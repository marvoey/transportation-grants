import { GrantOpportunity, SAMOpportunity } from '../types/index.js';
import { getSAMOpportunitiesClient } from '../clients/sam-opportunities.js';
import { getSAMAssistanceClient } from '../clients/sam-assistance.js';
import { SearchGrantsParams } from '../utils/validators.js';
import { APPLICANT_TYPE_MAPPING } from '../config/constants.js';
import { logger } from '../config/config.js';

/**
 * Search DOT grant opportunities based on criteria
 */
export async function searchDOTGrants(params: SearchGrantsParams): Promise<GrantOpportunity[]> {
  logger.info('Searching DOT grants', params);

  const opportunitiesClient = getSAMOpportunitiesClient();

  // Fetch opportunities from SAM.gov
  const opportunities = await opportunitiesClient.searchWithDateRange({
    daysBack: 365, // Look back 1 year
    daysAhead: 180, // Look ahead 6 months
    keywords: params.keywords,
    limit: 100,
  });

  logger.info(`Found ${opportunities.length} opportunities`);

  // Convert to domain model
  let results = opportunities.map(opp => convertToGrantOpportunity(opp));

  // Filter by applicant type if specified
  if (params.applicantType) {
    const assistanceClient = getSAMAssistanceClient();
    const applicantMapping = APPLICANT_TYPE_MAPPING[params.applicantType];

    // Filter by keywords in description or eligible applicants
    results = results.filter(grant => {
      const searchText = [
        grant.description || '',
        grant.eligibleApplicants?.join(' ') || '',
      ].join(' ').toLowerCase();

      return applicantMapping.keywords.some(keyword =>
        searchText.includes(keyword.toLowerCase())
      );
    });

    logger.info(`Filtered to ${results.length} opportunities for ${params.applicantType}`);
  }

  // Filter by amount if specified
  if (params.minAmount || params.maxAmount) {
    results = results.filter(grant => {
      if (!grant.amount) return false;

      // Parse amount string (e.g., "$1,000,000")
      const amountStr = grant.amount.replace(/[$,]/g, '');
      const amount = parseFloat(amountStr);

      if (isNaN(amount)) return false;

      if (params.minAmount && amount < params.minAmount) return false;
      if (params.maxAmount && amount > params.maxAmount) return false;

      return true;
    });

    logger.info(`Filtered to ${results.length} opportunities by amount`);
  }

  // Filter by deadline if specified
  if (params.deadlineAfter || params.deadlineBefore) {
    results = results.filter(grant => {
      if (!grant.deadline) return false;

      const deadline = new Date(grant.deadline);
      if (isNaN(deadline.getTime())) return false;

      if (params.deadlineAfter) {
        const afterDate = new Date(params.deadlineAfter);
        if (deadline < afterDate) return false;
      }

      if (params.deadlineBefore) {
        const beforeDate = new Date(params.deadlineBefore);
        if (deadline > beforeDate) return false;
      }

      return true;
    });

    logger.info(`Filtered to ${results.length} opportunities by deadline`);
  }

  // Sort by deadline (soonest first)
  results.sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  return results;
}

/**
 * Convert SAM opportunity to domain model
 */
function convertToGrantOpportunity(opp: SAMOpportunity): GrantOpportunity {
  // Extract contact info
  const primaryContact = opp.pointOfContact?.find(
    poc => poc.type === 'primary' || poc.type === 'Primary'
  ) || opp.pointOfContact?.[0];

  return {
    id: opp.noticeId,
    title: opp.title,
    organization: [opp.department, opp.subTier, opp.office]
      .filter(Boolean)
      .join(' - ') || 'Department of Transportation',
    deadline: opp.responseDeadLine,
    postedDate: opp.postedDate,
    amount: opp.award?.amount,
    description: opp.description,
    link: opp.uiLink || opp.additionalInfoLink,
    contactInfo: primaryContact
      ? {
          name: primaryContact.fullName,
          email: primaryContact.email,
          phone: primaryContact.phone,
        }
      : undefined,
  };
}
