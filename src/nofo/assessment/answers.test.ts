import { describe, expect, it } from 'vitest';
import { llmResult, scriptedLlm } from '../__fixtures__/extraction.js';
import { ANSWERS_SYSTEM_PROMPT, readAnswers, readSuggestedAnswers, type OpenDetailQuestion } from './answers.js';
import type { ChatMessage } from './schemas.js';

const open: OpenDetailQuestion[] = [
  { requirementId: 'req-0000a001', covers: ['req-0000a001'], question: 'Does your application include documentation of consultation?' },
  { requirementId: 'req-0000a002', covers: ['req-0000a002', 'req-0000a003'], question: 'Will your application include no more than four projects?' },
];
const messages = (...user: string[]): ChatMessage[] => [
  { role: 'assistant', content: 'Question: Does your application include documentation of consultation? Yes or no.' },
  ...user.map((content) => ({ role: 'user' as const, content })),
];
const model = (answers: unknown) => scriptedLlm(() => llmResult(JSON.stringify({ answers })));

describe('readAnswers', () => {
  it('records an answer only with words the applicant really wrote, and keeps the question and what it stands for', async () => {
    const llm = model([{ requirementId: 'req-0000a002', answer: 'no', quote: 'we plan five projects' }]);
    const out = await readAnswers({ messages: messages('No, we plan five projects in one application.'), open, llm, turn: 2 });
    expect(llm.calls[0].system).toBe(ANSWERS_SYSTEM_PROMPT);
    expect(out.answers['req-0000a002']).toEqual({ answer: 'no', quote: 'we plan five projects', question: open[1].question, covers: ['req-0000a002', 'req-0000a003'], turn: 2 });
  });

  it('never accepts a quote that only the assistant said', async () => {
    const llm = model([{ requirementId: 'req-0000a001', answer: 'yes', quote: 'documentation of consultation' }]);
    expect((await readAnswers({ messages: messages('Not sure about that.'), open, llm })).answers).toEqual({});
  });

  it('ignores a question that was not open, a repeat, a bad answer value and a missing quote', async () => {
    const llm = model([
      { requirementId: 'req-0000ffff', answer: 'yes', quote: 'Yes we do' },
      { requirementId: 'req-0000a001', answer: 'maybe', quote: 'Yes we do' },
      { requirementId: 'req-0000a001', answer: 'yes', quote: '' },
      { requirementId: 'req-0000a001', answer: 'yes', quote: 'Yes we do include it' },
      { requirementId: 'req-0000a001', answer: 'no', quote: 'Yes we do include it' },
    ]);
    const out = await readAnswers({ messages: messages('Yes we do include it.'), open, llm });
    expect(Object.keys(out.answers)).toEqual(['req-0000a001']);
    expect(out.answers['req-0000a001'].answer).toBe('yes');
  });

  it('a bare "yes" answers a question only when exactly one was asked', async () => {
    const llm = () => model([{ requirementId: 'req-0000a001', answer: 'yes', quote: 'Yes' }]);
    expect((await readAnswers({ messages: messages('Yes'), open, llm: llm() })).answers).toEqual({});
    const one = await readAnswers({ messages: messages('Yes'), open: [open[0]], llm: llm() });
    expect(one.answers['req-0000a001'].answer).toBe('yes');
  });

  it('records "not sure" and returns warnings, never a crash, when the model fails or answers badly', async () => {
    const unsure = model([{ requirementId: 'req-0000a001', answer: 'unsure', quote: 'not sure about that' }]);
    expect((await readAnswers({ messages: messages('Not sure about that.'), open, llm: unsure })).answers['req-0000a001'].answer).toBe('unsure');
    expect((await readAnswers({ messages: messages('x'), open, llm: scriptedLlm(() => { throw new Error('boom'); }) })).warnings).toHaveLength(1);
    expect((await readAnswers({ messages: messages('x'), open, llm: scriptedLlm(() => llmResult('nope')) })).warnings).toHaveLength(1);
    expect((await readAnswers({ messages: messages('x'), open: [], llm: unsure })).answers).toEqual({});
  });

  it('a requirement only listed in the drawer can be answered in a sentence, but never by a bare "yes"', async () => {
    const listed: OpenDetailQuestion[] = [open[0], { ...open[1], shown: false }];
    const sentence = model([{ requirementId: 'req-0000a002', answer: 'yes', quote: 'we will submit only four projects' }]);
    const out = await readAnswers({ messages: messages('Yes, we will submit only four projects.'), open: listed, llm: sentence });
    expect(out.answers['req-0000a002'].answer).toBe('yes');
    const bare = model([{ requirementId: 'req-0000a002', answer: 'yes', quote: 'Yes' }]);
    expect((await readAnswers({ messages: messages('Yes'), open: listed, llm: bare })).answers).toEqual({});
    // The one question that was asked can still take a bare yes, whatever else is listed.
    const asked = model([{ requirementId: 'req-0000a001', answer: 'yes', quote: 'Yes' }]);
    expect((await readAnswers({ messages: messages('Yes'), open: listed, llm: asked })).answers['req-0000a001'].answer).toBe('yes');
  });

  it('records the answer against the question whose words the reply restates, even if the model picked its near-twin', async () => {
    const twins: OpenDetailQuestion[] = [
      { requirementId: 'req-0000a010', covers: ['req-0000a010'], question: 'The notice says "Necessity beyond allocation to request equipment" (page 11). Does your project meet this?' },
      { requirementId: 'req-0000a011', covers: ['req-0000a011'], question: 'The notice says "Necessity beyond allocation for equipment requests" (page 11). Does your project meet this?', shown: false },
    ];
    const wrong = model([{ requirementId: 'req-0000a010', answer: 'yes', quote: 'yes, we do' }]);
    const reply = 'For "The notice says \'Necessity beyond allocation for equipment requests\' (page 11). Does your project meet this": yes, we do.';
    const out = await readAnswers({ messages: messages(reply), open: twins, llm: wrong });
    expect(Object.keys(out.answers)).toEqual(['req-0000a011']);
  });
});

