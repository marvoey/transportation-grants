import { describe, expect, it } from 'vitest';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { req, reqFile } from '../__fixtures__/assessment.js';
import {
  STAGES_SYSTEM_PROMPT, StagePlanSchema, defaultStagePlan, planStages, requirementsHash, stageOfGroupIn, stageOfRequirementIn, validateStages,
} from './stages.js';

const eligible = req({ id: 'req-0000f001', category: 'eligibility', topic: 'applicant_type', title: 'Only named states may apply', description: 'Only the states named in the notice may apply.' });
const ceiling = req({ id: 'req-0000f002', category: 'funding', topic: 'maximum_request', title: 'Award ceiling of $500,000', description: 'Awards are limited to $500,000.' });
const form = req({ id: 'req-0000f003', category: 'application', topic: 'application_content', title: 'SF-424 form required', description: 'Submit the SF-424.' });
const capacity = req({ id: 'req-0000f004', category: 'readiness', topic: 'applicant_capacity', title: 'Describe staffing', description: 'Describe staffing and equipment.' });
const file = reqFile([eligible, ceiling, form, capacity]);

const stage = (title: string, why: string, requirementIds: string[], questionGroups: string[]) => ({ title, why, requirementIds, questionGroups });
const good = {
  stages: [
    stage('Confirm the notice applies', 'I want to be sure the notice applies to you before we talk about money.', [eligible.id, capacity.id], ['listed', 'applicant', 'description']),
    stage('Money and paperwork', 'Next I would like to check the funding side and what you must submit.', [ceiling.id, form.id], ['request', 'costMatch', 'area', 'category', 'bca', 'design', 'environmental']),
  ],
};

describe('validateStages', () => {
  it('accepts a good proposal as it is', () => {
    const out = validateStages(good, file)!;
    expect(out.map((s) => s.title)).toEqual(['Confirm the notice applies', 'Money and paperwork']);
    expect(out[0].requirementIds).toEqual([eligible.id, capacity.id]);
    expect(out[1].requirementIds).toEqual([ceiling.id, form.id]);
  });

  it('drops ids that are not requirements of this notice, and keeps the first place of a repeat', () => {
    const out = validateStages({ stages: [stage('Confirm the notice applies', 'I want to be sure the notice applies to you first.', [eligible.id, 'req-ffff0000'], ['listed', 'bogus']), stage('The rest of it', 'Then we can go through the rest of the notice together.', [eligible.id, ceiling.id, form.id, capacity.id], ['listed', 'request'])] }, file)!;
    expect(out[0].requirementIds).toEqual([eligible.id]);
    expect(out[1].requirementIds).toEqual([ceiling.id, form.id, capacity.id]);
    expect(out.flatMap((s) => s.questionGroups).filter((g) => g === 'listed')).toHaveLength(1);
    expect(out.flatMap((s) => s.questionGroups)).not.toContain('bogus');
  });

  it('places whatever the model left out by the static rule, so every requirement and group is in exactly one stage', () => {
    const out = validateStages({ stages: [stage('Confirm the notice applies', 'I want to be sure the notice applies to you first.', [eligible.id], ['listed']), stage('The rest of it', 'Then we can go through the rest of the notice together.', [ceiling.id], ['request'])] }, file)!;
    const ids = out.flatMap((s) => s.requirementIds);
    expect([...ids].sort()).toEqual([eligible.id, ceiling.id, form.id, capacity.id].sort());
    const groups = out.flatMap((s) => s.questionGroups);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups.length).toBe(10);
  });

  it('forces everything about who may apply into the first stage, whatever the model decided', () => {
    const late = { stages: [stage('Money first', 'Let us start with how much money is involved here.', [ceiling.id], ['request', 'costMatch']), stage('Then who can apply', 'After that we will see who is eligible to apply.', [eligible.id, form.id, capacity.id], ['listed', 'applicant', 'description'])] };
    const out = validateStages(late, file)!;
    expect(out[0].requirementIds).toContain(eligible.id);
    expect(out[0].questionGroups).toEqual(expect.arrayContaining(['listed', 'applicant']));
    expect(out[1].questionGroups).not.toContain('listed');
  });

  it('rejects a bad number of stages and wording that fails the text checks', () => {
    expect(validateStages({ stages: [good.stages[0]] }, file)).toBeNull();
    expect(validateStages({ stages: [good.stages[0], good.stages[1], good.stages[0], good.stages[1]] }, file)).toBeNull();
    expect(validateStages({ stages: [stage('You are not eligible', 'You are not eligible for this notice at all.', [eligible.id], []), good.stages[1]] }, file)).toBeNull();
    expect(validateStages({ stages: [stage('Step 9 of 40', 'I want to be sure the notice applies to you first.', [eligible.id], []), good.stages[1]] }, file)).toBeNull();
    expect(validateStages('nonsense', file)).toBeNull();
  });
});

