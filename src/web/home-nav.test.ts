import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

const index = read('public/index.html');
const chat = read('public/chat.html');

/** The links inside <nav>...</nav>, as "label -> href". */
function navLinks(html: string): string[] {
  const nav = /<nav[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => `${m[2]} -> ${m[1]}`);
}

function allHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe('main navigation', () => {
  it('is the same on the home page and on chat.html', () => {
    expect(navLinks(index)).toEqual(navLinks(chat));
  });

  it('offers Home plus the three chat modes', () => {
    expect(navLinks(chat)).toEqual([
      'Home -> /',
      'Find grants -> /chat.html',
      'Assess a project -> /chat.html?mode=nofo',
      'Ask about grants -> /chat.html?mode=search',
    ]);
  });

  it('marks each link with a data-nav key that has a matching chat tab', () => {
    for (const [key, tabId] of [['find', 'modeFindTab'], ['nofo', 'modeNofoTab'], ['search', 'modeSearchTab']]) {
      expect(chat).toContain(`data-nav="${key}"`);
      expect(chat).toContain(`id="${tabId}"`);
    }
  });

  it('loads site-nav.js before nofo.js on chat.html so it hears the first mode event', () => {
    const nav = chat.indexOf('/js/site-nav.js');
    const nofo = chat.indexOf('/js/nofo.js');
    expect(nav).toBeGreaterThan(-1);
    expect(nofo).toBeGreaterThan(nav);
  });
});

describe('links in the pages', () => {
  const validModes = new Set(['nofo', 'search']);

  it('only point at the home page or at chat.html with a known mode', () => {
    for (const html of [index, chat]) {
      for (const href of allHrefs(html)) {
        if (href.startsWith('/css/') || href.startsWith('http')) continue;
        if (href === '/') continue;
        const url = new URL(href, 'http://localhost');
        expect(url.pathname, href).toBe('/chat.html');
        const mode = url.searchParams.get('mode');
        if (mode !== null) expect(validModes.has(mode), href).toBe(true);
      }
    }
  });

  it('no longer reference the removed pages', () => {
    const removed = ['search.html', 'eligibility.html', 'deadlines.html', 'details.html'];
    const files = ['public/index.html', 'public/chat.html', ...readdirSync(join(root, 'public/js')).map((f) => `public/js/${f}`)];
    for (const file of files) {
      const text = read(file);
      for (const name of removed) expect(text.includes(name), `${file} mentions ${name}`).toBe(false);
    }
    for (const name of removed) expect(existsSync(join(root, 'public', name))).toBe(false);
  });
});

describe('home page', () => {
  it('links one card to each chat mode', () => {
    expect(index).toContain('href="/chat.html"');
    expect(index).toContain('href="/chat.html?mode=nofo"');
    expect(index).toContain('href="/chat.html?mode=search"');
  });

  it('states that the output is preliminary and avoids unproven savings claims', () => {
    expect(index).toMatch(/Preliminary guidance only/);
    expect(index).not.toMatch(/\bhours\b|\b70%|\b800\b/);
  });
});
