import { loadDOTGrants, needsUpdate, updateGrantsDatabase } from './xml-extractor.js';
import { SAMOpportunity, SAMOpportunitiesResponse } from '../types/index.js';
import { logger } from '../config/config.js';

/**
 * Local data provider - searches cached XML extract data
 * No API calls, no rate limits!
 */
export class LocalGrantsProvider {
  private grants: SAMOpportunity[] = [];
  private loaded = false;

  /**
   * Load grants from cache
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    this.grants = await loadDOTGrants();
    this.loaded = true;

    if (this.grants.length === 0) {
      logger.warn('No cached grants found. Run: npm run update-grants');
    }
  }

  /**
   * Search grants locally
   */
  async search(params: {
    keyword?: string;
    postedFrom?: string;
    postedTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<SAMOpportunitiesResponse> {
    await this.ensureLoaded();

    let results = [...this.grants];

    // Filter by keyword
    if (params.keyword) {
      const keywords = params.keyword.toLowerCase();
      results = results.filter(grant => {
        const searchText = [
          grant.title,
          grant.description,
          grant.department,
          grant.office,
        ].join(' ').toLowerCase();
        return searchText.includes(keywords);
      });
    }

    // Filter by date range
    if (params.postedFrom) {
      const fromDate = this.parseDate(params.postedFrom);
      results = results.filter(grant => {
        if (!grant.postedDate) return false;
        const grantDate = new Date(grant.postedDate);
        return grantDate >= fromDate;
      });
    }

    if (params.postedTo) {
      const toDate = this.parseDate(params.postedTo);
      results = results.filter(grant => {
        if (!grant.postedDate) return false;
        const grantDate = new Date(grant.postedDate);
        return grantDate <= toDate;
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
   * Get grant by ID
   */
  async getById(noticeId: string): Promise<SAMOpportunity | null> {
    await this.ensureLoaded();
    return this.grants.find(g => g.noticeId === noticeId) || null;
  }

  /**
   * Check if data needs update
   */
  async checkForUpdates(): Promise<boolean> {
    return await needsUpdate();
  }

  /**
   * Parse MM/DD/YYYY date
   */
  private parseDate(dateStr: string): Date {
    if (dateStr.includes('/')) {
      const [month, day, year] = dateStr.split('/').map(Number);
      return new Date(year, month - 1, day);
    }
    return new Date(dateStr);
  }
}

// Singleton instance
let localProviderInstance: LocalGrantsProvider | null = null;

export function getLocalProvider(): LocalGrantsProvider {
  if (!localProviderInstance) {
    localProviderInstance = new LocalGrantsProvider();
  }
  return localProviderInstance;
}
