import type { AgentInput, AgentResult, DiscoveryDeps } from './discovery-types.js';
import { ProjectService } from './project-service.js';
import { JsonFileProjectStore } from './project-store.js';

/** Deterministic service for tests: in-memory store, controllable clock, sequential ids. */
/** A scriptable discovery agent: queue results/errors, inspect the inputs it received. */
export function makeFakeAgent() {
  const queue: Array<AgentResult | Error | ((input: AgentInput) => Promise<AgentResult>)> = [];
  const calls: AgentInput[] = [];
  const agent = async (input: AgentInput): Promise<AgentResult> => {
    calls.push(structuredClone(input));
    const next = queue.shift();
    if (!next) throw new Error('fake agent: nothing queued');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(input);
    return next;
  };
  return { agent, queue, calls };
}

export function reply(partial: Partial<AgentResult> = {}): AgentResult {
  return { reply: 'Thanks! What problem are you solving?', questions: [], changes: [], suggestedNextStep: 'problem_beneficiaries', ...partial };
}

export function makeService(
  opts: {
    filePath?: string | null;
    limits?: Partial<ProjectService['limits']>;
    discovery?: Partial<DiscoveryDeps>;
  } = {}
) {
  let t = Date.parse('2026-11-01T20:00:00.000Z');
  let n = 0;
  const clock = {
    advance(ms: number) {
      t += ms;
    },
    get now() {
      return new Date(t);
    },
  };
  const store = new JsonFileProjectStore(opts.filePath ?? null);
  const fake = makeFakeAgent();
  const service = new ProjectService({
    store,
    discovery: {
      runAgent: fake.agent,
      isConfigured: () => true,
      timeoutMs: 30000,
      graceMs: 10000,
      dailyLimit: 500,
      historyMessages: 20,
      ...opts.discovery,
    },
    now: () => new Date(t),
    // Valid UUIDs, since project ids are validated as UUIDs.
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    limits: opts.limits,
  });
  return { service, store, clock, fake };
}

let reqCounter = 0;
/** Fresh requestId per call, valid per RequestIdSchema. */
export function rid(): string {
  return `req-${String(++reqCounter).padStart(8, '0')}`;
}
