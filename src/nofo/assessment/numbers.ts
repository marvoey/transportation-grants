import { dollarAmountsIn, percentagesIn } from '../extraction/check-values.js';

/**
 * The numbers a piece of text states, for checking that a number someone relies on really is in it: a number the model
 * proposes for a requirement must be in the requirement's own text, and a number an answer is read as must be in the
 * applicant's own words. Digits (with commas), amounts with a unit ("$25 million", "3 million"), percentages and number
 * words ("four", "twenty") all count.
 */

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const SCALE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };

export function numbersInText(text: string): number[] {
  const out: number[] = [...dollarAmountsIn(text), ...percentagesIn(text)];
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)\b/gi)) {
    const base = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(base)) out.push(base * SCALE[match[2].toLowerCase()]);
  }
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) out.push(value);
  }
  for (const match of text.matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi)) {
    out.push(WORDS[match[1].toLowerCase()]);
  }
  return out;
}

export function numberAppears(text: string, value: number): boolean {
  return Number.isFinite(value) && numbersInText(text).some((n) => Math.abs(n - value) < 1e-6);
}
