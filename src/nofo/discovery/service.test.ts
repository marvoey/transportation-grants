import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../config/config.js';
import { BUILD_ID, WCPP_ID, fakeSearchSource, fixtureSearchSource, makeCandidate, profileLlm } from '../__fixtures__/discovery.js';
import { DiscoveryError, discoverTurn, refinementQuestions } from './service.js';
import { SearchCache } from './search.js';
import { EMPTY_PROFILE } from './schemas.js';

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

describe('question policy: stop asking, always end with a list', () => {
  it('asks exactly one question, and searches nothing, when the first message has no project type', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user('We need money for a project') }, { source, llm: null, now: NOW });
    expect(result.stage).toBe('ask');
    expect(result.questions).toHaveLength(1);
    expect(result.shortlist).toEqual([]);
    expect(source.bodies).toHaveLength(0);
  });

  it('never asks the project-type question again: a vague second message returns a list', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user('We need money for a project', 'It is a good one') }, { source, llm: null, now: NOW });
    expect(result.stage).toBe('results');
    expect(result.shortlist.length).toBeGreaterThan(0);
    // Only the optional refinements may follow; the project-type question is never repeated.
    expect(result.questions.length).toBeLessThanOrEqual(2);
    expect(result.questions.join(' ')).not.toMatch(/What kind of transportation project/);
    expect(result.summary).toMatch(/could not tell the project type/);
  });

  it('"Show grants now" skips the question even on the first vague message', async () => {
    const result = await discoverTurn({ messages: user('We need money for a project'), forceResults: true }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(result.stage).toBe('results');
    expect(result.questions).toEqual([]);
  });

  it('searches at once when the project type is known, and offers at most two optional refinements', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user('We want to build a new trail') }, { source, llm: null, now: NOW });
    expect(result.stage).toBe('results');
    expect(source.bodies.length).toBeGreaterThan(0);
    expect(result.questions.length).toBeLessThanOrEqual(2);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('asks nothing from the third message on, for every profile', () => {
    expect(refinementQuestions(EMPTY_PROFILE, 3, false)).toEqual([]);
    expect(refinementQuestions(EMPTY_PROFILE, 6, false)).toEqual([]);
    expect(refinementQuestions(EMPTY_PROFILE, 1, true)).toEqual([]);
    expect(refinementQuestions(EMPTY_PROFILE, 1, false).length).toBe(2);
  });

  it('asks nothing when the useful details are already known', async () => {
    const llm = profileLlm({
      projectTypes: [{ type: 'bridge', quote: 'bridge' }],
      applicantType: { present: true, value: 'state', quote: 'state DOT' },
      phase: { present: true, value: 'design', quote: 'design is underway' },
      federalAskUsd: { present: true, value: 25_000_000, quote: '$25 million' },
      terms: ['bridge'],
    });
    const text = 'Our state DOT has a bridge project, design is underway, and we would request $25 million.';
    const result = await discoverTurn({ messages: user(text) }, { source: fixtureSearchSource(), llm, now: NOW });
    expect(result.questions).toEqual([]);
  });
});

describe('search behavior', () => {
  it('runs the broad open pull and the keyword search, and widens beyond DOT only when too few listings match', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
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
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(source.bodies.every((b) => b.filters?.top_level_agency)).toBe(true);
  });

  it('includes closed and archived listings only when asked, and labels them historical', async () => {
    const open = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(open.shortlist.every((s) => !s.historical)).toBe(true);

    const source = fixtureSearchSource();
    const hist = await discoverTurn({ messages: user(BRIDGE_TEXT), includeHistorical: true }, { source, llm: bridgeLlm(), now: NOW });
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
      { messages: user('Our county wants a wildlife overpass on a rural highway') },
      { source: fixtureSearchSource(), llm, now: NOW }
    );
    expect(result.shortlist[0].opportunityId).toBe(WCPP_ID);
  });

  it('never sends the applicant\'s money, applicant type or free text as a filter', async () => {
    const source = fixtureSearchSource();
    await discoverTurn({ messages: user(BRIDGE_TEXT), includeHistorical: true }, { source, llm: bridgeLlm(), now: NOW });
    for (const body of source.bodies) {
      expect(Object.keys(body.filters ?? {}).sort()).not.toContain('applicant_type');
      expect(JSON.stringify(body)).not.toContain('Virginia');
      expect(JSON.stringify(body)).not.toContain('25000000');
    }
  });

  it('serves a repeated search from the cache', async () => {
    const source = fixtureSearchSource();
    const cache = new SearchCache();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    const calls = source.bodies.length;
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBe(calls);
  });
});

describe('failures are visible, not silent', () => {
  it('fails with SEARCH_FAILED when every search fails, without leaking content', async () => {
    const source = fakeSearchSource(() => {
      throw new Error('secret internal detail');
    });
    const error = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW }).catch((e: unknown) => e);
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
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(result.stage).toBe('results');
    expect(result.warnings.join(' ')).toMatch(/search failed/);
  });

  it('warns that a keyword reader was used when no model is configured', async () => {
    const result = await discoverTurn({ messages: user('We need to replace a bridge') }, { source: fixtureSearchSource(), llm: null, now: NOW });
    expect(result.warnings.join(' ')).toMatch(/No language model is configured/);
    expect(result.profile.projectTypes.map((t) => t.value)).toContain('bridge');
  });

  it('reports skipped malformed listings', async () => {
    const fixture = fixtureSearchSource();
    const source = fakeSearchSource(async (body) => ({ ...(await fixture.searchOpportunities(body)), skipped: 2 }));
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW });
    expect(result.warnings.join(' ')).toMatch(/unexpected format/);
  });
});

