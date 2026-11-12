import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

// public/js/prepare-replay.js is a plain script that sets window.PrepareReplay. Load it the way a page would.
const sandbox: Record<string, unknown> = {};
sandbox.window = sandbox;
vm.runInNewContext(readFileSync(join(process.cwd(), 'public/js/prepare-replay.js'), 'utf-8'), sandbox);

interface Step { state: { status: string; message: string; requirements?: number | null }; holdMs: number }
const replay = sandbox.PrepareReplay as {
  applies(item: unknown, options: { enabled?: boolean; demoModeOn?: boolean }): boolean;
  plan(item: unknown): Step[];
};

const item = {
  readyToAssess: true,
  downloaded: {
    documents: [
      { title: 'Notice of Funding Opportunity', pages: 42 },
      { title: 'Amendment 1', pages: 1 },
      { title: 'Application checklist', pages: null },
    ],
    requirements: { total: 31 },
  },
};

describe('PrepareReplay.applies', () => {
  it('needs the setting on, an opportunity that is really prepared, and demo mode off', () => {
    expect(replay.applies(item, { enabled: true })).toBe(true);
    expect(replay.applies(item, { enabled: false })).toBe(false);
    expect(replay.applies(item, { enabled: true, demoModeOn: true })).toBe(false);
    // Never replays a job that did not run: an unprepared opportunity gets the real flow.
    expect(replay.applies({ ...item, readyToAssess: false }, { enabled: true })).toBe(false);
    expect(replay.applies({ downloaded: item.downloaded }, { enabled: true })).toBe(false);
    expect(replay.applies(null, { enabled: true })).toBe(false);
  });
});

describe('PrepareReplay.plan', () => {
  it('downloads and reads each real document, then extracts, then finishes ready', () => {
    const steps = replay.plan(item);
    const statuses = steps.map((s) => s.state.status);
    expect(statuses.slice(0, 6)).toEqual(Array(6).fill('ingesting'));
    expect(statuses.slice(6, -1).every((s) => s === 'extracting')).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('ready');
    expect(steps[0].state.message).toBe('Downloading document 1 of 3: Notice of Funding Opportunity');
    expect(steps[3].state.message).toBe('Reading document 1 of 3: Notice of Funding Opportunity (42 pages)');
    expect(steps[4].state.message).toBe('Reading document 2 of 3: Amendment 1 (1 page)');
    // No page count is invented for a file that has none.
    expect(steps[5].state.message).toBe('Reading document 3 of 3: Application checklist');
  });

  it('counts requirements up to the real total and never past it', () => {
    const steps = replay.plan(item);
    const counts = steps
      .filter((s) => s.state.status === 'extracting')
      .map((s) => Number(/(\d+) of 31 requirements/.exec(s.state.message)![1]));
    expect(counts[counts.length - 1]).toBe(31);
    expect(Math.max(...counts)).toBe(31);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(steps[steps.length - 1].state.requirements).toBe(31);
  });

  it('shows no counter when no requirement count is on file', () => {
    const steps = replay.plan({ readyToAssess: true, downloaded: { documents: item.downloaded.documents, requirements: null } });
    const extracting = steps.filter((s) => s.state.status === 'extracting');
    expect(extracting).toHaveLength(1);
    expect(extracting[0].state.message).not.toMatch(/\d/);
    expect(steps[steps.length - 1].state.requirements).toBeNull();
  });

  it('falls back to one generic download step when no documents are on file', () => {
    const steps = replay.plan({ readyToAssess: true });
    expect(steps[0].state.status).toBe('ingesting');
    expect(steps[0].state.message).toMatch(/^Downloading the official documents/);
    expect(steps[steps.length - 1].state.status).toBe('ready');
  });

  it('keeps long titles and long document lists short', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Document ${i} ${'x'.repeat(200)}`, pages: 3 }));
    const steps = replay.plan({ readyToAssess: true, downloaded: { documents: many } });
    expect(steps.filter((s) => s.state.status === 'ingesting')).toHaveLength(24);
    for (const s of steps) expect(s.state.message.length).toBeLessThan(160);
  });

  it('only the final step has no wait, and every wait is bounded', () => {
    const steps = replay.plan(item);
    expect(steps[steps.length - 1].holdMs).toBe(0);
    for (const s of steps.slice(0, -1)) {
      expect(s.holdMs).toBeGreaterThan(0);
      expect(s.holdMs).toBeLessThanOrEqual(5000);
    }
  });
});
