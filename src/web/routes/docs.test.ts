import express from 'express';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { createDocsRouter } from './docs.js';
import { renderMarkdown, resolveLink } from '../docs/render.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const GUIDE = `# Guide to <uuid> things

Intro with a [link to the other doc](Other.md#part-two), a [link to the readme](../README.md) and an [outside link](https://example.com/x).

## Table

| Name | Value |
| ---- | ----- |
| a | 1 |

\`\`\`ts
const x = '<b>not bold</b>';
\`\`\`
`;

const OTHER = `# Other

## Part two

Back to [the guide](Guide.md), [the project rules](../CLAUDE.md) and a [missing doc](Nope.md) and a [file outside](../secret.md).
`;

const HOSTILE = `# Hostile

<script>alert(1)</script>

<img src=x onerror=alert(1)>

[click](javascript:alert(1)) and [data](data:text/html,<b>x</b>) and [mixed]( JaVa\tScRiPt:alert(1)).

![tracking pixel](https://evil.example/p.png)
`;

async function start(options: { clash?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'docs-route-'));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(base, 'docs'));
  await mkdir(join(base, 'docs', 'sub'));
  await writeFile(join(base, 'README.md'), '# The readme\n\nSee [the guide](docs/Guide.md) and [the rules](CLAUDE.md).\n');
  await writeFile(join(base, 'CLAUDE.md'), '# Project rules');
  await writeFile(join(base, 'CHANGELOG.md'), '# Not on the list'); // a root file that is not README or CLAUDE
  await writeFile(join(base, 'docs', 'Guide.md'), GUIDE);
  await writeFile(join(base, 'docs', 'Hostile.md'), HOSTILE);
  await writeFile(join(base, 'docs', 'notes.txt'), 'not markdown');
  await writeFile(join(base, 'docs', 'Other.md'), OTHER);
  await writeFile(join(base, 'docs', 'sub', 'Nested.md'), '# Nested');
  await writeFile(join(base, 'secret.md'), '# Outside the roots');
  await symlink(join(base, 'secret.md'), join(base, 'docs', 'Linked.md'));
  await writeFile(join(base, 'docs', 'Huge.md'), '# Huge\n' + 'x'.repeat(1024 * 1024 + 1));
  if (options.clash) await writeFile(join(base, 'docs', 'README.md'), '# A different readme');

  const app = express();
  app.use('/docs', createDocsRouter({ rootDir: base, docsDir: join(base, 'docs') }));
  app.use(errorHandler);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { get: (path: string) => fetch(url + path) };
}

