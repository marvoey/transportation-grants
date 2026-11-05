import { describe, expect, it } from 'vitest';
import {
  EXTRACTED_CATEGORIES,
  REQUIREMENT_TOPICS,
  WIRE_JSON_SCHEMA,
  WireEnvelopeSchema,
  WireRequirementSchema,
  toCandidate,
} from './schemas.js';
import { NO_CHECK, wire } from '../__fixtures__/extraction.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const itemSchema = ((WIRE_JSON_SCHEMA as Json).properties.requirements as Json).items as Json;

describe('wire schema and Zod stay in step', () => {
  it('requires every property it declares (structured outputs need that), with no extras allowed', () => {
    expect(itemSchema.additionalProperties).toBe(false);
    expect([...itemSchema.required].sort()).toEqual(Object.keys(itemSchema.properties).sort());
    const check = itemSchema.properties.check as Json;
    expect(check.additionalProperties).toBe(false);
    expect([...check.required].sort()).toEqual(Object.keys(check.properties).sort());
  });

  it('declares exactly the properties the Zod schema accepts', () => {
    expect(Object.keys(itemSchema.properties).sort()).toEqual(Object.keys(WireRequirementSchema.shape).sort());
  });

  it('uses the same enums as the code', () => {
    expect(itemSchema.properties.category.enum).toEqual([...EXTRACTED_CATEGORIES]);
    expect(itemSchema.properties.topic.enum).toEqual([...REQUIREMENT_TOPICS]);
  });

  it('a requirement in the shape the schema describes passes Zod', () => {
    expect(WireRequirementSchema.safeParse(wire()).success).toBe(true);
  });
});

describe('toCandidate', () => {
  it('converts flat wire values into the persisted shapes', () => {
    const c = toCandidate(
      wire({ mandatory: 'unclear', programVariant: 'unspecified', sources: [{ documentId: ' d ', page: 0, section: ' ', quote: ' q ' }] })
    );
    expect(c.mandatory).toBeNull();
    expect(c.programVariant).toBeNull();
    expect(c.sources).toEqual([{ documentId: 'd', page: null, section: null, quote: 'q' }]);
    expect(toCandidate(wire({ mandatory: 'yes' })).mandatory).toBe(true);
    expect(toCandidate(wire({ mandatory: 'no' })).mandatory).toBe(false);
  });

  it('builds typed checks and drops "none"', () => {
    expect(toCandidate(wire({ check: NO_CHECK })).check).toBeUndefined();
    expect(toCandidate(wire()).check).toEqual({
      kind: 'amount_min',
      amountUsd: 5_000_000,
      appliesTo: { areaType: 'urban', grantCategory: 'capital' },
    });
    expect(toCandidate(wire({ check: { ...NO_CHECK, kind: 'document_required', documentKey: 'bca' } })).check).toEqual({ kind: 'document_required', documentKey: 'bca' });
    expect(toCandidate(wire({ check: { ...NO_CHECK, kind: 'federal_share_max_pct', pct: 80 } })).check).toMatchObject({ kind: 'federal_share_max_pct', pct: 80 });
  });

  it('drops (never repairs) a malformed check', () => {
    expect(toCandidate(wire({ check: { ...NO_CHECK, kind: 'amount_min', amountUsd: 0 } })).check).toBeUndefined(); // not positive
    expect(toCandidate(wire({ check: { ...NO_CHECK, kind: 'federal_share_max_pct', pct: 250 } })).check).toBeUndefined(); // over 100
    expect(toCandidate(wire({ check: { ...NO_CHECK, kind: 'applicant_type_in', values: [] } })).check).toBeUndefined(); // empty list
  });
});

describe('WireEnvelopeSchema', () => {
  it('accepts any array of items so one bad item cannot discard a batch', () => {
    expect(WireEnvelopeSchema.safeParse({ requirements: [wire(), { nonsense: true }] }).success).toBe(true);
    expect(WireEnvelopeSchema.safeParse({ requirements: 'no' }).success).toBe(false);
    expect(WireEnvelopeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects out-of-vocabulary values item by item', () => {
    expect(WireRequirementSchema.safeParse(wire({ category: 'post_award' as never })).success).toBe(false);
    expect(WireRequirementSchema.safeParse(wire({ topic: 'made_up' as never })).success).toBe(false);
    expect(WireRequirementSchema.safeParse(wire({ sources: [] })).success).toBe(false);
  });
});
