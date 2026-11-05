import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

// The browser helpers are plain scripts that attach window.DiscoverUtil. Load them the way a page would.
const source = readFileSync(join(process.cwd(), 'public/js/discover-util.js'), 'utf-8');
const sandbox: Record<string, unknown> = { URL };
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);
const D = sandbox.DiscoverUtil as any;

const UUID = '4d8f5775-ff01-4a6f-ab4e-b125899043b3';

describe('formatMoney', () => {
  it('writes plain-language amounts', () => {
    expect(D.formatMoney(25_000_000)).toBe('$25 million');
    expect(D.formatMoney(1_500_000_000)).toBe('$1.5 billion');
    expect(D.formatMoney(2_039_246_480)).toBe('$2.04 billion');
    expect(D.formatMoney(450_000)).toBe('$450,000');
  });
  it('returns null for a missing value rather than inventing one', () => {
    expect(D.formatMoney(null)).toBeNull();
    expect(D.formatMoney(undefined)).toBeNull();
    expect(D.formatMoney(NaN)).toBeNull();
  });
});

describe('profileFacts', () => {
  it('lists what was understood with the applicant\'s own words, keeping cost and request apart', () => {
    const facts = D.profileFacts({
      projectTypes: [{ value: 'bridge', quote: 'replace a bridge' }],
      applicantType: { value: 'state', quote: 'Virginia DOT' },
      federalAskUsd: { value: 25_000_000, quote: '$25 million' },
      totalCostUsd: { value: 40_000_000, quote: '$40 million' },
      terms: ['bridge'],
    });
    expect(facts.map((f: any) => [f.label, f.value, f.quote])).toEqual([
      ['Project type', 'Bridge', 'replace a bridge'],
      ['Applicant', 'State government', 'Virginia DOT'],
      ['Federal funds you would request', '$25 million', '$25 million'],
      ['Total project cost', '$40 million', '$40 million'],
    ]);
  });
  it('is empty for an empty or missing profile', () => {
    expect(D.profileFacts({ projectTypes: [], terms: [] })).toEqual([]);
    expect(D.profileFacts(null)).toEqual([]);
  });
});

describe('status and meta lines', () => {
  it('labels open, forecasted and historical opportunities differently', () => {
    expect(D.statusInfo({ status: 'posted', historical: false })).toMatchObject({ kind: 'success' });
    expect(D.statusInfo({ status: 'forecasted', historical: false }).text).toMatch(/not open yet/);
    expect(D.statusInfo({ status: 'archived', historical: true }).text).toMatch(/past round/);
  });

  it('says when a close date or award ceiling is not listed', () => {
    const parts = D.metaParts({ opportunityNumber: 'X-1', agency: 'FHWA', closeDate: null, awardCeiling: null, historical: false });
    expect(parts).toEqual(['Opportunity number X-1', 'FHWA', 'No close date listed', 'Maximum award not listed']);
    expect(D.metaParts({ closeDate: '2026-02-24', awardCeiling: 25_000_000, historical: true })).toEqual(['Closed 2026-02-24', 'Maximum award $25 million']);
  });
});

