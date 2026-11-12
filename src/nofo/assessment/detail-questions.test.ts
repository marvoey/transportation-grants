import { describe, expect, it } from 'vitest';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { req } from '../__fixtures__/assessment.js';
import type { Requirement } from '../extraction/schemas.js';
import {
  DETAIL_SYSTEM_PROMPT, checkDetailQuestion, createDetailCache, detailCacheKey, detailCandidates, listedWording, sanitizeSpec, shownWording, similarTitles, templateQuestion, toDetailQuestion, writeDetailQuestions,
} from './detail-questions.js';
import type { Finding } from './schemas.js';

function unknownFinding(r: Requirement, over: Partial<Finding> = {}): Finding {
  return {
    requirementId: r.id, title: r.title, category: r.category, topic: r.topic, mandatory: r.mandatory, status: 'unknown', gap: false, method: 'none', provisional: true,
    explanation: 'x', factsUsed: [], missingFacts: [], requirementReviewStatus: 'unreviewed', sources: [{ documentId: 'd', page: 4, section: null, quote: 'q', authority: 'controlling' }], ...over,
  };
}
const consult = req({ id: 'req-0000e001', category: 'eligibility', topic: 'applicant_type', title: 'State agency consultation documentation required', description: 'An application from an entity other than a State DOT must include documentation that the State highway agency was consulted.' });
const maxProjects = req({ id: 'req-0000e002', category: 'eligibility', topic: 'other', title: 'Maximum four projects per application', description: 'An application may include no more than four projects.', appliesWhen: ['Applicant submits several projects'] });
const overtime = req({ id: 'req-0000e003', category: 'funding', topic: 'budget', title: 'Overtime needs a historical basis', description: 'Applicants should provide a historical basis for estimated overtime.' });
const capacity = req({ id: 'req-0000e004', category: 'readiness', topic: 'applicant_capacity', title: 'Describe staffing and equipment', description: 'The applicant must describe staffing, equipment and training.' });
const formA = req({ id: 'req-0000e005', category: 'application', topic: 'application_content', title: 'Completed SF-424 form required', description: 'SF-424.' });
const formB = req({ id: 'req-0000e006', category: 'application', topic: 'application_content', title: 'Completed SF-424A budget form required', description: 'SF-424A.' });
const requirements = [consult, maxProjects, overtime, capacity, formA, formB];
const findings = requirements.map((r) => unknownFinding(r));
const base = { findings, requirements, answers: {}, skipped: [] as string[] };

describe('detailCandidates', () => {
  it('ranks eligibility first, then funding, then readiness, with checklist items last; a universal rule before a conditional one', () => {
    const c = detailCandidates(base);
    expect(c.map((x) => x.category)).toEqual(['eligibility', 'eligibility', 'funding', 'readiness', 'application']);
    expect(c[0].leadId).toBe(consult.id); // no appliesWhen, so before the conditional maximum-projects rule
    expect(c[1].leadId).toBe(maxProjects.id);
  });

  it('only asks about unknown, mandatory requirements that no fixed question or code check covers', () => {
    const optional = req({ id: 'req-0000e007', category: 'eligibility', topic: 'other', title: 'Optional thing', mandatory: null });
    const waiting = req({ id: 'req-0000e008', category: 'eligibility', topic: 'other', title: 'Waiting on a fact' });
    const checked = req({ id: 'req-0000e009', category: 'funding', topic: 'other', title: 'Has a number', check: { kind: 'amount_max', amountUsd: 5, appliesTo: { areaType: 'any', grantCategory: 'any' } } });
    const decided = req({ id: 'req-0000e00a', category: 'eligibility', topic: 'other', title: 'Already decided' });
    const out = detailCandidates({
      findings: [unknownFinding(optional), unknownFinding(waiting, { missingFacts: ['applicantType'] }), unknownFinding(checked), unknownFinding(decided, { status: 'supported' })],
      requirements: [optional, waiting, checked, decided], answers: {}, skipped: [],
    });
    expect(out).toEqual([]);
  });

  it('leaves out what has been answered (including by a group) or set aside, and asks a repeated title once', () => {
    const dup = req({ id: 'req-0000e00b', category: 'eligibility', topic: 'other', title: 'State AGENCY consultation documentation required!' });
    const all = [...requirements, dup];
    const f = all.map((r) => unknownFinding(r));
    expect(detailCandidates({ findings: f, requirements: all, answers: {}, skipped: [] }).filter((c) => c.category === 'eligibility').map((c) => c.leadId)).toEqual([consult.id, maxProjects.id]);
    const answered = { [consult.id]: { answer: 'yes' as const, covers: [consult.id, dup.id] } };
    const left = detailCandidates({ findings: f, requirements: all, answers: answered, skipped: [maxProjects.id] }).map((c) => c.leadId);
    expect(left.filter((id) => [consult.id, maxProjects.id, dup.id].includes(id))).toEqual([]);
  });

  it('groups checklist items by topic into one question that an answer stands for', () => {
    const group = detailCandidates(base).find((c) => c.category === 'application')!;
    expect(group.grouped).toBe(true);
    expect(group.covers).toEqual([formA.id, formB.id]);
    expect(templateQuestion(group)).toBe('Does your application meet these notice requirements: SF-424 form; SF-424A budget form?');
  });

  it('can be limited to some categories', () => {
    expect(detailCandidates({ ...base, categories: ['funding'] }).map((c) => c.leadId)).toEqual([overtime.id]);
  });
});

