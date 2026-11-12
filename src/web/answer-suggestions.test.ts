import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

// A plain browser script that sets window.AnswerSuggestions. Load it the way a page would.
const sandbox: Record<string, unknown> = {};
sandbox.window = sandbox;
vm.runInNewContext(read('public/js/answer-suggestions.js'), sandbox);
const S = sandbox.AnswerSuggestions as any;

const q = (group: string, text = `Question about ${group}?`) => ({ group, text, factKeys: [], because: [] });
const fact = (value: unknown) => ({ value, provenance: 'user', quote: 'x' });
const nums = (text: string) => [...text.matchAll(/\$([\d.]+) million/g)].map((m) => Number(m[1]) * 1e6);

describe('amounts: total = federal request + match, and never contradicting what is known', () => {
  const consistent = (a: { total: number; request: number; match: number }) => Math.abs(a.total - a.request - a.match) < 1 && a.request > 0 && a.match > 0;

  it('uses a coherent default scenario when nothing is known', () => {
    expect(S.amounts({})).toEqual({ total: 24e6, request: 15e6, match: 9e6 });
  });

  it('keeps what the applicant already said and derives the rest', () => {
    expect(S.amounts({ totalProjectCostUsd: fact(25e6), requestedFederalUsd: fact(18e6) })).toEqual({ total: 25e6, request: 18e6, match: 7e6 });
    expect(S.amounts({ requestedFederalUsd: fact(12e6), nonFederalMatchUsd: fact(6e6) })).toEqual({ total: 18e6, request: 12e6, match: 6e6 });
    expect(S.amounts({ totalProjectCostUsd: fact(20e6), nonFederalMatchUsd: fact(5e6) })).toEqual({ total: 20e6, request: 15e6, match: 5e6 });
  });

  it('stays consistent for every combination of known amounts, including odd ones', () => {
    const options = [undefined, 3e6, 12e6, 18e6, 25e6, 55e6];
    for (const total of options) {
      for (const request of options) {
        for (const match of options) {
          const facts: Record<string, unknown> = {};
          if (total) facts.totalProjectCostUsd = fact(total);
          if (request) facts.requestedFederalUsd = fact(request);
          if (match) facts.nonFederalMatchUsd = fact(match);
          const a = S.amounts(facts);
          expect(consistent(a), JSON.stringify({ total, request, match, a })).toBe(true);
          // A stated total or request is never silently changed to a different number unless the three could not all hold.
          if (total && request && total > request) {
            expect(a.total).toBe(total);
            expect(a.request).toBe(request);
          }
        }
      }
    }
  });

  it('keeps a request it makes up under $20 million, but never changes one the applicant stated', () => {
    expect(S.amounts({ totalProjectCostUsd: fact(60e6) }).request).toBeLessThan(20e6);
    expect(S.amounts({ nonFederalMatchUsd: fact(30e6) }).request).toBeLessThan(20e6);
    expect(S.amounts({ requestedFederalUsd: fact(25e6) }).request).toBe(25e6);
  });

  it('ignores nonsense values rather than using them', () => {
    expect(S.amounts({ totalProjectCostUsd: fact(-5), requestedFederalUsd: fact('lots') })).toEqual({ total: 24e6, request: 15e6, match: 9e6 });
  });
});

