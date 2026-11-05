#!/usr/bin/env node
/**
 * Operator CLI: ingest one Simpler.Grants.gov opportunity by UUID.
 *
 *   npm run nofo:ingest -- <opportunity-uuid> [--refresh]
 *
 * Exit codes: 0 package written; 2 hard failure (invalid ID, auth, not found,
 * retries exhausted, corrupt package); 3 package written but no document could
 * be parsed (coverage "none").
 *
 * This is deliberately a CLI and not a web route: it needs the API key and
 * makes outbound requests, which the web app must not expose.
 */
import { GrantServerError } from '../../types/index.js';
import { SimplerApiError } from '../simpler/client.js';
import { PackageCorruptError } from '../store.js';
import { SupplementalConfigError } from '../acquire/supplemental.js';
import { ingestOpportunity } from './ingest-opportunity.js';

const USAGE = 'Usage: npm run nofo:ingest -- <opportunity-uuid> [--refresh]';

async function main(argv: string[]): Promise<number> {
  const refresh = argv.includes('--refresh');
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--help') || positional.length !== 1) {
    console.error(USAGE);
    return argv.includes('--help') ? 0 : 2;
  }

  try {
    const { opportunity, manifest } = await ingestOpportunity(positional[0], { refresh });

    console.log(`${opportunity.title ?? '(untitled)'}`);
    console.log(`  opportunity number : ${opportunity.opportunityNumber ?? 'n/a'}`);
    console.log(`  Simpler UUID       : ${opportunity.opportunityId}`);
    console.log(`  status             : ${opportunity.status}`);
    console.log(`  coverage           : ${manifest.coverage.status}`);
    for (const reason of manifest.coverage.reasons) console.log(`    - ${reason}`);
    console.log(`  documents (${manifest.documents.length}):`);
    for (const d of manifest.documents) {
      const size = d.sizeBytes === null ? '-' : `${d.sizeBytes} B`;
      console.log(
        `    ${d.documentId}  ${d.fileName}  [${d.detectedType ?? '-'}, ${size}]  ` +
          `authority=${d.authority}  retrieval=${d.retrieval.status}  processing=${d.processing.status}` +
          (d.processing.pages !== undefined ? ` (${d.processing.pages} pages)` : '') +
          (d.processing.sections !== undefined ? ` (${d.processing.sections} sections)` : '')
      );
    }
    if (manifest.potentialMissingSources.length > 0) {
      console.log('  potential missing sources:');
      for (const m of manifest.potentialMissingSources) console.log(`    - [${m.kind}] ${m.description}${m.url ? ` ${m.url}` : ''}`);
    }
    console.log(`  note: ${manifest.coverage.completenessNote}`);
    return manifest.coverage.status === 'none' ? 3 : 0;
  } catch (error) {
    // Messages from these error types are written to be safe to print (no keys, headers or signed URLs).
    if (
      error instanceof SimplerApiError ||
      error instanceof GrantServerError ||
      error instanceof PackageCorruptError ||
      error instanceof SupplementalConfigError
    ) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Error: unexpected failure during ingestion.');
    }
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