describe('output contract', () => {
  it('is labeled preliminary and carries the disclaimer; the summary is written by code', async () => {
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
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
      { messages: user('a', 'b', 'c', 'd', 'e', 'f', 'g') },
      { messages: user('x'.repeat(4001)) },
      { messages: user('   ') },
      { messages: user('ok'), extra: true },
    ];
    for (const input of bad) {
      await expect(discoverTurn(input, { source, llm: null, now: NOW })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(source.bodies).toHaveLength(0);
  });

  it('does not log what the applicant wrote', async () => {
    const spy = vi.spyOn(logger, 'info');
    await discoverTurn({ messages: user('Confidential bridge project at 123 Secret Street') }, { source: fixtureSearchSource(), llm: null, now: NOW });
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
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
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
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
    const started = events.find((e) => e.id === 'search:keywords' && e.status === 'running');
    expect(started?.message).toMatch(/Sending a request to Simpler\.Grants\.gov/);
    expect(started?.detail).toMatch(/Search words: bridge/);
    const done = events.find((e) => e.id === 'search:open_all' && e.status === 'done');
    expect(done?.message).toMatch(/11 listings/);
    expect(events.find((e) => e.id === 'plan' && e.status === 'done')?.detail).toMatch(/Search words: bridge/);
  });

  it('says what was understood using labels and numbers, never the applicant\'s own words', async () => {
    const { events, onProgress } = collect();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress });
    const understood = events.find((e) => e.id === 'understood');
    expect(understood?.message).toBe('Understood: Bridge · State government · request $25 million');
    expect(JSON.stringify(events)).not.toMatch(/Virginia|structurally deficient/);
  });

  it('reports a widening search only when it happens', async () => {
    const wide = collect();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, onProgress: wide.onProgress });
    expect(ids(wide.events)).toContain('widen');
    expect(wide.events.find((e) => e.id === 'search:beyond_dot')?.message).toMatch(/Simpler\.Grants\.gov/);

    const many = Array.from({ length: 6 }, (_, i) => makeCandidate({ opportunityId: `6666666${i}-6666-4666-8666-666666666666`, title: `Bridge Program ${i}` }));
    const narrow = collect();
    await discoverTurn(
      { messages: user(BRIDGE_TEXT) },
      { source: fakeSearchSource(() => ({ candidates: many, totalRecords: 6, skipped: 0 })), llm: bridgeLlm(), now: NOW, onProgress: narrow.onProgress }
    );
    expect(ids(narrow.events)).not.toContain('widen');
  });

  it('marks a failed search as failed, and says a cached result was reused', async () => {
    const fixture = fixtureSearchSource();
    const failing = collect();
    await discoverTurn(
      { messages: user(BRIDGE_TEXT) },
      { source: fakeSearchSource(async (b) => (b.query ? Promise.reject(new Error('boom')) : fixture.searchOpportunities(b))), llm: bridgeLlm(), now: NOW, onProgress: failing.onProgress }
    );
    expect(failing.events.find((e) => e.id === 'search:keywords' && e.status === 'failed')?.message).toMatch(/failed and was skipped/);

    const cache = new SearchCache();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache });
    const second = collect();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW, cache, onProgress: second.onProgress });
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
    await discoverTurn({ messages: user('We need to replace a bridge') }, { source: fixtureSearchSource(), llm: null, now: NOW, onProgress });
    expect(events.find((e) => e.id === 'read' && e.status === 'running')?.message).toMatch(/keywords/);
    expect(events.find((e) => e.id === 'read' && e.status === 'done')?.message).toMatch(/no language model is configured/);
  });

  it('is unaffected by a progress callback that throws', async () => {
    const plain = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const noisy = await discoverTurn(
      { messages: user(BRIDGE_TEXT) },
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
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    expect(result.inspection).toBeUndefined();
  });

  it('returns each search with the exact request that was sent and the raw response that came back', async () => {
    const source = fixtureSearchSource();
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW });
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
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT), inspect: true }, { source: fixtureSearchSource(), llm: bridgeLlm(), now: NOW });
    const text = JSON.stringify(result.inspection);
    expect(text).not.toMatch(/test-simpler-key|X-API-Key|api[_-]?key/i);
  });

  it('shows a failed search as failed, with a safe message and no response', async () => {
    const fixture = fixtureSearchSource();
    const source = fakeSearchSource(async (body) => {
      if (body.query) throw new Error('internal detail');
      return fixture.searchOpportunities(body);
    });
    const result = await discoverTurn({ messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW });
    const failed = result.inspection!.find((i) => !i.ok);
    expect(failed).toBeDefined();
    expect(failed!.response).toBeNull();
    expect(failed!.error).not.toMatch(/internal detail/);
  });

  it('refetches when the cached answer was stored without its raw response, then reuses it', async () => {
    const source = fixtureSearchSource();
    const cache = new SearchCache();
    await discoverTurn({ messages: user(BRIDGE_TEXT) }, { source, llm: bridgeLlm(), now: NOW, cache });
    const afterPlain = source.bodies.length;

    const inspected = await discoverTurn({ messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBeGreaterThan(afterPlain); // the plain run kept no raw bodies, so these were fetched again
    expect(inspected.inspection!.every((i) => i.response !== null && !i.cached)).toBe(true);

    const calls = source.bodies.length;
    const again = await discoverTurn({ messages: user(BRIDGE_TEXT), inspect: true }, { source, llm: bridgeLlm(), now: NOW, cache });
    expect(source.bodies.length).toBe(calls);
    expect(again.inspection!.every((i) => i.cached && i.response !== null)).toBe(true);
  });

  it('is rejected when inspect is not a boolean', async () => {
    await expect(discoverTurn({ messages: user(BRIDGE_TEXT), inspect: 'yes' }, { source: fixtureSearchSource(), llm: null, now: NOW })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