describe('safeUrl', () => {
  it('allows only http and https links', () => {
    expect(D.safeUrl('https://www.transportation.gov/BUILDgrants')).toBe('https://www.transportation.gov/BUILDgrants');
    expect(D.safeUrl('javascript:alert(1)')).toBeNull();
    expect(D.safeUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(D.safeUrl('not a url')).toBeNull();
    expect(D.safeUrl(null)).toBeNull();
  });
});

describe('loadCommands', () => {
  it('gives the two operator commands for a valid UUID, lower-cased', () => {
    expect(D.loadCommands(UUID.toUpperCase())).toEqual([`npm run nofo:ingest -- ${UUID}`, `npm run nofo:extract -- ${UUID}`]);
  });
  it('gives nothing for anything else, so nothing odd is ever shown as a command', () => {
    expect(D.loadCommands('abc; rm -rf /')).toEqual([]);
    expect(D.loadCommands('')).toEqual([]);
  });
});

describe('conversation limits', () => {
  it('adds a trimmed message, and refuses empty, oversize and over-limit input', () => {
    expect(D.nextMessages([], '  hello bridge  ')).toEqual([{ role: 'user', content: 'hello bridge' }]);
    expect(D.nextMessages([], '   ')).toBeNull();
    expect(D.nextMessages([], 'x'.repeat(4001))).toBeNull();
    const full = Array.from({ length: D.MAX_MESSAGES }, () => ({ role: 'user', content: 'a' }));
    expect(D.nextMessages(full, 'one more')).toBeNull();
    expect(D.messagesLeft(full)).toBe(0);
    expect(D.messagesLeft([])).toBe(D.MAX_MESSAGES);
  });

  it('builds a request with only the user\'s messages and the options that are on', () => {
    const body = D.buildRequest([{ role: 'user', content: 'a', extra: 'dropped' }], { includeHistorical: true });
    expect(body).toEqual({ messages: [{ role: 'user', content: 'a' }], includeHistorical: true });
    expect(D.buildRequest([{ role: 'user', content: 'a' }], { forceResults: true })).toEqual({ messages: [{ role: 'user', content: 'a' }], forceResults: true });
    expect(D.buildRequest([{ role: 'user', content: 'a' }], {})).toEqual({ messages: [{ role: 'user', content: 'a' }] });
    // The question ids already shown travel with the request; an empty list is left out.
    expect(D.buildRequest([{ role: 'user', content: 'a' }], { asked: ['applicant', 'phase'] })).toEqual({ messages: [{ role: 'user', content: 'a' }], asked: ['applicant', 'phase'] });
    expect(D.buildRequest([{ role: 'user', content: 'a' }], { asked: [] })).toEqual({ messages: [{ role: 'user', content: 'a' }] });
  });
});

describe('streamed progress helpers', () => {
  it('splits complete lines from an unfinished one and carries the rest forward', () => {
    const first = D.parseNdjson('{"type":"progress","id":"a"}\n{"type":"progress","id":"b"}\n{"type":"res');
    expect(first.events.map((e: any) => e.id)).toEqual(['a', 'b']);
    expect(first.rest).toBe('{"type":"res');
    const second = D.parseNdjson(first.rest + 'ult","data":1}\n');
    expect(second.events).toEqual([{ type: 'result', data: 1 }]);
    expect(second.rest).toBe('');
  });

  it('skips damaged or non-object lines instead of throwing', () => {
    const { events } = D.parseNdjson('not json\n\n"a string"\n42\n{"type":"progress","id":"ok"}\n');
    expect(events).toEqual([{ type: 'progress', id: 'ok' }]);
  });

  it('adds a step, then updates it in place by id, keeping the order', () => {
    let steps: any[] = [];
    steps = D.applyProgress(steps, { id: 'read', status: 'running', message: 'Reading…' });
    steps = D.applyProgress(steps, { id: 'search', status: 'running', message: 'Sending a request…', detail: 'Search words: bridge' });
    steps = D.applyProgress(steps, { id: 'read', status: 'done', message: 'Read it.' });
    expect(steps.map((s) => [s.id, s.status, s.message])).toEqual([
      ['read', 'done', 'Read it.'],
      ['search', 'running', 'Sending a request…'],
    ]);
    expect(steps[1].detail).toBe('Search words: bridge');
  });

  it('does not change the input array, and ignores events that are not well formed', () => {
    const steps = [{ id: 'a', status: 'running', message: 'x', detail: '' }];
    const out = D.applyProgress(steps, { id: 'a', status: 'done', message: 'y' });
    expect(steps[0].status).toBe('running');
    expect(out[0].status).toBe('done');
    expect(D.applyProgress(steps, { id: 5, message: 'bad' })).toBe(steps);
    expect(D.applyProgress(steps, null)).toBe(steps);
    // An unknown status is treated as still running rather than trusted.
    expect(D.applyProgress([], { id: 'z', status: 'weird', message: 'm' })[0].status).toBe('running');
  });

  it('picks the newest running step as the headline, else the newest step', () => {
    expect(D.currentStep([])).toBeNull();
    const steps = [
      { id: 'a', status: 'done', message: 'A' },
      { id: 'b', status: 'running', message: 'B' },
      { id: 'c', status: 'running', message: 'C' },
    ];
    expect(D.currentStep(steps).id).toBe('c');
    expect(D.currentStep([{ id: 'a', status: 'done', message: 'A' }, { id: 'b', status: 'failed', message: 'B' }]).id).toBe('b');
  });
});

describe('prepare helpers', () => {
  it('shows the two stages from the job state', () => {
    const steps = (state: any) => D.prepareSteps(state).map((s: any) => s.status);
    expect(steps({ status: 'ingesting' })).toEqual(['running', 'waiting']);
    expect(steps({ status: 'extracting' })).toEqual(['done', 'running']);
    expect(steps({ status: 'ready' })).toEqual(['done', 'done']);
    expect(steps({ status: 'failed', failedStep: 'ingest' })).toEqual(['failed', 'waiting']);
    expect(steps({ status: 'failed', failedStep: 'extract' })).toEqual(['done', 'failed']);
    expect(steps({ status: 'idle' })).toEqual(['waiting', 'waiting']);
  });

  it('shows both stages as waiting for anything unexpected rather than guessing', () => {
    expect(D.prepareSteps(null).map((s: any) => s.status)).toEqual(['waiting', 'waiting']);
    expect(D.prepareSteps({ status: 'banana' }).map((s: any) => s.status)).toEqual(['waiting', 'waiting']);
  });

  it('knows when a job is running', () => {
    expect(D.isPreparing({ status: 'ingesting' })).toBe(true);
    expect(D.isPreparing({ status: 'extracting' })).toBe(true);
    expect(D.isPreparing({ status: 'ready' })).toBe(false);
    expect(D.isPreparing(null)).toBe(false);
  });

  it('formats elapsed time', () => {
    expect(D.formatElapsed(0)).toBe('0s');
    expect(D.formatElapsed(45)).toBe('45s');
    expect(D.formatElapsed(125)).toBe('2m 05s');
    expect(D.formatElapsed(-3)).toBe('0s');
    expect(D.formatElapsed('x')).toBe('0s');
  });
});

describe('inspection helpers', () => {
  const inspection = [
    { label: 'Open', ok: true, response: { data: [{ opportunity_id: 'AAAAAAAA-0000-4000-8000-000000000001', opportunity_title: 'One' }] } },
    { label: 'Keywords', ok: true, response: { data: [{ opportunity_id: 'aaaaaaaa-0000-4000-8000-000000000002', opportunity_title: 'Two' }] } },
    { label: 'Failed', ok: false, response: null },
  ];

  it('finds the raw listing for an opportunity in any inspected response, ignoring letter case', () => {
    const found = D.findRawListing(inspection, 'aaaaaaaa-0000-4000-8000-000000000001');
    expect(found.label).toBe('Open');
    expect(found.listing.opportunity_title).toBe('One');
    expect(D.findRawListing(inspection, 'AAAAAAAA-0000-4000-8000-000000000002').label).toBe('Keywords');
  });

  it('returns null when the listing is not there, or the input is not usable', () => {
    expect(D.findRawListing(inspection, 'aaaaaaaa-0000-4000-8000-0000000000ff')).toBeNull();
    expect(D.findRawListing(null, 'x')).toBeNull();
    expect(D.findRawListing([{ response: { data: 'nope' } }, null], 'x')).toBeNull();
  });

  it('pretty-prints JSON and survives values that cannot be printed', () => {
    expect(D.prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(D.prettyJson(undefined)).toBe('');
    const circular: any = {};
    circular.self = circular;
    expect(D.prettyJson(circular)).toBe('');
  });

  it('makes download names from letters, digits and hyphens only', () => {
    expect(D.safeFileName('U.S. DOT opportunities matching: bridge, "rural"')).toBe('u-s-dot-opportunities-matching-bridge-rural.json');
    expect(D.safeFileName('../../etc/passwd')).toBe('etc-passwd.json');
    expect(D.safeFileName('')).toBe('response.json');
    expect(D.safeFileName('x'.repeat(200)).length).toBeLessThanOrEqual(65);
  });

  it('describes a search in one plain line', () => {
    expect(D.describeInspection({ ok: true, returned: 11, totalRecords: 11, cached: false, elapsedMs: 420 })).toBe('11 listings · 0.4s');
    expect(D.describeInspection({ ok: true, returned: 100, totalRecords: 1491, cached: false, elapsedMs: 1500 })).toBe('100 of 1491 listings · 1.5s');
    expect(D.describeInspection({ ok: true, returned: 1, totalRecords: 1, cached: true, elapsedMs: 0 })).toBe('1 listing · reused a recent result');
    expect(D.describeInspection({ ok: false })).toBe('failed');
  });

  it('asks the server for the raw traffic only when the option is on', () => {
    const messages = [{ role: 'user', content: 'a' }];
    expect(D.buildRequest(messages, { inspect: true })).toEqual({ messages, inspect: true });
    expect(D.buildRequest(messages, { inspect: false })).toEqual({ messages });
  });
});
