#!/usr/bin/env node
/**
 * Operator CLI: extract requirements from an ingested opportunity package.
 *
 *   npm run nofo:extract -- <opportunity-uuid> [--refresh] [--include-guidance]
 *
 * Run `npm run nofo:ingest -- <uuid>` first. Exit codes: 0 complete; 2 hard
 * failure; 3 written but PARTIAL (at least one batch failed, so the documents
 * are not fully covered); 4 no parsed controlling document (NOFO or amendment)
 * in the package, so there is nothing to extract from.
 */
import { GrantServerError } from '../../types/index.js';
import { LlmError } from '../llm.js';
import { PackageCorruptError } from '../store.js';
import { parseExtractArgs } from './args.js';
import { ExtractionError, extractRequirements } from './extract.js';

const USAGE = 'Usage: npm run nofo:extract -- <opportunity-uuid> [--refresh] [--include-guidance] [--passes N]';

async function main(argv: string[]): Promise<number> {
  const args = parseExtractArgs(argv);
  if (args.help || args.positional.length !== 1) {
    console.error(USAGE);
    return args.help ? 0 : 2;
  }

  try {
    const { file, cached } = await extractRequirements(args.positional[0], {
      refresh: args.refresh,
      includeGuidance: args.includeGuidance,
      passes: args.passes,
    });

    const byStatus = (status: string): number => file.requirements.filter((r) => r.reviewStatus === status).length;
    console.log(`Requirements for ${file.opportunityId}${cached ? '  (cached: no model call made)' : ''}`);
    console.log(`  model            : ${file.model}   prompt v${file.promptVersion}`);
    console.log(`  status           : ${file.status}   passes: ${file.passes}`);
    console.log(`  documents used   : ${file.documents.map((d) => `${d.documentId} (${d.authority}, ${d.units} units)`).join('; ')}`);
    console.log(`  batches          : ${file.batches.succeeded}/${file.batches.total} succeeded` + (file.batches.split > 0 ? ` (${file.batches.split} split after truncated output)` : ''));
    for (const f of file.batches.failed) console.log(`    - FAILED ${f.batchId}: ${f.error}`);
    console.log(`  tokens           : ${file.usage.inputTokens} in, ${file.usage.outputTokens} out`);
    console.log(
      `  candidates       : ${file.stats.candidates} proposed, ${file.stats.rejected} rejected (no verifiable source), ` +
        `${file.stats.merged} merged, ${file.stats.kept} kept`
    );
    console.log(
      `  checks           : ${file.stats.sourcesRejected} source(s) rejected, ${file.stats.locationsCorrected} location(s) corrected, ` +
        `${file.stats.checksDropped} numeric check(s) dropped`
    );
    console.log(`  review status    : ${byStatus('unreviewed')} unreviewed, ${byStatus('needs_review')} needs_review, ${byStatus('verified')} verified`);
    console.log('');
    for (const r of file.requirements) {
      const where = r.sources.map((s) => (s.page !== null ? `p${s.page}` : s.section ?? '?')).join(',');
      const mandatory = r.mandatory === null ? 'unclear' : r.mandatory ? 'mandatory' : 'optional';
      console.log(
        `  ${r.id}  ${r.category.padEnd(11)} ${r.topic.padEnd(22)} ${mandatory.padEnd(9)} ${r.reviewStatus === 'needs_review' ? 'REVIEW' : '      '}  [${where}]  ${r.title}`
      );
    }
    if (file.rejections.length > 0) {
      console.log(`\n  rejected candidates (${file.rejections.length}):`);
      for (const r of file.rejections.slice(0, 15)) console.log(`    - [${r.reason}] ${r.title}`);
    }
    return file.status === 'partial' ? 3 : 0;
  } catch (error) {
    if (
      error instanceof ExtractionError ||
      error instanceof LlmError ||
      error instanceof GrantServerError ||
      error instanceof PackageCorruptError
    ) {
      console.error(`Error: ${error.message}`);
      if (error instanceof ExtractionError && error.code === 'no_controlling_document') return 4;
    } else {
      console.error('Error: unexpected failure during extraction.');
    }
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
