import { config as dotenvConfig } from 'dotenv';
import { Config, GrantServerError } from '../types/index.js';

// Load environment variables
dotenvConfig();

/** Positive integer env var, falling back to the default on missing/invalid values. */
function intEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  // Validate required environment variables
  const samApiKey = process.env.SAM_API_KEY;

  if (!samApiKey) {
    throw new GrantServerError(
      'MISSING_CONFIG',
      'SAM_API_KEY environment variable is required. Please set it in your .env file. ' +
      'Get your free API key from: https://open.gsa.gov/api/get-opportunities-public-api/',
      false
    );
  }

  return {
    sam: {
      apiKey: samApiKey,
      baseUrl: process.env.SAM_BASE_URL || 'https://api.sam.gov',
      opportunitiesPath: process.env.SAM_OPPORTUNITIES_PATH || '/opportunities/v2',
      assistancePath: process.env.SAM_ASSISTANCE_PATH || '/assistance-listings/v1',
      timeout: parseInt(process.env.SAM_TIMEOUT || '30000', 10),
    },
    usaspending: {
      baseUrl: process.env.USASPENDING_BASE_URL || 'https://api.usaspending.gov/api/v2',
      timeout: parseInt(process.env.USASPENDING_TIMEOUT || '30000', 10),
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      directory: process.env.CACHE_DIR || '.cache',
      ttl: {
        assistance: parseInt(process.env.CACHE_ASSISTANCE_TTL_MS || '604800000', 10), // 7 days
        opportunities: parseInt(process.env.CACHE_OPPORTUNITIES_TTL_MS || '21600000', 10), // 6 hours
        awards: parseInt(process.env.CACHE_AWARDS_TTL_MS || '2592000000', 10), // 30 days
      },
    },
    rateLimits: {
      sam: {
        requests: parseInt(process.env.SAM_RATE_LIMIT_REQUESTS || '100', 10),
        windowMs: parseInt(process.env.SAM_RATE_LIMIT_WINDOW_MS || '86400000', 10), // 24 hours
      },
    },
    // Not required at startup (unlike SAM_API_KEY) so the rest of the app
    // keeps working without it — the chat route checks this lazily.
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL, // undefined => SDK default (api.anthropic.com)
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '1024', 10),
    },
    // Optional, like anthropic: only the NOFO ingestion CLI needs the key.
    simpler: {
      apiKey: process.env.SIMPLER_GRANTS_API_KEY || undefined,
      baseUrl: process.env.SIMPLER_GRANTS_BASE_URL || 'https://api.simpler.grants.gov',
      timeoutMs: intEnv('SIMPLER_TIMEOUT_MS', 30000),
      maxRetries: intEnv('SIMPLER_MAX_RETRIES', 3),
    },
    nofo: {
      dataDir: process.env.NOFO_DATA_DIR || 'data/opportunities',
      maxDownloadBytes: intEnv('NOFO_MAX_DOWNLOAD_BYTES', 50 * 1024 * 1024),
      maxPackageBytes: intEnv('NOFO_MAX_PACKAGE_BYTES', 200 * 1024 * 1024),
    },
    server: {
      name: 'dot-grants-mcp-server',
      version: '1.0.0',
    },
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// Simple logger based on config log level
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export const logger = {
  debug: (message: string, ...args: any[]) => {
    const config = getConfig();
    if (LOG_LEVELS[config.logLevel] <= LOG_LEVELS.debug) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    const config = getConfig();
    if (LOG_LEVELS[config.logLevel] <= LOG_LEVELS.info) {
      console.info(`[INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    const config = getConfig();
    if (LOG_LEVELS[config.logLevel] <= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    const config = getConfig();
    if (LOG_LEVELS[config.logLevel] <= LOG_LEVELS.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
};
