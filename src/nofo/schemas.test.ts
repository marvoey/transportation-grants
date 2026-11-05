import { describe, expect, it } from 'vitest';
import { GrantServerError } from '../types/index.js';
import { SupplementalConfigSchema, parseOpportunityId } from './schemas.js';

describe('parseOpportunityId', () => {
  it('accepts a UUID and lower-cases / trims it', () => {
    expect(parseOpportunityId('11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111');
    expect(parseOpportunityId('  AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE ')).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it.each([
    ['empty', ''],
    ['not a uuid', 'not-a-uuid'],
    ['opportunity number', 'DTOS59-26-RA-BUILD'],
    ['legacy integer id', '360921'],
    ['path traversal', '../../etc/passwd'],
    ['traversal inside a uuid shape', '11111111-1111-4111-8111-11111111111/../x'],
    ['too long', '1'.repeat(37)],
    ['number', 12345],
    ['undefined', undefined],
    ['object', { id: '11111111-1111-4111-8111-111111111111' }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseOpportunityId(value)).toThrow(GrantServerError);
  });

  it('does not echo the rejected input in the error', () => {
    try {
      parseOpportunityId('SENSITIVE-INPUT-../../x');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('SENSITIVE');
      expect((error as GrantServerError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('SupplementalConfigSchema', () => {
  it('defaults to no sources and no overrides', () => {
    expect(SupplementalConfigSchema.parse({})).toEqual({ sources: [], overrides: {} });
  });

  it('requires exactly one of url or localFile', () => {
    expect(SupplementalConfigSchema.safeParse({ sources: [{ title: 't' }] }).success).toBe(false);
    expect(
      SupplementalConfigSchema.safeParse({ sources: [{ title: 't', url: 'https://a.example.test/x.pdf', localFile: 'x.pdf' }] }).success
    ).toBe(false);
    expect(SupplementalConfigSchema.safeParse({ sources: [{ title: 't', url: 'https://a.example.test/x.pdf' }] }).success).toBe(true);
  });

  it.each(['../x.pdf', '.hidden', 'a/b.pdf', '..', 'a\\b.pdf'])('rejects unsafe localFile %s', (localFile) => {
    expect(SupplementalConfigSchema.safeParse({ sources: [{ title: 't', localFile }] }).success).toBe(false);
  });

  it('defaults curated authority to official_guidance and forbids "metadata" overrides', () => {
    const parsed = SupplementalConfigSchema.parse({ sources: [{ title: 't', localFile: 'faq.pdf' }] });
    expect(parsed.sources[0].authority).toBe('official_guidance');
    expect(SupplementalConfigSchema.safeParse({ overrides: { 'sg-abc': 'metadata' } }).success).toBe(false);
  });
});
