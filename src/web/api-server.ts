import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig, logger } from '../config/config.js';
import { getCacheManager } from '../cache/cache-manager.js';
import { errorHandler, errorResponse, successResponse } from './middleware/error-handler.js';
import { loadSession } from './middleware/session.js';
import { GATED_STATIC_PATHS, intFromEnv, isProjectDiscoveryEnabled } from '../projects/project-config.js';
import { ProjectService } from '../projects/project-service.js';
import { getProjectService } from './project-service-factory.js';

// Import routes
import grantsRouter from './routes/grants.js';
import eligibilityRouter from './routes/eligibility.js';
import deadlinesRouter from './routes/deadlines.js';
import { createChatRouter } from './routes/chat.js';
import { createProjectsRouter } from './routes/projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create and configure Express application
 */
export interface AppOptions {
  /** Inject a project service (tests); defaults to the process-wide one. */
  projectService?: ProjectService;
}

export function createApp(options: AppOptions = {}): Application {
  const app = express();
  const config = getConfig();
  const getService = () => options.projectService ?? getProjectService();

  // Middleware
  const defaultCors = {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    credentials: true,
  };
  // Project routes are same-origin only: no CORS headers at all, whatever CORS_ORIGINS says.
  app.use(cors((req, callback) => {
    callback(null, req.url?.startsWith('/api/projects') ? { origin: false } : defaultCors);
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Logging middleware
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // While the project workspace is off, its page and scripts must not be served
  // (the static handler below would otherwise expose them).
  app.use((req, res, next) => {
    let path = req.path;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the raw path
    }
    if (!isProjectDiscoveryEnabled() && GATED_STATIC_PATHS.has(path.toLowerCase())) {
      res.status(404).json({
        success: false,
        error: `Route ${req.method} ${req.path} not found`,
        code: 'NOT_FOUND',
      });
      return;
    }
    next();
  });

  // Serve static files from public directory
  const publicPath = join(__dirname, '../../public');
  app.use(express.static(publicPath));
  logger.info(`Serving static files from ${publicPath}`);

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
  app.use('/api/chat', chatRateLimiter, createChatRouter({ getService }));

  // Lets pages decide whether to show the Projects navigation link.
  app.get('/api/features', (req, res) => {
    res.json(successResponse({ projectDiscovery: isProjectDiscoveryEnabled() }));
  });

  // Project discovery workspace (feature-flagged). Limiters are per app instance.
  const projectNotFound = errorResponse('Project not found.', 'PROJECT_NOT_FOUND', false);
  const projectRateMessage = {
    success: false,
    error: 'Too many project requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryable: true,
  };
  const projectIpLimiter = rateLimit({
    windowMs: intFromEnv('PROJECT_IP_RATE_LIMIT_WINDOW_MS', 60000),
    limit: intFromEnv('PROJECT_IP_RATE_LIMIT_REQUESTS', 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: projectRateMessage,
  });
  const projectSessionLimiter = rateLimit({
    windowMs: intFromEnv('PROJECT_RATE_LIMIT_WINDOW_MS', 60000),
    limit: intFromEnv('PROJECT_RATE_LIMIT_REQUESTS', 120),
    standardHeaders: true,
    legacyHeaders: false,
    // Valid sessions are limited per owner; requests without one fall back to the IP.
    keyGenerator: (req) => (req.ownerId ? `owner:${req.ownerId}` : ipKeyGenerator(req.ip ?? '')),
    message: projectRateMessage,
  });
  // Discovery turns spend real money, so they get tighter limits on top of the general ones.
  const discoveryMessage = {
    success: false,
    error: 'Too many discovery requests. Please wait a moment and try again.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryable: true,
  };
  const discoverySessionLimiter = rateLimit({
    windowMs: intFromEnv('DISCOVERY_RATE_LIMIT_WINDOW_MS', 60000),
    limit: intFromEnv('DISCOVERY_RATE_LIMIT_REQUESTS', 6),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.ownerId ? `owner:${req.ownerId}` : ipKeyGenerator(req.ip ?? '')),
    message: discoveryMessage,
  });
  const discoveryIpLimiter = rateLimit({
    windowMs: intFromEnv('DISCOVERY_RATE_LIMIT_WINDOW_MS', 60000),
    limit: intFromEnv('DISCOVERY_IP_RATE_LIMIT_REQUESTS', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: discoveryMessage,
  });
  app.use(
    '/api/projects',
    (req, res, next) => {
      if (!isProjectDiscoveryEnabled()) {
        res.status(404).json(projectNotFound);
        return;
      }
      next();
    },
    loadSession(getService),
    projectIpLimiter,
    projectSessionLimiter,
    createProjectsRouter({ getService, discoveryLimiters: [discoveryIpLimiter, discoverySessionLimiter] })
  );

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
