import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig, logger } from '../config/config.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { errorHandler, successResponse } from './middleware/error-handler.js';

// Import routes
import grantsRouter from './routes/grants.js';
import eligibilityRouter from './routes/eligibility.js';
import deadlinesRouter from './routes/deadlines.js';
import chatRouter from './routes/chat.js';
import { createNofoRouter } from './routes/nofo.js';
import { createDocsRouter } from './routes/docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create and configure Express application
 */
export function createApp(): Application {
  const app = express();
  const config = getConfig();

  // On Vercel the app sits behind its proxy: trust the first hop so the rate limiters see the caller's address.
  if (process.env.VERCEL) app.set('trust proxy', 1);

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Logging middleware
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // Serve static files from public directory
  const publicPath = join(__dirname, '../../public');
  app.use(express.static(publicPath));
  logger.info(`Serving static files from ${publicPath}`);

  // Project documentation (README.md, CLAUDE.md and the markdown files in docs/), read-only.
  app.use('/docs', createDocsRouter());

  // API Routes
  app.use('/api/grants', grantsRouter);
  app.use('/api/eligibility', eligibilityRouter);
  app.use('/api/deadlines', deadlinesRouter);

  // Chat spends real money per request (Anthropic API calls), so it gets
  // its own rate limit on top of the global routes above.
  const chatRateLimiter = rateLimit({
    windowMs: parseInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS || '60000', 10),
    limit: parseInt(process.env.CHAT_RATE_LIMIT_REQUESTS || '10', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'Too many chat requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryable: true,
    },
  });
  app.use('/api/chat', chatRateLimiter, chatRouter);

  // NOFO applicant assessment: reads locally ingested packages; has its own rate limits.
  app.use('/api/nofo', createNofoRouter());

  // Health check endpoint
  app.get('/api/health', async (req: Request, res: Response) => {
    try {
      const cache = getCacheManager();
      const rateLimit = await cache.getRateLimit('sam');

      res.json(successResponse({
        status: 'ok',
        version: config.server.version,
        rateLimit: {
          requests: rateLimit.requests,
          limit: rateLimit.limit,
          remaining: rateLimit.limit - rateLimit.requests,
          resetAt: new Date(rateLimit.windowStart + rateLimit.windowMs).toISOString(),
        },
      }));
    } catch (error) {
      logger.error('Health check error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve health status',
      });
    }
  });

  // Error handling middleware (must be last)
  app.use(errorHandler);

  // 404 handler for undefined routes
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
    });
  });

  return app;
}

/**
 * Start the Express server
 */
export function startServer(port: number = 3000): void {
  const app = createApp();

  app.listen(port, () => {
    logger.info(`DOT Grants Web Server running on http://localhost:${port}`);
    logger.info(`API endpoints: http://localhost:${port}/api/*`);
    logger.info(`Web interface: http://localhost:${port}/`);
  });
}
