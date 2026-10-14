import { GrantServerError } from '../types/index.js';
import { logger } from '../config/config.js';

/**
 * Handle API errors and convert to GrantServerError
 */
export function handleApiError(error: any, source: string): GrantServerError {
  // Bad request - validation error
  if (error.response?.status === 400) {
    const errorMsg = error.response?.data?.error_description ||
                     error.response?.data?.message ||
                     error.message ||
                     'Invalid request parameters';
    return new GrantServerError(
      'VALIDATION_ERROR',
      `${source} returned an error: ${errorMsg}`,
      false,
      error.response?.data
    );
  }

  // Rate limit exceeded
  if (error.response?.status === 429) {
    const resetTime = error.response?.data?.nextAccessTime;
    const message = resetTime
      ? `SAM.gov API quota exceeded. Resets at ${resetTime}. Please try again after this time.`
      : `Rate limit exceeded for ${source}. Please try again later.`;
    return new GrantServerError(
      'RATE_LIMIT_EXCEEDED',
      message,
      true
    );
  }

  // Authentication errors
  if (error.response?.status === 401 || error.response?.status === 403) {
    return new GrantServerError(
      'INVALID_API_KEY',
      `Invalid or missing API key for ${source}. Please check your configuration. ` +
      'Get your free API key from: https://open.gsa.gov/api/get-opportunities-public-api/',
      false
    );
  }

  // Not found
  if (error.response?.status === 404) {
    return new GrantServerError(
      'NOT_FOUND',
      `Resource not found on ${source}. The requested grant or program may not exist.`,
      false
    );
  }

  // Server errors (retryable)
  if (error.response?.status >= 500) {
    return new GrantServerError(
      'API_ERROR',
      `${source} is experiencing issues. Please try again later.`,
      true,
      error.response?.data
    );
  }

  // Timeout errors
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return new GrantServerError(
      'API_TIMEOUT',
      `Request to ${source} timed out. Please try again.`,
      true
    );
  }

  // Network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return new GrantServerError(
      'NETWORK_ERROR',
      `Unable to connect to ${source}. Please check your internet connection.`,
      true
    );
  }

  // Generic API error
  return new GrantServerError(
    'API_ERROR',
    `Error calling ${source}: ${error.message}`,
    true,
    error
  );
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if it's not a retryable error
      if (error instanceof GrantServerError && !error.retryable) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      logger.debug(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);

      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  throw lastError;
}

/**
 * Validate required parameters
 */
export function validateRequired(params: Record<string, any>, required: string[]): void {
  const missing = required.filter(key => params[key] === undefined || params[key] === null);

  if (missing.length > 0) {
    throw new GrantServerError(
      'MISSING_PARAMETER',
      `Missing required parameter(s): ${missing.join(', ')}`,
      false
    );
  }
}

/**
 * Format error for MCP response
 */
export function formatErrorResponse(error: any): { error: string; code?: string; retryable?: boolean } {
  if (error instanceof GrantServerError) {
    return {
      error: error.message,
      code: error.code,
      retryable: error.retryable,
    };
  }

  return {
    error: error.message || 'An unexpected error occurred',
  };
}

/**
 * Log error with context
 */
export function logError(error: any, context: string): void {
  if (error instanceof GrantServerError) {
    logger.error(`[${context}] ${error.code}: ${error.message}`, error.details);
  } else {
    logger.error(`[${context}] ${error.message}`, error);
  }
}
