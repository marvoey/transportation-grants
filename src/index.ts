#!/usr/bin/env node

import { runServer } from './server.js';
import { logger } from './config/config.js';

/**
 * Entry point for the DOT Grants MCP server
 */
async function main() {
  try {
    await runServer();
  } catch (error) {
    logger.error('Fatal error starting server:', error);
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
