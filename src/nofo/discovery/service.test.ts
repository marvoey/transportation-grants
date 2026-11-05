import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../config/config.js';
import { BUILD_ID, WCPP_ID, fakeSearchSource, fixtureSearchSource, makeCandidate, profileLlm } from '../__fixtures__/discovery.js';
import { DiscoveryError, GUIDED_BATCH, GUIDED_ROUNDS, discoverTurn, guidedQuestions, pendingQuestions, refinementQuestions } from './service.js';
import { SearchCache } from './search.js';
import { EMPTY_PROFILE, GUIDED_QUESTION_IDS, type ConsoleLine } from './schemas.js';

/** Every guided question already shown: tests of the search itself use this so the search runs. */
const ASKED = [...GUIDED_QUESTION_IDS];
const NOW = () => new Date('2026-11-05T12:00:00Z');
const user = (...contents: string[]) => contents.map((content) => ({ role: 'user' as const, content }));

const BRIDGE_TEXT = 'Virginia DOT wants to replace a structurally deficient bridge. We would request $25 million in federal funds.';
const bridgeLlm = () =>
  profileLlm({
    projectTypes: [{ type: 'bridge', quote: 'replace a structurally deficient bridge' }],
    applicantType: { present: true, value: 'state', quote: 'Virginia DOT' },
    federalAskUsd: { present: true, value: 25_000_000, quote: '$25 million in federal funds' },
    terms: ['bridge'],
  });

