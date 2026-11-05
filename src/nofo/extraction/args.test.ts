import { describe, expect, it } from 'vitest';
import { parseExtractArgs } from './args.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseExtractArgs', () => {
  it('finds the UUID with no options (regression: the first argument was once dropped)', () => {
    expect(parseExtractArgs([UUID])).toEqual({ positional: [UUID], refresh: false, includeGuidance: false, passes: 1, help: false });
  });

  it('finds the UUID regardless of where the options are', () => {
    expect(parseExtractArgs([UUID, '--refresh']).positional).toEqual([UUID]);
    expect(parseExtractArgs(['--refresh', UUID]).positional).toEqual([UUID]);
    expect(parseExtractArgs(['--passes', '2', UUID]).positional).toEqual([UUID]);
    expect(parseExtractArgs([UUID, '--passes', '3', '--refresh']).positional).toEqual([UUID]);
  });

  it('reads flags and the passes value', () => {
    expect(parseExtractArgs([UUID, '--refresh', '--include-guidance', '--passes', '2'])).toMatchObject({ refresh: true, includeGuidance: true, passes: 2 });
    expect(parseExtractArgs([UUID, '--help']).help).toBe(true);
  });

  it('falls back to one pass for a missing or non-numeric value, and reports extra positionals', () => {
    expect(parseExtractArgs([UUID, '--passes']).passes).toBe(1);
    expect(parseExtractArgs([UUID, '--passes', 'lots']).passes).toBe(1);
    expect(parseExtractArgs([UUID, 'extra']).positional).toEqual([UUID, 'extra']);
  });
});
