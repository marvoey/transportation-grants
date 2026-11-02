import { describe, expect, it } from 'vitest';
import { CentsSchema, IsoDateSchema, ProfileSchema, StateCodeSchema, emptyProfile, ProjectSchema } from './schemas.js';

describe('profile schema', () => {
  it('accepts an empty profile with explicit nulls', () => {
    expect(ProfileSchema.safeParse(emptyProfile('Main Street')).success).toBe(true);
  });

  it('distinguishes unknown (null) from zero', () => {
    expect(CentsSchema.safeParse(0).success).toBe(true);
    expect(CentsSchema.safeParse(null).success).toBe(false); // null is handled by .nullable() at the field
    const p = emptyProfile('x');
    p.budget.totalCostCents = 0;
    expect(ProfileSchema.parse(p).budget.totalCostCents).toBe(0);
    p.budget.totalCostCents = null;
    expect(ProfileSchema.parse(p).budget.totalCostCents).toBeNull();
  });

  it('rejects empty strings (unknown is null, not "")', () => {
    const p = emptyProfile('x');
    (p as any).summary = '';
    expect(ProfileSchema.safeParse(p).success).toBe(false);
  });

  it('validates dates, states, money', () => {
    expect(IsoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(IsoDateSchema.safeParse('2026-2-3').success).toBe(false);
    expect(IsoDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(StateCodeSchema.parse(' ca ')).toBe('CA');
    expect(StateCodeSchema.safeParse('ZZ').success).toBe(false);
    expect(CentsSchema.safeParse(-1).success).toBe(false);
    expect(CentsSchema.safeParse(1.5).success).toBe(false);
    expect(CentsSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it('rejects bad enum values and unknown keys', () => {
    const p: any = emptyProfile('x');
    p.applicant.type = 'nonprofit';
    expect(ProfileSchema.safeParse(p).success).toBe(false);
    const q: any = emptyProfile('x');
    q.extra = 1;
    expect(ProfileSchema.safeParse(q).success).toBe(false);
  });

  it('enforces cross-field rules', () => {
    const p = emptyProfile('x');
    p.schedule.startDate = '2027-01-10';
    p.schedule.endDate = '2027-01-01';
    expect(ProfileSchema.safeParse(p).success).toBe(false);

    const q = emptyProfile('x');
    q.budget.totalCostCents = 100;
    q.budget.requestedFundingCents = 101;
    expect(ProfileSchema.safeParse(q).success).toBe(false);
    q.budget.requestedFundingCents = 100;
    q.budget.matchAmountCents = 101;
    expect(ProfileSchema.safeParse(q).success).toBe(false);
    q.budget.matchAmountCents = 10;
    expect(ProfileSchema.safeParse(q).success).toBe(true); // requested + match may differ from total
  });

  it('bounds string and list sizes', () => {
    const p = emptyProfile('x');
    p.name = 'n'.repeat(121);
    expect(ProfileSchema.safeParse(p).success).toBe(false);
    const q = emptyProfile('x');
    q.constraints = Array.from({ length: 51 }, (_, i) => `c${i}`);
    expect(ProfileSchema.safeParse(q).success).toBe(false);
  });

  it('only accepts http(s) evidence URLs and verified:false', () => {
    const p = emptyProfile('x');
    const item = { id: 'e1', description: 'd', sourceUrl: 'javascript:alert(1)', suppliedBy: 'user', verified: false };
    p.need.evidence = [item as any];
    expect(ProfileSchema.safeParse(p).success).toBe(false);
    p.need.evidence = [{ ...item, sourceUrl: 'https://example.com/x' } as any];
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    p.need.evidence = [{ ...item, sourceUrl: null, verified: true } as any];
    expect(ProfileSchema.safeParse(p).success).toBe(false);
  });

  it('rejects an invalid project record', () => {
    expect(ProjectSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });
});