describe('guided questions: ask before searching, then always end with a list', () => {
  const fresh = (...contents: string[]) => ({ messages: user(...contents) });

  it('asks about what is missing, and searches nothing, on the first message', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn(fresh('We need money for a project'), { source, llm: null, now: NOW });
    expect(result.stage).toBe('ask');
    expect(result.questions.map((q) => q.id)).toEqual(['projectType', 'applicant']);
    expect(result.questions.length).toBeLessThanOrEqual(GUIDED_BATCH);
    expect(result.shortlist).toEqual([]);
    expect(source.bodies).toHaveLength(0);
  });

  it('asks about the project type first, and says why', async () => {
    const result = await discoverTurn(fresh('We need money for a project'), { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(result.questions[0].text).toMatch(/What kind of transportation project/);
    expect(result.summary).toMatch(/what kind of project/);
  });

  it('does not ask for what the description already says', async () => {
    const result = await discoverTurn(fresh(BRIDGE_TEXT), { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    // Project type, applicant and the federal request are known: only the stage is left.
    expect(result.stage).toBe('ask');
    expect(result.questions.map((q) => q.id)).toEqual(['phase']);
  });

  it('searches at once when nothing useful is missing', async () => {
    const llm = profileLlm({
      projectTypes: [{ type: 'bridge', quote: 'bridge' }],
      applicantType: { present: true, value: 'state', quote: 'state DOT' },
      phase: { present: true, value: 'design', quote: 'design is underway' },
      federalAskUsd: { present: true, value: 25_000_000, quote: '$25 million' },
      terms: ['bridge'],
    });
    const source = fixtureSearchSource();
    const text = 'Our state DOT has a bridge project, design is underway, and we would request $25 million.';
    const result = await discoverTurn(fresh(text), { source, llm, now: NOW });
    expect(result.stage).toBe('results');
    expect(result.questions).toEqual([]);
    expect(source.bodies.length).toBeGreaterThan(0);
  });

  it('never asks a question twice: ids already shown are skipped, whether or not they were answered', async () => {
    const source = fixtureSearchSource();
    const second = await discoverTurn(
      { messages: user('We need money for a project', 'It is a good one'), asked: ['projectType', 'applicant'] },
      { source, llm: null, now: NOW }
    );
    expect(second.stage).toBe('ask');
    expect(second.questions.map((q) => q.id)).toEqual(['phase', 'request']);
    // Everything asked, still vague: a list, not a third round.
    const third = await discoverTurn({ messages: user('We need money for a project', 'It is a good one'), asked: ASKED }, { source, llm: null, now: NOW });
    expect(third.stage).toBe('results');
    expect(third.shortlist.length).toBeGreaterThan(0);
    expect(third.questions).toEqual([]);
    expect(third.summary).toMatch(/could not tell the project type/);
  });

  it('asks nothing from the third message on, whatever is missing', async () => {
    const result = await discoverTurn(fresh('We need money', 'for a project', 'a good one'), { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(GUIDED_ROUNDS).toBe(2);
    expect(result.stage).toBe('results');
    expect(result.questions).toEqual([]);
    expect(guidedQuestions(EMPTY_PROFILE, 3, false)).toEqual([]);
    expect(guidedQuestions(EMPTY_PROFILE, 6, false)).toEqual([]);
  });

  it('"Skip the questions and search" searches at once, and offers the unasked questions as optional refinements', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user('We want to build a new trail'), forceResults: true }, { source, llm: null, now: NOW });
    expect(result.stage).toBe('results');
    expect(source.bodies.length).toBeGreaterThan(0);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.length).toBeLessThanOrEqual(2);
  });

  it('skipping on a vague first message still returns the closest open programs', async () => {
    const result = await discoverTurn({ messages: user('We need money for a project'), forceResults: true }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(result.stage).toBe('results');
    expect(result.shortlist.length).toBeGreaterThan(0);
  });

  it('question helpers: order, batch size and the optional refinements', () => {
    expect(pendingQuestions(EMPTY_PROFILE).map((q) => q.id)).toEqual(['projectType', 'applicant', 'phase', 'request']);
    expect(pendingQuestions(EMPTY_PROFILE, ['projectType', 'phase']).map((q) => q.id)).toEqual(['applicant', 'request']);
    expect(guidedQuestions(EMPTY_PROFILE, 1, false)).toHaveLength(GUIDED_BATCH);
    expect(guidedQuestions(EMPTY_PROFILE, 1, true)).toEqual([]);
    expect(refinementQuestions(EMPTY_PROFILE, 1, false)).toEqual([]);
    expect(refinementQuestions(EMPTY_PROFILE, 1, true)).toHaveLength(2);
    expect(refinementQuestions(EMPTY_PROFILE, 3, true)).toEqual([]);
  });
});

describe('search behavior', () => {
  it('runs the broad open pull and the keyword search, and widens beyond DOT only when too few listings match', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    const kinds = source.bodies.map((b) => (b.filters?.top_level_agency ? (b.query ? 'keywords' : 'open_all') : 'beyond_dot'));
    expect(kinds).toEqual(expect.arrayContaining(['open_all', 'keywords']));
    // Open DOT listings contain no bridge programs, so the wider search runs.
    expect(kinds).toContain('beyond_dot');
    expect(result.searches.map((s) => s.label).join(' ')).toMatch(/any agency/);
  });

  it('does not widen when enough listings already match', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({ opportunityId: `5555555${i}-5555-4555-8555-555555555555`, title: `Bridge Program ${String.fromCharCode(65 + i)}` })
    );
    const source = fakeSearchSource(() => ({ candidates: many, totalRecords: many.length, skipped: 0 }));
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(source.bodies.every((b) => b.filters?.top_level_agency)).toBe(true);
  });

  it('includes closed and archived listings only when asked, and labels them historical', async () => {
    const open = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(open.shortlist.every((s) => !s.historical)).toBe(true);

    const source = fixtureSearchSource();
    const hist = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), includeHistorical: true }, { source, llm: bridgeLlm(), now: NOW });
    expect(hist.includeHistorical).toBe(true);
    expect(hist.shortlist.map((s) => s.opportunityId)).toContain(BUILD_ID);
    expect(hist.shortlist.find((s) => s.opportunityId === BUILD_ID)?.historical).toBe(true);
    expect(source.bodies.some((b) => b.filters?.opportunity_status?.one_of.includes('archived'))).toBe(true);
  });

  it('finds the wildlife program for a wildlife project (open listings only)', async () => {
    const llm = profileLlm({
      projectTypes: [{ type: 'wildlife_connectivity', quote: 'wildlife overpass' }],
      applicantType: { present: true, value: 'county', quote: 'Our county' },
      terms: ['wildlife crossing'],
    });
    const result = await discoverTurn(
      { asked: ASKED, messages: user('Our county wants a wildlife overpass on a rural highway') },
      { source: fixtureSearchSource(), llm, now: NOW }
    );
    expect(result.shortlist[0].opportunityId).toBe(WCPP_ID);
  });

  it('never sends the applicant\'s money, applicant type or free text as a filter', async () => {
    const source = fixtureSearchSource();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), includeHistorical: true }, { source, llm: bridgeLlm(), now: NOW });
    for (const body of source.bodies) {
      expect(Object.keys(body.filters ?? {}).sort()).not.toContain('applicant_type');
      expect(JSON.stringify(body)).not.toContain('Virginia');
      expect(JSON.stringify(body)).not.toContain('25000000');
    }
  });

  it('serves a repeated search from the cache', async () => {
    const source = fixtureSearchSource();
    const cache = new SearchCache();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    const calls = source.bodies.length;
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBe(calls);
  });
});

