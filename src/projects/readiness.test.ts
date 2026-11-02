import { describe, expect, it } from 'vitest';
import { applyChanges } from './field-paths.js';
import { computeReadiness } from './readiness.js';
import { emptyProfile } from './schemas.js';

const ctx = { actor: 'user' as const, newId: (() => { let n = 0; return () => `i${++n}`; })() };
const full = () =>
  applyChanges(
    emptyProfile('Main Street'),
    [
      { op: 'set', path: 'applicant.type', value: 'city' },
      { op: 'set', path: 'location.state', value: 'WA' },
      { op: 'set', path: 'location.city', value: 'Tacoma' },
      { op: 'set', path: 'need.problem', value: 'Unsafe crossings' },
      { op: 'add', path: 'scope.activities', value: 'Install crosswalks' },
      { op: 'add', path: 'outcomes', value: { description: 'Fewer injuries' } },
    ],
    ctx
  ).profile;

describe('computeReadiness', () => {
  it('counts only the name for a new project and lists the rest as missing', () => {
    const r = computeReadiness(emptyProfile('P'));
    expect(r.completeCount).toBe(1);
    expect(r.requiredCount).toBe(6);
    expect(r.missingFields.map((m) => m.key)).toEqual([
      'applicant.type', 'location', 'need.problem', 'scope.activities', 'outcomes',
    ]);
    expect(r.missingFields.every((m) => m.state === 'missing')).toBe(true);
  });

  it('reaches six of six with all required items', () => {
    const r = computeReadiness(full());
    expect(r.completeCount).toBe(6);
    expect(r.missingFields).toEqual([]);
  });

  it('location needs state plus service area, city or county', () => {
    const p = emptyProfile('P');
    p.location.state = 'WA';
    expect(computeReadiness(p).missingFields.some((m) => m.key === 'location')).toBe(true);
    p.location.county = 'Pierce';
    expect(computeReadiness(p).missingFields.some((m) => m.key === 'location')).toBe(false);
  });

  it('marks explicitly-unknown items "unknown" but never complete', () => {
    const p = emptyProfile('P');
    p.unknowns = ['applicant.type'];
    const r = computeReadiness(p);
    expect(r.missingFields.find((m) => m.key === 'applicant.type')?.state).toBe('unknown');
    expect(r.completeCount).toBe(1);
  });

  it('non-eligible applicant (null type) cannot reach six of six', () => {
    const p = full();
    p.applicant.type = null;
    p.constraints = ['Applicant is a nonprofit'];
    expect(computeReadiness(p).completeCount).toBe(5);
  });

  it('emits separate warnings for budget and readiness gaps without blocking completeness', () => {
    const r = computeReadiness(full());
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['budget.totalCostCents', 'readiness.designStatus'])
    );
    const p = full();
    p.unknowns = ['budget.totalCostCents'];
    expect(computeReadiness(p).warnings.find((w) => w.code === 'budget.totalCostCents')?.message).toMatch(/unknown/);
  });
});