describe('planStages', () => {
  const reply = (stages: unknown) => scriptedLlm(() => llmResult(JSON.stringify({ stages })));

  it('sends the model every requirement and the question groups, and never anything about an applicant', async () => {
    const llm = reply(good.stages);
    await planStages(file, llm);
    const call = llm.calls[0];
    expect(call.system).toBe(STAGES_SYSTEM_PROMPT);
    for (const r of file.requirements) expect(call.user).toContain(r.id);
    expect(call.user).toContain('<question_groups>');
    expect(call.user).toContain('"group": "listed"');
  });

  it('returns the model\'s plan, saved in the shape the store checks, with the hash of the requirements it was made from', async () => {
    const { plan, fallbackReason } = await planStages(file, reply(good.stages));
    expect(fallbackReason).toBeUndefined();
    expect(plan).toMatchObject({ source: 'model', reviewStatus: 'unreviewed', opportunityId: file.opportunityId, requirementsHash: requirementsHash(file) });
    expect(plan.stages.map((s) => s.index)).toEqual([1, 2]);
    expect(StagePlanSchema.safeParse(plan).success).toBe(true);
  });

  it('falls back to the three default stages, with a reason, without a model, when the call fails, or when the plan is invalid', async () => {
    expect((await planStages(file, null)).fallbackReason).toBe('no_model');
    expect((await planStages(file, scriptedLlm(() => { throw new Error('boom'); }))).fallbackReason).toBe('call_failed');
    const bad = await planStages(file, reply([good.stages[0]]));
    expect(bad).toMatchObject({ fallbackReason: 'invalid_plan' });
    expect(bad.plan.source).toBe('default');
    expect(bad.plan.stages).toHaveLength(3);
    expect(StagePlanSchema.safeParse(bad.plan).success).toBe(true);
  });
});

describe('looking things up in a plan', () => {
  it('finds the stage of a requirement or a question group in the plan, and places one it does not list by the static rule', () => {
    const plan = { ...defaultStagePlan(file), stages: validateStages(good, file)!.map((s, i) => ({ ...s, index: i + 1 })) };
    expect(stageOfRequirementIn(plan, eligible)).toBe(1);
    expect(stageOfRequirementIn(plan, ceiling)).toBe(2);
    expect(stageOfGroupIn(plan, 'request')).toBe(2);
    // Not listed: placed by category (readiness is static stage 3, clamped to the two stages there are).
    expect(stageOfRequirementIn(plan, { id: 'req-0000ffff', category: 'readiness' })).toBe(2);
    expect(stageOfGroupIn(plan, 'unknown-group')).toBe(2);
  });

  it('the default plan has the three fixed stages and a requirements hash that changes when the requirements do', () => {
    const plan = defaultStagePlan(file);
    expect(plan.source).toBe('default');
    expect(plan.stages.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(plan.requirementsHash).toBe(requirementsHash(file));
    expect(requirementsHash(reqFile([eligible]))).not.toBe(requirementsHash(file));
  });
});
