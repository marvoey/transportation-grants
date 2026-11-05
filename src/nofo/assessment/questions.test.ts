import { describe, expect, it } from 'vitest';
import { buildQuestions } from './questions.js';
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
});
