import { dollarAmountsIn } from './extraction/check-values.js';

/**
 * The checks a model-written conversational reply must pass before it is shown (Assess and Find grants). The model writes
 * only the words; the findings and the shortlist are written by code and stay separate. The reply may not add anything
 * that is not in the material it was given, so every check is a plain-code test on the text:
 *
 *   - plain text of a bounded length, a few paragraphs, with no markup, links or lists;
 *   - no verdict on the applicant (eligible, qualified, disqualified, "you cannot apply", a prediction of an award);
 *   - every dollar amount and every other number in it is one that appears in the material;
 *   - no internal identifiers (requirement ids, finding handles);
 *   - a question mark when a question was due, and none when no question is open (the app cannot act on a rhetorical one).
 *
 * Words the model chooses cannot be proven true by code, so the prompt restricts them and the page labels the reply as
 * model-written and preliminary. A reply that fails any check is replaced by a template written from the same material.
 */

export interface ReplyMaterial {
  /** Every dollar amount in the material, in dollars. */
  amounts: number[];
  /** Every other number written with digits in the material, as written (commas removed). */
  tokens: Set<string>;
}

const DOLLAR_EXPRESSION = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:thousand|million|billion|bn|k|m)?\b|\d[\d,]*(?:\.\d+)?\s*(?:thousand|million|billion)\s+dollars?/gi;

/** Reads the numbers out of the text the model was given, so the reply can be held to them. `extraNumbers` are counts the code supplies. */
export function replyMaterial(text: string, extraNumbers: number[] = []): ReplyMaterial {
  const tokens = new Set<string>(extraNumbers.map((n) => String(n)));
  for (const match of text.replace(DOLLAR_EXPRESSION, ' ').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)) tokens.add(match[0]);
  // A dollar amount's digits are also allowed as a plain number ("the $500,000 ceiling" and "500,000 dollars").
  for (const match of text.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)) tokens.add(match[0]);
  return { amounts: dollarAmountsIn(text), tokens };
}

export interface ReplyLimits {
  minChars?: number;
  maxChars?: number;
  maxParagraphs?: number;
  /** True when the reply must put a question to the applicant. */
  needsQuestion?: boolean;
  /** True when no question is open: a reply with a question mark would ask the applicant something the app cannot act on. */
  forbidQuestion?: boolean;
  /** For text written in the APPLICANT's voice ("we are eligible"): the verdict check is about the app's voice, so it is skipped. */
  allowVerdict?: boolean;
  /** For made-up example text, where invented figures (six troopers) are the point: numbers are not held to the material. */
  skipNumbers?: boolean;
}

const MARKUP = /https?:\/\/|www\.|[<>`]|\*\*|__|^\s*[-*•#]|^\s*\d+[.)]\s/m;
const VERDICT = new RegExp(
  [
    // "you are eligible", "your agency is not eligible", "your project would be ineligible"
    String.raw`\b(?:you|we|your\s+[a-z]+(?:\s+[a-z]+)?)\s+(?:is|are|would be|will be|'re|'s)\s+(?:not\s+|in)?(?:eligible|qualified|disqualified)\b`,
    String.raw`\b(?:ineligible|disqualified)\s+(?:applicant|to apply|for (?:this|the))\b`,
    String.raw`\byou\s+(?:cannot|can't|can not|may not|are not allowed to|must not)\s+(?:apply|receive|get)\b`,
    String.raw`\b(?:will|would)\s+(?:win|receive|be funded|be awarded|be approved|be rejected|be denied)\b`,
    String.raw`\bguarantee`,
    // A recommendation: these lists are a starting point, never advice on what to apply for.
    String.raw`\byou\s+should\s+(?:apply|go for|pursue|submit)\b`,
    String.raw`\b(?:the\s+)?best\s+(?:grant|program|programme|fit|option|choice)\s+for\s+(?:you|your)\b`,
    String.raw`\bi\s+(?:recommend|suggest)\s+(?:that\s+)?you\s+(?:apply|pursue|go for)\b`,
    String.raw`\b(?:definitely|certainly|undoubtedly)\s+(?:eligible|ineligible|qualif)`,
  ].join('|'),
  'i'
);
const INTERNAL_ID = /\breq-[0-9a-f]{4,}\b|\b[FLQ]\d{1,2}\b|\bsg-[0-9a-f]{6,}\b/i;

export type ReplyRejection = 'not_text' | 'length' | 'paragraphs' | 'markup' | 'verdict' | 'internal_id' | 'no_question' | 'unexpected_question' | 'dollar_amount' | 'number';

/**
 * Returns the cleaned text if it passes every check, or null (the caller then uses its template). Paragraph breaks are
 * kept as a blank line.
 */
export function checkReplyText(raw: unknown, material: ReplyMaterial, limits: ReplyLimits = {}): string | null {
  return inspectReplyText(raw, material, limits).text;
}

/** The same check, also saying which one failed. The reason is a fixed code, never any of the text. */
export function inspectReplyText(raw: unknown, material: ReplyMaterial, limits: ReplyLimits = {}): { text: string | null; reason: ReplyRejection | null } {
  const fail = (reason: ReplyRejection) => ({ text: null, reason });
  if (typeof raw !== 'string') return fail('not_text');
  const text = raw
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  if (text.length < (limits.minChars ?? 60) || text.length > (limits.maxChars ?? 1500)) return fail('length');
  const paragraphs = text.split('\n\n');
  if (paragraphs.length > (limits.maxParagraphs ?? 5)) return fail('paragraphs');
  if (paragraphs.some((p) => MARKUP.test(p))) return fail('markup');
  if (!limits.allowVerdict && VERDICT.test(text)) return fail('verdict');
  if (INTERNAL_ID.test(text)) return fail('internal_id');
  if (limits.needsQuestion && !text.includes('?')) return fail('no_question');
  if (limits.forbidQuestion && text.includes('?')) return fail('unexpected_question');

  if (limits.skipNumbers) return { text, reason: null };

  // Numbers: every dollar amount, then every other number, must be one the material already has.
  for (const amount of dollarAmountsIn(text)) {
    if (!material.amounts.some((a) => Math.abs(a - amount) < 0.5)) return fail('dollar_amount');
  }
  for (const match of text.replace(DOLLAR_EXPRESSION, ' ').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)) {
    if (!material.tokens.has(match[0])) return fail('number');
  }
  return { text, reason: null };
}