describe('failures are visible, not silent', () => {
  it('fails with SEARCH_FAILED when every search fails, without leaking content', async () => {
    const source = fakeSearchSource(() => {
      throw new Error('secret internal detail');
    });
    const error = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscoveryError);
    expect((error as DiscoveryError).code).toBe('SEARCH_FAILED');
    expect((error as DiscoveryError).message).not.toMatch(/secret internal detail/);
  });

  it('keeps going, with a warning, when one search fails', async () => {
    const fixture = fixtureSearchSource();
    const source = fakeSearchSource(async (body) => {
      if (body.query) throw new Error('boom');
      return fixture.searchOpportunities(body);
    });
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(result.stage).toBe('results');
    expect(result.warnings.join(' ')).toMatch(/search failed/);
  });

  it('warns that a keyword reader was used when no model is configured', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user('We need to replace a bridge') }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(result.warnings.join(' ')).toMatch(/No language model is configured/);
    expect(result.profile.projectTypes.map((t) => t.value)).toContain('bridge');
  });

  it('reports skipped malformed listings', async () => {
    const fixture = fixtureSearchSource();
    const source = fakeSearchSource(async (body) => ({ ...(await fixture.searchOpportunities(body)), skipped: 2 }));
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(result.warnings.join(' ')).toMatch(/unexpected format/);
  });
});

