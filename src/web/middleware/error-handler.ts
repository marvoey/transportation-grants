import { Request, Response, NextFunction } from 'express';
import { GrantServerError } from '../../types/index.js';
import { logger } from '../../config/config.js';

/**
 * API response format
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  count?: number;
  error?: string;
  code?: string;
  retryable?: boolean;
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, count?: number): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };

  if (count !== undefined) {
    response.count = count;
  }

  return response;
}

/**
 * Create error response
 */
export function errorResponse(
  error: string,
  code?: string,
  retryable?: boolean
): ApiResponse {
  return {
    success: false,
    error,
    code,
    retryable,
  };
}

/**
 * Express error handling middleware
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // A body the JSON parser rejected carries the raw body on the error object (`err.body`), which can hold a password or the
  // applicant's own words. Log only the kind of failure, never the error object.
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    logger.warn(`Rejected request body on ${req.method} ${req.path}: ${err.type}`);
    const tooLarge = err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json(
      errorResponse(tooLarge ? 'The request is too large.' : 'The request body is not valid JSON.', 'VALIDATION_ERROR', false)
    );
    return;
  }

  logger.error(`API error on ${req.method} ${req.path}:`, err);

  // Handle GrantServerError
  if (err instanceof GrantServerError) {
    res.status(getStatusCode(err.code)).json(
      errorResponse(err.message, err.code, err.retryable)
    );
    return;
  }

  // Handle validation errors (from Zod or other validators)
  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    res.status(400).json(
      errorResponse(
        err.message || 'Invalid request parameters',
        'VALIDATION_ERROR',
        false
      )
    );
    return;
  }

  // Handle generic errors
  res.status(500).json(
    errorResponse(
      'An unexpected error occurred. Please try again later.',
      'INTERNAL_ERROR',
      true
    )
  );
}

/**
 * Get HTTP status code from error code
 */
function getStatusCode(errorCode: string): number {
  switch (errorCode) {
    case 'RATE_LIMIT_EXCEEDED':
      return 429;
    case 'INVALID_API_KEY':
    case 'MISSING_CONFIG':
      return 503; // Service unavailable
    case 'NOT_FOUND':
      return 404;
    case 'MISSING_PARAMETER':
    case 'VALIDATION_ERROR':
      return 400;
    case 'API_TIMEOUT':
    case 'NETWORK_ERROR':
    case 'API_ERROR':
      return 502; // Bad gateway
    default:
      return 500;
  }
}

/**
 * Async route handler wrapper
 * Catches async errors and passes them to error middleware
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
