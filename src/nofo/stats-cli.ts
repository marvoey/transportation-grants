#!/usr/bin/env node
/**
 * Operator CLI: count the funding landscape on Simpler.Grants.gov and save the numbers the home page falls back on.
 *
 *   npm run nofo:stats [-- --print]
 *
 * Writes data/fixtures/simpler-stats-snapshot.json (counts only, safe to commit). The home page counts live and caches
 * for a few hours; this file is what it shows until the first live count succeeds, or when the API cannot be reached.
 * --print shows the numbers without writing the file. Exit codes: 0 ok; 2 failure (config or search).
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { GrantServerError } from '../types/index.js';
import { SimplerApiError } from './simpler/client.js';
import { createSearchSource, isSearchConfigured } from './discovery/default-source.js';
import { computeHomeStats } from './stats.js';

const SNAPSHOT = resolve(process.cwd(), 'data/fixtures/simpler-stats-snapshot.json');

async function main(argv: string[]): Promise<number> {
  const printOnly = argv.includes('--print');
  if (!isSearchConfigured()) {
    console.error('Error: SIMPLER_GRANTS_API_KEY is not set.');
    return 2;
  }
  try {
    const stats = await computeHomeStats(createSearchSource());
    console.log(JSON.stringify(stats, null, 2));
    if (!printOnly) {
      await mkdir(dirname(SNAPSHOT), { recursive: true });
      await writeFile(SNAPSHOT, JSON.stringify(stats, null, 2) + '\n');
      console.log(`\nSaved ${SNAPSHOT}`);
    }
    return 0;
  } catch (error) {
    // Messages from the Simpler client never contain the key or response content.
    console.error(error instanceof SimplerApiError || error instanceof GrantServerError ? `Error: ${error.message}` : 'Error: could not count the opportunities.');
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
