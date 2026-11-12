import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_ROUNDS, MAX_ROUND_SIZE, QUESTION_STAGES, buildQuestions, pickStage, stageOfCategory, stageOfQuestionGroup } from './questions.js';
import type { Finding } from './schemas.js';

function waiting(id: string, over: Partial<Finding> = {}): Finding {
  return {
    requirementId: id, title: `Requirement ${id}`, category: 'funding', topic: 'other', mandatory: true, status: 'unknown', gap: false,
    method: 'deterministic', provisional: true, explanation: 'x', factsUsed: [], missingFacts: [],
    sources: [{ documentId: 'd', page: 7, section: null, quote: `Quote for ${id}`, authority: 'controlling' }], requirementReviewStatus: 'unreviewed', ...over,
  };
}

describe('buildQuestions', () => {
  it('asks only about facts that stopped a requirement being evaluated, and cites the requirement', () => {
    const q = buildQuestions([waiting('a', { missingFacts: ['requestedFederalUsd'] })]);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ group: 'request', factKeys: ['requestedFederalUsd'] });
    expect(q[0].text).toMatch(/not the total project cost/);
    expect(q[0].because).toEqual([{ requirementId: 'a', title: 'Requirement a', source: expect.objectContaining({ page: 7 }) }]);
  });

  it('asks nothing when nothing is waiting on a fact, and ignores findings that are already decided', () => {
    expect(buildQuestions([])).toEqual([]);
    expect(buildQuestions([waiting('a', { status: 'supported', missingFacts: ['areaType'] }), waiting('b', { missingFacts: [] })])).toEqual([]);
  });

  it('asks at most three, ranked by the most consequential requirement (a hard numeric limit beats many soft items)', () => {
    const many = Array.from({ length: 8 }, (_, i) => waiting(`n${i}`, { method: 'none', mandatory: true, missingFacts: ['environmentalStatus'] }));
    const hard = waiting('limit', { method: 'deterministic', mandatory: true, missingFacts: ['requestedFederalUsd'] });
    const bca = waiting('bca', { method: 'deterministic', mandatory: true, missingFacts: ['bcaCompleted'] });
    const match = waiting('match', { method: 'none', mandatory: true, missingFacts: ['nonFederalMatchUsd', 'matchCommitted'] });
    const design = waiting('design', { method: 'none', mandatory: null, missingFacts: ['designStatus'] });
    const q = buildQuestions([...many, design, match, bca, hard]);
    expect(q).toHaveLength(3);
    expect(q.map((x) => x.group)).toEqual(['request', 'bca', 'costMatch']); // not environmental, despite 8 related items
  });

  it('combines cost, match and commitment into one question', () => {
    const q = buildQuestions([waiting('a', { missingFacts: ['totalProjectCostUsd', 'nonFederalMatchUsd'] }), waiting('b', { missingFacts: ['matchCommitted'] })]);
    expect(q).toHaveLength(1);
    expect(q[0].group).toBe('costMatch');
    expect(q[0].factKeys.sort()).toEqual(['matchCommitted', 'nonFederalMatchUsd', 'totalProjectCostUsd']);
    expect(q[0].text).toMatch(/is that match committed/);
  });

  it('lists at most three supporting requirements per question, most consequential first', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => waiting(id, { mandatory: i === 4 ? true : null, method: i === 4 ? 'deterministic' : 'none', missingFacts: ['areaType'] }));
    const [q] = buildQuestions(items);
    expect(q.because).toHaveLength(3);
    expect(q.because[0].requirementId).toBe('e');
  });

  it('honors a different maximum', () => {
    const items = [waiting('a', { missingFacts: ['requestedFederalUsd'] }), waiting('b', { missingFacts: ['areaType'] })];
    expect(buildQuestions(items, 1)).toHaveLength(1);
  });

  it('asks whether the organization is on the notice\'s list first, ahead of the request, and cites the rule', () => {
    const list = waiting('list', { missingFacts: ['onNoticeList'] });
    const request = waiting('request', { missingFacts: ['requestedFederalUsd'] });
    const q = buildQuestions([request, list]);
    expect(q.map((x) => x.group)).toEqual(['listed', 'request']);
    expect(q[0].text).toMatch(/specific organizations/);
    expect(q[0].because[0]).toMatchObject({ requirementId: 'list' });
  });

  it('does not ask about facts the applicant said they do not know yet, but still asks about the rest', () => {
    const findings = [waiting('a', { missingFacts: ['onNoticeList'] }), waiting('b', { missingFacts: ['requestedFederalUsd'] })];
    expect(buildQuestions(findings).map((q) => q.group)).toEqual(['listed', 'request']);
    expect(buildQuestions(findings, 3, ['onNoticeList']).map((q) => q.group)).toEqual(['request']);
    expect(buildQuestions(findings, 3, ['onNoticeList', 'requestedFederalUsd'])).toEqual([]);
  });
});

describe('the three stages of questions', () => {
  it('puts each fixed question and each requirement category in a stage: who you are, then the money, then readiness', () => {
    expect(['listed', 'applicant', 'area', 'category'].map(stageOfQuestionGroup)).toEqual([1, 1, 1, 1]);
    expect(['request', 'costMatch'].map(stageOfQuestionGroup)).toEqual([2, 2]);
    expect(['bca', 'design', 'environmental', 'description'].map(stageOfQuestionGroup)).toEqual([3, 3, 3, 3]);
    expect(['eligibility', 'funding', 'readiness', 'application', undefined].map(stageOfCategory)).toEqual([1, 2, 3, 3, 3]);
    expect(QUESTION_STAGES.map((s) => s.index)).toEqual([1, 2, 3]);
    for (const stage of QUESTION_STAGES) expect(stage.why.length).toBeGreaterThan(20);
  });

  it('a new message moves on to the next stage that has anything open, skipping empty ones, and stops after stage 3', () => {
    expect(pickStage([4, 3, 2], 0, true)).toEqual({ stage: 1, size: 4 });
    expect(pickStage([4, 3, 2], 1, true)).toEqual({ stage: 2, size: 3 });
    expect(pickStage([4, 0, 2], 1, true)).toEqual({ stage: 3, size: 2 });
    expect(pickStage([0, 0, 2], 0, true)).toEqual({ stage: 3, size: 2 });
    expect(pickStage([4, 3, 2], 3, true)).toEqual({ stage: 0, size: 0 });
    expect(pickStage([4, 3, 0], 2, true)).toEqual({ stage: 0, size: 0 });
    expect(pickStage([0, 0, 0], 0, true)).toEqual({ stage: 0, size: 0 });
    expect(MAX_QUESTION_ROUNDS).toBe(3);
  });

  it('asks at most ten in a stage', () => {
    expect(pickStage([40, 0, 0], 0, true).size).toBe(MAX_ROUND_SIZE);
    expect(MAX_ROUND_SIZE).toBe(10);
  });

  it('a re-check stays in the stage on screen, and moves on only when everything in it is answered or set aside', () => {
    expect(pickStage([4, 3, 2], 1, false)).toEqual({ stage: 1, size: 4 });
    expect(pickStage([0, 3, 2], 1, false)).toEqual({ stage: 2, size: 3 });
    expect(pickStage([4, 3, 2], 0, false)).toEqual({ stage: 1, size: 4 });
  });
});
