import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCliRunner, resolveCli } from './runner.js';

const ID = '4d8f5775-ff01-4a6f-ab4e-b125899043b3';
const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

/** Writes small stand-in CLIs. Real child processes, so the real spawn path is exercised. */
async function scripts() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'prepare-runner-'));
  dirs.push(dir);
  const write = async (name: string, body: string) => {
    const path = join(dir, name);
    await fs.writeFile(path, body);
    return path;
  };
  return {
    dir,
    // Records exactly the arguments it received (as JSON) to the file named in TEST_OUT.
    records: await write('records.mjs', `import { writeFileSync } from 'fs'; writeFileSync(process.env.TEST_OUT, JSON.stringify(process.argv.slice(2)));`),
    fails: await write(
      'fails.mjs',
      `console.error('some noise with secret-token-123'); console.error('Error: Something specific went wrong'); process.exit(2);`
    ),
    longError: await write('long.mjs', `console.error('Error: ' + 'x'.repeat(400)); process.exit(2);`),
    partial: await write('partial.mjs', `process.exit(3);`),
    slow: await write('slow.mjs', `setInterval(() => {}, 1000);`),
  };
}

describe('createCliRunner', () => {
  it('runs the CLI with exactly one argument: the validated UUID', async () => {
    const s = await scripts();
    const out = join(s.dir, 'args.json');
    const run = createCliRunner({ cliPaths: { ingest: s.records }, env: { ...process.env, TEST_OUT: out } });
    const result = await run('ingest', ID.toUpperCase());
    expect(result).toEqual({ exitCode: 0, timedOut: false, errorLine: null });
    expect(JSON.parse(await fs.readFile(out, 'utf8'))).toEqual([ID]);
  });

  it('never starts a process for something that is not a UUID, so nothing typed can reach a command', async () => {
    const s = await scripts();
    const out = join(s.dir, 'args.json');
    const run = createCliRunner({ cliPaths: { ingest: s.records }, env: { ...process.env, TEST_OUT: out } });
    for (const bad of [`${ID}; touch ${out}`, '$(touch x)', '--refresh', '', '../../x']) {
      expect(await run('ingest', bad)).toEqual({ exitCode: null, timedOut: false, errorLine: null });
    }
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('passes back the exit code and only the CLI\'s own "Error:" line, never other output', async () => {
    const s = await scripts();
    const run = createCliRunner({ cliPaths: { ingest: s.fails } });
    const result = await run('ingest', ID);
    expect(result.exitCode).toBe(2);
    expect(result.errorLine).toBe('Something specific went wrong');
    expect(JSON.stringify(result)).not.toContain('secret-token-123');
  });

  it('ignores an over-long error line rather than passing it on', async () => {
    const s = await scripts();
    const result = await createCliRunner({ cliPaths: { ingest: s.longError } })('ingest', ID);
    expect(result.exitCode).toBe(2);
    expect(result.errorLine).toBeNull();
  });

  it('reports a "written but partial" exit code as it is', async () => {
    const s = await scripts();
    expect((await createCliRunner({ cliPaths: { extract: s.partial } })('extract', ID)).exitCode).toBe(3);
  });

  it('stops a process that runs too long and says so', async () => {
    const s = await scripts();
    const run = createCliRunner({ cliPaths: { extract: s.slow }, extractTimeoutMs: 300 });
    const result = await run('extract', ID);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('reports a CLI that cannot be started instead of throwing', async () => {
    const run = createCliRunner({ cliPaths: { ingest: join(tmpdir(), 'does-not-exist-cli.mjs') } });
    const result = await run('ingest', ID);
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

describe('resolveCli', () => {
  it('finds the real ingest and extract CLIs (compiled if built, else source through tsx)', () => {
    const ingest = resolveCli('ingest');
    const extract = resolveCli('extract');
    expect(ingest[ingest.length - 1]).toMatch(/ingest[\\/]cli\.(js|ts)$/);
    expect(extract[extract.length - 1]).toMatch(/extraction[\\/]cli\.(js|ts)$/);
    if (ingest[ingest.length - 1].endsWith('.ts')) expect(ingest.slice(0, 2)).toEqual(['--import', 'tsx']);
  });

  it('uses an explicit path when one is given', () => {
    expect(resolveCli('ingest', { cliPaths: { ingest: '/x/y.mjs' } })).toEqual(['/x/y.mjs']);
  });
});
