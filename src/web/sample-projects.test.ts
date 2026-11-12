import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

// public/js/sample-projects.js is a plain script that sets window.SampleProjects. Load it the way a page would.
const sandbox: Record<string, unknown> = {};
sandbox.window = sandbox;
vm.runInNewContext(read('public/js/sample-projects.js'), sandbox);
const projects = sandbox.SampleProjects as Array<{ id: string; title: string; note: string; text: string }>;

const docsText = read('docs/NOFO_TEST_PROJECTS.md');
const docsDescriptions = docsText
  .split('\n')
  .filter((line) => line.startsWith('> '))
  .map((line) => line.slice(2).trim());

describe('sample project descriptions (the data behind the slide-out tray)', () => {
  it('has twenty-six descriptions (ten detailed, six short and vague, ten stress tests), each with an id, a title and text, and unique ids', () => {
    expect(projects).toHaveLength(26);
    for (const p of projects) {
      expect(p.id).toMatch(/^sample-\d+$/);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.text.length).toBeGreaterThan(30);
    }
    expect(new Set(projects.map((p) => p.id)).size).toBe(projects.length);
    // The short ones really are short: a sentence or two, nothing like a full project brief.
    const short = projects.filter((p) => p.title.startsWith('Short: '));
    expect(short).toHaveLength(6);
    for (const p of short) expect(p.text.length).toBeLessThanOrEqual(200);
    expect(projects.filter((p) => !p.title.startsWith('Short: ') && !p.title.startsWith('Stress test: '))).toHaveLength(10);
  });

  it('has two stress tests for each of five programs', () => {
    // A stress-test title reads "Stress test: <Program>, <applicant and project>".
    const byProgram = new Map<string, number>();
    for (const p of projects.filter((x) => x.title.startsWith('Stress test: '))) {
      const match = /^Stress test: ([^,]+), .+$/.exec(p.title);
      expect(match, `title "${p.title}" should read "Stress test: <Program>, <who>"`).not.toBeNull();
      byProgram.set(match![1], (byProgram.get(match![1]) ?? 0) + 1);
    }
    expect(byProgram.size).toBe(5);
    for (const [program, count] of byProgram) expect(count, program).toBe(2);
  });

  it('has two detailed ones for each of five programs: one with one gap and one with two', () => {
    // A detailed title reads "<Program>: <applicant and project> (1 gap)" or "... (2 gaps)".
    const byProgram = new Map<string, string[]>();
    for (const p of projects.filter((x) => !x.title.startsWith('Short: ') && !x.title.startsWith('Stress test: '))) {
      const match = /^([^:]+): .+ \((\d) gaps?\)$/.exec(p.title);
      expect(match, `title "${p.title}" should end with the number of gaps`).not.toBeNull();
      byProgram.set(match![1], [...(byProgram.get(match![1]) ?? []), match![2]]);
    }
    expect(byProgram.size).toBe(5);
    for (const [program, gaps] of byProgram) expect(gaps.sort(), program).toEqual(['1', '2']);
  });

  it('every description fits in one message (the search and assessment accept 4,000 characters)', () => {
    for (const p of projects) expect(p.text.length).toBeLessThanOrEqual(4000);
  });

  it('matches docs/NOFO_TEST_PROJECTS.md exactly, so the two cannot drift apart', () => {
    expect(docsDescriptions).toHaveLength(projects.length);
    for (const p of projects) expect(docsDescriptions).toContain(p.text);
  });
});

describe('the slide-out tray in chat.html', () => {
  const html = read('public/chat.html');

  it('is closed by default, with a tab that says so to assistive technology', () => {
    expect(html).toMatch(/<button[^>]*id="samplesTab"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="samplesPanel"[^>]*aria-hidden="true"/);
    // The open state is only ever added by script.
    expect(html).not.toMatch(/id="samplesDrawer"[^>]*is-open/);
    expect(html).not.toMatch(/class="[^"]*is-open[^"]*"/);
  });

  it('has a way to close it, and a status line for announcing a copy', () => {
    expect(html).toContain('id="samplesClose"');
    expect(html).toMatch(/id="samplesStatus"[^>]*aria-live="polite"/);
  });

  it('loads the data before the behavior, and both before the script that announces mode changes', () => {
    const at = (name: string) => html.indexOf(`/js/${name}`);
    expect(at('sample-projects.js')).toBeGreaterThan(-1);
    expect(at('sample-projects.js')).toBeLessThan(at('samples-drawer.js'));
    expect(at('samples-drawer.js')).toBeLessThan(at('nofo.js'));
  });

  it('is available on both remaining modes: nothing hides it when the mode changes', () => {
    const drawer = read('public/js/samples-drawer.js');
    expect(drawer).not.toContain('chatmodechange');
    expect(drawer).not.toContain('setAvailable');
  });
});
