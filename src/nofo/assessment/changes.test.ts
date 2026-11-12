import { describe, expect, it } from 'vitest';
import { diffFindings } from './changes.js';
import type { Finding, FindingStatus } from './schemas.js';

const finding = (id: string, status: FindingStatus, title = `Rule ${id}`): Finding => ({
  requirementId: id, title, category: 'funding', topic: 't', mandatory: true, status, gap: false, method: 'none', provisional: true, explanation: 'x',
  factsUsed: [], missingFacts: [], sources: [], requirementReviewStatus: 'unreviewed',
});

describe('diffFindings (what moved since the last message)', () => {
  it('is null on the first message, when there is nothing to compare with', () => {
    expect(diffFindings(undefined, [finding('req-0000a001', 'unknown')])).toBeNull();
    expect(diffFindings({}, [finding('req-0000a001', 'unknown')])).toBeNull();
  });

  it('counts what became supported as settled and what turned into a conflict or a review item as a new concern', () => {
    const out = diffFindings(
      { 'req-0000a001': 'unknown', 'req-0000a002': 'conflict', 'req-0000a003': 'unknown', 'req-0000a004': 'supported', 'req-0000a005': 'unknown' },
      [finding('req-0000a001', 'supported', 'Consultation documentation'), finding('req-0000a002', 'supported', 'Four-project limit'), finding('req-0000a003', 'conflict', 'Award ceiling'), finding('req-0000a004', 'needs_specialist_review', 'Applicant types'), finding('req-0000a005', 'unknown')]
    )!;
    expect(out.settled).toEqual(['Consultation documentation', 'Four-project limit']);
    expect(out.concerns).toEqual(['Award ceiling', 'Applicant types']);
    expect(out.line).toBe('Since your last message: 2 items settled (Consultation documentation; Four-project limit), and 2 new concerns (Award ceiling; Applicant types).');
  });

  it('says nothing changed, ignores new or unchanged findings, and does not call a worse concern new', () => {
    const out = diffFindings({ 'req-0000a001': 'conflict', 'req-0000a002': 'needs_specialist_review' }, [finding('req-0000a001', 'conflict'), finding('req-0000a002', 'conflict'), finding('req-0000a009', 'conflict')])!;
    expect(out.settled).toEqual([]);
    expect(out.concerns).toEqual([]);
    expect(out.line).toBe('Since your last message, nothing in the findings changed.');
  });

  it('names at most two titles and counts the rest', () => {
    const ids = ['req-0000b001', 'req-0000b002', 'req-0000b003'];
    const out = diffFindings(Object.fromEntries(ids.map((id) => [id, 'unknown'])), ids.map((id) => finding(id, 'supported')))!;
    expect(out.line).toBe('Since your last message: 3 items settled (Rule req-0000b001; Rule req-0000b002; and 1 more).');
  });
});
