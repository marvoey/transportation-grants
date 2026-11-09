import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');
const html = read('public/big-build.html');

/** Loads a browser helper the way a page would and returns what it attached to window. */
function loadWindowScript<T>(path: string, name: string): T {
  const sandbox: Record<string, unknown> = { URLSearchParams };
  sandbox.window = sandbox;
  vm.runInNewContext(read(path), sandbox);
  return sandbox[name] as T;
}

interface Model {
  DEFAULTS: { applications: number; adoptionPct: number; hoursSavedPerAssessment: number };
  perAssessment(): { manualHours: number; assistedHours: number; hoursSaved: number; percentReduction: number };
  scenario(input?: Record<string, unknown>): {
    applications: number;
    adoptionPct: number;
    hoursSavedPerAssessment: number;
    assistedAssessments: number;
    hoursPotentiallyFreed: number;
  };
  federalHypothesis(input?: Record<string, unknown>): { exchangesAvoided: number; hours: number };
  approxHours(hours: number): number;
  approxPercent(pct: number): number;
  clamp(value: unknown, key: string): number;
}
const Model = loadWindowScript<Model>('public/js/big-build-model.js', 'BigBuildModel');
const NofoUtil = loadWindowScript<{ readParams(search: string): { mode: string; opportunity: string | null } }>(
  'public/js/nofo-util.js',
  'NofoUtil'
);

/** Everything an audience member could see: no notes, comments, presenter-only elements or the presenter slide. */
function audienceText(): string {
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<aside class="notes">[\s\S]*?<\/aside>/g, ' ')
    .replace(/<section id="presenter-checklist"[\s\S]*?<\/section>/g, ' ')
    .replace(/<p class="[^"]*presenter-only[^"]*">[\s\S]*?<\/p>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ');
  // Keep alt text (it is read aloud) but drop the rest of the markup.
  const alts = [...visible.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]).join(' ');
  return (visible.replace(/<[^>]+>/g, ' ') + ' ' + alts).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
}

describe('slide structure', () => {
  it('has the seven audience sections in the storyboard order', () => {
    const ids = [...html.matchAll(/<section id="([^"]+)" class="slide/g)].map((m) => m[1]);
    expect(ids).toEqual(['problem', 'govrail', 'grantflow', 'find-grants', 'assess', 'impact', 'closing', 'presenter-checklist']);
  });

  it('opens with the general GovRail problem, not a grant-specific one', () => {
    const slide = /<section id="problem"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const visible = slide.replace(/<aside class="notes">[\s\S]*?<\/aside>/, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(visible).toContain('Government runs on complex rules');
    for (const word of ['Complex requirements', 'Human interpretation', 'Accountable outcomes']) expect(visible).toContain(word);
    expect(visible).toContain('how do we make its guidance reliable');
    expect(visible).not.toMatch(/\b(grant|notice|NOFO|applicant|GrantFlow)/i);
    // The funding-round picture belongs to the impact slide.
    expect(slide).not.toContain('applicantGrid');
    const impact = /<section id="impact"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(impact).toContain('id="applicantGrid"');
  });

  it('states the rules-engine / LLM / GovRail distinction on the architecture slide', () => {
    const slide = /<section id="govrail"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(slide).toContain('Rules engines follow predefined rules. LLMs interpret language and context. GovRail brings both together.');
  });

  it('keeps the presenter checklist hidden by default and marks it for removal outside presenter mode', () => {
    const tag = /<section id="presenter-checklist"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toContain('data-visibility="hidden"');
    expect(tag).toContain('data-presenter-slide');
  });

  it('shows the general architecture first and the GovRail + GrantFlow architecture second, as two slides', () => {
    const general = html.indexOf('/img/big-build/govrail-architecture-general.png');
    const app = html.indexOf('/img/big-build/govrail-grantflow-architecture.png');
    expect(general).toBeGreaterThan(0);
    expect(app).toBeGreaterThan(general);
    expect(html.indexOf('id="govrail"')).toBeLessThan(general);
    expect(html.indexOf('id="grantflow"')).toBeGreaterThan(general);
    expect(html.indexOf('id="grantflow"')).toBeLessThan(app);
  });

  it('gives every image real alt text', () => {
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(4);
    for (const tag of imgs) {
      const alt = /alt="([^"]*)"/.exec(tag)?.[1] ?? '';
      expect(alt.length, tag.slice(0, 80)).toBeGreaterThan(5);
    }
    const arch = imgs.filter((t) => t.includes('/img/big-build/'));
    for (const tag of arch) expect(/alt="([^"]*)"/.exec(tag)![1].length).toBeGreaterThan(200);
  });
});

