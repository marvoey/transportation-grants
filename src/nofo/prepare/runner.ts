import { spawn, type SpawnOptions } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { parseOpportunityId } from '../schemas.js';

/**
 * Runs the existing operator CLIs (`nofo:ingest`, `nofo:extract`) as separate processes. PDF and HTML parsing
 * therefore never happens inside the web-server process, which is the point of keeping ingestion offline.
 *
 * The command line is fixed: this program (node), the CLI file, and a validated UUID. No shell is involved,
 * so nothing a user typed can become part of a command. Only the CLI's own `Error: ...` line is passed back
 * (those messages are written to be safe to show: no keys, headers or signed URLs).
 */

export type PrepareStep = 'ingest' | 'extract';

export interface StepResult {
  /** null when the process was killed or could not start. */
  exitCode: number | null;
  timedOut: boolean;
  /** The CLI's last "Error: ..." line, or null. */
  errorLine: string | null;
}

export type RunStep = (step: PrepareStep, opportunityId: string) => Promise<StepResult>;

export interface CliRunnerOptions {
  ingestTimeoutMs?: number;
  extractTimeoutMs?: number;
  /** Tests point these at tiny scripts. Default: the CLIs next to this module (compiled .js, else .ts via tsx). */
  cliPaths?: Partial<Record<PrepareStep, string>>;
  /** Extra arguments placed before the CLI path (tests only). */
  nodeArgs?: string[];
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
}

const CLI_LOCATIONS: Record<PrepareStep, string> = {
  ingest: '../ingest/cli',
  extract: '../extraction/cli',
};

/** The node arguments (everything before the UUID) for a step: the compiled CLI if it exists, else the source via tsx. */
export function resolveCli(step: PrepareStep, options: Pick<CliRunnerOptions, 'cliPaths' | 'nodeArgs'> = {}): string[] {
  const override = options.cliPaths?.[step];
  if (override) return [...(options.nodeArgs ?? []), override];
  const base = CLI_LOCATIONS[step];
  const js = fileURLToPath(new URL(`${base}.js`, import.meta.url));
  if (existsSync(js)) return [js];
  const ts = fileURLToPath(new URL(`${base}.ts`, import.meta.url));
  if (existsSync(ts)) return ['--import', 'tsx', ts];
  throw new Error(`The ${step} command could not be found.`);
}

const MAX_CAPTURE = 8_000;

function lastErrorLine(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^Error: (.{1,300})$/.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

export function createCliRunner(options: CliRunnerOptions = {}): RunStep {
  const spawnFn = options.spawnImpl ?? spawn;
  const timeouts: Record<PrepareStep, number> = {
    ingest: options.ingestTimeoutMs ?? 5 * 60 * 1000,
    extract: options.extractTimeoutMs ?? 20 * 60 * 1000,
  };

  return (step, opportunityId) =>
    new Promise<StepResult>((resolve) => {
      // Re-validated here as well, so this function is safe to call from anywhere.
      let id: string;
      try {
        id = parseOpportunityId(opportunityId);
      } catch {
        resolve({ exitCode: null, timedOut: false, errorLine: null });
        return;
      }

      let args: string[];
      try {
        args = [...resolveCli(step, options), id];
      } catch {
        resolve({ exitCode: null, timedOut: false, errorLine: null });
        return;
      }

      const spawnOptions: SpawnOptions = { shell: false, stdio: ['ignore', 'ignore', 'pipe'], env: options.env ?? process.env, windowsHide: true };
      let stderr = '';
      let timedOut = false;
      let finished = false;
      const finish = (result: StepResult): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawnFn(process.execPath, args, spawnOptions);
      } catch {
        resolve({ exitCode: null, timedOut: false, errorLine: null });
        return;
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, timeouts[step]);

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-MAX_CAPTURE);
      });
      child.on('error', () => finish({ exitCode: null, timedOut, errorLine: null }));
      child.on('close', (code) => finish({ exitCode: code, timedOut, errorLine: lastErrorLine(stderr) }));
    });
}
