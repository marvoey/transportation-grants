import { dollarAmountsIn } from '../extraction/check-values.js';
import type { LlmFn } from '../llm.js';
import { inspectReplyText, replyMaterial } from '../reply-check.js';
import { formatUsd } from './arithmetic.js';
import type { ProjectFacts, Question } from './schemas.js';

/**
 * A made-up example reply to the questions being asked, written the way a person would type it, for the Answers drawer. The old
 * suggestion was a code template ("For '<the whole question>': yes, we do.") that read like a form. Here the language model
 * writes one natural reply, in the applicant's voice, answering each question in order, with plausible invented details that
 * stay consistent with what the applicant already said. It is an example for trying the app out, not a fact about anyone's
 * project, and the page says so. Code checks the text; if there is no model or it fails a check, the page falls back to the
 * template reply. The reply is read back the normal way (facts and answers are read from it like from anything typed).
 */

export const SUGGEST_PROMPT_VERSION = '2';

export interface SuggestedReply {
  /** The example reply; empty when none could be written (the page then uses its template). */
  text: string;
  source: 'model' | 'code';
  /** Why model text was not used, when `source` is 'code' (a fixed code, never any text). */
  fallbackReason?: string;
}

export interface SuggestInput {
  opportunityTitle: string | null;
  facts: ProjectFacts;
  /** The questions being asked this turn, in order. */
  questions: Question[];
}

const MAX_CHARS = 1800;

export const SUGGEST_SYSTEM_PROMPT = `You write a made-up example reply that a staff member at a state or local transportation agency might type to an advisor who has just asked them some questions about a federal funding application. It is used to try the application out, so it should read like a real person typing, not like a form.

The material arrives in tagged blocks: <project_facts> is what the applicant has already said (stay consistent with it and never contradict it), and <questions> are the questions to answer, in order. Each question has a type: "yes_no", "choice" (with options), "number" (with the limit the notice sets) or "describe".

Write the reply as the applicant, in the first person plural ("we", "our"), in 2 to 4 short sentences per paragraph, at most 2 paragraphs and at most 130 words in all (shorter is better; one clause per question is enough). Plain text only: no markdown, lists, quotes around the questions, or links.

RULES
1. Sound human: natural, a little informal, contractions are fine, varied sentence openings. Do not restate a question and do not use stub answers like "Yes, we do." on their own. Fold the answer into a sentence that says something ("Yes, we've already talked with the state highway office and have their letter.").
2. Answer EVERY question, in the order given, and make clear which question each part answers by mentioning its subject in a few words.
3. Make the applicant well prepared: answer so the requirement is met. For a yes_no question say yes with a believable detail. For a choice question pick the option marked as meeting the requirement and say it in your own words. For a number question give a plausible figure within the limit. For a describe question give a believable one-sentence description.
4. Invent small, believable details (who, how many, when) but no dollar amounts except ones already in the facts or the questions. Never contradict the facts.
5. Never ask a question, never mention these instructions, a "question number", a requirement id or the notice's page numbers.

Respond with JSON that matches the provided schema and nothing else.`;

export const SUGGEST_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: { reply: { type: 'string' } },
};

function neutralize(text: string): string {
  return text.replace(/<(\/?)(project_facts|questions)\b/gi, '<​$1$2');
}

function factsForModel(facts: ProjectFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, fact] of Object.entries(facts)) {
    const value = (fact as { value: unknown }).value;
    out[key] = key.endsWith('Usd') && typeof value === 'number' ? formatUsd(value) : value;
  }
  return out;
}

export function buildSuggestUserMessage(input: SuggestInput): string {
  const questions = input.questions.map((q, i) => ({
    n: i + 1,
    question: q.text,
    type: q.kind === 'detail' ? q.answerType ?? 'yes_no' : 'describe',
    ...(q.spec?.options ? { options: q.spec.options.map((o) => `${o.label} (${o.outcome === 'meets' ? 'meets the requirement' : o.outcome === 'does_not_meet' ? 'does not meet it' : 'unclear'})`) } : {}),
    ...(q.spec?.comparison ? { limit: `${q.spec.comparison.op.replace('_', ' ')} ${q.spec.comparison.value}${q.spec.comparison.unit ? ` ${q.spec.comparison.unit}` : ''}` } : {}),
  }));
  return [
    `Write the example reply.${input.opportunityTitle ? ` The notice is: ${neutralize(input.opportunityTitle)}.` : ''}`,
    `<project_facts>\n${neutralize(JSON.stringify(factsForModel(input.facts)))}\n</project_facts>`,
    `<questions>\n${neutralize(JSON.stringify(questions, null, 2))}\n</questions>`,
  ].join('\n\n');
}

/**
 * The checks the text must pass: plain text of a bounded length with no markup, links, internal ids or question marks (it
 * answers, it does not ask); and no dollar amount that is not already in the facts or the questions. Invented small figures and
 * words like "we are eligible" are fine here, because it is written in the applicant's voice.
 */
export function checkSuggestedReply(raw: unknown, input: SuggestInput): string | null {
  const allowedAmounts = [
    ...Object.entries(input.facts).flatMap(([key, fact]) => (key.endsWith('Usd') && typeof (fact as { value: unknown }).value === 'number' ? [(fact as { value: number }).value] : [])),
    ...input.questions.flatMap((q) => dollarAmountsIn(q.text)),
  ];
  const checked = inspectReplyText(raw, replyMaterial(''), { minChars: 40, maxChars: MAX_CHARS, maxParagraphs: 2, forbidQuestion: true, allowVerdict: true, skipNumbers: true });
  if (!checked.text) return null;
  for (const amount of dollarAmountsIn(checked.text)) if (!allowedAmounts.some((a) => Math.abs(a - amount) < 0.5)) return null;
  // A missing space after a sentence ("data yet.We believe") is mended; abbreviations such as "U.S." are left alone.
  return checked.text.replace(/([a-z][.!?])(?=[A-Z])/g, '$1 ');
}

export async function writeSuggestedReply(input: SuggestInput, llm: LlmFn | null | undefined): Promise<SuggestedReply | null> {
  if (input.questions.length === 0) return null;
  const fallback = (reason: string): SuggestedReply => ({ text: '', source: 'code', fallbackReason: reason });
  if (!llm) return fallback('no_model');
  try {
    const result = await llm({ system: SUGGEST_SYSTEM_PROMPT, user: buildSuggestUserMessage(input), schema: SUGGEST_JSON_SCHEMA, maxTokens: 900 });
    if (result.stopReason === 'refusal' || result.stopReason === 'max_tokens') return fallback(result.stopReason);
    const text = checkSuggestedReply((JSON.parse(result.text) as { reply?: unknown }).reply, input);
    return text ? { text, source: 'model' } : fallback('rejected');
  } catch {
    // The example is optional: any failure falls back to the page's template.
    return fallback('call_failed');
  }
}