describe('the drawer\'s suggested sentences are read in code', () => {
  const many: OpenDetailQuestion[] = [
    { requirementId: 'req-0000a020', covers: ['req-0000a020'], question: 'The notice says "Costs must be in an approved plan" (page 42). Does your project meet this?' },
    { requirementId: 'req-0000a021', covers: ['req-0000a021', 'req-0000a022'], question: 'Does your application meet these notice requirements: SF-424 form; SF-424A budget form?', shown: false },
    { requirementId: 'req-0000a023', covers: ['req-0000a023'], question: 'Do you describe staffing and equipment?', shown: false },
  ];
  const sentence = (q: string, tail: string) => `For "${q.replace(/"/g, "'").replace(/\?+\s*$/, '')}": ${tail}`;
  const complete = [sentence(many[0].question, 'yes, we do.'), sentence(many[1].question, 'no, not yet.'), sentence(many[2].question, 'we are not sure yet.')].join(' ');

  it('records one answer per named question, with the sentence as its quote, and what each stands for', () => {
    const { answers, leftover } = readSuggestedAnswers(complete, many, 3);
    expect(Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.answer]))).toEqual({ 'req-0000a020': 'yes', 'req-0000a021': 'no', 'req-0000a023': 'unsure' });
    expect(answers['req-0000a021'].covers).toEqual(['req-0000a021', 'req-0000a022']);
    expect(answers['req-0000a020'].quote).toBe(sentence(many[0].question, 'yes, we do.'));
    expect(answers['req-0000a020'].turn).toBe(3);
    expect(leftover.replace(/\s+/g, '')).toBe('');
  });

  it('ignores a sentence that names no open question, or repeats one', () => {
    const text = `${sentence('A question nobody asked at all', 'yes, we do.')} ${sentence(many[2].question, 'yes, we do.')} ${sentence(many[2].question, 'no, not yet.')}`;
    const { answers } = readSuggestedAnswers(text, many);
    expect(Object.keys(answers)).toEqual(['req-0000a023']);
    expect(answers['req-0000a023'].answer).toBe('yes');
  });

  it('does not call the model when the message is only suggested sentences, and sends it only what is left over otherwise', async () => {
    const never = scriptedLlm(() => { throw new Error('should not be called'); });
    const out = await readAnswers({ messages: messages(complete), open: many, llm: never });
    expect(Object.keys(out.answers)).toHaveLength(3);
    expect(never.calls).toHaveLength(0);

    const asked: OpenDetailQuestion[] = [...many, { requirementId: 'req-0000a030', covers: ['req-0000a030'], question: 'Will your application include no more than four projects?' }];
    const llm = model([{ requirementId: 'req-0000a030', answer: 'no', quote: 'we plan five projects' }]);
    const mixed = await readAnswers({ messages: messages(`${complete} Also, we plan five projects in one application.`), open: asked, llm });
    expect(Object.keys(mixed.answers).sort()).toEqual(['req-0000a020', 'req-0000a021', 'req-0000a023', 'req-0000a030']);
    expect(llm.calls[0].user).not.toContain('req-0000a020'); // the ones read in code are not given to the model again
    expect(llm.calls[0].user).toContain('req-0000a030');
  });
});

