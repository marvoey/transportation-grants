import axios, { AxiosInstance } from 'axios';
import { SAMAssistanceProgram } from '../types/index.js';
import { getConfig, logger } from '../config/config.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { handleApiError, retryWithBackoff } from '../utils/error-handler.js';
import { DOT_AGENCY_CODES } from '../config/constants.js';

export class SAMAssistanceClient {
  private client: AxiosInstance;
  private cache = getCacheManager();

  constructor() {
    const config = getConfig();
    this.client = axios.create({
      baseURL: `${config.sam.baseUrl}${config.sam.assistancePath}`,
      timeout: config.sam.timeout,
      headers: {
        'X-Api-Key': config.sam.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get all DOT assistance programs
   */
  async getDOTPrograms(): Promise<SAMAssistanceProgram[]> {
    const config = getConfig();

    // Try cache first (long TTL since programs change infrequently)
    const cacheKey = { action: 'getDOTPrograms', orgCode: DOT_AGENCY_CODES.sam };
    const cached = await this.cache.get<SAMAssistanceProgram[]>(
      'sam_assistance',
      cacheKey
    );
    if (cached) {
      logger.info('Returning cached DOT programs');
      return cached;
    }

    // Check rate limit
    const { allowed, info } = await this.cache.canMakeRequest('sam');
    if (!allowed) {
      const timeUntilReset = info.windowMs - (Date.now() - info.windowStart);
      const minutesLeft = Math.ceil(timeUntilReset / 1000 / 60);
      throw new Error(
        `Rate limit exceeded: ${info.requests}/${info.limit} requests used. ` +
        `Resets in ${minutesLeft} minutes.`
      );
    }

    // Make API request
    try {
      const response = await retryWithBackoff(
        async () => {
          logger.info('Fetching DOT programs from SAM.gov Assistance Listings API');
          return await this.client.get('/search', {
            params: {
              api_key: config.sam.apiKey,
              organizationCodes: DOT_AGENCY_CODES.sam,
              status: 'Active',
              pageSize: 200, // Get all DOT programs
            },
          });
        },
        {
          maxRetries: 3,
          onRetry: (attempt, error) => {
            logger.warn(`Retry attempt ${attempt} for SAM assistance: ${error.message}`);
          },
        }
      );

      // Increment rate limit counter
      await this.cache.incrementRateLimit('sam');

      const programs: SAMAssistanceProgram[] = response.data.programs || response.data.results || [];

      // Cache the result with long TTL
      await this.cache.set(
        'sam_assistance',
        cacheKey,
        programs,
        config.cache.ttl.assistance
      );

      logger.info(`Fetched ${programs.length} DOT programs`);
      return programs;
    } catch (error) {
      throw handleApiError(error, 'SAM.gov Assistance Listings API');
    }
  }

  /**
   * Get program by CFDA number (e.g., "20.205")
   */
  async getProgramByNumber(programNumber: string): Promise<SAMAssistanceProgram | null> {
    const config = getConfig();

    // Try cache first
    const cacheKey = { action: 'getByNumber', programNumber };
    const cached = await this.cache.get<SAMAssistanceProgram>(
      'sam_assistance',
      cacheKey
    );
    if (cached) {
      logger.info(`Returning cached program ${programNumber}`);
      return cached;
    }

    // Check rate limit
    const { allowed } = await this.cache.canMakeRequest('sam');
    if (!allowed) {
      throw new Error('Rate limit exceeded');
    }

    // Make API request
    try {
      const response = await retryWithBackoff(
        async () => {
          logger.info(`Fetching program ${programNumber} from SAM.gov API`);
          return await this.client.get(`/${programNumber}`, {
            params: {
              api_key: config.sam.apiKey,
            },
          });
        }
      );

      // Increment rate limit counter
      await this.cache.incrementRateLimit('sam');

      const program: SAMAssistanceProgram = response.data;

      // Cache the result
      await this.cache.set(
        'sam_assistance',
        cacheKey,
        program,
        config.cache.ttl.assistance
      );

      return program;
    } catch (error) {
      if ((error as any).response?.status === 404) {
        logger.warn(`Program ${programNumber} not found`);
        return null;
      }
      throw handleApiError(error, 'SAM.gov Assistance Listings API');
    }
  }

  /**
   * Search programs by keywords
   */
  async searchPrograms(keywords: string): Promise<SAMAssistanceProgram[]> {
    // Get all DOT programs first (cached)
    const allPrograms = await this.getDOTPrograms();

    // Filter by keywords
    const lowerKeywords = keywords.toLowerCase();
    const filtered = allPrograms.filter(program => {
      const searchText = [
        program.programTitle,
        program.popularName,
        program.objectivesAndUses,
        program.programNumber,
      ].join(' ').toLowerCase();

      return searchText.includes(lowerKeywords);
    });

    logger.info(`Found ${filtered.length} programs matching "${keywords}"`);
    return filtered;
  }

  /**
   * Get programs eligible for specific applicant type codes
   */
  async getProgramsByApplicantCodes(codes: string[]): Promise<SAMAssistanceProgram[]> {
    // Get all DOT programs (cached)
    const allPrograms = await this.getDOTPrograms();

    // Filter by applicant eligibility
    const filtered = allPrograms.filter(program => {
      const eligibleCodes = program.applicantEligibility?.eligibleApplicants || [];
      return codes.some(code => eligibleCodes.includes(code));
    });

    return filtered;
  }
}

// Singleton instance
let samAssistanceClientInstance: SAMAssistanceClient | null = null;

export function getSAMAssistanceClient(): SAMAssistanceClient {
  if (!samAssistanceClientInstance) {
    samAssistanceClientInstance = new SAMAssistanceClient();
  }
  return samAssistanceClientInstance;
}
