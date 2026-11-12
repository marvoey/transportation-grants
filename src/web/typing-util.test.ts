import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

// public/js/typing-util.js is a plain script that sets window.TypingUtil. Load it the way a page would.
const sandbox: Record<string, unknown> = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(process.cwd(), 'public/js/typing-util.js'), 'utf-8'), sandbox);
const T = sandbox.TypingUtil as { schedule(text: string, random?: () => number): number[]; MAX_TOTAL_MS: number };

/** A small seeded generator, so the tests are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sentence = 'We are a state motor vehicle division in New Mexico, and we would request about $180,000 for the 33-month project. ';
const text = sentence.repeat(6);

describe('TypingUtil.schedule', () => {
  it('gives one positive delay per character, and none for empty text', () => {
    const d = T.schedule(text, seeded(1));
    expect(d).toHaveLength(text.length);
    for (const ms of d) expect(ms).toBeGreaterThan(0);
    expect(T.schedule('', seeded(1))).toEqual([]);
  });

  it('is uneven: many different delays, and the pace drifts instead of staying put', () => {
    const d = T.schedule(text, seeded(2));
    expect(new Set(d).size).toBeGreaterThan(30);
    const windows: number[] = [];
    for (let i = 0; i + 20 <= d.length; i += 20) windows.push(d.slice(i, i + 20).reduce((a, b) => a + b, 0) / 20);
    expect(Math.max(...windows) / Math.min(...windows)).toBeGreaterThan(1.2);
  });

  it('uses the 1.5 seconds for a typical answer rather than finishing in a blink', () => {
    const answer = 'We would request about $180,000 for the 33-month project, with no matching funds.';
    for (const seed of [3, 4, 5, 6, 7]) {
      const total = T.schedule(answer, seeded(seed)).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(1400);
      expect(total).toBeLessThanOrEqual(1500);
    }
  });

  it('leaves a very short text at its natural pace, well under the limit', () => {
    const total = T.schedule('No.', seeded(8)).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(1500);
  });

  it('pauses longer after the end of a sentence than after an ordinary letter', () => {
    const d = T.schedule(text, seeded(4));
    const ends: number[] = [];
    const letters: number[] = [];
    for (let i = 1; i < text.length; i++) {
      if (text[i] === '.' && text[i + 1] === ' ') ends.push(d[i]);
      else if (/[a-z]/.test(text[i])) letters.push(d[i]);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(ends)).toBeGreaterThan(mean(letters) * 4);
  });

  it('does not treat the dot in a number as the end of a sentence', () => {
    const d = T.schedule('about 3.5 million dollars', seeded(5));
    expect(d[7]).toBeLessThan(150);
  });

  it('is within 1.5 seconds for any length, up to the longest text the question box accepts (4,000 characters)', () => {
    expect(T.MAX_TOTAL_MS).toBe(1500);
    for (const length of [50, 700, 4000]) {
      const long = sentence.repeat(40).slice(0, length);
      const total = T.schedule(long, seeded(6)).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(1500 + length * 0.005); // only the rounding to hundredths of a millisecond
    }
  });

  it('works with the default random source', () => {
    expect(T.schedule('hello there')).toHaveLength(11);
  });
});

describe('typing in chat.html', () => {
  const html = readFileSync(join(process.cwd(), 'public/chat.html'), 'utf-8');
  it('loads the pacing script before the drawer kit that uses it', () => {
    expect(html.indexOf('/js/typing-util.js')).toBeGreaterThan(-1);
    expect(html.indexOf('/js/typing-util.js')).toBeLessThan(html.indexOf('/js/drawer-kit.js'));
  });
});