describe('answers by kind of question', () => {
  const choice: OpenDetailQuestion = {
    requirementId: 'req-0000a040', covers: ['req-0000a040'], question: 'Which best describes who is applying? A) A State DOT; B) A local agency.',
    spec: { type: 'choice', options: [{ label: 'A State DOT', outcome: 'meets' }, { label: 'A local agency', outcome: 'does_not_meet' }] },
  };
  const number: OpenDetailQuestion = {
    requirementId: 'req-0000a041', covers: ['req-0000a041'], question: 'How many projects will your application include?',
    spec: { type: 'number', comparison: { op: 'at_most', value: 4, unit: 'projects' } },
  };
  const describeQ: OpenDetailQuestion = { requirementId: 'req-0000a042', covers: ['req-0000a042'], question: 'Describe your staffing and equipment.', spec: { type: 'describe' } };
  const entry = (requirementId: string, over: Record<string, unknown>) => ({ requirementId, answer: 'answered', option: -1, hasNumber: false, number: 0, quote: '', ...over });
  const run = (open: OpenDetailQuestion[], text: string, answers: unknown[]) => readAnswers({ messages: messages(text), open, llm: model(answers) });

  it('a choice needs a valid option index; the answer keeps the option and how the question was asked', async () => {
    const ok = await run([choice], 'We are a local agency.', [entry(choice.requirementId, { option: 1, quote: 'We are a local agency' })]);
    expect(ok.answers[choice.requirementId]).toMatchObject({ answer: 'answered', kind: 'choice', option: 1, spec: choice.spec });
    for (const option of [-1, 2, 1.5]) expect((await run([choice], 'We are a local agency.', [entry(choice.requirementId, { option, quote: 'We are a local agency' })])).answers).toEqual({});
  });

  it('a number must appear in the applicant\'s own quote, so a figure the model made up is dropped', async () => {
    const ok = await run([number], 'We will submit five projects.', [entry(number.requirementId, { hasNumber: true, number: 5, quote: 'five projects' })]);
    expect(ok.answers[number.requirementId]).toMatchObject({ kind: 'number', number: 5 });
    expect((await run([number], 'We will submit five projects.', [entry(number.requirementId, { hasNumber: true, number: 4, quote: 'five projects' })])).answers).toEqual({});
    expect((await run([number], 'We will submit five projects.', [entry(number.requirementId, { hasNumber: false, number: 5, quote: 'five projects' })])).answers).toEqual({});
  });

  it('a description is kept as the applicant\'s own words, never model text, and a yes/no question cannot take "answered"', async () => {
    const said = 'We have six troopers and two vehicles ready.';
    const ok = await run([describeQ], said, [entry(describeQ.requirementId, { quote: said })]);
    expect(ok.answers[describeQ.requirementId]).toMatchObject({ kind: 'describe', text: said });
    expect((await run([open[0]], 'Yes we do include it.', [entry(open[0].requirementId, { quote: 'Yes we do include it' })])).answers).toEqual({});
  });

  it('"not sure" is an answer for any kind', async () => {
    for (const q of [choice, number, describeQ]) {
      const out = await run([q], 'We are not sure about that yet.', [entry(q.requirementId, { answer: 'unsure', quote: 'not sure about that yet' })]);
      expect(out.answers[q.requirementId].answer).toBe('unsure');
    }
  });

  it('the drawer\'s suggested sentences are read in code by the question\'s kind', () => {
    const asked = [choice, number, describeQ];
    const sentence = (q: OpenDetailQuestion, tail: string) => `For "${q.question.replace(/"/g, "'").replace(/\?+\s*$/, '')}": ${tail}`;
    const text = [sentence(choice, 'A local agency.'), sentence(number, '5 projects.'), sentence(describeQ, 'we have this in place and will describe it in our application.')].join(' ');
    const { answers, leftover } = readSuggestedAnswers(text, asked, 1);
    expect(answers[choice.requirementId]).toMatchObject({ answer: 'answered', kind: 'choice', option: 1 });
    expect(answers[number.requirementId]).toMatchObject({ answer: 'answered', kind: 'number', number: 5 });
    expect(answers[describeQ.requirementId]).toMatchObject({ answer: 'answered', kind: 'describe', text: 'we have this in place and will describe it in our application.' });
    expect(leftover.replace(/\s+/g, '')).toBe('');
    expect(readSuggestedAnswers(sentence(number, 'we are not sure yet.'), asked).answers[number.requirementId].answer).toBe('unsure');
    // An option that is not one of the choices, or a number question answered with no figure, is not guessed at.
    expect(readSuggestedAnswers(sentence(choice, 'Something else entirely.'), asked).answers).toEqual({});
    expect(readSuggestedAnswers(sentence(number, 'a few.'), asked).answers).toEqual({});
  });
});
