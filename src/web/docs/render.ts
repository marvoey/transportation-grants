import { posix } from 'path';
import { Marked, type Tokens } from 'marked';

/**
 * Markdown -> HTML for the /docs pages (README.md, CLAUDE.md and the files in docs/).
 *
 * The documents are project files, but they are still treated as untrusted text: raw HTML is shown as
 * text, only a short list of link schemes survives, and images are never loaded. Everything the renderer
 * emits is either escaped here or produced by marked's own escaping (code, code spans, plain text).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** GitHub-style heading id: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** A URL scheme at the start of the value ("javascript:", "https:" ...), or null for a relative reference. */
function schemeOf(href: string): string | null {
  // Browsers ignore tabs/newlines and leading control characters inside a scheme, so strip them before looking.
  const cleaned = href.replace(/[\u0000- ]/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return match ? match[1].toLowerCase() : null;
}

export interface RenderContext {
  /** The folder of the document being rendered, relative to the project root ("" for README.md, "docs" for docs/*.md); relative links resolve against it. */
  dir: string;
  /** Every document that can be opened: its path from the project root ("docs/A.md") mapped to its page name ("A"), so links only point at pages that exist. */
  known: ReadonlyMap<string, string>;
}

/** What to do with one link target. `null` means "show the link text only". */
type LinkTarget = { href: string; external: boolean } | null;

export function resolveLink(rawHref: string, ctx: RenderContext): LinkTarget {
  const href = rawHref.trim();
  if (!href) return null;

  const scheme = schemeOf(href);
  if (scheme) {
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return { href, external: true };
    return null; // javascript:, data:, file:, vbscript: ...
  }

  if (href.startsWith('#')) return { href, external: false };
  if (href.startsWith('//')) return null; // protocol-relative: could point anywhere
  if (href.startsWith('/')) return { href, external: false }; // another page on this site

  // Relative reference: only links to another document we can serve are kept.
  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  if (!path || path.includes('?') || !path.toLowerCase().endsWith('.md')) return null;

  const name = ctx.known.get(posix.normalize(posix.join(ctx.dir || '.', path)));
  if (!name) return null;
  return { href: `/docs/${encodeURIComponent(name)}${hash}`, external: false };
}

/** The text of the first top-level heading, or null. */
export function firstHeading(markdown: string): string | null {
  const heading = new Marked().lexer(markdown).find((t): t is Tokens.Heading => t.type === 'heading' && t.depth === 1);
  if (!heading) return null;
  const text = heading.text.replace(/[`*_]/g, '').trim();
  return text || null;
}

export function renderMarkdown(markdown: string, ctx: RenderContext): string {
  const used = new Map<string, number>();

  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      // Raw HTML in a document is shown as text, never interpreted.
      html(token: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(token.text);
      },
      // Images are never loaded; the alt text is shown instead.
      image(token: Tokens.Image): string {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link): string {
        const inner = this.parser.parseInline(token.tokens);
        const target = resolveLink(token.href, ctx);
        if (!target) return inner;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const open = target.external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(target.href)}"${title}${open}>${inner}</a>`;
      },
      heading(token: Tokens.Heading): string {
        const base = slugify(token.text) || 'section';
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        const inner = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>\n`;
      },
    },
  });

  const html = marked.parse(markdown, { async: false });
  // Any literal "<table>" in the source was escaped above, so these tags can only come from real tables.
  return html.replace(/<table>/g, '<div class="doc-table"><table>').replace(/<\/table>/g, '</table></div>');
}
