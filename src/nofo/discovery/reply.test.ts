import { describe, expect, it } from 'vitest';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { EMPTY_PROFILE, type ProjectProfile, type ShortlistItem } from './schemas.js';
import { FIND_REPLY_SYSTEM_PROMPT, codeFindReply, writeFindReply, type FindReplyInput } from './reply.js';

function item(id: string, over: Partial<ShortlistItem> = {}): ShortlistItem {
  return {
    opportunityId: id, opportunityNumber: `N-${id}`, title: `Program ${id}`, agency: 'DOT', status: 'posted', historical: false, closeDate: '2026-12-28', postDate: null,
    awardCeiling: 500_000, awardFloor: null, isCostSharing: null, applicantTypes: [], match: 'likely', whyItMayFit: ['Its description mentions "safety"'],
    watchOuts: ['Maximum award ($500K) is below your stated request ($1.4 million)'], otherEditions: 0, additionalInfoUrl: null, simplerUrl: null, ...over,
  };
}
const profile: ProjectProfile = { ...EMPTY_PROFILE, projectTypes: [{ value: 'safety', quote: 'crashes' }], applicantType: { value: 'state', quote: 'state patrol' }, federalAskUsd: { value: 1_400_000, quote: '$1.4 million' } };
const input: FindReplyInput = { messages: ['We are a state patrol and would request $1.4 million.'], profile, shown: [item('1'), item('2')], examined: 11, listed: 11, questions: [] };

const GOOD = 'It sounds like you are a state agency with a safety project and a request of about $1.4 million.\n\nProgram 1 looks worth a look because its description mentions safety, though its maximum award of $500,000 is below your request, and it closes on 2026-12-28. Nine more listings are further down.\n\nWhen you are ready, pick one and choose "Assess my project against this" to see what its notice asks.';
const reply = (text: unknown, mentions: unknown = ['L1']) => scriptedLlm(() => llmResult(JSON.stringify({ reply: text, mentions })));

describe('writeFindReply', () => {
  it('shows the model the understood project and the first listings with handles, and only those', async () => {
    const llm = reply(GOOD);
    await writeFindReply(input, llm);
    expect(llm.calls[0].system).toBe(FIND_REPLY_SYSTEM_PROMPT);
    expect(llm.calls[0].user).toContain('"handle": "L1"');
    expect(llm.calls[0].user).toContain('<understood>');
    expect(llm.calls[0].user).toContain('$500,000');
  });

  it('uses model text that passes, with the listings it relied on', async () => {
    const out = await writeFindReply(input, reply(GOOD, ['L1']));
    expect(out).toMatchObject({ source: 'model', mentions: ['1'] });
  });

  it('falls back, with a reason, for a made-up number, a recommendation, an unknown listing or no listing cited', async () => {
    expect((await writeFindReply(input, reply(GOOD.replace('$500,000', '$900,000')))).fallbackReason).toBe('dollar_amount');
    expect((await writeFindReply(input, reply(`${GOOD} You should apply to Program 1.`))).fallbackReason).toBe('verdict');
    expect((await writeFindReply(input, reply(GOOD, ['L7']))).fallbackReason).toBe('unknown_listing');
    expect((await writeFindReply(input, reply(GOOD, []))).fallbackReason).toBe('no_listings_cited');
  });

  it('requires the open question to be asked, and falls back without a model', async () => {
    const withQuestion = { ...input, questions: [{ id: 'request' as const, text: 'Roughly how much federal funding would you request?' }] };
    expect((await writeFindReply(withQuestion, reply(GOOD))).fallbackReason).toBe('no_question');
    expect((await writeFindReply(withQuestion, reply(`${GOOD.replace(/\.$/, '')} Roughly how much would you ask for?`))).source).toBe('model');
    expect((await writeFindReply(input, null)).fallbackReason).toBe('no_model');
  });
});

describe('codeFindReply (the template)', () => {
  it('names the closest listing, carries its first caution, and points to Assess', () => {
    const out = codeFindReply(input);
    expect(out.source).toBe('code');
    expect(out.text).toContain('"Program 1"');
    expect(out.text).toContain('Maximum award');
    expect(out.text).toContain('Assess my project against this');
    expect(out.mentions).toEqual(['1']);
  });

  it('says plainly when there is nothing to show', () => {
    expect(codeFindReply({ ...input, shown: [], listed: 0 }).text).toMatch(/did not find a listing/);
  });
});

describe('follow-ups (the reply sees the one before it, and the latest message)', () => {
  const followUp: FindReplyInput = { ...input, messages: ['We are a state patrol and would request $1.4 million.', 'Yes'], latestMessage: 'Yes', previousReply: 'Program 1 looks worth a look. Do you want 99 more?', isFollowUp: true };

  it('shows the model the latest message and the previous reply as delimited context, only on a follow-up', async () => {
    const llm = reply('Thanks. Nothing in that changes the list. Use the button under my message to see what its notice asks.');
    await writeFindReply(followUp, llm);
    expect(llm.calls[0].user).toContain('<latest_applicant_message>\nYes\n</latest_applicant_message>');
    expect(llm.calls[0].user).toContain('<previous_reply>');
    const first = reply(GOOD);
    await writeFindReply({ ...input, previousReply: 'earlier', latestMessage: 'x' }, first);
    expect(first.calls[0].user).not.toContain('<previous_reply>');
    expect(first.calls[0].user).not.toContain('<latest_applicant_message>');
  });

  it('does not let the previous reply or the applicant\'s message introduce a number', async () => {
    // "99" is only in the previous reply, so a reply that uses it is rejected.
    const out = await writeFindReply(followUp, reply('Thanks. There are 99 more listings, and the button under my message shows what the first one asks.'));
    expect(out).toMatchObject({ source: 'code', fallbackReason: 'number' });
  });

  it('rejects a rhetorical question when no question is open, and accepts a short direct answer', async () => {
    expect((await writeFindReply(followUp, reply('Great. Would you like to pick one of these listings to assess?'))).fallbackReason).toBe('unexpected_question');
    const ok = await writeFindReply(followUp, reply('Thanks. Nothing in that changes the list; use the button under my message to see what its notice asks.'));
    expect(ok.source).toBe('model');
  });

  it('never lets a handle through', async () => {
    expect((await writeFindReply(followUp, reply('L1 is the closest, and the button under my message starts it.'))).fallbackReason).toBe('internal_id');
  });

  it('uses a short template that does not repeat the introduction', () => {
    const out = codeFindReply(followUp);
    expect(out.text).toMatch(/^Thanks\. Nothing in that changes the list/);
    expect(out.text).not.toContain('?');
    expect(out.text).not.toMatch(/looked through/);
  });
});
