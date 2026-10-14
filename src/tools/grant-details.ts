import { GrantDetails } from '../types/index.js';
import { getSAMOpportunitiesClient } from '../clients/sam-opportunities.js';
import { getSAMAssistanceClient } from '../clients/sam-assistance.js';
import { GetGrantDetailsParams } from '../utils/validators.js';
import { logger } from '../config/config.js';
import { GrantServerError } from '../types/index.js';

/**
 * Get detailed grant information
 */
export async function getGrantDetails(params: GetGrantDetailsParams): Promise<GrantDetails> {
  logger.info('Getting grant details', params);

  const opportunitiesClient = getSAMOpportunitiesClient();
  const assistanceClient = getSAMAssistanceClient();

  // If programNumber is provided, fetch from Assistance Listings
  if (params.programNumber) {
    const program = await assistanceClient.getProgramByNumber(params.programNumber);

    if (!program) {
      throw new GrantServerError(
        'NOT_FOUND',
        `Program ${params.programNumber} not found`,
        false
      );
    }

    return {
      id: program.programNumber || '',
      programNumber: program.programNumber,
      title: program.programTitle || '',
      organization: program.federalAgency || 'Department of Transportation',
      description: program.objectivesAndUses,
      objectives: program.objectivesAndUses,
      amount: {
        min: program.financialInformation?.rangeAndAverageOfFinancialAssistance?.minimumAward,
        max: program.financialInformation?.rangeAndAverageOfFinancialAssistance?.maximumAward,
        average: program.financialInformation?.rangeAndAverageOfFinancialAssistance?.averageAward,
      },
      eligibility: {
        description: program.applicantEligibility?.description,
        applicantTypes: program.applicantEligibility?.eligibleApplicants,
        beneficiaryTypes: program.beneficiaryEligibility?.eligibleBeneficiaries,
        requirements: program.credentials,
      },
      applicationProcedures: {
        description: program.applicationProcedures,
        deadlines: program.deadlines,
        howToApply: program.applicationProcedures,
      },
      matchingRequirements: {
        formula: program.formulaAndMatchingRequirements?.formula,
        matchingRequired: Boolean(program.formulaAndMatchingRequirements?.matchingRequirements),
      },
      compliance: {
        regulations: program.regulations,
      },
      contacts: {
        headquarters: program.headquartersOffice
          ? {
              office: program.headquartersOffice.office,
              address: program.headquartersOffice.address,
              phone: program.headquartersOffice.phone,
              email: program.headquartersOffice.email,
            }
          : undefined,
        regional: program.regionalOrLocalOffice
          ? {
              office: program.regionalOrLocalOffice.office,
              address: program.regionalOrLocalOffice.address,
              phone: program.regionalOrLocalOffice.phone,
            }
          : undefined,
      },
      resources: {
        website: program.websiteAddress,
      },
      examples: program.examplesOfFundedProjects,
      relatedPrograms: program.relatedPrograms,
    };
  }

  // If opportunityId is provided, fetch from Opportunities API
  if (params.opportunityId) {
    const opportunity = await opportunitiesClient.getOpportunityById(params.opportunityId);

    if (!opportunity) {
      throw new GrantServerError(
        'NOT_FOUND',
        `Opportunity ${params.opportunityId} not found`,
        false
      );
    }

    // Extract primary contact
    const primaryContact = opportunity.pointOfContact?.find(
      poc => poc.type === 'primary' || poc.type === 'Primary'
    ) || opportunity.pointOfContact?.[0];

    // Parse amount
    const amountStr = opportunity.award?.amount?.replace(/[$,]/g, '');
    const amountNum = amountStr ? parseFloat(amountStr) : undefined;

    return {
      id: opportunity.noticeId,
      title: opportunity.title,
      organization: [opportunity.department, opportunity.subTier, opportunity.office]
        .filter(Boolean)
        .join(' - ') || 'Department of Transportation',
      description: opportunity.description,
      deadline: opportunity.responseDeadLine,
      postedDate: opportunity.postedDate,
      amount: amountNum
        ? {
            total: opportunity.award?.amount,
          }
        : undefined,
      contacts: primaryContact
        ? {
            pointOfContact: {
              name: primaryContact.fullName,
              email: primaryContact.email,
              phone: primaryContact.phone,
            },
          }
        : undefined,
      resources: {
        applicationLink: opportunity.uiLink,
        additionalLinks: opportunity.resourceLinks,
      },
    };
  }

  throw new GrantServerError(
    'MISSING_PARAMETER',
    'Either opportunityId or programNumber must be provided',
    false
  );
}