describe('output contract', () => {
  it('is labeled preliminary and carries the disclaimer; the summary is written by code', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(result.preliminary).toBe(true);
    expect(result.disclaimer).toMatch(/not an eligibility determination/);
    expect(result.summary).toMatch(/^I checked \d+ listings?\./);
  });

  it('rejects invalid input', async () => {
    const source = fixtureSearchSource();
    const bad: unknown[] = [
      {},
      { messages: [] },
      { messages: [{ role: 'assistant', content: 'hi' }] },
      { asked: ASKED, messages: user('a', 'b', 'c', 'd', 'e', 'f', 'g') },
      { asked: ASKED, messages: user('x'.repeat(4001)) },
      { asked: ASKED, messages: user('   ') },
      { asked: ASKED, messages: user('ok'), extra: true },
    ];
    for (const input of bad) {
      await expect(discoverTurn(input, { source, llm: null, now: NOW })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(source.bodies).toHaveLength(0);
  });

  it('does not log what the applicant wrote', async () => {
    const spy = vi.spyOn(logger, 'info');
    await discoverTurn({ asked: ASKED, messages: user('Confidential bridge project at 123 Secret Street') }, { source: fixtureSearchSource(), llm: null, now: NOW });
    const logged = spy.mock.calls.map((c) => String(c[0])).join(' ');
    spy.mockRestore();
    expect(logged).toMatch(/Discover:/);
    expect(logged).not.toMatch(/Secret Street|Confidential/);
  });
});

describe('progress events: what the code is really doing', () => {
  const collect = () => {
    const events: Array<{ id: string; status: string; message: string; detail?: string }> = [];
    return { events, onProgress: (e: (typeof events)[number]) => events.push(e) };
  };
  const ids = (events: Array<{ id: string }>) => [...new Set(events.map((e) => e.id))];

  it('reports each step in the order it happens, one running and one done per step', async () => {
    const { events, onProgress } = collect();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
    expect(ids(events).slice(0, 3)).toEqual(['read', 'understood', 'plan']);
    expect(ids(events)).toEqual(expect.arrayContaining(['search:open_all', 'search:keywords', 'rank']));
    // The first search request is sent only after the query has been built.
    const firstSearch = events.findIndex((e) => e.id.startsWith('search:'));
    expect(events.findIndex((e) => e.id === 'plan' && e.status === 'done')).toBeLessThan(firstSearch);
    // Every step that started also finished. ("understood" and "ask" are single results, not work in progress.)
    for (const id of ids(events).filter((i) => i !== 'understood' && i !== 'ask')) {
      const mine = events.filter((e) => e.id === id);
      expect(mine[0].status).toBe('running');
      expect(mine[mine.length - 1].status).not.toBe('running');
    }
  });

  it('names Simpler.Grants.gov and the search words, and reports real counts', async () => {
    const { events, onProgress } = collect();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
    const started = events.find((e) => e.id === 'search:keywords' && e.status === 'running');
    expect(started?.message).toMatch(/Sending a request to Simpler\.Grants\.gov/);
    expect(started?.detail).toMatch(/Search words: bridge/);
    const done = events.find((e) => e.id === 'search:open_all' && e.status === 'done');
    expect(done?.message).toMatch(/11 listings/);
    expect(events.find((e) => e.id === 'plan' && e.status === 'done')?.detail).toMatch(/Search words: bridge/);
  });

  it('says what was understood using labels and numbers, never the applicant\'s own words', async () => {
    const { events, onProgress } = collect();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
    const understood = events.find((e) => e.id === 'understood');
    expect(understood?.message).toBe('Understood: Bridge · State government · request $25 million');
    expect(JSON.stringify(events)).not.toMatch(/Virginia|structurally deficient/);
  });

  it('reports a widening search only when it happens', async () => {
    const wide = collect();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress: wide.onProgress });
    expect(ids(wide.events)).toContain('widen');
    expect(wide.events.find((e) => e.id === 'search:beyond_dot')?.message).toMatch(/Simpler\.Grants\.gov/);

    const many = Array.from({ length: 6 }, (_, i) => makeCandidate({ opportunityId: `6666666${i}-6666-4666-8666-666666666666`, title: `Bridge Program ${i}` }));
    const narrow = collect();
    await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      { source: fakeSearchSource(() => ({ candidates: many, totalRecords: 6, skipped: 0 })), llm: bridgeLlm(), now: NOW, onProgress: narrow.onProgress }
    );
    expect(ids(narrow.events)).not.toContain('widen');
  });

  it('marks a failed search as failed, and says a cached result was reused', async () => {
    const fixture = fixtureSearchSource();
    const failing = collect();
    await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      { source: fakeSearchSource(async (b) => (b.query ? Promise.reject(new Error('boom')) : fixture.searchOpportunities(b))), llm: bridgeLlm(), now: NOW, onProgress: failing.onProgress }
    );
    expect(failing.events.find((e) => e.id === 'search:keywords' && e.status === 'failed')?.message).toMatch(/failed and was skipped/);

    const cache = new SearchCache();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache });
    const second = collect();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache, onProgress: second.onProgress });
    expect(second.events.find((e) => e.id === 'search:open_all' && e.status === 'done')?.message).toMatch(/^Reused a recent result/);
  });

  it('stops after reading and understanding when it has to ask a question', async () => {
    const { events, onProgress } = collect();
    const result = await discoverTurn({ messages: user('We need money for a project') }, { source: fixtureSearchSource(), llm: null, now: NOW, onProgress });
    expect(result.stage).toBe('ask');
    expect(ids(events)).toEqual(['read', 'understood', 'ask']);
    expect(events.find((e) => e.id === 'understood')?.status).toBe('failed');
  });

  it('describes the keyword reader honestly when there is no model', async () => {
    const { events, onProgress } = collect();
    await discoverTurn({ asked: ASKED, messages: user('We need to replace a bridge') }, { source: fixtureSearchSource(), llm: null, now: NOW, onProgress });
    expect(events.find((e) => e.id === 'read' && e.status === 'running')?.message).toMatch(/keywords/);
    expect(events.find((e) => e.id === 'read' && e.status === 'done')?.message).toMatch(/no language model is configured/);
  });

  it('is unaffected by a progress callback that throws', async () => {
    const plain = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const noisy = await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      {
        source: fixtureSearchSource(),
        llm: bridgeLlm(),
        now: NOW,
        onProgress: () => {
          throw new Error('listener failed');
        },
      }
    );
    expect(noisy).toEqual(plain);
  });
});

