import { describe, expect, it } from 'vitest';
import type { Advisory } from '../advisory.js';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { facts } from '../__fixtures__/assessment.js';
import { REPLY_SYSTEM_PROMPT, codeReply, replyFindings, writeReply, type ReplyInput } from './reply.js';
import type { Finding, Question } from './schemas.js';

function finding(id: string, over: Partial<Finding> = {}): Finding {
  return {
    requirementId: id, title: `Rule ${id}`, category: 'funding', topic: 't', mandatory: true, status: 'conflict', gap: false, method: 'deterministic', provisional: true,
    explanation: `Explanation for ${id}: the requested $1,400,000 exceeds the $500,000 maximum.`, factsUsed: [], missingFacts: [], requirementReviewStatus: 'unreviewed',
    sources: [{ documentId: 'd', page: 7, section: null, quote: 'q', authority: 'controlling' }], ...over,
  };
}
const conflict = finding('a');
const second = finding('b', { explanation: 'There is a maximum of four projects per application.' });
const fine = finding('c', { status: 'supported', explanation: 'The applicant is a state.' });
const advisory = {
  label: 'Preliminary assessment', headline: 'h', disclaimer: 'd', nextSteps: [],
  counts: { assessed: 3, supported: 1, conflicts: 2, gaps: 0, needsSpecialistReview: 0, unknown: 0, notApplicable: 0 },
  keyFindings: [conflict, second].map((f) => ({ requirementId: f.requirementId, relatedCount: 0, relatedRequirementIds: [], title: f.title, status: f.status, gap: f.gap, provisional: true, text: f.explanation, source: f.sources[0] })),
} as unknown as Advisory;
const question: Question = { group: 'listed', factKeys: ['onNoticeList'], text: 'Is your organization one the notice names?', because: [] };
const input: ReplyInput = { opportunityTitle: 'Test Program', latestMessage: 'We want $1.4 million.', facts: facts({ applicantType: 'state', requestedFederalUsd: 1_400_000 }), advisory, findings: [conflict, second, fine], questions: [question] };

const GOOD = 'You are asking for $1.4 million, but the notice appears to cap awards at $500,000, so that may be a problem as described. It also looks like there may be a limit of four projects in one application.\n\nBefore going further, is your organization one of those the notice names?';
const reply = (text: unknown, mentions: unknown = ['F1']) => scriptedLlm(() => llmResult(JSON.stringify({ reply: text, mentions })));

describe('writeReply (Assess)', () => {
  it('shows the model only checked material: facts, findings with handles, questions; never the notice', async () => {
    const llm = reply(GOOD);
    await writeReply(input, llm);
    const call = llm.calls[0];
    expect(call.system).toBe(REPLY_SYSTEM_PROMPT);
    expect(call.user).toContain('"handle": "F1"');
    expect(call.user).toContain('"handle": "Q1"');
    expect(call.user).toContain('<latest_applicant_message>');
    expect(call.user).not.toContain('"quote"'); // source quotes are not given to the model
  });

  it('uses the model text when it passes the checks, and records which findings it relied on', async () => {
    const out = await writeReply(input, reply(GOOD, ['F1', 'F2']));
    expect(out).toMatchObject({ source: 'model', mentions: ['a', 'b'] });
    expect(out.fallbackReason).toBeUndefined();
  });

  it('falls back to the template, with a reason, when the text has a number that is not in the material', async () => {
    const out = await writeReply(input, reply(GOOD.replace('$500,000', '$600,000')));
    expect(out).toMatchObject({ source: 'code', fallbackReason: 'dollar_amount' });
  });

  it('falls back when it gives a verdict, names a finding it was not shown, cites none, or forgets the question', async () => {
    expect((await writeReply(input, reply(`${GOOD} You are not eligible.`))).fallbackReason).toBe('verdict');
    expect((await writeReply(input, reply(GOOD, ['F9']))).fallbackReason).toBe('unknown_finding');
    expect((await writeReply(input, reply(GOOD, []))).fallbackReason).toBe('no_findings_cited');
    expect((await writeReply(input, reply(GOOD.replace('?', '.')))).fallbackReason).toBe('no_question');
  });

  it('falls back when there is no model, the call fails, or the output cannot be read', async () => {
    expect((await writeReply(input, null)).fallbackReason).toBe('no_model');
    expect((await writeReply(input, scriptedLlm(() => { throw new Error('boom'); }))).fallbackReason).toBe('call_failed');
    expect((await writeReply(input, scriptedLlm(() => llmResult('not json')))).fallbackReason).toBe('call_failed');
    expect((await writeReply(input, scriptedLlm(() => llmResult('{}', { stopReason: 'max_tokens' })))).fallbackReason).toBe('max_tokens');
  });
});

describe('codeReply (the template)', () => {
  it('leads with the most serious finding, asks the first question, and is plain text', () => {
    const out = codeReply(input);
    expect(out.source).toBe('code');
    expect(out.text).toContain('Rule a');
    expect(out.text.trim().endsWith(question.text)).toBe(true);
    expect(out.text).not.toMatch(/req-|\*\*|https?:/);
  });

  it('says nothing runs against the notice only because little can be checked, when there is nothing serious', () => {
    const quiet = { ...input, advisory: { ...advisory, keyFindings: [] } as Advisory, questions: [] };
    expect(codeReply(quiet).text).toMatch(/cannot be checked yet/);
    expect(replyFindings(quiet.advisory, quiet.findings).every((f) => f.kind.includes('consistent'))).toBe(true);
  });
});

