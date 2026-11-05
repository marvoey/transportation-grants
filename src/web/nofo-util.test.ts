import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

// The browser helpers are plain scripts that attach window.NofoUtil. Load them the way a page would.
const source = readFileSync(join(process.cwd(), 'public/js/nofo-util.js'), 'utf-8');
const sandbox: Record<string, unknown> = { URLSearchParams };
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);
const U = sandbox.NofoUtil as any;

const PAGE = 'B. ELIGIBILITY\n2. MINIMUM FUNDING REQUEST\nApplicants for capital projects located in urban areas\nmust request at least $5 million in program funding.\nThere is no minimum for planning.';

describe('finding a quote in a page', () => {
  it('finds it across line breaks, spacing and punctuation differences', () => {
    const parts = U.splitAroundQuote(PAGE, 'Applicants for capital projects located in urban areas must request at least $5 million in program funding.');
    expect(parts.match).toBe('Applicants for capital projects located in urban areas\nmust request at least $5 million in program funding');
    expect(parts.before).toBe('B. ELIGIBILITY\n2. MINIMUM FUNDING REQUEST\n');
    expect(parts.after).toBe('.\nThere is no minimum for planning.');
    expect(parts.before + parts.match + parts.after).toBe(PAGE);
  });

  it('is case-insensitive and tolerant of ligatures and full-width characters (NFKC)', () => {
    expect(U.splitAroundQuote('The ﬁnal ＄５ amount', 'final 5 amount').match).toBe('ﬁnal ＄５ amount');
  });

  it('returns no match (and the whole text) when the quote is not there or is empty', () => {
    expect(U.splitAroundQuote(PAGE, 'completely different words')).toEqual({ before: PAGE, match: '', after: '' });
    expect(U.splitAroundQuote(PAGE, '!!! ...')).toEqual({ before: PAGE, match: '', after: '' });
  });

  it('never splits inside an astral character', () => {
    const text = 'Before 😀 target words here 😀 after';
    const parts = U.splitAroundQuote(text, 'target words here');
    expect(parts.match).toBe('target words here');
    expect(parts.before + parts.match + parts.after).toBe(text);
  });
});

describe('labels', () => {
  it('shows a preparation gap as a gap, never as a conflict', () => {
    expect(U.statusInfo({ status: 'conflict', gap: true })).toMatchObject({ label: 'Preparation gap', kind: 'gap' });
    expect(U.statusInfo({ status: 'conflict', gap: false })).toMatchObject({ label: 'Possible conflict', kind: 'conflict' });
    expect(U.statusInfo({ status: 'unknown', gap: false })).toMatchObject({ label: 'Not yet evaluated', badge: 'badge-secondary' });
    expect(U.statusInfo({ status: 'needs_specialist_review', gap: false }).label).toBe('Needs specialist review');
    expect(U.statusInfo({ status: 'supported', gap: false }).label).toBe('Appears supported');
  });

  it('formats facts for people and falls back safely for unknown keys', () => {
    expect(U.factLabel('requestedFederalUsd')).toBe('Federal funds requested');
    expect(U.factLabel('__proto__')).toBe('__proto__');
    expect(U.formatFactValue('requestedFederalUsd', 18000000)).toBe('$18,000,000');
    expect(U.formatFactValue('bcaCompleted', false)).toBe('No');
    expect(U.formatFactValue('applicantType', 'state')).toBe('State government');
    expect(U.formatFactValue('areaType', 'urban')).toBe('Urban');
    expect(U.formatFactValue('activities', ['paving', 'signals'])).toBe('paving, signals');
  });

  it('labels where a source is, and its authority', () => {
    expect(U.locationLabel({ page: 23, section: null })).toBe('page 23');
    expect(U.locationLabel({ page: null, section: 's4' })).toBe('section s4');
    expect(U.locationLabel({ page: null, section: null })).toBe('location unknown');
    expect(U.authorityLabel('controlling')).toBe('Notice (controlling)');
    expect(U.authorityLabel('official_guidance')).toBe('Official guidance');
    expect(U.authorityLabel('whatever')).toBe('Authority not classified');
  });

  it('orders facts predictably', () => {
    expect(U.orderedFactKeys({ bcaCompleted: 1, applicantType: 1, zzz: 1, requestedFederalUsd: 1 })).toEqual(['applicantType', 'requestedFederalUsd', 'bcaCompleted', 'zzz']);
  });
});

describe('what is sent to the server', () => {
  const msgs = (...roles: string[]) => roles.map((role, i) => ({ role, content: `m${i}` }));

  it('sends at most the newest N messages and never starts with an assistant turn', () => {
    expect(U.windowMessages(msgs('user', 'assistant', 'user', 'assistant', 'user'), 3).map((m: any) => m.content)).toEqual(['m2', 'm3', 'm4']);
    expect(U.windowMessages(msgs('user', 'assistant', 'user', 'assistant', 'user'), 4).map((m: any) => m.content)).toEqual(['m2', 'm3', 'm4']);
    expect(U.windowMessages(msgs('assistant'), 5)).toEqual([]);
    expect(U.windowMessages([], 5)).toEqual([]);
  });

  it('keeps the questions in the assistant turn so a short answer keeps its context, within the server limit', () => {
    const text = U.assistantTurnText('Headline.', [{ text: 'Is it urban or rural?' }, { text: 'Is the match committed?' }]);
    expect(text).toBe('Headline.\nQuestion: Is it urban or rural?\nQuestion: Is the match committed?');
    expect(U.assistantTurnText('x'.repeat(10000), []).length).toBeLessThanOrEqual(4000);
  });

  it('truncates with an ellipsis only when needed', () => {
    expect(U.truncate('short', 10)).toBe('short');
    expect(U.truncate('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('deep links', () => {
  const id = '4d8f5775-0000-4000-8000-000000000001';
  it('reads the mode and a valid opportunity ID', () => {
    expect(U.readParams(`?mode=nofo&opportunity=${id}`)).toEqual({ mode: 'nofo', opportunity: id });
    expect(U.readParams(`?mode=nofo&opportunity=${id.toUpperCase()}`).opportunity).toBe(id);
    expect(U.readParams('')).toEqual({ mode: 'search', opportunity: null });
  });

  it('ignores anything that is not a UUID, so nothing odd reaches a request path', () => {
    expect(U.readParams('?mode=nofo&opportunity=../../etc/passwd').opportunity).toBeNull();
    expect(U.readParams('?mode=evil').mode).toBe('search');
    expect(U.isUuid(id)).toBe(true);
    expect(U.isUuid('nope')).toBe(false);
  });
});
