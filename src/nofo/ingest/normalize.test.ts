import { describe, expect, it } from 'vitest';
import { matchKey, normalizeForMatch, textContainsQuote } from './normalize.js';

describe('normalizeForMatch', () => {
  it('joins hyphenated line breaks and collapses whitespace', () => {
    expect(normalizeForMatch('The appli-\ncant must   submit\n\tthe form')).toBe('the applicant must submit the form');
  });
  it('unifies quotes, dashes, ligatures and soft hyphens', () => {
    expect(normalizeForMatch('“Smart” — it’s ﬁnal­ly')).toBe('"smart" - it\'s finally');
  });
});

describe('textContainsQuote', () => {
  const page = 'Applicants must pro-\nvide a non-Federal cost share of at\nleast 20 percent of project costs.';
  it('matches despite line breaks, hyphenation and punctuation differences', () => {
    expect(textContainsQuote(page, 'must provide a non-Federal cost share of at least 20 percent')).toBe(true);
    expect(textContainsQuote(page, 'MUST PROVIDE A NON FEDERAL COST SHARE')).toBe(true);
  });
  it('does not match different content', () => {
    expect(textContainsQuote(page, 'at least 30 percent of project costs')).toBe(false);
  });
  it('never matches an empty or punctuation-only quote', () => {
    expect(textContainsQuote(page, '')).toBe(false);
    expect(textContainsQuote(page, ' .,; ')).toBe(false);
  });
  it('matchKey keeps letters and digits only', () => {
    expect(matchKey('A-1, b_2!')).toBe('a1b2');
  });
});
