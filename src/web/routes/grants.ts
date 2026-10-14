import { Router, Request, Response } from 'express';
import { searchDOTGrants } from '../../tools/search-grants.js';
import { getGrantDetails } from '../../tools/grant-details.js';
import { SearchGrantsSchema, GetGrantDetailsSchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';

const router = Router();

/**
 * GET /api/grants/search
 * Search for DOT grant opportunities
 */
router.get(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    // Convert query params to correct types
    const params: any = { ...req.query };
    if (params.minAmount) params.minAmount = parseFloat(params.minAmount);
    if (params.maxAmount) params.maxAmount = parseFloat(params.maxAmount);

    // Validate query parameters
    const validation = validateParams(SearchGrantsSchema, params);

    if (!validation.success) {
      res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
      return;
    }

    // Call existing tool function
    const grants = await searchDOTGrants(validation.data);

    res.json(successResponse(grants, grants.length));
  })
);

/**
 * GET /api/grants/details
 * Get detailed information about a specific grant
 * Query params: id OR program (programNumber)
 */
router.get(
  '/details',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, program } = req.query;

    // Build parameters object
    const params = id
      ? { opportunityId: id as string }
      : program
      ? { programNumber: program as string }
      : {};

    // Validate parameters
    const validation = validateParams(GetGrantDetailsSchema, params);

    if (!validation.success) {
      res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
      return;
    }

    // Call existing tool function
    const details = await getGrantDetails(validation.data);

    res.json(successResponse(details));
  })
);

export default router;
