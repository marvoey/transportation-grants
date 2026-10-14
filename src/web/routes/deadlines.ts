import { Router, Request, Response } from 'express';
import { trackUpcomingDeadlines } from '../../tools/deadlines.js';
import { TrackDeadlinesSchema, validateParams } from '../../utils/validators.js';
import { successResponse, errorResponse, asyncHandler } from '../middleware/error-handler.js';

const router = Router();

/**
 * GET /api/deadlines
 * Track upcoming grant deadlines
 * Query params: daysAhead (optional, default 30), applicantType (optional)
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { daysAhead, applicantType } = req.query;

    // Build parameters object with defaults
    const params: any = {
      daysAhead: daysAhead ? parseInt(daysAhead as string, 10) : 30,
    };
    if (applicantType) params.applicantType = applicantType;

    // Validate parameters
    const validation = validateParams(TrackDeadlinesSchema, params);

    if (!validation.success) {
      res.status(400).json(errorResponse(validation.error, 'VALIDATION_ERROR', false));
      return;
    }

    // Ensure daysAhead has a value
    const callParams = {
      ...validation.data,
      daysAhead: validation.data.daysAhead ?? 30,
    };

    // Call existing tool function
    const deadlines = await trackUpcomingDeadlines(callParams);

    res.json(successResponse(deadlines, deadlines.length));
  })
);

export default router;
