import { describe, expect, it } from 'vitest';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { facts } from '../__fixtures__/assessment.js';
import type { Question } from './schemas.js';
import { SUGGEST_SYSTEM_PROMPT, buildSuggestUserMessage, checkSuggestedReply, writeSuggestedReply, type SuggestInput } from './suggest.js';

const fixed: Question = { group: 'request', kind: 'fact', factKeys: ['requestedFederalUsd'], text: 'How much federal funding do you plan to request?', because: [] };
const numberQ: Question = {
  group: 'detail:req-0000a001', kind: 'detail', factKeys: [], answerType: 'number', text: 'How many projects will your application include?', because: [],
  spec: { type: 'number', comparison: { op: 'at_most', value: 4, unit: 'projects' } },
};
const choiceQ: Question = {
  group: 'detail:req-0000a002', kind: 'detail', factKeys: [], answerType: 'choice', text: 'Who is applying? A) A State DOT; B) A local agency.', because: [],
  spec: { type: 'choice', options: [{ label: 'A State DOT', outcome: 'meets' }, { label: 'A local agency', outcome: 'does_not_meet' }] },
};
const input: SuggestInput = { opportunityTitle: 'Test Program', facts: facts({ applicantType: 'state', requestedFederalUsd: 400_000 }), questions: [fixed, numberQ, choiceQ] };
const human = "We're hoping to ask for about $400,000, and we'll keep it to three projects so we stay under the limit. We're a state agency, so on who's applying that's the State DOT side of things. We've already lined up six troopers and a couple of vehicles.";
const reply = (text: unknown) => scriptedLlm(() => llmResult(JSON.stringify({ reply: text })));

describe('buildSuggestUserMessage', () => {
  it('gives the model the facts (money written as dollars), and each question with its type, options and limit, in order', () => {
    const user = buildSuggestUserMessage(input);
    expect(user).toContain('"requestedFederalUsd":"$400,000"');
    expect(user.indexOf('How much federal funding')).toBeLessThan(user.indexOf('How many projects'));
    expect(user).toContain('"type": "number"');
    expect(user).toContain('"limit": "at most 4 projects"');
    expect(user).toContain('A State DOT (meets the requirement)');
    expect(user).toContain('A local agency (does not meet it)');
  });
});

describe('checkSuggestedReply', () => {
  it('accepts a natural reply with small invented figures, an amount already in the facts, and "we are eligible" wording', () => {
    expect(checkSuggestedReply(human, input)).toBe(human);
    expect(checkSuggestedReply("We're confident we are eligible, and we have nine staff on it.", input)).not.toBeNull();
  });

  it('rejects markup or links, a question, an internal id, a dollar amount that is not in the facts or the questions, and text that is too short', () => {
    for (const bad of ['**We do** have it and we are ready to go ahead with it.', 'See https://example.com because we are ready to go ahead with it.', 'We are ready to go ahead, are you?', 'This is covered by req-0000a001 and we are ready to go ahead.', 'We are asking for $900,000 this time, and we are ready to go ahead with it.', 'Yes.']) {
      expect(checkSuggestedReply(bad, input), bad).toBeNull();
    }
  });

  it('mends a missing space after a sentence but leaves abbreviations alone', () => {
    expect(checkSuggestedReply('We have the letter on file.We believe that covers it for the U.S. side of things too.', input)).toBe('We have the letter on file. We believe that covers it for the U.S. side of things too.');
  });
});

describe('writeSuggestedReply', () => {
  it('asks for nothing when no question is being asked', async () => {
    expect(await writeSuggestedReply({ ...input, questions: [] }, reply(human))).toBeNull();
  });

  it('uses the model\'s reply when it passes the checks', async () => {
    const llm = reply(human);
    expect(await writeSuggestedReply(input, llm)).toEqual({ text: human, source: 'model' });
    expect(llm.calls[0].system).toBe(SUGGEST_SYSTEM_PROMPT);
  });

  it('gives an empty reply with a reason (so the page uses its template) when there is no model, the call fails, or the text is rejected', async () => {
    expect(await writeSuggestedReply(input, null)).toMatchObject({ text: '', source: 'code', fallbackReason: 'no_model' });
    expect(await writeSuggestedReply(input, scriptedLlm(() => { throw new Error('boom'); }))).toMatchObject({ text: '', fallbackReason: 'call_failed' });
    expect(await writeSuggestedReply(input, reply('Is this a question?'))).toMatchObject({ text: '', fallbackReason: 'rejected' });
    expect(await writeSuggestedReply(input, scriptedLlm(() => llmResult('{}', { stopReason: 'max_tokens' })))).toMatchObject({ fallbackReason: 'max_tokens' });
  });
});