describe('GET /docs (index)', () => {
  it('lists README, CLAUDE and the docs/ files as one flat list, titled by their first heading', async () => {
    const { get } = await start();
    const res = await get('/docs');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('href="/docs/README"');
    expect(html).toContain('The readme');
    expect(html).toContain('href="/docs/CLAUDE"');
    expect(html).toContain('href="/docs/Guide"');
    expect(html).toContain('Guide to &lt;uuid&gt; things'); // title is escaped, not interpreted
    expect(html).toContain('href="/docs/Other"');
    expect(html).toContain('docs/Guide.md'); // the file path is shown beside the title
    expect(html).not.toContain('docs-doc'); // no separate sections or folder headings
    expect(html).not.toContain('<h3');
  });

  it('shows README first, then CLAUDE, then the docs/ files by name', async () => {
    const { get } = await start();
    const html = await (await get('/docs')).text();
    const at = (name: string) => html.indexOf(`href="/docs/${name}"`);
    expect(at('README')).toBeGreaterThan(-1);
    expect(at('README')).toBeLessThan(at('CLAUDE'));
    expect(at('CLAUDE')).toBeLessThan(at('Guide'));
    expect(at('Guide')).toBeLessThan(at('Other'));
  });

  it('leaves out other root files, non-markdown files, subfolders, symlinks and oversized files', async () => {
    const { get } = await start();
    const html = await (await get('/docs')).text();
    expect(html).not.toContain('CHANGELOG');
    expect(html).not.toContain('notes');
    expect(html).not.toContain('Nested');
    expect(html).not.toContain('Linked');
    expect(html).not.toContain('Huge');
  });

  it('lists a name only once: the root README wins over docs/README.md', async () => {
    const { get } = await start({ clash: true });
    const html = await (await get('/docs')).text();
    expect(html.match(/href="\/docs\/README"/g)).toHaveLength(1);
    const page = await (await get('/docs/README')).text();
    expect(page).toContain('The readme');
    expect(page).not.toContain('A different readme');
  });

  it('is styled like the site and sends restrictive headers', async () => {
    const { get } = await start();
    const res = await get('/docs');
    const html = await res.text();
    expect(html).toContain('/css/theme-afs.css');
    expect(html).toContain('/css/docs.css');
    expect(html).toContain('<nav aria-label="Main">');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('GET /docs/:name', () => {
  it('renders headings (with ids), tables (in a scroll box) and code blocks', async () => {
    const { get } = await start();
    const res = await get('/docs/Guide');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<h2 id="table">Table</h2>');
    expect(html).toContain('<div class="doc-table"><table>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;'); // code is shown, not run
    expect(html).not.toContain('<b>not bold</b>');
  });

  it('shows placeholders like <uuid> as text', async () => {
    const { get } = await start();
    const html = await (await get('/docs/Guide')).text();
    expect(html).toContain('Guide to &lt;uuid&gt; things');
    expect(html).not.toContain('<uuid>');
  });

  it('rewrites links between documents and opens outside links in a new tab', async () => {
    const { get } = await start();
    const guide = await (await get('/docs/Guide')).text();
    expect(guide).toContain('<a href="/docs/Other#part-two">link to the other doc</a>');
    expect(guide).toContain('<a href="/docs/README">link to the readme</a>'); // ../README.md from docs/
    expect(guide).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">outside link</a>');

    const other = await (await get('/docs/Other')).text();
    expect(other).toContain('<a href="/docs/Guide">the guide</a>');
    expect(other).toContain('<a href="/docs/CLAUDE">the project rules</a>');
    expect(other).not.toContain('Nope.md'); // a link to a document that does not exist is shown as text only
    expect(other).toContain('missing doc');
    expect(other).not.toContain('secret.md'); // a link out of the project's documents is shown as text only
    expect(other).toContain('file outside');

    const readme = await (await get('/docs/README')).text();
    expect(readme).toContain('<a href="/docs/Guide">the guide</a>'); // docs/Guide.md from the project root
    expect(readme).toContain('<a href="/docs/CLAUDE">the rules</a>');
  });

  it('produces no executable markup from hostile content', async () => {
    const { get } = await start();
    const html = await (await get('/docs/Hostile')).text();
    const article = /<article[\s\S]*<\/article>/.exec(html)?.[0] ?? '';
    expect(article).not.toMatch(/<script/i);
    expect(article).not.toMatch(/<img/i);
    expect(article).not.toMatch(/javascript:/i);
    expect(article).not.toMatch(/data:text/i);
    expect(article).not.toMatch(/href="[^"]*(alert|evil)/i);
    expect(article).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); // shown as text
    expect(article).toContain('click'); // link text survives, the link does not
    expect(article).toContain('tracking pixel'); // images are replaced by their alt text
    expect(article).not.toContain('evil.example');
  });

  it('returns 404 for anything that is not a listed document', async () => {
    const { get } = await start();
    const paths = [
      '/docs/..%2Fsecret', // encoded slash
      '/docs/..%2F..%2Fsecret',
      '/docs/%2e%2e/secret',
      '/docs/../secret',
      '/docs/secret', // a root file that is not on the list
      '/docs/CHANGELOG', // a root .md file that is not README or CLAUDE
      '/docs/Missing',
      '/docs/notes', // a .txt file
      '/docs/notes.txt',
      '/docs/Guide.md', // the extension is not part of the name
      '/docs/Nested', // in a subfolder
      '/docs/sub/Nested',
      '/docs/docs/Guide', // the old two-level address no longer exists
      '/docs/doc/Guide',
      '/docs/Linked', // symlink out of the folder
      '/docs/Huge', // over the size cap
    ];
    for (const path of paths) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      const html = await res.text();
      expect(html, path).not.toContain('Outside the roots');
    }
  });
});

describe('link handling', () => {
  const known = new Map([['README.md', 'README'], ['CLAUDE.md', 'CLAUDE'], ['docs/A.md', 'A'], ['docs/B.md', 'B']]);
  const ctx = { dir: 'docs', known };

  it('allows http, https, mailto, same-page and same-site links only', () => {
    expect(resolveLink('https://example.com', ctx)).toEqual({ href: 'https://example.com', external: true });
    expect(resolveLink('mailto:a@example.com', ctx)?.external).toBe(true);
    expect(resolveLink('#section', ctx)).toEqual({ href: '#section', external: false });
    expect(resolveLink('/chat.html', ctx)).toEqual({ href: '/chat.html', external: false });
  });

  it('drops dangerous or unresolvable links', () => {
    for (const href of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' java\nscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '//evil.example/x', '', 'src/web/api-server.ts', 'Missing.md', '../../secret.md', '../CHANGELOG.md', 'sub/Nested.md', 'A.md?x=1']) {
      expect(resolveLink(href, ctx), href).toBeNull();
    }
  });

  it('resolves .md links between the root files and docs/ and keeps the anchor', () => {
    expect(resolveLink('A.md', ctx)?.href).toBe('/docs/A');
    expect(resolveLink('./A.md#top', ctx)?.href).toBe('/docs/A#top');
    expect(resolveLink('../README.md', ctx)?.href).toBe('/docs/README'); // from docs/ up to the root
    expect(resolveLink('docs/B.md', { dir: '', known })?.href).toBe('/docs/B'); // from the root down into docs/
    expect(resolveLink('CLAUDE.md', { dir: '', known })?.href).toBe('/docs/CLAUDE');
    expect(resolveLink('README.md', ctx)).toBeNull(); // docs/README.md does not exist
  });

  it('gives repeated headings distinct ids', () => {
    const html = renderMarkdown('## Same\n\n## Same\n', ctx);
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-1"');
  });
});

describe('floating menu', () => {
  it('opens every menu link in a new tab and offers the documentation', () => {
    const js = readFileSync(join(process.cwd(), 'public/js/floating-menu.js'), 'utf-8');
    expect(js).toContain("href: '/docs'");
    expect(js).toContain("a.target = '_blank'");
    expect(js).toContain("a.rel = 'noopener noreferrer'");
    // target/rel are set inside the loop over ITEMS, so no entry can skip them
    expect(/ITEMS\.forEach\(function \(item\) \{[\s\S]*?a\.target = '_blank'[\s\S]*?\}\);/.test(js)).toBe(true);
  });
});
