import { Router, type Request, type Response } from 'express';
import { readFile, readdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/error-handler.js';
import { DOC_FOLDERS, escapeHtml, firstHeading, renderMarkdown, type DocFolder } from '../docs/render.js';

/**
 * Read-only viewer for the project's markdown files (doc/ and docs/), styled like the rest of the site.
 *
 * No request value is ever used to build a file path: the folder is looked up in a fixed table, and the
 * document name is looked up in the list of .md files actually found in that folder. Anything else is a 404.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../../..');

/** Refuse (and do not list) files larger than this. The largest document today is well under it. */
const MAX_BYTES = 1024 * 1024;

/** The order the folders are shown on the index page: docs/ first. */
const INDEX_ORDER: readonly DocFolder[] = ['docs', 'doc'];

export type DocRoots = Record<DocFolder, string>;

export interface DocsRouterDeps {
  /** Folder locations. Tests point these at a temp directory. */
  roots?: DocRoots;
}

interface DocEntry {
  folder: DocFolder;
  name: string; // file name without ".md"
  path: string;
}

function defaultRoots(): DocRoots {
  return { doc: join(PROJECT_ROOT, 'doc'), docs: join(PROJECT_ROOT, 'docs') };
}

async function listFolder(folder: DocFolder, root: string): Promise<DocEntry[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // a missing folder is just an empty list
  }
  const found: DocEntry[] = [];
  for (const entry of entries) {
    // isFile() is false for symlinks and directories, so neither can be served.
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const path = join(root, entry.name);
    const info = await stat(path);
    if (info.size > MAX_BYTES) continue;
    found.push({ folder, name: entry.name.slice(0, -3), path });
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
  const roots = deps.roots ?? defaultRoots();
  const router = Router();

  async function listAll(): Promise<Record<DocFolder, DocEntry[]>> {
    const [doc, docs] = await Promise.all(DOC_FOLDERS.map((f) => listFolder(f, roots[f])));
    return { doc, docs };
  }

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const all = await listAll();
      const sections: string[] = [];
      for (const folder of INDEX_ORDER) {
        const items: string[] = [];
        for (const entry of all[folder]) {
          const title = firstHeading(await readFile(entry.path, 'utf-8')) ?? entry.name;
          items.push(
            `<li><a href="/docs/${folder}/${encodeURIComponent(entry.name)}">${escapeHtml(title)}</a> <span class="docs-file">${escapeHtml(entry.name)}.md</span></li>`,
          );
        }
        sections.push(
          `<section aria-labelledby="docs-${folder}">\n        <h3 id="docs-${folder}"><code>${folder}/</code></h3>\n        ${
            items.length ? `<ul class="docs-list">\n          ${items.join('\n          ')}\n        </ul>` : '<p>No documents found.</p>'
          }\n      </section>`,
        );
      }
      send(res, 200, page('Documentation', `<h2>Documentation</h2>\n      ${sections.join('\n      ')}`));
    }),
  );

  router.get(
    '/:folder/:name',
    asyncHandler(async (req: Request, res: Response) => {
      const folder = DOC_FOLDERS.find((f) => f === req.params.folder);
      if (!folder) return notFound(res);

      const all = await listAll();
      const entry = all[folder].find((e) => e.name === req.params.name);
      if (!entry) return notFound(res);

      const known = new Set(DOC_FOLDERS.flatMap((f) => all[f].map((e) => `${f}/${e.name}`)));
      const markdown = await readFile(entry.path, 'utf-8');
      const title = firstHeading(markdown) ?? entry.name;
      const body = renderMarkdown(markdown, { folder, known });
      send(
        res,
        200,
        page(
          title,
          `<p class="docs-crumbs"><a href="/docs">Documentation</a> / <code>${folder}/${escapeHtml(entry.name)}.md</code></p>\n      <article class="docs-article">\n${body}\n      </article>`,
        ),
      );
    }),
  );

  return router;
}
