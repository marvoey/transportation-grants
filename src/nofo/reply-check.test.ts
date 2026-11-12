import { describe, expect, it } from 'vitest';
import { checkReplyText, inspectReplyText, replyMaterial } from './reply-check.js';

const material = replyMaterial('Requested $1,400,000 exceeds the $500,000 maximum. The notice says a maximum of four projects (page 12). Closes 2026-12-28.', [3, 7]);
const long = (s: string) => `${s} ${'This is plain filler text that keeps the reply long enough to pass the length check. '.repeat(2)}`;

describe('checkReplyText', () => {
  it('accepts plain text whose numbers all come from the material, and keeps paragraph breaks', () => {
    const text = long('You asked for $1.4 million, but the notice appears to cap awards at $500,000.\n\nIt may also limit you to four projects (page 12), and it closes on December 28, 2026. Is that right?');
    expect(checkReplyText(text, material, { needsQuestion: true })).toBe(text.trim());
    // Counts supplied by code are allowed too.
    expect(checkReplyText(long('I found 3 points and 7 listings. Does that help?'), material)).not.toBeNull();
  });

  it('rejects a dollar amount or any other number the material does not have', () => {
    expect(inspectReplyText(long('The ceiling is $750,000.'), material).reason).toBe('dollar_amount');
    expect(inspectReplyText(long('You may submit 9 projects.'), material).reason).toBe('number');
    expect(inspectReplyText(long('That is on page 99.'), material).reason).toBe('number');
  });

  it('rejects a verdict on the applicant, a prediction, and a recommendation', () => {
    for (const bad of [
      'You are not eligible for this program.',
      'Your agency is ineligible.',
      'You cannot apply for this.',
      'You will be funded if you fix this.',
      'I guarantee this works.',
      'You should apply to this one.',
      'This is the best program for you.',
      'I recommend you apply now.',
    ]) {
      expect(inspectReplyText(long(bad), material).reason, bad).toBe('verdict');
    }
    // The notice may be described as saying something; that is not a verdict on the applicant.
    expect(checkReplyText(long('The notice says for-profit organizations are ineligible, so it is worth checking who is named.'), material)).not.toBeNull();
  });

  it('rejects markup, links, lists, headings and internal identifiers', () => {
    expect(inspectReplyText(long('See https://example.com for more.'), material).reason).toBe('markup');
    expect(inspectReplyText(long('This is **important**.'), material).reason).toBe('markup');
    expect(inspectReplyText(`- first\n- second\n${long('text')}`, material).reason).toBe('markup');
    expect(inspectReplyText(long('Rule req-13a7186e applies.'), material).reason).toBe('internal_id');
    expect(inspectReplyText(long('As in F2 above.'), material).reason).toBe('internal_id');
    expect(inspectReplyText(long('L1 lines up well and L2 also looks worth a look.'), material).reason).toBe('internal_id');
  });

  it('rejects text that is too short, too long, has too many paragraphs, is not text, or lacks a required question', () => {
    expect(inspectReplyText('Too short.', material).reason).toBe('length');
    expect(inspectReplyText('x'.repeat(2000), material).reason).toBe('length');
    expect(inspectReplyText(Array.from({ length: 7 }, () => long('A paragraph.')).join('\n\n'), material, { maxChars: 9000 }).reason).toBe('paragraphs');
    expect(inspectReplyText(42, material).reason).toBe('not_text');
    expect(inspectReplyText(long('No question here.'), material, { needsQuestion: true }).reason).toBe('no_question');
  });

  it('rejects a question when none is open (a rhetorical "would you like…?" the app cannot act on)', () => {
    expect(inspectReplyText(long('Would you like to pick one of these?'), material, { forbidQuestion: true }).reason).toBe('unexpected_question');
    expect(checkReplyText(long('Pick one and use the button below.'), material, { forbidQuestion: true })).not.toBeNull();
    // Without the limit a question is fine (a question is due).
    expect(checkReplyText(long('Is yours one of them?'), material, { needsQuestion: true })).not.toBeNull();
  });
});

describe('limits for text in the applicant\'s own voice', () => {
  it('lets "we are eligible" wording and invented figures through when asked to, and keeps the other checks', () => {
    const voice = long('We are eligible, and we have nine staff.');
    expect(inspectReplyText(voice, material).reason).toBe('verdict');
    expect(inspectReplyText(voice, material, { allowVerdict: true }).reason).toBe('number');
    expect(checkReplyText(voice, material, { allowVerdict: true, skipNumbers: true })).not.toBeNull();
    expect(inspectReplyText(long('We have a link at https://example.com for you.'), material, { allowVerdict: true, skipNumbers: true }).reason).toBe('markup');
  });
});

