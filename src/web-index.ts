#!/usr/bin/env node

import { startServer } from './web/api-server.js';
import { logger } from './config/config.js';

/**
 * Entry point for the DOT Grants Web Server
 */
async function main() {
  try {
    const port = parseInt(process.env.WEB_PORT || '3000', 10);
    startServer(port);
  } catch (error) {
    logger.error('Fatal error starting web server:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main();