describe('inspecting the Simpler.Grants.gov traffic', () => {
  it('adds nothing unless asked, so the normal response stays small', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(result.inspection).toBeUndefined();
  });

  it('returns each search with the exact request that was sent and the raw response that came back', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW });
    expect(result.inspection).toHaveLength(result.searches.length);
    const sent = source.bodies.map((b) => JSON.stringify(b)).sort();
    expect(result.inspection!.map((i) => JSON.stringify(i.request)).sort()).toEqual(sent);
    for (const item of result.inspection!) {
      expect(item.ok).toBe(true);
      expect(item.error).toBeNull();
      expect(item.response).toMatchObject({ status_code: 200 });
      expect(item.returned).toBeGreaterThan(0);
      expect(item.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(typeof item.label).toBe('string');
    }
  });

  it('never includes credentials or headers', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: true }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const text = JSON.stringify(result.inspection);
    expect(text).not.toMatch(/test-simpler-key|X-API-Key|api[_-]?key/i);
  });

  it('shows a failed search as failed, with a safe message and no response', async () => {
    const fixture = fixtureSearchSource();
    const source = fakeSearchSource(async (body) => {
      if (body.query) throw new Error('internal detail');
      return fixture.searchOpportunities(body);
    });
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW });
    const failed = result.inspection!.find((i) => !i.ok);
    expect(failed).toBeDefined();
    expect(failed!.response).toBeNull();
    expect(failed!.error).not.toMatch(/internal detail/);
  });

  it('refetches when the cached answer was stored without its raw response, then reuses it', async () => {
    const source = fixtureSearchSource();
    const cache = new SearchCache();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    const afterPlain = source.bodies.length;

    const inspected = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBeGreaterThan(afterPlain); // the plain run kept no raw bodies, so these were fetched again
    expect(inspected.inspection!.every((i) => i.response !== null && !i.cached)).toBe(true);

    const calls = source.bodies.length;
    const again = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBe(calls);
    expect(again.inspection!.every((i) => i.cached && i.response !== null)).toBe(true);
  });

  it('is rejected when inspect is not a boolean', async () => {
    await expect(discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT), inspect: 'yes' }, { source: fixtureSearchSource(), llm: null, now: NOW })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('developer console lines', () => {
  const collectConsole = () => {
    const lines: ConsoleLine[] = [];
    return { lines, onConsole: (l: ConsoleLine) => lines.push(l), text: () => lines.map((l) => l.text).join('\n') };
  };

  it('shows the profile and a draft of the search while it waits for answers, and sends nothing', async () => {
    const c = collectConsole();
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, onConsole: c.onConsole });
    expect(result.stage).toBe('ask');
    expect(source.bodies).toHaveLength(0);
    const text = c.text();
    expect(text).toMatch(/profile\.projectTypes\s+= \["bridge"\]/);
    expect(text).toMatch(/profile\.phase\s+= \(not stated yet\)/);
    expect(text).toMatch(/build search "keywords"\s+# draft only, not sent/);
    expect(text).toMatch(/nothing has been sent to Simpler\.Grants\.gov/);
    expect(text).not.toMatch(/POST /);
  });

  it('shows each request being built, then the request itself, then a summary of the response, in that order', async () => {
    const c = collectConsole();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onConsole: c.onConsole, apiBaseUrl: 'https://api.example.test/' });
    const text = c.text();
    const built = text.indexOf('$ build search "keywords"');
    const sent = text.indexOf('POST https://api.example.test/v1/opportunities/search');
    const answered = text.indexOf('200 OK');
    expect(built).toBeGreaterThan(-1);
    expect(sent).toBeGreaterThan(built);
    expect(answered).toBeGreaterThan(sent);
    expect(text).toMatch(/\+ filters\.top_level_agency = \{"one_of":\["DOT"\]\}/);
    expect(text).toMatch(/\+ query_operator = "OR"/);
    expect(text).toMatch(/total_records: \d+ · returned: \d+/);
    expect(text).toMatch(/\$ rank \d+ unique listings/);
    // The request body printed is exactly the body that was sent.
    const jsonLines = c.lines.filter((l) => l.kind === 'json').map((l) => JSON.parse(l.text));
    const source = fixtureSearchSource();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(jsonLines).toEqual(expect.arrayContaining(source.bodies));
  });

  it('never prints the API key, the applicant\'s own sentences, or a raw response', async () => {
    const c = collectConsole();
    const secret = 'Confidential bridge project at 123 Secret Street';
    await discoverTurn({ asked: ASKED, messages: user(secret) }, { source: fixtureSearchSource(), llm: null, now: NOW, onConsole: c.onConsole });
    const text = c.text();
    expect(text).not.toMatch(/Secret Street|Confidential/);
    expect(text).toMatch(/X-API-Key: ••••••••/);
    expect(text).not.toMatch(/"opportunity_id"|"summary"|"opportunity_assistance_listings"/);
  });

  it('says plainly when a search fails or is answered from the cache', async () => {
    const fixture = fixtureSearchSource();
    const failing = collectConsole();
    await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      { source: fakeSearchSource(async (b) => (b.query ? Promise.reject(new Error('boom')) : fixture.searchOpportunities(b))), llm: bridgeLlm(), now: NOW, onConsole: failing.onConsole }
    );
    expect(failing.lines.some((l) => l.kind === 'error' && /\[keywords\] failed/.test(l.text))).toBe(true);

    const cache = new SearchCache();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache });
    const cached = collectConsole();
    await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache, onConsole: cached.onConsole });
    expect(cached.text()).toMatch(/no request sent: reused an identical search/);
  });

  it('is unaffected by a console listener that throws', async () => {
    const plain = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const noisy = await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onConsole: () => { throw new Error('listener failed'); } }
    );
    expect(noisy.shortlist.map((s) => s.opportunityId)).toEqual(plain.shortlist.map((s) => s.opportunityId));
  });
});

