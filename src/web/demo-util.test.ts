import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

// The browser scripts are plain scripts that attach window.* objects. Load them the way a page would.
const read = (name: string) => readFileSync(join(process.cwd(), 'public/js', name), 'utf-8');

const utilSandbox: Record<string, unknown> = {};
utilSandbox.window = utilSandbox;
vm.runInNewContext(read('demo-util.js'), utilSandbox);
const U = utilSandbox.DemoUtil as any;

const UUID = '4d8f5775-ff01-4a6f-ab4e-b125899043b3';

const progress = (id: string, status: string, message = id) => ({ type: 'progress', id, status, message });

function recording(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    recordedAt: '2026-11-11T00:00:00.000Z',
    note: 'test',
    discover: [
      { lines: [{ t: 0, line: progress('read', 'running') }, { t: 400, line: progress('read', 'done') }, { t: 500, line: { type: 'result', data: { stage: 'ask', turn: 1 } } }] },
      { lines: [{ t: 0, line: progress('rank', 'running') }, { t: 9000, line: progress('rank', 'done') }, { t: 9100, line: { type: 'result', data: { stage: 'results', turn: 2 } } }] },
    ],
    assess: [{ lines: [{ t: 0, line: progress('load', 'running') }, { t: 100, line: progress('load', 'done') }, { t: 150, line: { type: 'result', data: { advisory: { headline: 'assessed' } } } }] }],
    projectDescription: { text: 'A fictional project', source: 'model' },
    prepareReady: { message: 'Ready to assess.', partial: false, requirements: 42 },
    ...overrides,
  };
}

describe('validateRecording', () => {
  it('accepts a well-formed recording', () => {
    expect(U.validateRecording(recording())).toEqual({ ok: true });
  });
  it('rejects things that are not recordings, with a plain message', () => {
    expect(U.validateRecording(null).ok).toBe(false);
    expect(U.validateRecording({ version: 2, discover: [] }).ok).toBe(false);
    expect(U.validateRecording(recording({ discover: [] })).error).toMatch(/no discover turns/);
  });
  it('rejects a turn that is out of order, has an unknown line type, or does not end with a result', () => {
    const bad = (lines: unknown[]) => U.validateRecording(recording({ discover: [{ lines }] }));
    expect(bad([{ t: 5, line: progress('a', 'running') }, { t: 1, line: { type: 'result', data: {} } }]).error).toMatch(/out of order/);
    expect(bad([{ t: 0, line: { type: 'mystery' } }]).error).toMatch(/unknown type/);
    expect(bad([{ t: 0, line: progress('a', 'running') }]).error).toMatch(/does not end with a result/);
    expect(bad([]).error).toMatch(/no lines/);
  });
});

describe('pickTurn', () => {
  it('picks by call number and repeats the last turn after that', () => {
    expect(U.pickTurn(['a', 'b'], 0)).toBe('a');
    expect(U.pickTurn(['a', 'b'], 1)).toBe('b');
    expect(U.pickTurn(['a', 'b'], 7)).toBe('b');
  });
  it('returns null when there is nothing recorded', () => {
    expect(U.pickTurn([], 0)).toBeNull();
    expect(U.pickTurn(undefined, 0)).toBeNull();
  });
});

describe('scheduleLines', () => {
  const lines = [{ t: 0, line: 'a' }, { t: 400, line: 'b' }, { t: 9400, line: 'c' }];
  it('keeps short gaps and caps long ones', () => {
    expect(U.scheduleLines(lines, 2500, 1).map((s: any) => s.delay)).toEqual([0, 400, 2500]);
  });
  it('divides each gap by the speed', () => {
    expect(U.scheduleLines(lines, 2500, 2).map((s: any) => s.delay)).toEqual([0, 200, 1250]);
  });
  it('scales every delay down so the whole replay fits a time budget, keeping its shape', () => {
    const slow = [{ t: 0, line: 'a' }, { t: 2000, line: 'b' }, { t: 4000, line: 'c' }, { t: 6000, line: 'd' }];
    const delays = U.scheduleLines(slow, 2500, 1, 1500).map((s: any) => s.delay);
    expect(delays.reduce((a: number, b: number) => a + b, 0)).toBeLessThanOrEqual(1500);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBe(delays[2]);
    // A run already inside the budget is left alone.
    expect(U.scheduleLines(lines, 2500, 1, 10000).map((s: any) => s.delay)).toEqual([0, 400, 2500]);
  });
  it('ignores a nonsense cap or speed', () => {
    expect(U.scheduleLines(lines, -1, 0).map((s: any) => s.delay)).toEqual([0, 400, 2500]);
  });
});

describe('the scripted prepare', () => {
  it('is over in under two seconds', () => {
    expect(U.INGEST_MS + U.EXTRACT_MS).toBeLessThanOrEqual(2000);
  });
});

