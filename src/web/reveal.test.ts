import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

// reveal.js works on a live DOM, so its behavior was checked in a headless browser (see docs/NOFO_MVP_PLAN.md). These tests
// pin what can be checked without one: how it is wired into the pages and the limits it promises.
describe('reply reveal (public/js/reveal.js)', () => {
  const reveal = read('public/js/reveal.js');

  it('splits 3 seconds at most between the conversation message and the panel under it', () => {
    const message = Number(/MESSAGE_MS:\s*(\d+)/.exec(reveal)?.[1]);
    const panel = Number(/PANEL_MS:\s*(\d+)/.exec(reveal)?.[1]);
    expect(message).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(0);
    expect(message + panel).toBeLessThanOrEqual(3000);
  });

  it('never builds markup: text goes back with nodeValue, and nothing uses innerHTML', () => {
    expect(reveal).toContain('nodeValue');
    expect(reveal).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });

  it('does nothing for reduced motion or without typing-util.js', () => {
    expect(reveal).toContain('prefers-reduced-motion: reduce');
    expect(reveal).toMatch(/!root\.TypingUtil \|\| reducedMotion\(\)/);
  });

  it('is loaded after typing-util.js on the chat page, and used by both Find grants and Assess', () => {
    const html = read('public/chat.html');
    expect(html.indexOf('/js/typing-util.js')).toBeGreaterThan(-1);
    expect(html.indexOf('/js/typing-util.js')).toBeLessThan(html.indexOf('/js/reveal.js'));
    expect(read('public/js/discover.js')).toContain('window.Reveal.play');
    expect(read('public/js/nofo.js')).toContain('window.Reveal.play');
  });
});
