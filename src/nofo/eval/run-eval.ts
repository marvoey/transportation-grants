#!/usr/bin/env node
/**
 * Manual evaluation: compare an opportunity's extracted requirements with a
 * reference ("gold") set. Not part of `npm test` (it reads real, git-ignored
 * package data).
 *
 *   npm run nofo:eval -- <opportunity-uuid> [--gold <path>] [--min-coverage 0.8]
 *
 * Default gold path: data/fixtures/nofo-gold/<uuid>.gold.json
 */
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { parseOpportunityId } from '../schemas.js';
import { PackageStore } from '../store.js';
import { GoldSchema, compareToGold, documentsFrom, validateGold } from './compare.js';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  if (positional.length !== 1) {
    console.error('Usage: npm run nofo:eval -- <opportunity-uuid> [--gold <path>] [--min-coverage 0.8]');
    return 2;
  }
  try {
    const id = parseOpportunityId(positional[0]);
    const goldPath = resolve(flag(argv, '--gold') ?? `data/fixtures/nofo-gold/${id}.gold.json`);
    const minCoverage = Number(flag(argv, '--min-coverage') ?? '0');
    const store = PackageStore.fromConfig();

    const requirements = await store.readRequirements(id);
    if (!requirements) {
      console.error(`No requirements.json for ${id}. Run: npm run nofo:extract -- ${id}`);
      return 2;
    }
    const goldRaw = JSON.parse(await fs.readFile(goldPath, 'utf-8'));
    const gold = GoldSchema.parse(goldRaw);
    if (gold.opportunityId !== id) throw new Error('The gold file is for a different opportunity.');

    const manifest = await store.readManifest(id);
    const entries = [];
    for (const doc of manifest?.documents ?? []) {
      if (doc.processing.status !== 'parsed') continue;
      const normalized = await store.readNormalized(id, doc.documentId);
      if (normalized) entries.push({ documentId: doc.documentId, authority: doc.authority, normalized });
    }
    const documents = documentsFrom(entries);

    console.log(`Reference set : ${gold.items.length} items, verification status "${gold.verification.status}"`);
    if (gold.verification.verifiedBy === null) {
      console.log('  LIMITATION  : this reference set has NOT been verified by a human. Treat these numbers as provisional.');
    }
    const issues = validateGold(gold, documents);
    console.log(`Reference quotes found on their pages: ${gold.items.length - new Set(issues.map((i) => i.goldId)).size}/${gold.items.length}`);
    for (const issue of issues) console.log(`  ! ${issue.goldId}: ${issue.problem}`);

    const result = compareToGold(gold, requirements, documents);
    console.log(`\nExtraction    : model ${requirements.model}, status ${requirements.status}, ${requirements.requirements.length} requirements`);
    console.log(`Coverage      : ${result.covered}/${result.total} reference items recovered by an overlapping quote (${(result.coverage * 100).toFixed(0)}%)  <- strict`);
    console.log(`                ${result.lenientCovered}/${result.total} if a requirement on the same page and topic citing a different sentence also counts (${(result.lenientCoverage * 100).toFixed(0)}%)  <- lenient`);
    console.log(`Category      : ${result.categoryAgreement.agree}/${result.categoryAgreement.of} matched items agree`);
    console.log(`Mandatory     : ${result.mandatoryAgreement.agree}/${result.mandatoryAgreement.of} matched items agree (informational: wording judgments)`);
    console.log(`Citations     : ${result.sources.reverified}/${result.sources.total} stored sources re-verified against the document text`);
    for (const f of result.sources.failures.slice(0, 10)) console.log(`  ! ${f.requirementId}: ${f.detail}`);
    console.log(`Review status : ${result.reviewStatus.unreviewed} unreviewed, ${result.reviewStatus.needs_review} needs_review, ${result.reviewStatus.verified} verified`);

    console.log('\nPer reference item:');
    for (const row of result.rows) {
      console.log(
        `  ${row.matchKind === 'quote' ? 'HIT ' : row.matchKind === 'page_topic' ? 'SOFT' : 'MISS'}  ${row.goldId}  ${row.title}` +
          (row.matchedRequirementId
            ? `  -> ${row.matchedRequirementId}${row.categoryAgrees === false ? '  [category differs]' : ''}${row.mandatoryAgrees === false ? '  [mandatory differs]' : ''}`
            : '')
      );
    }
    console.log(`\nExtracted requirements not in the reference set (${result.unmatchedExtracted.length}); these are not necessarily wrong:`);
    for (const u of result.unmatchedExtracted.slice(0, 40)) console.log(`  ${u.id}  ${u.category.padEnd(11)} ${u.title}`);

    return issues.length > 0 || result.coverage < minCoverage ? 1 : 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message.slice(0, 300) : 'evaluation failed'}`);
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