describe('replyFindings', () => {
  it('offers nothing about who may apply as consistent while the question about being on the notice\'s list is open', () => {
    const eligible = finding('e', { status: 'supported', category: 'eligibility', explanation: 'Applicant is a state.' });
    const withList = replyFindings(advisory, [conflict, eligible, fine], [question]);
    expect(withList.map((f) => f.requirementId)).not.toContain('e');
    expect(withList.map((f) => f.requirementId)).toContain('c');
    expect(replyFindings(advisory, [conflict, eligible, fine], []).map((f) => f.requirementId)).toContain('e');
  });
});

describe('follow-ups and stray questions (Assess)', () => {
  it('shows the model the previous assistant message as context but does not let it supply numbers', async () => {
    const llm = reply(GOOD);
    await writeReply({ ...input, previousReply: 'Earlier I mentioned 4242 things.' }, llm);
    expect(llm.calls[0].user).toContain('<previous_reply>');
    const out = await writeReply({ ...input, previousReply: 'Earlier I mentioned 4242 things.' }, reply(`${GOOD} That is 4242 in all.`));
    expect(out).toMatchObject({ source: 'code', fallbackReason: 'number' });
  });

  it('rejects a question when none is open', async () => {
    const quiet = { ...input, questions: [] };
    const out = await writeReply(quiet, reply('You asked for $1.4 million, but the notice appears to cap awards at $500,000. Would you like me to explain the four-project limit as well?'));
    expect(out).toMatchObject({ source: 'code', fallbackReason: 'unexpected_question' });
  });
});

describe('mentions', () => {
  it('does not count a question handle it was shown as a finding, and still needs a finding', async () => {
    expect(await writeReply(input, reply(GOOD, ['F1', 'Q1']))).toMatchObject({ source: 'model', mentions: ['a'] });
    expect((await writeReply(input, reply(GOOD, ['Q1']))).fallbackReason).toBe('no_findings_cited');
    expect((await writeReply(input, reply(GOOD, ['Q9']))).fallbackReason).toBe('unknown_finding');
  });
});

describe('explaining the process in the first reply', () => {
  const process = { steps: [{ index: 1, title: 'Confirm who can apply' }, { index: 2, title: 'Check the funding rules' }] };

  it('shows the model the steps only on the first reply', async () => {
    const llm = reply(GOOD);
    await writeReply({ ...input, process }, llm);
    expect(llm.calls[0].user).toContain('<process>\nStep 1: Confirm who can apply\nStep 2: Check the funding rules\n</process>');
    const later = reply(GOOD);
    await writeReply(input, later);
    expect(later.calls[0].user).not.toContain('<process>');
  });

  it('lets the reply use the step numbers it was given, but no other number', async () => {
    expect((await writeReply({ ...input, process }, reply(GOOD.replace('?', '? I will take this in step 1 and step 2.')))).source).toBe('model');
    expect((await writeReply({ ...input, process }, reply(GOOD.replace('?', '? I will take this in 9 steps.')))).fallbackReason).toBe('number');
  });

  it('the template names the steps in order before the rest', () => {
    const out = codeReply({ ...input, process });
    expect(out.text.startsWith('Here is how I would like to work: I will take this in 2 steps (Confirm who can apply; Check the funding rules)')).toBe(true);
  });
});

describe('the stage and what changed (consultation shape)', () => {
  const stage = { index: 2, of: 3, title: 'Whether the money works', why: 'Next I would like to check the funding side.' };
  const changes = { settled: ['Consultation documentation'], concerns: [], line: 'Since your last message: 1 item settled (Consultation documentation).' };

  it('shows the model the stage and what changed as code-written blocks, only when there are any', async () => {
    const llm = reply(GOOD);
    await writeReply({ ...input, stage, changes }, llm);
    expect(llm.calls[0].user).toContain('<stage>\nStep 2 of 3: Whether the money works. Why now: Next I would like to check the funding side.\n</stage>');
    expect(llm.calls[0].user).toContain('<changes>\nSince your last message: 1 item settled');
    const plain = reply(GOOD);
    await writeReply(input, plain);
    expect(plain.calls[0].user).not.toContain('<stage>');
    expect(plain.calls[0].user).not.toContain('<changes>');
  });

  it('lets the reply use the step numbers and counts in those blocks, but no other number', async () => {
    const ok = `${GOOD.replace('?', '? This is step 2 of 3, and 1 item was settled.')}`;
    expect((await writeReply({ ...input, stage, changes }, reply(ok))).source).toBe('model');
    expect((await writeReply({ ...input, stage, changes }, reply(GOOD.replace('?', '? That is step 7.')))).fallbackReason).toBe('number');
  });

  it('the template opens with what changed and bridges into the stage before the question', () => {
    const out = codeReply({ ...input, stage, changes });
    expect(out.text.startsWith('Since your last message: 1 item settled')).toBe(true);
    expect(out.text).toContain('Next I would like to check the funding side. To go further, I need to ask:');
  });
});

