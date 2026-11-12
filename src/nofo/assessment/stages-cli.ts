#!/usr/bin/env node
/**
 * Operator CLI: plan the question stages of the Assess conversation for one opportunity.
 *
 *   npm run nofo:stages -- <opportunity-uuid> [--refresh]
 *
 * One model call reads all the opportunity's extracted requirements and proposes 2 or 3 stages for THIS grant (what gates what,
 * in what order, with a title and a reason for each); code checks the proposal and saves it as stages.json next to the
 * requirements, where a person can review it. If there is no model, or the proposal fails a check, the three default stages are
 * saved instead and the output says so. Run `npm run nofo:extract -- <uuid>` first. Exit codes: 0 saved (model plan); 2 failure;
 * 3 saved, but it is the default plan.
 */
import { GrantServerError } from '../../types/index.js';
import { createAnthropicLlm, LlmError } from '../llm.js';
import { parseOpportunityId } from '../schemas.js';
import { PackageCorruptError, PackageStore } from '../store.js';
import { planStages, requirementsHash, type StagePlan } from './stages.js';

const USAGE = 'Usage: npm run nofo:stages -- <opportunity-uuid> [--refresh]';

export function printStagePlan(plan: StagePlan, log: (line: string) => void = console.log): void {
  log(`Stage plan for ${plan.opportunityId}  (${plan.source === 'model' ? `planned by the language model (${plan.model}), checked by code` : 'the default three stages'}; ${plan.reviewStatus})`);
  for (const stage of plan.stages) {
    log(`  ${stage.index}. ${stage.title}`);
    log(`       why: ${stage.why}`);
    log(`       ${stage.requirementIds.length} requirements; fixed questions: ${stage.questionGroups.join(', ') || '(none)'}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--help') || positional.length !== 1) {
    console.error(USAGE);
    return argv.includes('--help') ? 0 : 2;
  }
  try {
    const id = parseOpportunityId(positional[0]);
    const store = PackageStore.fromConfig();
    const requirements = await store.readRequirements(id);
    if (!requirements) {
      console.error(`Error: no extracted requirements for ${id}. Run: npm run nofo:extract -- ${id}`);
      return 2;
    }
    const saved = await store.readStages(id);
    if (saved && saved.requirementsHash === requirementsHash(requirements) && !argv.includes('--refresh')) {
      console.log('(saved plan reused; no model call made; use --refresh to plan again)');
      printStagePlan(saved);
      return saved.source === 'model' ? 0 : 3;
    }
    let llm;
    try {
      llm = createAnthropicLlm();
    } catch {
      llm = null;
    }
    const result = await planStages(requirements, llm);
    await store.writeStages(id, result.plan);
    printStagePlan(result.plan);
    if (result.usage) console.log(`  tokens: ${result.usage.inputTokens} in, ${result.usage.outputTokens} out`);
    if (result.fallbackReason) console.log(`  model plan not used: ${result.fallbackReason}`);
    return result.plan.source === 'model' ? 0 : 3;
  } catch (error) {
    if (error instanceof LlmError || error instanceof GrantServerError || error instanceof PackageCorruptError) console.error(`Error: ${error.message}`);
    else console.error('Error: unexpected failure while planning the stages.');
    return 2;
  }
}

if (process.argv[1] && /stages-cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
