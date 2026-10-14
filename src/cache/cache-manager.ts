import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { CacheEntry, RateLimitInfo } from '../types/index.js';
import { getConfig, logger } from '../config/config.js';

export class CacheManager {
  private cacheDir: string;

  constructor() {
    const config = getConfig();
    this.cacheDir = config.cache.directory;
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.warn(`Failed to create cache directory: ${error}`);
    }
  }

  /**
   * Generate cache key from any input
   */
  private generateCacheKey(namespace: string, input: any): string {
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
      .substring(0, 16);
    return `${namespace}_${hash}.json`;
  }

  /**
   * Get cached data if valid
   */
  async get<T>(namespace: string, key: any): Promise<T | null> {
    const config = getConfig();
    if (!config.cache.enabled) {
      return null;
    }

    try {
      await this.ensureCacheDir();
      const cacheKey = this.generateCacheKey(namespace, key);
      const cachePath = join(this.cacheDir, cacheKey);

      const data = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(data);

      const now = Date.now();
      const age = now - entry.timestamp;

      if (age > entry.ttl) {
        logger.debug(`Cache expired for ${namespace}: ${age}ms > ${entry.ttl}ms`);
        // Cache expired, delete it
        await fs.unlink(cachePath).catch(() => {});
        return null;
      }

      logger.debug(`Cache hit for ${namespace}: age ${age}ms`);
      return entry.data;
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        logger.debug(`Cache read error for ${namespace}: ${error}`);
      }
      return null;
    }
  }

  /**
   * Set cached data with TTL
   */
  async set<T>(namespace: string, key: any, data: T, ttl: number): Promise<void> {
    const config = getConfig();
    if (!config.cache.enabled) {
      return;
    }

    try {
      await this.ensureCacheDir();
      const cacheKey = this.generateCacheKey(namespace, key);
      const cachePath = join(this.cacheDir, cacheKey);

      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl,
      };

      await fs.writeFile(cachePath, JSON.stringify(entry), 'utf-8');
      logger.debug(`Cached data for ${namespace} with TTL ${ttl}ms`);
    } catch (error) {
      logger.warn(`Cache write error for ${namespace}: ${error}`);
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map(file =>
          fs.unlink(join(this.cacheDir, file)).catch(() => {})
        )
      );
      logger.info('Cache cleared');
    } catch (error) {
      logger.warn(`Cache clear error: ${error}`);
    }
  }

  /**
   * Clear cache for specific namespace
   */
  async clearNamespace(namespace: string): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const namespaceFiles = files.filter(f => f.startsWith(`${namespace}_`));
      await Promise.all(
        namespaceFiles.map(file =>
          fs.unlink(join(this.cacheDir, file)).catch(() => {})
        )
      );
      logger.info(`Cache cleared for namespace: ${namespace}`);
    } catch (error) {
      logger.warn(`Cache clear error for ${namespace}: ${error}`);
    }
  }

  /**
   * Get or set cached data (convenience method)
   */
  async getOrSet<T>(
    namespace: string,
    key: any,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(namespace, key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const data = await fetcher();

    // Cache it
    await this.set(namespace, key, data, ttl);

    return data;
  }

  /**
   * Track rate limit usage
   */
  async getRateLimit(service: string): Promise<RateLimitInfo> {
    const config = getConfig();
    const key = `ratelimit_${service}`;
    const cachePath = join(this.cacheDir, `${key}.json`);

    try {
      await this.ensureCacheDir();
      const data = await fs.readFile(cachePath, 'utf-8');
      const info: RateLimitInfo = JSON.parse(data);

      // Check if window has expired
      const now = Date.now();
      if (now - info.windowStart > info.windowMs) {
        // Reset window
        const newInfo: RateLimitInfo = {
          requests: 0,
          windowStart: now,
          windowMs: config.rateLimits.sam.windowMs,
          limit: config.rateLimits.sam.requests,
        };
        await this.setRateLimit(service, newInfo);
        return newInfo;
      }

      return info;
    } catch (error) {
      // Initialize rate limit tracking
      const newInfo: RateLimitInfo = {
        requests: 0,
        windowStart: Date.now(),
        windowMs: config.rateLimits.sam.windowMs,
        limit: config.rateLimits.sam.requests,
      };
      await this.setRateLimit(service, newInfo);
      return newInfo;
    }
  }

  /**
   * Update rate limit info
   */
  private async setRateLimit(service: string, info: RateLimitInfo): Promise<void> {
    const key = `ratelimit_${service}`;
    const cachePath = join(this.cacheDir, `${key}.json`);

    try {
      await this.ensureCacheDir();
      await fs.writeFile(cachePath, JSON.stringify(info), 'utf-8');
    } catch (error) {
      logger.warn(`Failed to update rate limit for ${service}: ${error}`);
    }
  }

  /**
   * Increment rate limit counter
   */
  async incrementRateLimit(service: string): Promise<RateLimitInfo> {
    const info = await this.getRateLimit(service);
    info.requests += 1;
    await this.setRateLimit(service, info);

    logger.debug(`Rate limit for ${service}: ${info.requests}/${info.limit}`);

    return info;
  }

  /**
   * Check if rate limit allows request
   */
  async canMakeRequest(service: string): Promise<{ allowed: boolean; info: RateLimitInfo }> {
    const info = await this.getRateLimit(service);
    const allowed = info.requests < info.limit;

    if (!allowed) {
      const timeUntilReset = info.windowMs - (Date.now() - info.windowStart);
      logger.warn(
        `Rate limit exceeded for ${service}: ${info.requests}/${info.limit}. ` +
        `Resets in ${Math.ceil(timeUntilReset / 1000 / 60)} minutes.`
      );
    }

    return { allowed, info };
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
}
