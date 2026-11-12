#!/usr/bin/env node
/**
 * Operator CLI: find opportunities worth considering from a project description.
 *
 *   npm run nofo:find -- "<project description>" [--say "<follow-up>"]... [--historical] [--guided]
 *
 * Prints what was understood, which Simpler.Grants.gov searches ran, and the shortlist. Each --say adds
 * another applicant message (the conversation so far). --historical also searches closed and archived
 * opportunities. By default the CLI always searches (it has no way to remember which questions it
 * asked); --guided runs the same question policy as the web page.
 * Exit codes: 0 ok; 2 failure (config, search, validation).
 */
import { GrantServerError } from '../../types/index.js';
import { LlmError } from '../llm.js';
import { SimplerApiError } from '../simpler/client.js';
import { createDiscoveryLlm, createSearchSource } from './default-source.js';
import { PROJECT_TYPE_LABELS } from './schemas.js';
import { DiscoveryError, discoverTurn } from './service.js';
import { SearchCache } from './search.js';

const USAGE = 'Usage: npm run nofo:find -- "<project description>" [--say "<follow-up>"]... [--previous-reply "<the reply shown last turn>"] [--historical] [--guided]';

function parseArgs(argv: string[]): { messages: string[]; historical: boolean; guided: boolean; help: boolean; previousReply?: string } {
  const messages: string[] = [];
  let previousReply: string | undefined;
  let historical = false;
  let guided = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--historical') historical = true;
    else if (a === '--guided') guided = true;
    else if (a === '--help') help = true;
    else if (a === '--previous-reply') previousReply = argv[++i];
    else if (a === '--say') {
      const next = argv[++i];
      if (next) messages.push(next);
    } else if (!a.startsWith('--')) messages.unshift(a);
  }
  return { messages, historical, guided, help, previousReply };
}

const money = (n: number | null): string => (n === null ? 'n/a' : `$${n.toLocaleString('en-US')}`);

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || args.messages.length === 0) {
    console.error(USAGE);
    return args.help ? 0 : 2;
  }

  try {
    const llm = createDiscoveryLlm();
    const result = await discoverTurn(
      {
        messages: args.messages.map((content) => ({ role: 'user', content })),
        includeHistorical: args.historical,
        forceResults: !args.guided,
        ...(args.previousReply ? { previousReply: args.previousReply } : {}),
      },
      { source: createSearchSource(), llm, cache: new SearchCache() }
    );

    console.log(`PRELIMINARY. Stage: ${result.stage}${llm ? '' : '  (no model configured: keyword reader)'}`);
    if (result.reply) {
      console.log(`\nREPLY (written by ${result.reply.source === 'model' ? 'the language model, checked by code' : `a template; model text not used: ${result.reply.fallbackReason ?? 'unknown'}`})`);
      for (const paragraph of result.reply.text.split('\n\n')) console.log(`  ${paragraph}`);
    }
    console.log('\nUnderstood from your description:');
    const p = result.profile;
    console.log(`  project types : ${p.projectTypes.map((t) => `${PROJECT_TYPE_LABELS[t.value]} ("${t.quote}")`).join('; ') || '(none)'}`);
    console.log(`  applicant     : ${p.applicantType ? `${p.applicantType.value} ("${p.applicantType.quote}")` : 'unknown'}`);
    console.log(`  phase         : ${p.phase ? `${p.phase.value} ("${p.phase.quote}")` : 'unknown'}`);
    console.log(`  federal ask   : ${p.federalAskUsd ? money(p.federalAskUsd.value) : 'unknown'}`);
    console.log(`  total cost    : ${p.totalCostUsd ? money(p.totalCostUsd.value) : 'unknown'}`);
    console.log(`  search terms  : ${p.terms.join(', ') || '(none)'}`);

    if (result.searches.length > 0) {
      console.log('\nSearches run:');
      for (const s of result.searches) console.log(`  - ${s.label} [${s.records ?? '?'} records]\n      ${s.detail}`);
    }

    console.log(`\n${result.summary}`);
    result.shortlist.forEach((s, i) => {
      console.log(`\n${i + 1}. ${s.title}  [${s.match}${s.historical ? ', historical' : ''}]`);
      console.log(`   ${s.opportunityNumber ?? 'no number'}  |  ${s.agency ?? 'agency n/a'}  |  ${s.status}  |  closes ${s.closeDate ?? 'n/a'}  |  max award ${money(s.awardCeiling)}`);
      console.log(`   UUID ${s.opportunityId}${s.otherEditions > 0 ? `  (+${s.otherEditions} other edition${s.otherEditions === 1 ? '' : 's'})` : ''}`);
      for (const w of s.whyItMayFit) console.log(`   + ${w}`);
      for (const w of s.watchOuts) console.log(`   ! ${w}`);
    });

    if (result.questions.length > 0) {
      console.log(result.stage === 'ask' ? '\nQuestions before searching (re-run with more detail, without --guided):' : '\nOptional refinements:');
      for (const q of result.questions) console.log(`  ? ${q.text}`);
    }
    for (const w of result.warnings) console.log(`\nWarning: ${w}`);
    console.log(`\n${result.disclaimer}`);
    return 0;
  } catch (error) {
    if (error instanceof SimplerApiError || error instanceof GrantServerError || error instanceof DiscoveryError || error instanceof LlmError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Error: unexpected failure during search.');
    }
    return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
