import axios, { AxiosInstance } from 'axios';
import { SAMOpportunitiesResponse, SAMOpportunity } from '../types/index.js';
import { getConfig, logger } from '../config/config.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { handleApiError, retryWithBackoff } from '../utils/error-handler.js';
import { DOT_AGENCY_CODES } from '../config/constants.js';
import { getLocalProvider } from '../data/local-provider.js';
import { mockSearch, mockGetById } from '../data/mock-data.js';

export class SAMOpportunitiesClient {
  private client: AxiosInstance;
  private cache = getCacheManager();

  constructor() {
    const config = getConfig();
    this.client = axios.create({
      baseURL: `${config.sam.baseUrl}${config.sam.opportunitiesPath}`,
      timeout: config.sam.timeout,
      headers: {
        'X-Api-Key': config.sam.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Search DOT grant opportunities
   */
  async searchOpportunities(params: {
    postedFrom?: string; // Format: MM/DD/YYYY
    postedTo?: string;   // Format: MM/DD/YYYY
    keyword?: string;
    limit?: number;
    offset?: number;
  }): Promise<SAMOpportunitiesResponse> {
    const config = getConfig();

    // Use mock or local data if configured
    const dataSource = process.env.DATA_SOURCE || 'mock';
    if (dataSource === 'mock') {
      logger.info('Using mock data (no API calls)');
      return mockSearch(params);
    }
    if (dataSource === 'local') {
      logger.info('Using local XML extract data (no API calls)');
      const localProvider = getLocalProvider();
      return await localProvider.search(params);
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

    // Build cache key
    const cacheKey = {
      action: 'search',
      ...params,
      org: 'transportation',
    };

    // Try cache first
    const cached = await this.cache.get<SAMOpportunitiesResponse>(
      'sam_opportunities',
      cacheKey
    );
    if (cached) {
      logger.info('Returning cached opportunities');
      return cached;
    }

    // Make API request
    try {
      const response = await retryWithBackoff(
        async () => {
          const requestParams: any = {
            api_key: config.sam.apiKey,
            department: 'Department of Transportation', // Filter DOT grants at API level
          };

          // Add only the params we need
          if (params.postedFrom) requestParams.postedFrom = params.postedFrom;
          if (params.postedTo) requestParams.postedTo = params.postedTo;
          if (params.keyword) requestParams.keyword = params.keyword;
          if (params.limit) requestParams.limit = params.limit;
          if (params.offset !== undefined) requestParams.offset = params.offset;

          logger.info('SAM.gov request params:', JSON.stringify(requestParams));
          const result = await this.client.get('/search', {
            params: requestParams,
          });
          logger.info('SAM.gov response successful');
          return result;
        },
        {
          maxRetries: 0, // Don't retry - saves API calls
          onRetry: (attempt, error) => {
            logger.warn(`Retry attempt ${attempt} for SAM opportunities: ${error.message}`);
          },
        }
      );

      // Increment rate limit counter
      await this.cache.incrementRateLimit('sam');

      const result: SAMOpportunitiesResponse = response.data;

      // No need to filter - API already filtered by department

      // Cache the result
      await this.cache.set(
        'sam_opportunities',
        cacheKey,
        result,
        config.cache.ttl.opportunities
      );

      return result;
    } catch (error: any) {
      logger.error('SAM.gov API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw handleApiError(error, 'SAM.gov Opportunities API');
    }
  }

  /**
   * Get opportunity by ID
   */
  async getOpportunityById(noticeId: string): Promise<SAMOpportunity | null> {
    const config = getConfig();

    // Use mock or local data if configured
    const dataSource = process.env.DATA_SOURCE || 'mock';
    if (dataSource === 'mock') {
      logger.info('Using mock data (no API calls)');
      return mockGetById(noticeId);
    }
    if (dataSource === 'local') {
      const localProvider = getLocalProvider();
      return await localProvider.getById(noticeId);
    }

    // Check rate limit
    const { allowed } = await this.cache.canMakeRequest('sam');
    if (!allowed) {
      throw new Error('Rate limit exceeded');
    }

    // Try cache first
    const cacheKey = { action: 'getById', noticeId };
    const cached = await this.cache.get<SAMOpportunity>(
      'sam_opportunities',
      cacheKey
    );
    if (cached) {
      return cached;
    }

    // Make API request
    try {
      const response = await retryWithBackoff(
        async () => {
          logger.info(`Fetching opportunity ${noticeId} from SAM.gov API`);
          return await this.client.get(`/${noticeId}`, {
            params: {
              api_key: config.sam.apiKey,
            },
          });
        }
      );

      // Increment rate limit counter
      await this.cache.incrementRateLimit('sam');

      const result: SAMOpportunity = response.data;

      // Cache the result
      await this.cache.set(
        'sam_opportunities',
        cacheKey,
        result,
        config.cache.ttl.opportunities
      );

      return result;
    } catch (error) {
      if ((error as any).response?.status === 404) {
        return null;
      }
      throw handleApiError(error, 'SAM.gov Opportunities API');
    }
  }

  /**
   * Search opportunities with date range (required by SAM.gov API)
   */
  async searchWithDateRange(params: {
    daysBack?: number;
    daysAhead?: number;
    keywords?: string;
    limit?: number;
  }): Promise<SAMOpportunity[]> {
    const { daysBack = 365, daysAhead = 90, keywords: keyword, limit = 100 } = params;

    // Calculate date range
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - daysBack);
    const to = new Date(now);
    to.setDate(to.getDate() + daysAhead);

    // Format dates as MM/DD/YYYY
    const postedFrom = `${String(from.getMonth() + 1).padStart(2, '0')}/${String(from.getDate()).padStart(2, '0')}/${from.getFullYear()}`;
    const postedTo = `${String(to.getMonth() + 1).padStart(2, '0')}/${String(to.getDate()).padStart(2, '0')}/${to.getFullYear()}`;

    // SAM.gov API parameters - only include what the API accepts
    const apiParams: any = {
      postedFrom,
      postedTo,
      limit,
      offset: 0,
    };

    // SAM.gov uses 'keyword' (singular) not 'keywords'
    if (keyword) {
      apiParams.keyword = keyword;
    }

    const response = await this.searchOpportunities(apiParams);

    return response.opportunitiesData || [];
  }
}

// Singleton instance
let samOpportunitiesClientInstance: SAMOpportunitiesClient | null = null;

export function getSAMOpportunitiesClient(): SAMOpportunitiesClient {
  if (!samOpportunitiesClientInstance) {
    samOpportunitiesClientInstance = new SAMOpportunitiesClient();
  }
  return samOpportunitiesClientInstance;
}