describe('build: suggestions for the questions the assessment asked', () => {
  it('returns one item per question, in the order asked, with the question text kept', () => {
    const { items } = S.build([q('bca', 'Has a BCA been done?'), q('costMatch'), q('environmental')], {});
    expect(items.map((i: any) => i.group)).toEqual(['bca', 'costMatch', 'environmental']);
    expect(items[0].question).toBe('Has a BCA been done?');
  });

  it('offers a well-advanced and an early-stage answer where the answer depends on the stage, and one answer where it does not', () => {
    const { items } = S.build([q('bca'), q('request')], {});
    expect(items[0].variants.map((v: any) => v.stage)).toEqual(['advanced', 'early']);
    expect(items[0].variants[0].text).toMatch(/has been completed/);
    expect(items[0].variants[1].text).toMatch(/not completed .* yet/);
    expect(items[1].variants).toHaveLength(1);
    expect(items[1].variants[0].stage).toBe('either');
  });

  it('keeps the money consistent inside the answer, and says "request" for the request and "total" for the total', () => {
    const { items } = S.build([q('costMatch')], {});
    const text = items[0].variants[0].text as string;
    expect(text).toContain('The total project cost is $24 million');
    expect(text).toContain('We would request $15 million in federal funds');
    expect(text).toContain('remaining $9 million is non-federal match');
    const [total, request, match] = nums(text);
    expect(total).toBe(request + match);
  });

  it('builds on the facts already known, so a reply never contradicts the conversation', () => {
    const facts = { totalProjectCostUsd: fact(25e6), requestedFederalUsd: fact(18e6) };
    const { items } = S.build([q('costMatch'), q('request')], facts);
    expect(items[0].variants[0].text).toContain('The total project cost is $25 million');
    expect(items[0].variants[0].text).toContain('remaining $7 million');
    expect(items[1].variants[0].text).toBe('We would request $18 million in federal funds.');
  });

  it('follows a match-committed fact that is already known, for both stages', () => {
    const committed = S.build([q('costMatch')], { matchCommitted: fact(true) }).items[0].variants;
    expect(committed).toHaveLength(1);
    expect(committed[0].text).toMatch(/That match is committed/);
    const notYet = S.build([q('costMatch')], { matchCommitted: fact(false) }).items[0].variants;
    expect(notYet[0].text).toMatch(/not committed yet/);
    const unknown = S.build([q('costMatch')], {}).items[0].variants;
    expect(unknown.map((v: any) => /not committed/.test(v.text))).toEqual([false, true]);
  });

  it('uses known area, category and applicant facts', () => {
    const facts = { areaType: fact('rural'), grantCategory: fact('planning'), applicantType: fact('tribal') };
    const text = S.build([q('area'), q('category'), q('applicant')], facts).items.map((i: any) => i.variants[0].text);
    expect(text[0]).toBe('The project is in a rural area.');
    expect(text[1]).toMatch(/planning application/);
    expect(text[2]).toBe('We are a tribal government.');
    expect(S.build([q('applicant')], {}).items[0].variants[0].text).toBe('We are a state department of transportation.');
  });

  it('gives one complete reply per stage that answers every question once, in order', () => {
    const { replies, items } = S.build([q('bca'), q('costMatch'), q('environmental')], {});
    expect(replies.map((r: any) => r.stage)).toEqual(['advanced', 'early']);
    const advanced = replies[0].text as string;
    expect(advanced.indexOf('benefit-cost')).toBeLessThan(advanced.indexOf('total project cost'));
    expect(advanced.indexOf('total project cost')).toBeLessThan(advanced.indexOf('environmental review'));
    expect(advanced).toBe(items.map((i: any) => i.answers.advanced).join(' '));
    expect(replies[1].text).toMatch(/not completed/);
    expect(replies[0].text).not.toBe(replies[1].text);
  });

  it('gives nothing when there are no questions, and skips a question it does not recognise', () => {
    expect(S.build([], {})).toEqual({ items: [], replies: [] });
    expect(S.build(null, null)).toEqual({ items: [], replies: [] });
    const { items } = S.build([q('mystery'), { nope: true }, null, q('bca')], {});
    expect(items.map((i: any) => i.group)).toEqual(['bca']);
  });

  it('covers every guided question the Find grants page can ask, using the ids the server defines', () => {
    const schemas = read('src/nofo/discovery/schemas.ts');
    const ids = [...schemas.slice(schemas.indexOf('GUIDED_QUESTION_IDS'), schemas.indexOf('as const', schemas.indexOf('GUIDED_QUESTION_IDS'))).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['projectType', 'applicant', 'phase', 'request']);
    for (const id of ids) expect(S.build([q(id)], {}).items, `no suggestion for guided question "${id}"`).toHaveLength(1);
  });

  it('answers the stage question differently for a well advanced and an early project, and keeps a known cost consistent', () => {
    const { items, replies } = S.build([q('projectType'), q('phase'), q('request')], { totalProjectCostUsd: fact(30e6) });
    expect(items[1].variants.map((v: any) => v.stage)).toEqual(['advanced', 'early']);
    expect(items[1].variants[0].text).toMatch(/construction-ready/);
    expect(items[1].variants[1].text).toMatch(/planning stage/);
    // $30 million total: the suggested request is a share of it, never the whole cost.
    const [request] = nums(items[2].variants[0].text);
    expect(request).toBeGreaterThan(0);
    expect(request).toBeLessThan(30e6);
    expect(replies).toHaveLength(2);
  });

  it('covers every question group the server can ask', () => {
    const server = read('src/nofo/assessment/questions.ts');
    // Only the TEXT block (one entry per question group), not the fact-key lines above it.
    const start = server.indexOf('const TEXT');
    const block = server.slice(start, server.indexOf('};', start));
    const groups = [...block.matchAll(/^  (\w+): ['"]/gm)].map((m) => m[1]);
    expect(groups.length).toBeGreaterThanOrEqual(9);
    for (const group of groups) {
      expect(S.build([q(group)], {}).items, `no suggestion for question group "${group}"`).toHaveLength(1);
    }
  });
});

describe('the suggested-answers tray in chat.html', () => {
  const html = read('public/chat.html');

  it('is closed by default and starts hidden, so it never shows before the Assess tab is chosen', () => {
    expect(html).toMatch(/<aside[^>]*id="answersDrawer"[^>]*\bhidden\b/);
    expect(html).toMatch(/<button[^>]*id="answersTab"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="answersPanel"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/class="[^"]*is-open[^"]*"/);
  });

  it('says plainly that the answers are made up', () => {
    expect(html).toMatch(/Made-up example answers for testing, not facts about your project/);
  });

  it('loads the shared kit before either tray, the suggestion logic before its tray, and all before nofo.js', () => {
    const at = (name: string) => html.indexOf(`/js/${name}`);
    expect(at('drawer-kit.js')).toBeGreaterThan(-1);
    expect(at('drawer-kit.js')).toBeLessThan(at('samples-drawer.js'));
    expect(at('drawer-kit.js')).toBeLessThan(at('answers-drawer.js'));
    expect(at('answer-suggestions.js')).toBeLessThan(at('answers-drawer.js'));
    expect(at('answers-drawer.js')).toBeLessThan(at('nofo.js'));
  });

  it('is available on the Find grants and Assess tabs only, and learns of each set of questions from the page that asked', () => {
    const tray = read('public/js/answers-drawer.js');
    expect(tray).toMatch(/setAvailable\(mode === 'nofo' \|\| mode === 'find'\)/);
    expect(tray).toContain("addEventListener('assessresult'");
    expect(tray).toContain("addEventListener('findquestions'");
    const find = read('public/js/discover.js');
    expect(find).toContain("new CustomEvent('findquestions'");
    // Announced when a turn returns, and cleared on start over.
    expect((find.match(/announceQuestions\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const nofo = read('public/js/nofo.js');
    expect(nofo).toContain("new CustomEvent('assessresult'");
    // Announced when a result arrives, and cleared on start over, on switching opportunity and on opening another one.
    expect((nofo.match(/announceResult\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('opening one tray closes the other', () => {
    const kit = read('public/js/drawer-kit.js');
    expect(kit).toContain("new CustomEvent('trayopen'");
    expect(kit).toContain("addEventListener('trayopen'");
    // The other tab moves beside the open panel so it is not hidden behind it (and can be clicked to switch trays).
    expect(kit).toContain("classList.toggle('tray-open'");
    expect(read('public/css/style.css')).toContain('body.tray-open .tray:not(.is-open) .tray-tab');
  });
});

describe('detail questions (made from the notice\'s requirements)', () => {
  const detail = { group: 'detail:req-0000a001', text: 'Are all costs in your application part of an approved project plan?' };

  it('suggests a yes, a no and a not-sure answer, each naming its question so several can be pasted together', () => {
    const { items } = S.build([detail], {});
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe(true);
    expect(items[0].variants.map((v: any) => v.label)).toEqual(['Yes, we meet this', 'No, not yet', 'Not sure yet']);
    expect(items[0].variants[0].text).toBe('For "Are all costs in your application part of an approved project plan": yes, we do.');
    expect(items[0].variants[1].text).toContain(': no, not yet.');
  });

  it('uses yes in the well-advanced complete reply and no in the early one, alongside the fixed questions', () => {
    const { replies } = S.build([q('request'), detail], {});
    expect(replies[0].text).toContain('yes, we do.');
    expect(replies[1].text).toContain('no, not yet.');
  });

  it('strips quotes out of the question so the suggestion stays one clean sentence', () => {
    const { items } = S.build([{ group: 'detail:req-0000a002', text: 'Does "Form A" apply?' }], {});
    expect(items[0].variants[0].text).toBe("For \"Does 'Form A' apply\": yes, we do.");
  });
});

describe('listed requirements keep their category', () => {
  it('passes the category through so the drawer can group the suggestions', () => {
    const { items } = S.build([{ group: 'detail:req-0000a003', text: 'Does it?', category: 'funding' }, { group: 'detail:req-0000a004', text: 'Does it too?' }], {});
    expect(items.map((i: any) => i.category)).toEqual(['funding', '']);
  });
});

describe('buildOpen (one complete reply for every other open requirement)', () => {
  const listed = (n: number, text = 'Does your project meet this requirement?') =>
    Array.from({ length: n }, (_, i) => ({ group: `detail:req-${String(i).padStart(8, '0')}`, text: `${text} (${i})`, category: 'funding' }));

  it('gives a yes, a no and a not-sure reply, each with one sentence per requirement, in order', () => {
    const out = S.buildOpen(listed(3), {});
    expect(out.total).toBe(3);
    expect(out.replies.map((r: any) => r.stage)).toEqual(['yes', 'no', 'unsure']);
    expect(out.replies[0].label).toBe('Complete reply: yes to all (3)');
    expect(out.replies[0].text.match(/yes, we do\./g)).toHaveLength(3);
    expect(out.replies[1].text.match(/no, not yet\./g)).toHaveLength(3);
    expect(out.replies[2].text.match(/we are not sure yet\./g)).toHaveLength(3);
    expect(out.replies[0].text.indexOf('(0)')).toBeLessThan(out.replies[0].text.indexOf('(2)'));
  });

  it('keeps each reply within one message and says how many requirements it holds when not all fit', () => {
    const out = S.buildOpen(listed(70, 'Does your application meet these notice requirements with a deliberately long wording that takes room?'), {});
    for (const reply of out.replies) expect(reply.text.length).toBeLessThanOrEqual(3800);
    expect(out.replies[0].included).toBeLessThan(70);
    expect(out.replies[0].label).toMatch(/^Complete reply: yes to all \(the first \d+ of 70\)$/);
  });

  it('is empty when there is nothing listed, and ignores questions that are not detail questions', () => {
    expect(S.buildOpen([], {})).toMatchObject({ total: 0, replies: [] });
    expect(S.buildOpen([q('request')], {}).total).toBe(0);
  });
});

describe('suggestions by kind of detail question', () => {
  const base = { group: 'detail:req-0000a050', category: 'eligibility' };
  const labels = (item: any) => item.variants.map((v: any) => v.label);

  it('a choice gets one suggestion per option, plus not sure, each naming its question', () => {
    const spec = { type: 'choice', options: [{ label: 'A State DOT', outcome: 'meets' }, { label: 'A local agency', outcome: 'does_not_meet' }] };
    const { items, replies } = S.build([{ ...base, text: 'Who is applying? A) A State DOT; B) A local agency.', spec }], {});
    expect(labels(items[0])).toEqual(['A State DOT', 'A local agency', 'Not sure yet']);
    expect(items[0].variants[1].text).toBe('For "Who is applying? A) A State DOT; B) A local agency.": A local agency.');
    expect(replies[0].text).toContain(': A State DOT.');
    expect(replies[1].text).toContain(': A local agency.');
  });

  it('a number gets a figure that meets the limit and one that does not, with the unit', () => {
    const atMost = { type: 'number', comparison: { op: 'at_most', value: 4, unit: 'projects' } };
    const atLeast = { type: 'number', comparison: { op: 'at_least', value: 20 } };
    const a = S.build([{ ...base, text: 'How many projects?', spec: atMost }], {}).items[0];
    expect(a.variants.map((v: any) => v.text)).toEqual(['For "How many projects": 4 projects.', 'For "How many projects": 5 projects.', 'For "How many projects": we are not sure yet.']);
    const b = S.build([{ ...base, text: 'What percent match?', spec: atLeast }], {}).items[0];
    expect(b.variants.slice(0, 2).map((v: any) => v.text)).toEqual(['For "What percent match": 20.', 'For "What percent match": 19.']);
  });

  it('a description gets a short description and a still-planning one; a yes/no is as before', () => {
    expect(labels(S.build([{ ...base, text: 'Describe your staffing.', spec: { type: 'describe' } }], {}).items[0])).toEqual(['A short description', 'Still being planned', 'Not sure yet']);
    expect(labels(S.build([{ ...base, text: 'Do you?', spec: { type: 'yes_no' } }], {}).items[0])).toEqual(['Yes, we meet this', 'No, not yet', 'Not sure yet']);
    expect(labels(S.build([{ ...base, text: 'Do you?' }], {}).items[0])).toEqual(['Yes, we meet this', 'No, not yet', 'Not sure yet']);
  });
});

