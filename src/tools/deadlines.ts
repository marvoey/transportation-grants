import { DeadlineInfo, SAMOpportunity } from '../types/index.js';
import { getSAMOpportunitiesClient } from '../clients/sam-opportunities.js';
import { TrackDeadlinesParams } from '../utils/validators.js';
import { APPLICANT_TYPE_MAPPING } from '../config/constants.js';
import { logger } from '../config/config.js';

/**
 * Track upcoming grant deadlines
 */
export async function trackUpcomingDeadlines(
  params: TrackDeadlinesParams
): Promise<DeadlineInfo[]> {
  logger.info('Tracking deadlines', params);

  const opportunitiesClient = getSAMOpportunitiesClient();
  const daysAhead = params.daysAhead || 30;

  // Fetch opportunities
  const opportunities = await opportunitiesClient.searchWithDateRange({
    daysBack: 0,
    daysAhead: daysAhead,
    limit: 100,
  });

  logger.info(`Found ${opportunities.length} opportunities in next ${daysAhead} days`);

  // Filter to only those with deadlines
  let withDeadlines = opportunities.filter(opp => opp.responseDeadLine);

  // Calculate current date
  const now = new Date();

  // Convert to DeadlineInfo and filter by date range
  let results = withDeadlines
    .map(opp => convertToDeadlineInfo(opp, now))
    .filter(info => info.daysUntilDeadline >= 0 && info.daysUntilDeadline <= daysAhead);

  // Filter by applicant type if specified
  if (params.applicantType) {
    const applicantMapping = APPLICANT_TYPE_MAPPING[params.applicantType];

    results = results.filter(info => {
      const searchText = [
        info.title,
        info.eligibleApplicants?.join(' ') || '',
      ].join(' ').toLowerCase();

      return applicantMapping.keywords.some(keyword =>
        searchText.includes(keyword.toLowerCase())
      );
    });

    logger.info(`Filtered to ${results.length} deadlines for ${params.applicantType}`);
  }

  // Sort by deadline (soonest first)
  results.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);

  return results;
}

/**
 * Convert SAM opportunity to DeadlineInfo
 */
function convertToDeadlineInfo(opp: SAMOpportunity, now: Date): DeadlineInfo {
  const deadline = new Date(opp.responseDeadLine!);
  const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    id: opp.noticeId,
    title: opp.title,
    deadline: opp.responseDeadLine!,
    daysUntilDeadline: daysUntil,
    organization: [opp.department, opp.subTier, opp.office]
      .filter(Boolean)
      .join(' - ') || 'Department of Transportation',
    amount: opp.award?.amount,
    link: opp.uiLink || opp.additionalInfoLink,
  };
}
