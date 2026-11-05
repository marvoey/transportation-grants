#!/usr/bin/env node
/**
 * Operator CLI: assess a described project against an opportunity's extracted
 * requirements. There is no chat screen yet (that is a later milestone).
 *
 *   npm run nofo:assess -- <uuid> --say "We are a state DOT ..." [--say "..."] [--facts-file facts.json]
 *
 * Each --say is one message from the applicant. With --facts-file, facts are
 * read from the file if it exists and the updated facts are written back, so
 * you can answer follow-up questions in a second run and watch findings change.
 */
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { GrantServerError } from '../../types/index.js';
import { LlmError } from '../llm.js';
import { PackageCorruptError } from '../store.js';
import { AssessmentError, assessTurn } from '../service.js';
import { FactsError } from './facts.js';
import { parseAssessArgs } from './args.js';

const USAGE = 'Usage: npm run nofo:assess -- <opportunity-uuid> --say "<what the applicant says>" [--say "..."] [--facts-file path]';

async function main(argv: string[]): Promise<number> {
  const args = parseAssessArgs(argv);
  if (args.help || args.positional.length !== 1 || args.say.length === 0) {
    console.error(USAGE);
    return args.help ? 0 : 2;
  }
  try {
    let priorFacts: unknown;
    if (args.factsFile) {
      try {
        priorFacts = JSON.parse(await fs.readFile(resolve(args.factsFile), 'utf-8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new FactsError('The facts file could not be read.');
      }
    }
    const result = await assessTurn({
      opportunityId: args.positional[0],
      messages: args.say.map((content) => ({ role: 'user' as const, content })),
      facts: priorFacts,
    });
    if (args.factsFile) await fs.writeFile(resolve(args.factsFile), JSON.stringify(result.facts, null, 2) + '\n');

    const line = (s = ''): void => console.log(s);
    line(`${result.opportunity?.title ?? result.opportunityId}  (${result.opportunity?.opportunityNumber ?? 'no number'})`);
    line(`PRELIMINARY, not an eligibility determination.   requirements: ${result.requirements.total} (${result.requirements.needsReview} need review, ${result.requirements.verified} human-verified), extraction ${result.requirements.status}`);
    line('');
    line('FACTS I AM USING (from your words)');
    for (const [key, fact] of Object.entries(result.facts)) {
      const f = fact as { value: unknown; quote?: string };
      line(`  ${key.padEnd(22)} ${JSON.stringify(f.value)}${f.quote ? `   <- "${f.quote}"` : ''}`);
    }
    if (Object.keys(result.facts).length === 0) line('  (none yet)');
    for (const r of result.rejectedFacts) line(`  (ignored ${r.key}: ${r.reason})`);
    line('');
    line('ARITHMETIC');
    line(`  federal share: ${result.derived.federalSharePct ?? 'n/a'}%   ${result.derived.consistency.message}`);
    for (const a of result.derived.assumptions) line(`  assumption: ${a}`);
    line('');
    line(result.advisory.headline);
    const show = (title: string, items: typeof result.findings): void => {
      if (items.length === 0) return;
      line(`\n${title} (${items.length})`);
      for (const f of items) {
        const where = f.sources[0] ? ` [p${f.sources[0].page ?? f.sources[0].section ?? '?'}]` : '';
        line(`  ${f.requirementId}${where} ${f.provisional ? '(provisional) ' : ''}${f.title}`);
        line(`      ${f.explanation}`);
      }
    };
    show('POSSIBLE CONFLICTS', result.findings.filter((f) => f.status === 'conflict' && !f.gap));
    show('PREPARATION GAPS', result.findings.filter((f) => f.status === 'conflict' && f.gap));
    show('NEEDS SPECIALIST REVIEW', result.findings.filter((f) => f.status === 'needs_specialist_review'));
    show('LOOKS SUPPORTED BY WHAT YOU STATED', result.findings.filter((f) => f.status === 'supported'));
    const unknown = result.findings.filter((f) => f.status === 'unknown');
    line(`\nNOT YET EVALUATED (${unknown.length}); ${unknown.filter((f) => f.missingFacts.length > 0).length} are waiting for a fact you have not given`);
    line(`NOT APPLICABLE to this project: ${result.notApplicable.length}   (optional/permissive items skipped: ${result.skippedCount})`);
    line('\nQUESTIONS');
    for (const q of result.questions) {
      line(`  ? ${q.text}`);
      for (const b of q.because.slice(0, 2)) line(`      because: ${b.title}${b.source ? ` [p${b.source.page ?? b.source.section ?? '?'}]` : ''}`);
    }
    if (result.questions.length === 0) line('  (no further questions)');
    line('\nNEXT STEPS');
    for (const s of result.advisory.nextSteps) line(`  - ${s}`);
    line(`\nmodel calls this turn: ${result.interpretation.modelCalls} interpretation (+ cache hits ${result.interpretation.cacheHits}), requirements interpreted ${result.interpretation.requirements}`);
    for (const w of result.warnings) line(`WARNING: ${w}`);
    line(`\n${result.advisory.disclaimer}`);
    return 0;
  } catch (error) {
    if (
      error instanceof AssessmentError ||
      error instanceof FactsError ||
      error instanceof LlmError ||
      error instanceof GrantServerError ||
      error instanceof PackageCorruptError
    ) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Error: unexpected failure during assessment.');
    }
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