describe('the API call and the plain-language explanation', () => {
  const EXPLAINED =
    'You asked about a county bridge project. The search looked at open U.S. Department of Transportation listings for the words bridge and infrastructure, and did not exclude anything by applicant type or award size. Eleven listings were checked and some are shown.';
  /** Answers the profile call like bridgeLlm, and the explanation call with `explanation`. */
  const llmWithExplanation = (explanation: string): import('../llm.js').LlmFn => {
    const profile = bridgeLlm();
    return (async (call) => {
      if ((call.schema as { required?: string[] }).required?.includes('explanation')) {
        return { text: JSON.stringify({ explanation }), stopReason: 'end_turn', model: 'test-model', inputTokens: 1, outputTokens: 1 };
      }
      return profile(call);
    }) as import('../llm.js').LlmFn;
  };

  it('returns every request that was made, with all parameters and no key, once the questions are done', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, apiBaseUrl: 'https://api.example.test' });
    expect(result.stage).toBe('results');
    expect(result.apiCalls!.map((c) => c.planId)).toEqual(expect.arrayContaining(['open_all', 'keywords']));
    const keywords = result.apiCalls!.find((c) => c.planId === 'keywords')!;
    expect(keywords.url).toBe('https://api.example.test/v1/opportunities/search');
    expect(keywords.body).toMatchObject({ query: 'bridge', query_operator: 'OR', filters: { top_level_agency: { one_of: ['DOT'] } }, pagination: { page_size: 25 } });
    expect(keywords.curl).toMatch(/\$SIMPLER_GRANTS_API_KEY/);
    expect(JSON.stringify(result.apiCalls)).not.toMatch(/test-key/);
  });

  it('uses the model\'s explanation when it passes the checks, and says it was written by the model', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: llmWithExplanation(EXPLAINED), now: NOW });
    expect(result.explanation).toEqual({ text: EXPLAINED, source: 'model' });
  });

  it('falls back to a template, and says so, with no model or an unusable answer', async () => {
    const none = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(none.explanation?.source).toBe('code');
    expect(none.explanation?.text).toMatch(/checked and/);
    const bad = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: llmWithExplanation('You are eligible and will win this grant for certain, see https://x.test'), now: NOW });
    expect(bad.explanation?.source).toBe('code');
  });

  it('gives neither while questions are still being asked', async () => {
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(result.stage).toBe('ask');
    expect(result.apiCalls).toBeUndefined();
    expect(result.explanation).toBeUndefined();
  });

  it('reports the explanation as its own step, after scoring, and records it in the console', async () => {
    const events: Array<{ id: string; status: string; message: string }> = [];
    const lines: string[] = [];
    await discoverTurn(
      { asked: ASKED, messages: user(BRIDGE_TEXT) },
      { source: fixtureSearchSource(), llm: llmWithExplanation(EXPLAINED), now: NOW, onProgress: (e) => events.push(e), onConsole: (l) => lines.push(l.text) }
    );
    const order = [...new Set(events.map((e) => e.id))];
    expect(order.indexOf('explain')).toBeGreaterThan(order.indexOf('rank'));
    expect(events.filter((e) => e.id === 'explain').map((e) => e.status)).toEqual(['running', 'done']);
    expect(JSON.stringify(events)).not.toMatch(/Virginia|structurally deficient/);
    expect(lines.join('\n')).toMatch(/\$ explain search/);
  });
});

describe('the build trace in the result', () => {
  it('is returned with a list, describes this run, and is not returned while questions are open', async () => {
    const result = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(result.trace!.steps[1].actor).toBe('model');
    expect(result.trace!.parameters.some((p) => p.call === 'keywords' && p.parameter === 'query')).toBe(true);
    const asking = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(asking.trace).toBeUndefined();
  });

  it('says a keyword reader was used when there is no model, and a widened search when it happened', async () => {
    const none = await discoverTurn({ asked: ASKED, messages: user('We need to replace a bridge') }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(none.trace!.steps[1].title).toMatch(/keyword reader/);
    const wide = await discoverTurn({ asked: ASKED, messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const searches = wide.trace!.steps.find((s) => s.title === 'Code chose which searches to run')!;
    expect(searches.items!.some((i) => i.startsWith('beyond_dot'))).toBe(wide.apiCalls!.some((c) => c.planId === 'beyond_dot'));
  });
});

