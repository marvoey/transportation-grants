import { describe, expect, it } from 'vitest';
import {
  ALL_PATHS,
  ChangeError,
  applyChanges,
  basisHolds,
  computeBasis,
  validateChange,
} from './field-paths.js';
import { emptyProfile } from './schemas.js';

let n = 0;
const ctx = (actor: 'user' | 'agent' = 'user') => ({ actor, newId: () => `id-${++n}` });
const apply = (changes: unknown[], actor: 'user' | 'agent' = 'user', p = emptyProfile('P')) =>
  applyChanges(p, changes, ctx(actor));

describe('field path allowlist', () => {
  it('rejects unknown and forbidden paths', () => {
    for (const path of [
      'ownerId', 'id', 'revision', 'status', 'createdAt', 'budget.currency', 'fieldMetadata',
      'readinessAssessment', 'profile.name', '__proto__', 'applicant', 'need.evidence.0.verified',
    ]) {
      expect(() => validateChange({ op: 'set', path, value: 'x' }, 'user'), path).toThrow(ChangeError);
    }
  });

  it('rejects operations a path does not allow', () => {
    expect(() => validateChange({ op: 'add', path: 'name', value: 'x' }, 'user')).toThrow(/not allowed/);
    expect(() => validateChange({ op: 'set', path: 'scope.activities', value: 'x' }, 'user')).toThrow(/not allowed/);
    expect(() => validateChange({ op: 'set', path: 'outcomes', value: {} }, 'user')).toThrow(/not allowed/);
    expect(() => validateChange({ op: 'update', path: 'constraints', value: 'x' }, 'user')).toThrow(/not allowed/);
  });

  it('rejects unknown change keys and item fields', () => {
    expect(() => validateChange({ op: 'set', path: 'name', value: 'x', extra: 1 }, 'user')).toThrow();
    expect(() => apply([{ op: 'add', path: 'outcomes', value: { description: 'd', id: 'forced' } }])).toThrow();
    expect(() =>
      apply([{ op: 'add', path: 'need.evidence', value: { description: 'd', verified: true } }])
    ).toThrow();
    expect(() =>
      apply([{ op: 'add', path: 'need.evidence', value: { description: 'd', suppliedBy: 'user' } }])
    ).toThrow();
  });

  it('requires a value (null = unknown) and forbids null name', () => {
    expect(() => validateChange({ op: 'set', path: 'summary' }, 'user')).toThrow(/required/);
    expect(validateChange({ op: 'set', path: 'summary', value: null }, 'user').value).toBeNull();
    expect(() => validateChange({ op: 'set', path: 'name', value: null }, 'user')).toThrow(/null/);
  });

  it('exposes every Appendix A path', () => {
    expect(ALL_PATHS).toContain('need.evidence');
    expect(ALL_PATHS).toContain('readiness.rightOfWayStatus');
    expect(ALL_PATHS).toHaveLength(32);
  });
});

