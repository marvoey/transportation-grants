import { describe, expect, it } from 'vitest';
import { RecentOpportunities } from './recent.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('RecentOpportunities', () => {
  it('remembers what it was told and nothing else', () => {
    const recent = new RecentOpportunities();
    recent.remember([A]);
    expect(recent.has(A)).toBe(true);
    expect(recent.has(B)).toBe(false);
  });

  it('matches regardless of letter case', () => {
    const recent = new RecentOpportunities();
    recent.remember([A.toUpperCase()]);
    expect(recent.has(A)).toBe(true);
    expect(recent.has(A.toUpperCase())).toBe(true);
  });

  it('ignores anything that is not a UUID', () => {
    const recent = new RecentOpportunities();
    recent.remember(['../../etc/passwd', 'abc', '', A + '; rm -rf /']);
    expect(recent.has('../../etc/passwd')).toBe(false);
    expect(recent.has('abc')).toBe(false);
  });

  it('forgets an opportunity after the time limit', () => {
    let now = 1_000;
    const recent = new RecentOpportunities(500, 10, () => now);
    recent.remember([A]);
    now += 499;
    expect(recent.has(A)).toBe(true);
    now += 2;
    expect(recent.has(A)).toBe(false);
  });

  it('showing an opportunity again extends its time', () => {
    let now = 0;
    const recent = new RecentOpportunities(1_000, 10, () => now);
    recent.remember([A]);
    now = 900;
    recent.remember([A]);
    now = 1_500;
    expect(recent.has(A)).toBe(true);
  });

  it('keeps at most the newest N, dropping the oldest', () => {
    const recent = new RecentOpportunities(60_000, 2, () => 0);
    recent.remember([A, B, C]);
    expect(recent.has(A)).toBe(false);
    expect(recent.has(B)).toBe(true);
    expect(recent.has(C)).toBe(true);
  });
});
