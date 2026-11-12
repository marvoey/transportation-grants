import { describe, expect, it } from 'vitest';
import { AssessInputSchema, DetailAnswersSchema } from './schemas.js';

const messages = [{ role: 'user', content: 'hello' }];
const answer = { answer: 'yes', quote: 'Yes we do', covers: ['req-0000a001'], question: 'Do you?' };

describe('the detail-question fields of an assessment request', () => {
  it('accepts answers, the questions just shown and the questions set aside', () => {
    const ok = AssessInputSchema.safeParse({
      opportunityId: 'x', messages, answers: { 'req-0000a001': answer }, asked: [{ id: 'req-0000a001', covers: ['req-0000a001'], question: 'Do you?' }], skipDetails: ['req-0000a002'],
    });
    expect(ok.success).toBe(true);
  });

  it('rejects anything that is not shaped like what the app sends', () => {
    const bad = (extra: Record<string, unknown>) => AssessInputSchema.safeParse({ opportunityId: 'x', messages, ...extra }).success;
    expect(bad({ answers: { 'not-an-id': answer } })).toBe(false);
    expect(bad({ answers: { 'req-0000a001': { ...answer, answer: 'maybe' } } })).toBe(false);
    expect(bad({ answers: { 'req-0000a001': { ...answer, covers: [] } } })).toBe(false);
    expect(bad({ answers: { 'req-0000a001': { ...answer, extra: 1 } } })).toBe(false);
    expect(bad({ asked: [{ id: 'req-0000a001', covers: ['<script>'] }] })).toBe(false);
    expect(bad({ asked: Array.from({ length: 6 }, () => ({ id: 'req-0000a001', covers: ['req-0000a001'] })) })).toBe(false);
    expect(bad({ skipDetails: ['nope'] })).toBe(false);
  });

  it('allows at most forty answers', () => {
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`req-${String(i).padStart(8, '0')}`, answer]));
    expect(DetailAnswersSchema.safeParse(many).success).toBe(false);
  });
});

describe('listed requirements in an assessment request', () => {
  const entry = (i: number, extra: Record<string, unknown> = {}) => ({ id: `req-${String(i).padStart(8, '0')}`, covers: [`req-${String(i).padStart(8, '0')}`], ...extra });

  it('allows up to eighty detail questions, marking the ones that were only listed', () => {
    const asked = Array.from({ length: 80 }, (_, i) => entry(i, i > 2 ? { shown: false } : {}));
    expect(AssessInputSchema.safeParse({ opportunityId: 'x', messages, asked }).success).toBe(true);
    expect(AssessInputSchema.safeParse({ opportunityId: 'x', messages, asked: [...asked, entry(99)] }).success).toBe(false);
    expect(AssessInputSchema.safeParse({ opportunityId: 'x', messages, asked: [entry(1, { shown: 'no' })] }).success).toBe(false);
  });
});

describe('kinds of detail question in a request', () => {
  const asked = (spec: unknown) => AssessInputSchema.safeParse({ opportunityId: 'x', messages, asked: [{ id: 'req-0000a001', covers: ['req-0000a001'], spec }] }).success;

  it('accepts a spec for each kind and rejects a malformed one', () => {
    expect(asked({ type: 'yes_no' })).toBe(true);
    expect(asked({ type: 'describe', reason: 'Why.' })).toBe(true);
    expect(asked({ type: 'number', comparison: { op: 'at_most', value: 4, unit: 'projects' } })).toBe(true);
    expect(asked({ type: 'choice', options: [{ label: 'A', outcome: 'meets' }, { label: 'B', outcome: 'unclear' }] })).toBe(true);
    expect(asked({ type: 'ranking' })).toBe(false);
    expect(asked({ type: 'choice', options: [{ label: 'A', outcome: 'meets' }] })).toBe(false);
    expect(asked({ type: 'choice', options: Array.from({ length: 5 }, (_, i) => ({ label: `O${i}`, outcome: 'meets' })) })).toBe(false);
    expect(asked({ type: 'number', comparison: { op: 'sort_of', value: 4 } })).toBe(false);
    expect(asked({ type: 'number', comparison: { op: 'at_most', value: -1 } })).toBe(false);
    expect(asked({ type: 'yes_no', extra: true })).toBe(false);
  });

  it('accepts an answer of each kind and bounds its parts', () => {
    const answer = (extra: Record<string, unknown>) => DetailAnswersSchema.safeParse({ 'req-0000a001': { answer: 'answered', covers: ['req-0000a001'], ...extra } }).success;
    expect(answer({ kind: 'choice', option: 2 })).toBe(true);
    expect(answer({ kind: 'number', number: 5 })).toBe(true);
    expect(answer({ kind: 'describe', text: 'We have staff.' })).toBe(true);
    expect(answer({ kind: 'choice', option: 4 })).toBe(false);
    expect(answer({ kind: 'number', number: -3 })).toBe(false);
    expect(answer({ kind: 'describe', text: 'x'.repeat(1001) })).toBe(false);
    expect(answer({ kind: 'poem' })).toBe(false);
  });
});

describe('the round of questions in an assessment request', () => {
  it('accepts 0 to 3 rounds asked so far and nothing else', () => {
    const ok = (round: unknown) => AssessInputSchema.safeParse({ opportunityId: 'x', messages, round }).success;
    for (const round of [0, 1, 2, 3]) expect(ok(round)).toBe(true);
    for (const round of [-1, 4, 1.5, '2']) expect(ok(round)).toBe(false);
  });
});

describe('the statuses sent back to say what changed', () => {
  const ok = (previous: unknown) => AssessInputSchema.safeParse({ opportunityId: 'x', messages, previous }).success;
  it('accepts a status per finding and rejects anything else', () => {
    expect(ok({ 'req-0000a001': 'unknown', 'req-0000a002': 'needs_specialist_review' })).toBe(true);
    expect(ok({ 'not-an-id': 'unknown' })).toBe(false);
    expect(ok({ 'req-0000a001': 'fine' })).toBe(false);
    const tooMany = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`req-${String(i).padStart(8, '0')}`, 'unknown']));
    expect(ok(tooMany)).toBe(false);
  });
});

describe('requirement ids with a collision suffix (req-f3e1a0c0-2)', () => {
  it('are accepted everywhere a requirement id is sent back, because the extractor makes them when two requirements collide', () => {
    const id = 'req-f3e1a0c0-2';
    const ok = AssessInputSchema.safeParse({
      opportunityId: 'x', messages,
      previous: { [id]: 'unknown' }, skipDetails: [id], asked: [{ id, covers: [id, 'req-799f5f8d-3'] }],
      answers: { [id]: { answer: 'yes', covers: [id] } },
    });
    expect(ok.success).toBe(true);
    expect(AssessInputSchema.safeParse({ opportunityId: 'x', messages, skipDetails: ['req-f3e1a0c0-'] }).success).toBe(false);
    expect(AssessInputSchema.safeParse({ opportunityId: 'x', messages, skipDetails: ['req-f3e1a0c0-2x'] }).success).toBe(false);
  });
});

