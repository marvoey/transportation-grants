import { Router, type Request, type Response } from 'express';
import { readFile, readdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/error-handler.js';
import { escapeHtml, firstHeading, renderMarkdown } from '../docs/render.js';

/**
 * Read-only viewer for the project's markdown files: README.md and CLAUDE.md at the project root, and the .md files in
 * docs/, shown as one flat list and styled like the rest of the site.
 *
 * No request value is ever used to build a file path: the document name is looked up in the list of files actually
 * found (the two root files, and the .md files directly inside docs/). Anything else is a 404.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../..');

/** Refuse (and do not list) files larger than this. The largest document today is well under it. */
const MAX_BYTES = 1024 * 1024;

/** The only files read from the project root. */
const ROOT_FILES: readonly string[] = ['README.md', 'CLAUDE.md'];

/**
 * The order of the list, by page name (the file name without ".md"). The readme and the presentation and script documents
 * come first, in this order; any other document follows by name; the development documents are last, in this order.
 */
const FIRST_NAMES: readonly string[] = [
  'README',
  'BigBuild3_GrantFlow_ConOps',
  'GrantFlow_BigBuild_Live_App_Demo_Script',
  'NOFO_DEMO',
  'BIG_BUILD_SUBMISSION_GUIDELINES',
];
const LAST_NAMES: readonly string[] = ['NOFO_MVP_PLAN', 'CLAUDE'];

export interface DocsRouterDeps {
  /** Folder locations. Tests point these at a temp directory. */
  rootDir?: string;
  docsDir?: string;
  rootFiles?: readonly string[];
  /** Page names listed first, and last, in this order. The rest are in between, by name. */
  firstNames?: readonly string[];
  lastNames?: readonly string[];
}

interface DocEntry {
  /** The page name: the file name without ".md". Unique across the list. */
  name: string;
  /** The path from the project root, as shown ("README.md", "docs/NOFO_DEMO.md"), also used to resolve links. */
  relPath: string;
  /** The folder of the file from the project root ("" or "docs"). */
  dir: string;
  path: string;
}

/** The .md files directly inside `dir` that pass `accept` (regular files only, under the size cap), sorted by name. */
async function listMarkdown(dir: string, relDir: string, accept: (fileName: string) => boolean): Promise<DocEntry[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // a missing folder is just an empty list
  }
  const found: DocEntry[] = [];
  for (const entry of entries) {
    // isFile() is false for symlinks and directories, so neither can be served.
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md') || !accept(entry.name)) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    if (info.size > MAX_BYTES) continue;
    found.push({ name: entry.name.slice(0, -3), relPath: relDir ? `${relDir}/${entry.name}` : entry.name, dir: relDir, path });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const HEADER = `<header>
    <div class="container">
      <h1><a href="/" class="brand-link"><img src="/img/logos/accenture-logo.svg" alt="Accenture" width="122" height="32"><span class="brand-product">Grant<span class="brand-flow">Flow</span></span></a></h1>
      <nav aria-label="Main">
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/chat.html">Find grants</a></li>
          <li><a href="/chat.html?mode=nofo">Assess a project</a></li>
        </ul>
      </nav>
    </div>
  </header>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - GrantFlow documentation</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/theme-afs.css">
  <link rel="stylesheet" href="/css/docs.css">
  <link rel="stylesheet" href="/css/floating-menu.css">
</head>
<body>
  ${HEADER}
  <main>
    <div class="container docs-container">
${body}
    </div>
  </main>
  <script src="/js/floating-menu.js"></script>
</body>
</html>
`;
}

function send(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      // Static assets from this site only: nothing a document says can load or run anything else.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    })
    .send(html);
}

function notFound(res: Response): void {
  send(
    res,
    404,
    page(
      'Not found',
      `<h2>Document not found</h2>\n      <p><a href="/docs">Back to the documentation index</a></p>`,
    ),
  );
}

export function createDocsRouter(deps: DocsRouterDeps = {}): Router {
  const rootDir = deps.rootDir ?? PROJECT_ROOT;
  const docsDir = deps.docsDir ?? join(PROJECT_ROOT, 'docs');
  const rootFiles = deps.rootFiles ?? ROOT_FILES;
  const firstNames = deps.firstNames ?? FIRST_NAMES;
  const lastNames = deps.lastNames ?? LAST_NAMES;
  const router = Router();

  /** The documents in list order (see FIRST_NAMES and LAST_NAMES). A name already taken is not listed twice; the root file wins. */
  async function listAll(): Promise<DocEntry[]> {
    const [root, docs] = await Promise.all([
      listMarkdown(rootDir, '', (file) => rootFiles.includes(file)),
      listMarkdown(docsDir, 'docs', () => true),
    ]);
    const seen = new Set<string>();
    const unique = [...root, ...docs].filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
    const rank = (name: string): number => {
      const first = firstNames.indexOf(name);
      if (first >= 0) return first;
      const last = lastNames.indexOf(name);
      return last >= 0 ? 2000 + last : 1000;
    };
    return unique.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const items: string[] = [];
      for (const entry of await listAll()) {
        const title = firstHeading(await readFile(entry.path, 'utf-8')) ?? entry.name;
        items.push(
          `<li><a href="/docs/${encodeURIComponent(entry.name)}">${escapeHtml(title)}</a> <span class="docs-file">${escapeHtml(entry.relPath)}</span></li>`,
        );
      }
      const list = items.length ? `<ul class="docs-list">\n        ${items.join('\n        ')}\n      </ul>` : '<p>No documents found.</p>';
      send(res, 200, page('Documentation', `<h2>Documentation</h2>\n      ${list}`));
    }),
  );

  router.get(
    '/:name',
    asyncHandler(async (req: Request, res: Response) => {
      const all = await listAll();
      const entry = all.find((e) => e.name === req.params.name);
      if (!entry) return notFound(res);

      const known = new Map(all.map((e) => [e.relPath, e.name] as const));
      const markdown = await readFile(entry.path, 'utf-8');
      const title = firstHeading(markdown) ?? entry.name;
      const body = renderMarkdown(markdown, { dir: entry.dir, known });
      send(
        res,
        200,
        page(
          title,
          `<p class="docs-crumbs"><a href="/docs">Documentation</a> / <code>${escapeHtml(entry.relPath)}</code></p>\n      <article class="docs-article">\n${body}\n      </article>`,
        ),
      );
    }),
  );

  return router;
}
