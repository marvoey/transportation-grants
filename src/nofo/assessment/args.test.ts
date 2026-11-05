import { describe, expect, it } from 'vitest';
import { parseAssessArgs } from './args.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseAssessArgs', () => {
  it('reads the UUID, several --say messages in order, and the facts file', () => {
    expect(parseAssessArgs([UUID, '--say', 'first', '--say', 'second', '--facts-file', 'f.json'])).toEqual({
      positional: [UUID], say: ['first', 'second'], factsFile: 'f.json', help: false,
    });
  });
  it('finds the UUID wherever it is, and does not mistake option values for it', () => {
    expect(parseAssessArgs(['--say', 'hello there', UUID]).positional).toEqual([UUID]);
    expect(parseAssessArgs(['--facts-file', 'f.json', UUID, '--say', 'x']).positional).toEqual([UUID]);
  });
  it('ignores a flag with a missing value', () => {
    expect(parseAssessArgs([UUID, '--say']).say).toEqual([]);
    expect(parseAssessArgs([UUID, '--say', '--facts-file', 'f.json']).say).toEqual([]);
    expect(parseAssessArgs([UUID, '--facts-file']).factsFile).toBeNull();
  });
  it('recognises help', () => {
    expect(parseAssessArgs(['--help']).help).toBe(true);
  });
});
