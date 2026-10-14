#!/usr/bin/env node

import { updateGrantsDatabase } from './xml-extractor.js';
import { logger } from '../config/config.js';

/**
 * CLI script to update grants database
 * Run with: npm run update-grants
 */
async function main() {
  console.log('========================================');
  console.log('Grants.gov Database Update');
  console.log('========================================\n');

  try {
    await updateGrantsDatabase();
    console.log('\n✅ Update completed successfully!');
    console.log('You can now use the web interface without API rate limits.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Update failed:', error);
    process.exit(1);
  }
}

main();
