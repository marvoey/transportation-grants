import { Router, Request, Response } from 'express';
import { checkEligibility } from '../../tools/eligibility.js';
import { CheckEligibilitySchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';

const router = Router();

/**
 * GET /api/eligibility/check
 * Check eligibility for DOT grant programs
 * Query params: applicantType (required), opportunityId (optional), programNumber (optional)
 */
router.get(
  '/check',
  asyncHandler(async (req: Request, res: Response) => {
    const { applicantType, opportunityId, programNumber } = req.query;

    // Build parameters object
    const params: any = { applicantType };
    if (opportunityId) params.opportunityId = opportunityId;
    if (programNumber) params.programNumber = programNumber;

    // Validate parameters
    const validation = validateParams(CheckEligibilitySchema, params);

    if (!validation.success) {
      res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
      return;
    }

    // Call existing tool function
    const eligibilityResults = await checkEligibility(validation.data);

    res.json(successResponse(eligibilityResults, eligibilityResults.length));
  })
);

export default router;