describe('applyChanges', () => {
  it('sets scalars, preserving null vs value', () => {
    const r = apply([
      { op: 'set', path: 'applicant.type', value: 'city' },
      { op: 'set', path: 'location.state', value: 'wa' },
      { op: 'set', path: 'budget.totalCostCents', value: 0 },
    ]);
    expect(r.profile.applicant.type).toBe('city');
    expect(r.profile.location.state).toBe('WA');
    expect(r.profile.budget.totalCostCents).toBe(0);
    expect(r.touched).toEqual(expect.arrayContaining(['applicant.type', 'location.state']));
  });

  it('is all-or-none', () => {
    const p = emptyProfile('P');
    expect(() =>
      apply(
        [
          { op: 'set', path: 'summary', value: 'ok' },
          { op: 'set', path: 'applicant.type', value: 'nonprofit' },
        ],
        'user',
        p
      )
    ).toThrow(ChangeError);
    expect(p.summary).toBeNull();
  });

  it('adds server ids and sets suppliedBy from the actor', () => {
    const r = apply([{ op: 'add', path: 'need.evidence', value: { description: 'crash data' } }], 'agent');
    const e = r.profile.need.evidence[0];
    expect(e.id).toMatch(/^id-/);
    expect(e).toMatchObject({ suppliedBy: 'agent', verified: false, sourceUrl: null });
  });

  it('agent assumptions are always unconfirmed and cannot be confirmed', () => {
    const r = apply([{ op: 'add', path: 'assumptions', value: { text: 'City applicant' } }], 'agent');
    expect(r.profile.assumptions[0].confirmed).toBe(false);
    expect(() =>
      apply([{ op: 'add', path: 'assumptions', value: { text: 'x', confirmed: true } }], 'agent')
    ).toThrow();
    const id = r.profile.assumptions[0].id;
    expect(() =>
      apply([{ op: 'update', path: 'assumptions', itemId: id, value: { confirmed: true } }], 'agent', r.profile)
    ).toThrow();
    const confirmed = apply(
      [{ op: 'update', path: 'assumptions', itemId: id, value: { confirmed: true } }],
      'user',
      r.profile
    );
    expect(confirmed.profile.assumptions[0].confirmed).toBe(true);
  });

  it('updates and removes object items by id', () => {
    const a = apply([{ op: 'add', path: 'outcomes', value: { description: 'Fewer crashes', target: 10 } }]);
    const id = a.profile.outcomes[0].id;
    const b = apply([{ op: 'update', path: 'outcomes', itemId: id, value: { unit: '%' } }], 'user', a.profile);
    expect(b.profile.outcomes[0]).toMatchObject({ description: 'Fewer crashes', target: 10, unit: '%' });
    const c = apply([{ op: 'remove', path: 'outcomes', itemId: id }], 'user', b.profile);
    expect(c.profile.outcomes).toEqual([]);
    expect(() => apply([{ op: 'remove', path: 'outcomes', itemId: 'nope' }], 'user', c.profile)).toThrow(/not found/);
  });

  it('dedupes string-list adds and errors on removing a missing value', () => {
    const a = apply([
      { op: 'add', path: 'scope.activities', value: 'Crosswalks' },
      { op: 'add', path: 'scope.activities', value: 'Crosswalks' },
    ]);
    expect(a.profile.scope.activities).toEqual(['Crosswalks']);
    expect(() => apply([{ op: 'remove', path: 'scope.activities', value: 'Nope' }], 'user', a.profile)).toThrow();
  });

  it('unknowns must be allowlisted paths and are cleared when a value arrives', () => {
    expect(() => apply([{ op: 'add', path: 'unknowns', value: 'ownerId' }])).toThrow(/allowlisted/);
    expect(() => apply([{ op: 'add', path: 'unknowns', value: 'name' }])).toThrow(/allowlisted/);
    const a = apply([{ op: 'add', path: 'unknowns', value: 'budget.totalCostCents' }]);
    expect(a.profile.unknowns).toEqual(['budget.totalCostCents']);
    const b = apply([{ op: 'set', path: 'budget.totalCostCents', value: 5000 }], 'user', a.profile);
    expect(b.profile.unknowns).toEqual([]);
    const c = apply([{ op: 'add', path: 'unknowns', value: 'scope.activities' }]);
    const d = apply([{ op: 'add', path: 'scope.activities', value: 'Paving' }], 'user', c.profile);
    expect(d.profile.unknowns).toEqual([]);
  });

  it('rejects resulting profiles that break cross-field rules as INVALID_PROFILE', () => {
    try {
      apply([
        { op: 'set', path: 'schedule.startDate', value: '2027-05-01' },
        { op: 'set', path: 'schedule.endDate', value: '2027-04-01' },
      ]);
      expect.unreachable();
    } catch (e) {
      expect((e as ChangeError).code).toBe('INVALID_PROFILE');
    }
  });
});

describe('basis', () => {
  it('records the precondition and detects conflicts per change', () => {
    const p0 = apply([{ op: 'set', path: 'location.city', value: 'Tacoma' }]).profile;
    const change = validateChange({ op: 'set', path: 'location.city', value: 'Seattle' }, 'agent');
    const basis = computeBasis(p0, change);
    expect(basis).toBe('Tacoma');
    expect(basisHolds(p0, change, basis)).toBe(true);
    const p1 = apply([{ op: 'set', path: 'location.city', value: 'Olympia' }], 'user', p0).profile;
    expect(basisHolds(p1, change, basis)).toBe(false);
  });

  it('add has no basis and never conflicts; removed items conflict', () => {
    const p0 = apply([{ op: 'add', path: 'outcomes', value: { description: 'x' } }]).profile;
    const add = validateChange({ op: 'add', path: 'outcomes', value: { description: 'y' } }, 'agent');
    expect(computeBasis(p0, add)).toBeUndefined();
    expect(basisHolds(p0, add, undefined)).toBe(true);

    const upd = validateChange({ op: 'update', path: 'outcomes', itemId: p0.outcomes[0].id, value: { unit: 'u' } }, 'agent');
    const basis = computeBasis(p0, upd);
    expect(basisHolds(p0, upd, basis)).toBe(true);
    const p1 = apply([{ op: 'remove', path: 'outcomes', itemId: p0.outcomes[0].id }], 'user', p0).profile;
    expect(basisHolds(p1, upd, basis)).toBe(false);
  });
});
