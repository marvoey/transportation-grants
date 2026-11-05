import type { NormalizedDocument } from '../../schemas.js';
import {
  DEFAULT_LIMITS,
  ProcessingError,
  type DocumentProcessor,
  type ProcessingLimits,
  type ProcessInput,
} from './types.js';

export const HTML_PROCESSOR_ID = 'cheerio-sections';
export const HTML_PROCESSOR_VERSION = '1';

// cheerio's chained API is awkward to type structurally; this adapter is the
// only consumer, so it is deliberately `any` here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type CheerioModule = { load(html: string): any };

// Lazy runtime import (see pdf.ts): only the offline ingestion path loads it.
const CHEERIO_SPECIFIER = 'cheerio';

async function loadCheerio(): Promise<CheerioModule> {
  try {
    return (await import(CHEERIO_SPECIFIER)) as CheerioModule;
  } catch {
    throw new ProcessingError('The HTML parser (cheerio) is not installed or failed to load.');
  }
}

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,td,th,pre,blockquote,dd,dt,caption,figcaption,summary';
const MAX_LINKS = 500;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function createHtmlProcessor(limits: ProcessingLimits = DEFAULT_LIMITS): DocumentProcessor {
  return {
    id: HTML_PROCESSOR_ID,
    version: HTML_PROCESSOR_VERSION,
    supports: (detectedType) => detectedType === 'html',

    async process(input: ProcessInput): Promise<NormalizedDocument> {
      const cheerio = await loadCheerio();
      let $: any;
      try {
        $ = cheerio.load(input.file.toString('utf-8'));
      } catch {
        throw new ProcessingError('The HTML could not be parsed.');
      }

      // Parsing only: nothing is executed. Drop everything that is not readable content.
      $('script,style,noscript,iframe,object,embed,template,svg,canvas').remove();

      const title = collapse($('title').first().text()) || null;

      type Section = { id: string; heading: string | null; level: number | null; parts: string[] };
      const sections: Section[] = [];
      let current: Section = { id: 's0', heading: null, level: null, parts: [] };
      let counter = 0;
      let totalChars = 0;

      const flush = (): void => {
        if (current.heading !== null || current.parts.length > 0) sections.push(current);
      };

      $(BLOCK_SELECTOR).each((_: number, el: any) => {
        const $el = $(el);
        // Only leaf blocks, so nested lists/tables do not duplicate text.
        if ($el.find(BLOCK_SELECTOR).length > 0) return;
        const text = collapse($el.text());
        if (!text) return;
        totalChars += text.length;
        if (totalChars > limits.maxChars) {
          throw new ProcessingError('The HTML contains more text than the size limit allows.');
        }
        const tag = String(el.tagName ?? el.name ?? '').toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          flush();
          counter += 1;
          current = { id: `s${counter}`, heading: text, level: Number(tag[1]), parts: [] };
        } else {
          current.parts.push(text);
        }
      });
      flush();

      // Links: http(s) only, resolved against the original source URL when relative.
      const links: Array<{ text: string; url: string }> = [];
      const seen = new Set<string>();
      $('a[href]').each((_: number, el: any) => {
        if (links.length >= MAX_LINKS) return;
        const href = String($(el).attr('href') ?? '').trim();
        let resolved: URL;
        try {
          resolved = input.sourceUrl ? new URL(href, input.sourceUrl) : new URL(href);
        } catch {
          return;
        }
        if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return;
        const text = collapse($(el).text());
        const key = `${resolved.toString()}\u0000${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ text, url: resolved.toString() });
      });

      return {
        schemaVersion: 1,
        kind: 'html',
        documentId: input.documentId,
        processorId: HTML_PROCESSOR_ID,
        processorVersion: HTML_PROCESSOR_VERSION,
        warnings: [],
        title,
        sourceUrl: input.sourceUrl ?? null,
        sections: sections.map((s) => ({
          id: s.id,
          heading: s.heading,
          level: s.level,
          text: s.parts.join('\n'),
        })),
        links,
      };
    },
  };
}