describe('prepareStateAt', () => {
  const final = { message: 'Ready to assess.', partial: false, requirements: 42 };
  it('moves from ingesting to extracting to ready, in the server\'s state shape', () => {
    const start = '2026-11-11T10:00:00.000Z';
    const a = U.prepareStateAt(0, UUID, final, start);
    expect(a).toMatchObject({ opportunityId: UUID, status: 'ingesting', failedStep: null, error: null, finishedAt: null });
    expect(U.prepareStateAt(U.INGEST_MS + 1, UUID, final, start).status).toBe('extracting');
    const done = U.prepareStateAt(U.INGEST_MS + U.EXTRACT_MS, UUID, final, start);
    expect(done).toMatchObject({ status: 'ready', requirements: 42, partial: false });
    expect(done.finishedAt).toBe('2026-11-11T10:00:12.000Z');
  });
  it('still reports ready when no final state was recorded', () => {
    expect(U.prepareStateAt(99999, UUID, null, null).status).toBe('ready');
  });
});

describe('parseFlag and isLocalRead', () => {
  it('reads the demo flag from the query string', () => {
    expect(U.parseFlag('?demo=1')).toBe('1');
    expect(U.parseFlag('?mode=nofo&demo=0')).toBe('0');
    expect(U.parseFlag('?demo=record')).toBe('record');
    expect(U.parseFlag('?demo=banana')).toBeNull();
    expect(U.parseFlag('?mode=nofo')).toBeNull();
    expect(U.parseFlag('')).toBeNull();
  });
  it('passes through only GETs of local opportunity data', () => {
    expect(U.isLocalRead('GET', '/opportunities')).toBe(true);
    expect(U.isLocalRead('get', `/opportunities/${UUID}/documents/d1/pages/2`)).toBe(true);
    expect(U.isLocalRead('POST', '/opportunities')).toBe(false);
    expect(U.isLocalRead('GET', '/discover')).toBe(false);
    expect(U.isLocalRead('GET', '/opportunitiesx')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// demo-mode.js: load it the way a page would, with a fake browser and a fake network.
// ---------------------------------------------------------------------------------------------------------------

type Call = { url: string; method: string };

function ndjson(lines: unknown[]) {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function loadPage(opts: { search: string; stored?: string; file?: unknown | 'missing'; real?: (url: string, init?: any) => Response; now?: { value: number } }) {
  const calls: Call[] = [];
  const local: Record<string, string> = opts.stored ? { 'grantflow.demoMode': opts.stored } : {};
  const session: Record<string, string> = {};
  const clock = opts.now ?? { value: 1_000_000 };
  class FakeDate extends Date {
    static now() { return clock.value; }
  }
  const store = (bag: Record<string, string>) => ({
    getItem: (k: string) => (k in bag ? bag[k] : null),
    setItem: (k: string, v: string) => { bag[k] = v; },
  });
  const assigned: string[] = [];
  const realFetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: String((init && init.method) || 'GET').toUpperCase() });
    if (url === '/demo/demo-run.json') {
      return opts.file === 'missing' ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(opts.file ?? recording()), { status: 200 });
    }
    if (opts.real) return opts.real(url, init);
    return new Response(JSON.stringify({ success: true, data: { real: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const sandbox: Record<string, any> = {
    URL, Response, ReadableStream, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console, JSON, Date: FakeDate,
    Blob, CustomEvent: class { constructor(public type: string, public init?: unknown) {} },
    document: { body: { appendChild() {}, removeChild() {} }, createElement: () => ({ setAttribute() {}, click() {} }), addEventListener() {}, dispatchEvent() {} },
    location: { search: opts.search, href: `http://localhost:3000/chat.html${opts.search}`, assign: (u: string) => assigned.push(u), reload() {} },
    localStorage: store(local),
    sessionStorage: store(session),
    fetch: realFetch,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['discover-util.js', 'demo-util.js', 'demo-mode.js', 'progress-panel.js']) vm.runInContext(read(file), sandbox);
  return { sandbox, calls, local, session, assigned, clock, realFetch };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('demo mode: switching', () => {
  it('leaves fetch alone when demo mode is off', () => {
    const page = loadPage({ search: '' });
    expect(page.sandbox.fetch).toBe(page.realFetch);
    expect(page.sandbox.DemoMode.isOn()).toBe(false);
  });
  it('turns on from ?demo=1, remembers it, and turns off from ?demo=0', () => {
    const on = loadPage({ search: '?demo=1' });
    expect(on.sandbox.DemoMode.isOn()).toBe(true);
    expect(on.local['grantflow.demoMode']).toBe('on');
    const remembered = loadPage({ search: '', stored: 'on' });
    expect(remembered.sandbox.DemoMode.isOn()).toBe(true);
    const off = loadPage({ search: '?demo=0', stored: 'on' });
    expect(off.sandbox.DemoMode.isOn()).toBe(false);
  });
  it('toggle() navigates with the new flag so the URL cannot undo it', () => {
    const page = loadPage({ search: '?demo=1&x=1' });
    page.sandbox.DemoMode.toggle();
    expect(page.assigned).toHaveLength(1);
    expect(new URL(page.assigned[0]).searchParams.get('demo')).toBe('0');
    expect(page.local['grantflow.demoMode']).toBe('off');
  });
});

describe('demo mode: replay never reaches a real API', () => {
  it('replays a discover turn through the page\'s own stream reader, turn by turn', async () => {
    const page = loadPage({ search: '?demo=1&demo_speed=1000' });
    const steps: any[] = [];
    const first = await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', { messages: [] }, (s: any) => steps.push(s));
    expect(first).toEqual({ stage: 'ask', turn: 1 });
    expect(steps.map((s) => `${s.id}:${s.status}`)).toEqual(['read:running', 'read:done']);
    const second = await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', { messages: [] }, () => {});
    expect(second).toEqual({ stage: 'results', turn: 2 });
    const third = await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', { messages: [] }, () => {});
    expect(third).toEqual({ stage: 'results', turn: 2 }); // past the last turn: repeats it
    // The only request that went out is the recording file itself.
    expect(page.calls.map((c) => c.url)).toEqual(['/demo/demo-run.json']);
  });

  it('replays assess and the project description', async () => {
    const page = loadPage({ search: '?demo=1&demo_speed=1000' });
    const result = await page.sandbox.ProgressPanel.stream('/api/nofo/assess?stream=1', { opportunityId: UUID, messages: [] }, () => {});
    expect(result.advisory.headline).toBe('assessed');
    const response = await page.sandbox.fetch('/api/nofo/project-description', { method: 'POST', body: '{}' });
    expect(await response.json()).toEqual({ success: true, data: { text: 'A fictional project', source: 'model' } });
  });

  it('restarts from the first turn after reset()', async () => {
    const page = loadPage({ search: '?demo=1&demo_speed=1000' });
    await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {});
    page.sandbox.DemoMode.reset();
    const again = await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {});
    expect(again.turn).toBe(1);
  });

  it('refuses a request it has no recording for, without sending it anywhere', async () => {
    const page = loadPage({ search: '?demo=1' });
    const response = await page.sandbox.fetch('/api/nofo/something-else', { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/no recording/);
    expect(page.calls).toHaveLength(0);
  });

  it('passes read-only local opportunity reads to the server, and nothing else', async () => {
    const page = loadPage({ search: '?demo=1' });
    await page.sandbox.fetch('/api/nofo/opportunities');
    await page.sandbox.fetch(`/api/nofo/opportunities/${UUID}/documents/d1/pages/2`);
    expect(page.calls.map((c) => c.url)).toEqual(['/api/nofo/opportunities', `/api/nofo/opportunities/${UUID}/documents/d1/pages/2`]);
    await page.sandbox.fetch(`/api/nofo/opportunities/${UUID}`, { method: 'DELETE' });
    expect(page.calls).toHaveLength(2);
  });

  it('does not touch requests outside /api/nofo', async () => {
    const page = loadPage({ search: '?demo=1' });
    await page.sandbox.fetch('/api/health');
    expect(page.calls.map((c) => c.url)).toEqual(['/api/health']);
  });

  it('says so plainly when the recording is missing or damaged, and still sends nothing to an API', async () => {
    const missing = loadPage({ search: '?demo=1', file: 'missing' });
    await expect(missing.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {})).rejects.toThrow(/recording was not found/);
    expect(missing.calls.map((c) => c.url)).toEqual(['/demo/demo-run.json']);
    const damaged = loadPage({ search: '?demo=1', file: { version: 1, discover: [] } });
    await expect(damaged.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {})).rejects.toThrow(/no discover turns/);
  });
});

describe('demo mode: the scripted prepare job', () => {
  it('reports the same state shape the server does, stage by stage, then ready', async () => {
    const clock = { value: 5_000_000 };
    const page = loadPage({ search: '?demo=1', now: clock });
    const get = async (init?: any) => (await (await page.sandbox.fetch(init ? '/api/nofo/prepare' : `/api/nofo/prepare/${UUID}`, init)).json()).data;
    expect((await get()).status).toBe('idle'); // nothing started yet
    const started = await get({ method: 'POST', body: JSON.stringify({ opportunityId: UUID }) });
    expect(started).toMatchObject({ opportunityId: UUID, status: 'ingesting' });
    clock.value += 6000;
    expect((await get()).status).toBe('extracting');
    clock.value += 7000;
    expect(await get()).toMatchObject({ status: 'ready', requirements: 42 });
    expect(page.calls.map((c) => c.url)).toEqual(['/demo/demo-run.json']); // no real prepare job
  });
  it('refuses to prepare without an opportunity', async () => {
    const page = loadPage({ search: '?demo=1' });
    const response = await page.sandbox.fetch('/api/nofo/prepare', { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
  });
});

describe('demo mode: recording a real run', () => {
  it('passes requests through and captures finished turns, the description and the ready state', async () => {
    const lines = [progress('read', 'running'), progress('read', 'done'), { type: 'result', data: { stage: 'ask' } }];
    const page = loadPage({
      search: '?demo=record',
      real: (url) => {
        if (url.startsWith('/api/nofo/discover')) return ndjson(lines);
        if (url.startsWith('/api/nofo/project-description')) return new Response(JSON.stringify({ success: true, data: { text: 'T', source: 'model' } }), { status: 200 });
        if (url.startsWith('/api/nofo/prepare')) return new Response(JSON.stringify({ success: true, data: { status: 'ready', message: 'Ready.', partial: false, requirements: 7 } }), { status: 200 });
        return new Response('{}', { status: 200 });
      },
    });
    expect(page.sandbox.DemoMode.isRecording()).toBe(true);
    expect(page.sandbox.DemoMode.isOn()).toBe(false);
    const result = await page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {});
    expect(result).toEqual({ stage: 'ask' }); // the page still gets the real answer
    await page.sandbox.fetch('/api/nofo/project-description', { method: 'POST', body: '{}' });
    await page.sandbox.fetch(`/api/nofo/prepare/${UUID}`);
    await settle();
    const saved = JSON.parse(page.session['grantflow.demoCapture']);
    expect(U.validateRecording(saved)).toEqual({ ok: true });
    expect(saved.discover[0].lines.map((l: any) => l.line.type)).toEqual(['progress', 'progress', 'result']);
    expect(saved.projectDescription).toEqual({ text: 'T', source: 'model' });
    expect(saved.prepareReady).toEqual({ message: 'Ready.', partial: false, requirements: 7 });
  });
  it('does not record a turn that failed', async () => {
    const page = loadPage({ search: '?demo=record', real: () => ndjson([progress('read', 'running'), { type: 'error', error: 'boom', code: 'X', retryable: false }]) });
    await expect(page.sandbox.ProgressPanel.stream('/api/nofo/discover?stream=1', {}, () => {})).rejects.toThrow('boom');
    await settle();
    expect(page.session['grantflow.demoCapture']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The progress panel stays on screen when a demo run completes.
// ---------------------------------------------------------------------------------------------------------------

function fakeElement(): any {
  const classes = new Set<string>();
  const node: any = {
    className: '', textContent: '', hidden: false, children: [] as any[], firstChild: null,
    appendChild(child: any) { node.children.push(child); node.firstChild = node.children[0]; return child; },
    removeChild(child: any) { node.children = node.children.filter((c: any) => c !== child); node.firstChild = node.children[0] ?? null; },
    setAttribute() {},
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
  };
  return node;
}

describe('progress panel in demo mode', () => {
  function panelPage(search: string) {
    const page = loadPage({ search });
    page.sandbox.document.createElement = () => fakeElement();
    const parts = { root: fakeElement(), title: fakeElement(), time: fakeElement(), steps: fakeElement() };
    const panel = page.sandbox.ProgressPanel.create(parts);
    return { panel, parts };
  }

  it('keeps a finished panel visible, ticked, and marked complete; the next start clears it', () => {
    const { panel, parts } = panelPage('?demo=1');
    panel.start();
    panel.push(progress('read', 'running'));
    panel.push(progress('read', 'done'));
    panel.flush();
    panel.stop();
    expect(parts.root.hidden).toBe(false);
    expect(parts.root.classList.contains('find-progress-complete')).toBe(true);
    expect(parts.title.textContent).toBe('Completed');
    expect(parts.steps.children).toHaveLength(1);
    panel.start();
    expect(parts.root.classList.contains('find-progress-complete')).toBe(false);
    expect(parts.steps.children).toHaveLength(0);
    panel.stop(); // clear the elapsed-time timer
  });

  it('still hides a run that did not finish, so a failure is never shown as completed', () => {
    const { panel, parts } = panelPage('?demo=1');
    panel.start();
    panel.push(progress('read', 'running'));
    panel.stop();
    expect(parts.root.hidden).toBe(true);
    expect(parts.root.classList.contains('find-progress-complete')).toBe(false);
  });

  it('hides the panel as before when demo mode is off', () => {
    const { panel, parts } = panelPage('');
    panel.start();
    panel.push(progress('read', 'running'));
    panel.push(progress('read', 'done'));
    panel.flush();
    panel.stop();
    expect(parts.root.hidden).toBe(true);
  });
});