describe('writeDetailQuestions', () => {
  const [first, second] = detailCandidates(base);
  const good = 'If you are not a State DOT, does your application include documentation that the State highway agency was consulted?';
  const reply = (questions: unknown) => scriptedLlm(() => llmResult(JSON.stringify({ questions })));
  /** One entry in the shape the model returns: a kind, why, the question, and the parts only some kinds use. */
  const entry = (requirementId: string, question: string, over: Record<string, unknown> = {}) => ({
    requirementId, type: 'yes_no', reason: 'The requirement asks whether something is done.', question, options: [], comparison: { op: 'none', value: 0, unit: '' }, ...over,
  });

  it('shows the model only the requirements, never the applicant, and uses wording that passes the checks', async () => {
    const llm = reply([entry(first.leadId, good), entry(second.leadId, 'Will your application include no more than four projects?')]);
    const out = await writeDetailQuestions([first, second], llm);
    expect(llm.calls[0].system).toBe(DETAIL_SYSTEM_PROMPT);
    expect(llm.calls[0].user).toContain('<requirements>');
    expect(out.get(first.leadId)).toMatchObject({ text: good, source: 'model', spec: { type: 'yes_no' } });
    expect(out.get(second.leadId)?.source).toBe('model');
  });

  it('rejects wording with no question mark, a number that is not in the requirement, a verdict, or an unknown id, and uses the template', async () => {
    const llm = reply([entry(first.leadId, 'Tell me about the consultation.'), entry(second.leadId, 'Will your application include no more than 9 projects?'), entry('req-ffff0000', 'Is this right?')]);
    const out = await writeDetailQuestions([first, second], llm);
    expect(out.get(first.leadId)).toEqual({ text: templateQuestion(first), source: 'code', spec: { type: 'yes_no' } });
    expect(out.get(second.leadId)?.source).toBe('code');
    expect(checkDetailQuestion('You are not eligible, are you?', first)).toBeNull();
    expect(checkDetailQuestion(good, first)).toBe(good);
  });

  it('falls back to the template when there is no model or it fails, and always returns every candidate', async () => {
    expect((await writeDetailQuestions([first], null)).get(first.leadId)?.source).toBe('code');
    const failing = scriptedLlm(() => { throw new Error('boom'); });
    expect((await writeDetailQuestions([first, second], failing)).size).toBe(2);
  });

  it('keeps model wording so the same question has the same words next turn without another call', async () => {
    const cache = createDetailCache();
    const llm = reply([entry(first.leadId, good)]);
    await writeDetailQuestions([first], llm, cache);
    const again = scriptedLlm(() => { throw new Error('should not be called'); });
    expect((await writeDetailQuestions([first], again, cache)).get(first.leadId)?.text).toBe(good);
    expect(again.calls).toHaveLength(0);
    expect(shownWording(first.leadId, consult, cache)).toBe(good);
    expect(shownWording('req-0000ffff', consult)).toMatch(/^The notice says "/);
  });

  it('words checklist groups by code and never asks the model about them', async () => {
    const group = detailCandidates(base).find((c) => c.category === 'application')!;
    const llm = scriptedLlm(() => { throw new Error('should not be called'); });
    expect((await writeDetailQuestions([group], llm)).get(group.leadId)).toEqual({ text: templateQuestion(group), source: 'code', spec: { type: 'yes_no' } });
    expect(llm.calls).toHaveLength(0);
  });

  it('turns a candidate into the question the page receives, with the requirement as its reason', () => {
    const q = toDetailQuestion(first, { text: good, source: 'model', spec: { type: 'yes_no', reason: 'It is about having something.' } });
    expect(q).toMatchObject({ group: `detail:${first.leadId}`, kind: 'detail', factKeys: [], requirementIds: [consult.id], text: good, answerType: 'yes_no', reason: 'It is about having something.' });
    expect(q.because[0]).toMatchObject({ requirementId: consult.id, title: consult.title });
  });
});

describe('listedWording (requirements listed, not asked)', () => {
  it('uses the template, or the model wording if one was written for it before, and never calls a model', () => {
    const [first] = detailCandidates(base);
    expect(listedWording(first)).toEqual({ text: templateQuestion(first), source: 'code', spec: { type: 'yes_no' } });
    const cache = createDetailCache();
    cache.set(detailCacheKey(first), { text: 'Do you have the consultation documentation?', source: 'model', spec: { type: 'yes_no' } });
    expect(listedWording(first, cache)).toMatchObject({ text: 'Do you have the consultation documentation?', source: 'model' });
  });

  it('puts the category on the question the page receives, so the drawer can group them', () => {
    const [first] = detailCandidates(base);
    expect(toDetailQuestion(first, listedWording(first)).category).toBe('eligibility');
  });
});

describe('near-duplicate requirements', () => {
  it('treats the same rule worded twice as one, but not different rules that share words', () => {
    expect(similarTitles('States must demonstrate necessity beyond MCSAP allocation to request equipment', 'States must demonstrate necessity beyond MCSAP allocation for equipment requests')).toBe(true);
    expect(similarTitles('Maximum four projects per application', 'Application narrative page limit of 35 pages')).toBe(false);
    expect(similarTitles('', 'anything')).toBe(false);
  });

  it('asks the twin once', () => {
    const a = req({ id: 'req-0000d001', category: 'funding', topic: 'budget', title: 'States must demonstrate necessity beyond allocation to request equipment' });
    const b = req({ id: 'req-0000d002', category: 'funding', topic: 'budget', title: 'States must demonstrate necessity beyond allocation for equipment requests' });
    const out = detailCandidates({ findings: [a, b].map((r) => unknownFinding(r)), requirements: [a, b], answers: {}, skipped: [] });
    expect(out.map((c) => c.leadId)).toEqual([a.id]);
  });
});

describe('the model chooses the kind of question, and code checks it', () => {
  const [first, second] = detailCandidates(base); // consult (eligibility, no number) and maxProjects ("four projects")
  const entry = (requirementId: string, over: Record<string, unknown>) => ({
    requirementId, type: 'yes_no', reason: 'The requirement asks whether something is done.', question: 'Does your application include the documentation?', options: [], comparison: { op: 'none', value: 0, unit: '' }, ...over,
  });
  const one = async (candidate: typeof first, raw: Record<string, unknown>) =>
    (await writeDetailQuestions([candidate], scriptedLlm(() => llmResult(JSON.stringify({ questions: [raw] }))))).get(candidate.leadId)!;

  it('accepts a number question when the figure is in the requirement ("four" counts as 4), and says why', async () => {
    const out = await one(second, entry(second.leadId, { type: 'number', reason: 'The notice sets a limit on how many projects.', question: 'How many projects will your application include?', comparison: { op: 'at_most', value: 4, unit: 'projects' } }));
    expect(out.source).toBe('model');
    expect(out.spec).toEqual({ type: 'number', reason: 'The notice sets a limit on how many projects.', comparison: { op: 'at_most', value: 4, unit: 'projects' } });
  });

  it('falls back to the yes/no template when a number question\'s figure is not in the requirement', async () => {
    const out = await one(second, entry(second.leadId, { type: 'number', question: 'How many projects will your application include?', comparison: { op: 'at_most', value: 9, unit: 'projects' } }));
    expect(out).toEqual({ text: templateQuestion(second), source: 'code', spec: { type: 'yes_no' } });
  });

  it('accepts a choice with 2 to 4 distinct options of which one meets, and shows them with the question', async () => {
    const out = await one(first, entry(first.leadId, {
      type: 'choice', question: 'Which best describes who is applying?',
      options: [{ label: 'A State DOT', outcome: 'meets' }, { label: 'A local agency', outcome: 'does_not_meet' }, { label: 'Another public body', outcome: 'unclear' }],
    }));
    expect(out.spec.type).toBe('choice');
    expect(out.text).toBe('Which best describes who is applying? A) A State DOT; B) A local agency; C) Another public body.');
  });

  it('rejects a choice with too few or too many options, a duplicate, a bad outcome, or none that meets', async () => {
    const bad = (options: unknown) => one(first, entry(first.leadId, { type: 'choice', question: 'Which best describes who is applying?', options }));
    const o = (label: string, outcome = 'meets') => ({ label, outcome });
    for (const options of [[o('Only one')], [o('A'), o('B'), o('C'), o('D'), o('E')], [o('Same'), o('same', 'does_not_meet')], [o('A'), o('B', 'maybe')], [o('A', 'does_not_meet'), o('B', 'unclear')]]) {
      expect((await bad(options)).source).toBe('code');
    }
  });

  it('accepts a describe question that ends with a period, and rejects a yes/no that does not end with a question mark', async () => {
    const described = await one(first, entry(first.leadId, { type: 'describe', question: 'Describe how your agency was consulted.' }));
    expect(described).toMatchObject({ source: 'model', spec: { type: 'describe' } });
    expect((await one(first, entry(first.leadId, { type: 'yes_no', question: 'Describe how your agency was consulted.' }))).source).toBe('code');
  });

  it('rejects an unknown kind and a verdict in the question, and drops a reason that fails the checks without losing the question', async () => {
    expect((await one(first, entry(first.leadId, { type: 'ranking' }))).source).toBe('code');
    expect((await one(first, entry(first.leadId, { question: 'You are not eligible, are you?' }))).source).toBe('code');
    const noReason = await one(first, entry(first.leadId, { reason: 'See https://example.com for why.' }));
    expect(noReason.source).toBe('model');
    expect(noReason.spec.reason).toBeUndefined();
  });

  it('re-checks a spec that came back from the page against the requirement\'s own text', () => {
    const number = { type: 'number' as const, comparison: { op: 'at_most' as const, value: 4, unit: 'projects' } };
    expect(sanitizeSpec(number, maxProjects)).toEqual(number);
    expect(sanitizeSpec({ ...number, comparison: { op: 'at_most', value: 99 } }, maxProjects)).toEqual({ type: 'yes_no' });
    expect(sanitizeSpec({ type: 'choice', options: [{ label: 'A', outcome: 'meets' }] }, consult)).toEqual({ type: 'yes_no' });
    expect(sanitizeSpec(undefined, consult)).toEqual({ type: 'yes_no' });
    expect(sanitizeSpec({ type: 'describe', reason: 'Why.' }, consult)).toEqual({ type: 'describe', reason: 'Why.' });
  });
});
