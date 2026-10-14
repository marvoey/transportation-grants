import { EligibilityCheck, SAMAssistanceProgram } from '../types/index.js';
import { getSAMAssistanceClient } from '../clients/sam-assistance.js';
import { CheckEligibilityParams } from '../utils/validators.js';
import { APPLICANT_TYPE_MAPPING } from '../config/constants.js';
import { logger } from '../config/config.js';
import { mockCheckEligibility } from '../data/mock-data.js';

/**
 * Check eligibility for grants based on applicant type
 */
export async function checkEligibility(
  params: CheckEligibilityParams
): Promise<EligibilityCheck[]> {
  logger.info('Checking eligibility', params);

  // Use mock data if configured
  const dataSource = process.env.DATA_SOURCE || 'mock';
  if (dataSource === 'mock') {
    logger.info('Using mock eligibility data');
    return mockCheckEligibility(params.applicantType);
  }

  const assistanceClient = getSAMAssistanceClient();
  const applicantMapping = APPLICANT_TYPE_MAPPING[params.applicantType];

  let programs: SAMAssistanceProgram[];

  // If specific program is requested
  if (params.programNumber) {
    const program = await assistanceClient.getProgramByNumber(params.programNumber);
    programs = program ? [program] : [];
  } else if (params.opportunityId) {
    // Try to find program by opportunity ID
    // Note: This would require looking up the CFDA number from the opportunity
    // For now, check all DOT programs
    programs = await assistanceClient.getDOTPrograms();
  } else {
    // Check all DOT programs
    programs = await assistanceClient.getDOTPrograms();
  }

  logger.info(`Checking eligibility against ${programs.length} programs`);

  // Check eligibility for each program
  const results: EligibilityCheck[] = programs.map(program =>
    checkProgramEligibility(params.applicantType, program, applicantMapping)
  );

  // Sort by status (eligible first, then conditional, then not eligible)
  const statusOrder = { eligible: 0, conditional: 1, not_eligible: 2, unknown: 3 };
  results.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  // If checking a specific program, return just that one
  if (params.programNumber || params.opportunityId) {
    return results.slice(0, 1);
  }

  return results;
}

/**
 * Check if applicant type is eligible for a specific program
 */
function checkProgramEligibility(
  applicantType: string,
  program: SAMAssistanceProgram,
  applicantMapping: { samCodes: string[]; keywords: string[] }
): EligibilityCheck {
  const eligibleApplicants = program.applicantEligibility?.eligibleApplicants || [];
  const eligibilityDescription = program.applicantEligibility?.description || '';

  // Check 1: Direct SAM code match
  const codeMatch = eligibleApplicants.some(code =>
    applicantMapping.samCodes.includes(code)
  );

  if (codeMatch) {
    return {
      applicantType: applicantType as any,
      status: 'eligible',
      reasoning: `Direct match: ${applicantType} entities are explicitly listed as eligible applicants (code match)`,
      requirements: extractRequirements(program),
      programNumber: program.programNumber,
      programTitle: program.programTitle,
    };
  }

  // Check 2: Keyword match in description
  const descriptionLower = eligibilityDescription.toLowerCase();
  const keywordMatches = applicantMapping.keywords.filter(keyword =>
    descriptionLower.includes(keyword.toLowerCase())
  );

  if (keywordMatches.length > 0) {
    return {
      applicantType: applicantType as any,
      status: 'conditional',
      reasoning: `Possible match: Eligibility description mentions "${keywordMatches.join(', ')}". Review full requirements to confirm.`,
      requirements: extractRequirements(program),
      programNumber: program.programNumber,
      programTitle: program.programTitle,
    };
  }

  // Check 3: Check if "all" governments or "any" is mentioned
  if (
    eligibilityDescription.match(/all\s+(state|local|government)/i) ||
    eligibilityDescription.match(/any\s+(state|local|government)/i) ||
    eligibleApplicants.some(code => code === '99' || code.toLowerCase().includes('all'))
  ) {
    return {
      applicantType: applicantType as any,
      status: 'conditional',
      reasoning: 'Program appears to accept broad categories of governmental entities. Review full requirements to confirm.',
      requirements: extractRequirements(program),
      programNumber: program.programNumber,
      programTitle: program.programTitle,
    };
  }

  // No match found
  return {
    applicantType: applicantType as any,
    status: 'not_eligible',
    reasoning: `No match found: ${applicantType} entities are not explicitly listed in eligible applicants`,
    programNumber: program.programNumber,
    programTitle: program.programTitle,
  };
}

/**
 * Extract key requirements from program
 */
function extractRequirements(program: SAMAssistanceProgram): string[] | undefined {
  const requirements: string[] = [];

  if (program.credentials) {
    requirements.push(`Credentials: ${program.credentials}`);
  }

  if (program.applicantEligibility?.description) {
    requirements.push(`Eligibility: ${program.applicantEligibility.description}`);
  }

  if (program.preapplicationCoordination) {
    requirements.push(`Pre-application: ${program.preapplicationCoordination}`);
  }

  if (program.formulaAndMatchingRequirements?.matchingRequirements) {
    requirements.push(`Matching: ${program.formulaAndMatchingRequirements.matchingRequirements}`);
  }

  return requirements.length > 0 ? requirements : undefined;
}
