import { describe, expect, it } from 'vitest';
import { longestCommonSubstring, quotesOverlap } from './quotes.js';
import { RURAL_QUOTE, URBAN_QUOTE } from './__fixtures__/extraction.js';

describe('longestCommonSubstring', () => {
  it('finds the longest shared run', () => {
    expect(longestCommonSubstring('abcdefg', 'xxcdefyy')).toBe(4);
    expect(longestCommonSubstring('abc', 'xyz')).toBe(0);
    expect(longestCommonSubstring('', 'abc')).toBe(0);
  });
});

describe('quotesOverlap', () => {
  it('treats containment as overlap in both modes, ignoring punctuation and line breaks', () => {
    const long = 'Applicants must submit the form.\nThe form is due by the deadline, no exceptions.';
    expect(quotesOverlap(long, 'The form is due by the deadline', 'strict')).toBe(true);
    expect(quotesOverlap('the form is due by the deadline', long, 'loose')).toBe(true);
  });

  it('does not merge two neighbouring sentences that merely start alike (strict)', () => {
    expect(quotesOverlap(URBAN_QUOTE, RURAL_QUOTE, 'strict')).toBe(false);
  });

  it('does not match unrelated text, and never matches empty text', () => {
    expect(quotesOverlap('Each applicant can submit up to three applications.', RURAL_QUOTE, 'loose')).toBe(false);
    expect(quotesOverlap('', RURAL_QUOTE, 'loose')).toBe(false);
    expect(quotesOverlap(' ,. ', ' ;; ', 'strict')).toBe(false);
  });

  it('loose mode accepts a substantial partial overlap that strict mode rejects', () => {
    const a = 'Applicants submitting capital grant applications for projects located in urban areas must request at least five million dollars';
    const b = 'located in urban areas must request at least five million dollars in funding from the department for the project and other unrelated words';
    expect(quotesOverlap(a, b, 'loose')).toBe(true);
    expect(quotesOverlap(a, b, 'strict')).toBe(false);
  });
});