describe('local assets', () => {
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)].map((m) => m[1]).filter((p) => !p.startsWith('//'));

  it('references only files that exist under public/ (including the vendored Reveal.js files)', () => {
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      if (ref === '/') continue; // the app's home route
      expect(existsSync(join(root, 'public', ref)), ref).toBe(true);
    }
  });

  it('serves both architecture graphics and they are the supplied images, not placeholders', () => {
    for (const name of ['govrail-architecture-general.png', 'govrail-grantflow-architecture.png']) {
      const file = join(root, 'public/img/big-build', name);
      expect(existsSync(file), name).toBe(true);
      expect(statSync(file).size, name).toBeGreaterThan(100_000);
      // The documented source copy must match byte for byte.
      const source = join(root, 'docs/presentation-instructions', name);
      if (existsSync(source)) expect(readFileSync(file).equals(readFileSync(source)), name).toBe(true);
    }
  });

  it('pulls nothing from another host', () => {
    const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+|\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(external).toEqual([]);
    expect(read('public/css/big-build.css')).not.toMatch(/https?:\/\//);
    expect(read('public/js/big-build.js')).not.toMatch(/fetch\(|XMLHttpRequest|https?:\/\//);
  });
});

describe('handoff links into the real app', () => {
  const links = [...html.matchAll(/<a class="launch[^"]*"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

  it('has a Find grants link (plain chat.html: there is no separate discover mode) and a live Assess link', () => {
    expect(links).toContain('/chat.html');
    const assess = links.find((l) => l.startsWith('/chat.html?mode=nofo'));
    expect(assess).toBeTruthy();
  });

  it('opens them in a new tab without leaking the opener', () => {
    for (const m of html.matchAll(/<a class="launch[^"]*"[^>]*>/g)) {
      expect(m[0]).toContain('target="_blank"');
      expect(m[0]).toContain('rel="noopener noreferrer"');
    }
  });

  it('uses the same parameters the app reads: the Assess link preselects the chosen opportunity', () => {
    const assess = links.find((l) => l.startsWith('/chat.html?mode=nofo'))!;
    const parsed = NofoUtil.readParams(assess.slice(assess.indexOf('?')));
    expect(parsed.mode).toBe('nofo');
    expect(parsed.opportunity).toBe('4d8f5775-ff01-4a6f-ab4e-b125899043b3');
    expect(NofoUtil.readParams('').mode).toBe('find');
  });

  const packageDir = join(root, 'data/opportunities/4d8f5775-ff01-4a6f-ab4e-b125899043b3');
  // data/opportunities/ is a git-ignored cache, so a fresh clone does not have the BUILD package. This is reported as skipped.
  it.skipIf(!existsSync(packageDir))('links to an opportunity that is prepared on this machine (skipped when the local cache has no BUILD package)', () => {
    expect(existsSync(join(packageDir, 'requirements.json'))).toBe(true);
  });
});

describe('claims discipline', () => {
  const text = audienceText();

  it('makes none of the claims the brief rules out', () => {
    for (const banned of [/\bMCP\b/i, /autonomous/i, /\bSDK\b/, /production[- ]ready/i, /we saved/i, /will save/i, /you qualify/i, /guaranteed/i, /eligible for/i, /verified savings/i]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
  });

  it('labels the impact figures as an illustrative model, not measured results', () => {
    expect(html).toMatch(/Illustrative model\s*(?:&mdash;|—)\s*not measured results\./);
    expect(html).toContain('class="calc-tag">Illustrative model');
  });

  it('keeps the footer limited to the home link (the preliminary disclaimer was removed on purpose)', () => {
    const footer = /<footer class="deck-foot"[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
    expect(footer).toContain('href="/"');
    expect(footer).not.toContain('Preliminary guidance for human review');
  });

  it('calls BUILD an archived historical demonstration, not open funding', () => {
    expect(text).toMatch(/archived notice used as a historical demonstration, not a claim that funding is open/);
  });

  it('says GovRail is a harness and the example workflows are potential uses', () => {
    expect(text).toContain('evidence-grounded AI guidance harness');
    expect(text).toMatch(/potential uses, not implemented applications/);
  });

  it('shows the final tagline exactly', () => {
    expect(html).toContain('GovRail: grounded reasoning. GrantFlow: government productivity in action.');
  });
});

describe('modes', () => {
  const js = read('public/js/big-build.js');
  const css = read('public/css/big-build.css');

  it('reads audience, presenter and record, and falls back to audience', () => {
    expect(js).toContain("m === 'presenter' || m === 'record' ? m : 'audience'");
  });

  it('removes presenter material unless presenter mode is on', () => {
    expect(js).toContain("checklist.remove()");
    expect(js).toMatch(/mode !== 'presenter'[\s\S]*?\.presenter-only[\s\S]*?\.remove\(\)/);
  });

  it('turns controls, progress, numbers and the speaker view off for recording, and the home link is hidden', () => {
    expect(js).toContain('controls: !record');
    expect(js).toContain('progress: !record');
    expect(js).toMatch(/if \(!record && typeof RevealNotes/);
    expect(css).toMatch(/\[data-mode="record"\] \.deck-home\s*\{\s*display:\s*none/);
  });

  it('honors prefers-reduced-motion', () => {
    expect(js).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('never builds HTML from strings', () => {
    expect(js).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
});

describe('scenario model (illustrative, deterministic)', () => {
  it('per assessment: 8 h manual midpoint vs 2.5 h assisted is 5.5 h, 68.75%, shown as ~70%', () => {
    const p = Model.perAssessment();
    expect(p.manualHours).toBe(8);
    expect(p.assistedHours).toBe(2.5);
    expect(p.hoursSaved).toBe(5.5);
    expect(p.percentReduction).toBeCloseTo(68.75, 10);
    expect(Model.approxPercent(p.percentReduction)).toBe(70);
  });

  it('defaults to 300 applications, 50% adoption, 5.5 h: 150 assisted, 825 h exactly, shown as ~800', () => {
    expect(Model.DEFAULTS).toEqual({ applications: 300, adoptionPct: 50, hoursSavedPerAssessment: 5.5 });
    const s = Model.scenario();
    expect(s.assistedAssessments).toBe(150);
    expect(s.hoursPotentiallyFreed).toBe(825);
    expect(Model.approxHours(s.hoursPotentiallyFreed)).toBe(800);
  });

  it('rounding is for display only: the exact value is unchanged and other inputs follow the same arithmetic', () => {
    const s = Model.scenario({ applications: 200, adoptionPct: 25, hoursSavedPerAssessment: 4 });
    expect(s.hoursPotentiallyFreed).toBe(200);
    const odd = Model.scenario({ applications: 307, adoptionPct: 33, hoursSavedPerAssessment: 5.5 });
    expect(odd.hoursPotentiallyFreed).toBeCloseTo(307 * 0.33 * 5.5, 10);
    expect(Model.approxHours(12.4)).toBe(12);
    expect(Model.approxHours(87)).toBe(90);
    expect(Model.approxHours(1234)).toBe(1200);
  });

  it('clamps and sanitizes input instead of trusting it', () => {
    expect(Model.clamp('abc', 'applications')).toBe(300);
    expect(Model.clamp(-5, 'adoptionPct')).toBe(0);
    expect(Model.clamp(250, 'adoptionPct')).toBe(100);
    expect(Model.clamp(1e9, 'applications')).toBe(5000);
    expect(Model.clamp(12.6, 'applications')).toBe(13);
    expect(Model.clamp(99, 'hoursSavedPerAssessment')).toBe(40);
    const s = Model.scenario({ applications: 'NaN', adoptionPct: Infinity, hoursSavedPerAssessment: '' });
    expect(Number.isFinite(s.hoursPotentiallyFreed)).toBe(true);
  });

  it('the federal side is a hypothesis chain: 150 x 40% x 25% x 1 h = 15 h', () => {
    expect(Model.federalHypothesis().hours).toBeCloseTo(15, 10);
    expect(Model.federalHypothesis().exchangesAvoided).toBeCloseTo(15, 10);
  });

  it('the slide copy states the same numbers the model produces', () => {
    const text = audienceText();
    expect(text).toContain('68.75%');
    expect(text).toContain('150 assisted assessments');
    expect(text).toContain('825 h');
    expect(text).toMatch(/~800 h/);
    expect(html).toContain('id="numPercent">~70<');
    expect(html).toContain('id="numFreed">800<');
  });
});
