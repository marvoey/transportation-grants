import { describe, expect, it } from 'vitest';
import { createHtmlProcessor } from './html.js';
import { ProcessingError } from './types.js';

const cheerioAvailable = await import('cheerio' as string).then(
  () => true,
  () => false
);

const input = (html: string, sourceUrl?: string) => ({
  documentId: 'sg-html',
  file: Buffer.from(html),
  fileName: 'page.html',
  mimeType: 'text/html',
  detectedType: 'html' as const,
  sourceUrl,
});

// Reported as SKIPPED (visible in the run output) if cheerio is not installed.
describe.skipIf(!cheerioAvailable)(`cheerio adapter${cheerioAvailable ? '' : ' (SKIPPED: cheerio is not installed)'}`, () => {
  const processor = createHtmlProcessor();

  it('splits content into sections by heading and keeps the title', async () => {
    const doc = await processor.process(
      input(`<html><head><title> FAQ Page </title></head><body>
        <p>Intro text before any heading.</p>
        <h1>Eligibility</h1><p>States may apply.</p><p>So may cities.</p>
        <h2>Cost share</h2><ul><li>At least 20 percent.</li><li>Committed funds only.</li></ul>
      </body></html>`)
    );
    expect(doc.kind).toBe('html');
    if (doc.kind !== 'html') return;
    expect(doc.title).toBe('FAQ Page');
    expect(doc.sections.map((s) => [s.id, s.heading, s.level])).toEqual([
      ['s0', null, null],
      ['s1', 'Eligibility', 1],
      ['s2', 'Cost share', 2],
    ]);
    expect(doc.sections[0].text).toBe('Intro text before any heading.');
    expect(doc.sections[1].text).toBe('States may apply.\nSo may cities.');
    expect(doc.sections[2].text).toBe('At least 20 percent.\nCommitted funds only.');
  });

  it('drops scripts, styles and other non-content, and never executes anything', async () => {
    const doc = await processor.process(
      input('<html><body><script>window.pwned=1</script><style>p{}</style><h1>Title</h1><p>Visible.</p><iframe src="https://evil.example.test"></iframe></body></html>')
    );
    if (doc.kind !== 'html') throw new Error('expected html');
    const all = JSON.stringify(doc);
    expect(all).not.toContain('pwned');
    expect(all).not.toContain('evil.example.test');
    expect(doc.sections[0].text).toBe('Visible.');
  });

  it('keeps only http(s) links, resolved against the source URL, and de-duplicates them', async () => {
    const doc = await processor.process(
      input(
        `<html><body><h1>Links</h1><p>
          <a href="/faq">FAQ</a> <a href="/faq">FAQ</a>
          <a href="https://agency.example.test/nofo.pdf">NOFO</a>
          <a href="javascript:alert(1)">bad</a> <a href="mailto:a@b.test">mail</a> <a href="data:text/html,x">data</a>
        </p></body></html>`,
        'https://agency.example.test/page/'
      )
    );
    if (doc.kind !== 'html') throw new Error('expected html');
    expect(doc.sourceUrl).toBe('https://agency.example.test/page/');
    expect(doc.links).toEqual([
      { text: 'FAQ', url: 'https://agency.example.test/faq' },
      { text: 'NOFO', url: 'https://agency.example.test/nofo.pdf' },
    ]);
  });

  it('does not duplicate text from nested blocks', async () => {
    const doc = await processor.process(input('<html><body><h1>H</h1><table><tr><td><p>Cell text</p></td></tr></table></body></html>'));
    if (doc.kind !== 'html') throw new Error('expected html');
    expect(doc.sections[1 - 1].text).toBe('Cell text');
  });

  it('enforces the text limit', async () => {
    const small = createHtmlProcessor({ maxPages: 10, maxChars: 50, timeoutMs: 1000 });
    const error = await small.process(input(`<html><body><p>${'x'.repeat(200)}</p></body></html>`)).catch((e) => e);
    expect(error).toBeInstanceOf(ProcessingError);
  });
});
