import { describe, expect, it } from 'vitest';
import { GrantServerError } from '../types/index.js';
import type { AgentChange } from './discovery-types.js';
import { makeService, reply, rid } from './test-helpers.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GrantServerError);
    return (e as GrantServerError).code;
  }
  throw new Error('expected rejection');
};

async function setup(opts: Parameters<typeof makeService>[0] = {}) {
  const h = makeService(opts);
  const owner = (await h.service.createSession()).ownerId;
  const other = (await h.service.createSession()).ownerId;
  const { project } = await h.service.createProject(owner, { name: 'Main Street', requestId: rid() });
  const turn = (message: string, revision = project.revision, requestId = rid(), who = owner) =>
    h.service.runDiscoveryTurn(who, project.id, { message, expectedRevision: revision, requestId });
  return { ...h, owner, other, project, turn };
}

const change = (c: Partial<AgentChange> & Pick<AgentChange, 'op' | 'path'>): AgentChange => ({ rationale: 'user said so', ...c });
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('discovery turn', () => {
  it('stores the conversation and a pending batch, and reports current readiness', async () => {
    const { turn, fake, service, owner, project } = await setup();
    fake.queue.push(
      reply({
        questions: [{ field: 'need.problem', text: 'What problem?' }],
        changes: [change({ op: 'set', path: 'applicant.type', value: 'city', basis: null })],
      })
    );
    const r = await turn('We are the City of Tacoma');
    expect(r.userMessage).toMatchObject({ role: 'user', content: 'We are the City of Tacoma' });
    expect(r.assistantMessage.role).toBe('assistant');
    expect(r.batch).toMatchObject({ state: 'pending', baseRevision: 1 });
    expect(r.batch!.changes[0]).toMatchObject({ disposition: 'pending', path: 'applicant.type', basis: null });
    expect(r.batch!.changes[0].sourceMessageIds).toEqual([r.userMessage.id, r.assistantMessage.id]);
    expect(r.readiness.completeCount).toBe(1);
    expect(r.questions).toHaveLength(1);

    // The profile is NOT mutated by a turn — only by an explicit apply.
    const p = (await service.getProject(owner, project.id)).project;
    expect(p.profile.applicant.type).toBeNull();
    expect(p.revision).toBe(1);

    const msgs = await service.listMessages(owner, project.id);
    expect(msgs.items.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs.lastTurn).toMatchObject({
      state: 'complete',
      questions: [{ field: 'need.problem', text: 'What problem?' }],
      suggestedNextStep: 'problem_beneficiaries',
    });
  });

  it('gives the agent only server-loaded context and bounded history', async () => {
    const { turn, fake } = await setup({ discovery: { historyMessages: 3 } });
    for (let i = 0; i < 3; i++) {
      fake.queue.push(reply());
      await turn(`message ${i}`, 1);
    }
    fake.queue.push(reply());
    await turn('latest', 1);
    const last = fake.calls[fake.calls.length - 1];
    expect(last.history).toHaveLength(3);
    expect(last.history[last.history.length - 1]).toEqual({ role: 'user', content: 'latest' });
    expect(last.profile.name).toBe('Main Street');
    expect(JSON.stringify(last)).not.toMatch(/ownerId/);
  });

  it('persists the user message and the busy lock before the model call, with no transaction held', async () => {
    const { turn, fake, store, owner, project, service } = await setup();
    fake.queue.push(async () => {
      // If a transaction were still open this would deadlock (the store serializes them).
      await store.transaction(() => undefined);
      const stored = await store.read((d) => ({
        msgs: d.messages[project.id].map((m) => m.role),
        state: d.discoveryRequests[project.id][0].state,
      }));
      expect(stored).toEqual({ msgs: ['user'], state: 'in_progress' });
      return reply();
    });
    await turn('hello');
    expect((await service.listMessages(owner, project.id)).lastTurn?.state).toBe('complete');
  });

  it('a stale revision returns REVISION_CONFLICT before anything is stored or the model is called', async () => {
    const { turn, fake, store, project } = await setup();
    expect(await code(turn('hi', 99))).toBe('REVISION_CONFLICT');
    expect(fake.calls).toHaveLength(0);
    expect(await store.read((d) => d.messages[project.id])).toBeUndefined();
  });

  it('only one turn runs per project: a second returns DISCOVERY_BUSY (retryable)', async () => {
    const { turn, fake } = await setup();
    const gate = deferred();
    fake.queue.push(async () => { await gate.promise; return reply(); });
    const first = turn('first');
    await new Promise((r) => setTimeout(r, 10));
    const err = await turn('second').catch((e) => e);
    expect(err).toBeInstanceOf(GrantServerError);
    expect(err.code).toBe('DISCOVERY_BUSY');
    expect(err.retryable).toBe(true);
    gate.resolve();
    await first;
    fake.queue.push(reply());
    await expect(turn('third')).resolves.toBeDefined(); // lock released
  });

  it('replay of a completed request returns the stored result without calling the model', async () => {
    const { turn, fake, service, owner, project } = await setup();
    fake.queue.push(reply({ changes: [change({ op: 'add', path: 'constraints', value: 'Tight budget' })] }));
    const requestId = rid();
    const a = await turn('same', 1, requestId);
    const b = await turn('same', 1, requestId);
    expect(b.assistantMessage.id).toBe(a.assistantMessage.id);
    expect(b.batch!.id).toBe(a.batch!.id);
    expect(fake.calls).toHaveLength(1);
    expect((await service.listMessages(owner, project.id)).items).toHaveLength(2);
    expect(await code(turn('different text', 1, requestId))).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('on failure the user message stays, the profile is untouched, and a retry re-runs without duplicating', async () => {
    const { turn, fake, service, owner, project } = await setup();
    fake.queue.push(new GrantServerError('AGENT_TIMEOUT', 'too slow', true));
    const requestId = rid();
    expect(await code(turn('please help', 1, requestId))).toBe('AGENT_TIMEOUT');

    let msgs = await service.listMessages(owner, project.id);
    expect(msgs.items.map((m) => m.role)).toEqual(['user']);
    expect(msgs.lastTurn).toEqual({ requestId, state: 'failed', errorCode: 'AGENT_TIMEOUT' });
    expect((await service.getProject(owner, project.id)).project.revision).toBe(1);

    // The user edits the profile, then retries: the original request still matches.
    await service.patchProject(owner, project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'summary', value: 'edited' }],
    });
    fake.queue.push(reply());
    const ok = await turn('please help', 2, requestId);
    expect(ok.assistantMessage.content).toBeTruthy();
    msgs = await service.listMessages(owner, project.id);
    expect(msgs.items.map((m) => m.role)).toEqual(['user', 'assistant']); // no duplicate user message
    expect(fake.calls).toHaveLength(2);
  });

  it('invalid output and provider errors never mutate the profile', async () => {
    const { turn, fake, service, owner, project } = await setup();
    fake.queue.push(new GrantServerError('AGENT_INVALID_OUTPUT', 'bad', false));
    expect(await code(turn('a'))).toBe('AGENT_INVALID_OUTPUT');
    fake.queue.push(new Error('socket hang up'));
    expect(await code(turn('b'))).toBe('AI_UNAVAILABLE'); // raw errors are mapped to a safe code
    const p = (await service.getProject(owner, project.id)).project;
    expect(p.revision).toBe(1);
    expect(p.profile).toMatchObject({ applicant: { type: null }, summary: null });
  });

  it('treats a stuck in_progress row as failed after the timeout plus grace', async () => {
    const { turn, fake, store, clock, project } = await setup();
    await store.transaction((d) => {
      d.discoveryRequests[project.id] = [{
        requestId: 'crashed-req', projectId: project.id, state: 'in_progress', bodyHash: 'x', userMessageId: 'u',
        assistantMessageId: null, batchId: null, result: null, errorCode: null,
        startedAt: clock.now.toISOString(), updatedAt: clock.now.toISOString(),
      }];
    });
    expect(await code(turn('blocked?'))).toBe('DISCOVERY_BUSY');
    clock.advance(30000 + 10000 + 1);
    fake.queue.push(reply());
    await expect(turn('now fine')).resolves.toBeDefined();
  });

  it('discards a model response that arrives after the project was deleted', async () => {
    const { turn, fake, service, store, owner, project } = await setup();
    fake.queue.push(async () => {
      await service.deleteProject(owner, project.id, { expectedRevision: 1, requestId: rid() });
      return reply({ changes: [change({ op: 'add', path: 'constraints', value: 'x' })] });
    });
    expect(await code(turn('hello'))).toBe('PROJECT_NOT_FOUND');
    const left = await store.read((d) => [d.messages, d.batches, d.discoveryRequests].map((c) => Object.keys(c).length));
    expect(left).toEqual([0, 0, 0]);
  });

  it('rejects archived projects, foreign owners, missing config and unknown projects', async () => {
    const { turn, service, owner, other, project, fake } = await setup();
    expect(await code(turn('x', 1, rid(), other))).toBe('PROJECT_NOT_FOUND');
    const archived = await service.setStatus(owner, project.id, { expectedRevision: 1, requestId: rid(), status: 'archived' });
    expect(await code(turn('x', archived.project.revision))).toBe('PROJECT_ARCHIVED');
    expect(fake.calls).toHaveLength(0);

    const h = await setup({ discovery: { isConfigured: () => false } });
    expect(await code(h.turn('x'))).toBe('MISSING_CONFIG');
    expect(await h.store.read((d) => d.messages[h.project.id])).toBeUndefined(); // nothing stored
  });

  it('enforces the global daily cap (resets next day) and the per-project message cap', async () => {
    const h = await setup({ discovery: { dailyLimit: 2 } });
    h.fake.queue.push(reply(), reply(), reply());
    await h.turn('1');
    await h.turn('2');
    const err = await h.turn('3').catch((e) => e);
    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.retryable).toBe(true);
    expect(h.fake.calls).toHaveLength(2);
    h.clock.advance(24 * 60 * 60 * 1000);
    await expect(h.turn('4')).resolves.toBeDefined();

    const small = await setup({ limits: { maxMessagesPerProject: 4 } });
    small.fake.queue.push(reply(), reply(), reply());
    await small.turn('a');
    await small.turn('b');
    expect(await code(small.turn('c'))).toBe('LIMIT_EXCEEDED');
  });

  it('pages messages chronologically', async () => {
    const { turn, fake, service, owner, project } = await setup();
    for (let i = 0; i < 3; i++) { fake.queue.push(reply()); await turn(`m${i}`); }
    const p1 = await service.listMessages(owner, project.id, { limit: 4 });
    expect(p1.items.map((m) => m.content).filter((_, i) => i % 2 === 0)).toEqual(['m0', 'm1']);
    const p2 = await service.listMessages(owner, project.id, { limit: 4, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
  });
});

describe('suggestion review', () => {
  async function withBatch(changes: AgentChange[]) {
    const h = await setup();
    h.fake.queue.push(reply({ changes }));
    const r = await h.turn('hi');
    return { ...h, batch: r.batch!, ids: r.batch!.changes.map((c) => c.id) };
  }
  const apply = (h: Awaited<ReturnType<typeof withBatch>>, accepted: string[], revision?: number, requestId = rid(), who = h.owner) =>
    h.service.applySuggestion(who, h.project.id, h.batch.id, {
      expectedRevision: revision ?? h.project.revision, requestId, acceptedChangeIds: accepted,
    });

  it('applies only the selected changes, records provenance, and dismisses the rest', async () => {
    const h = await withBatch([
      change({ op: 'set', path: 'applicant.type', value: 'city', basis: null }),
      change({ op: 'set', path: 'location.state', value: 'WA', basis: null }),
      change({ op: 'add', path: 'assumptions', value: { text: 'City government' } }),
    ]);
    const r = await apply(h, [h.ids[0], h.ids[2]]);
    expect(r.batch.state).toBe('applied');
    expect(r.batch.changes.map((c) => c.disposition)).toEqual(['applied', 'dismissed', 'applied']);
    expect(r.project.profile.applicant.type).toBe('city');
    expect(r.project.profile.location.state).toBeNull(); // not selected
    expect(r.project.profile.assumptions[0].confirmed).toBe(false); // agent assumptions stay unconfirmed
    expect(r.project.revision).toBe(2);
    expect(r.project.fieldMetadata['applicant.type']).toMatchObject({
      source: 'accepted_suggestion', messageId: h.batch.changes[0].sourceMessageIds[1],
    });
    expect(r.project.readinessAssessment.completeCount).toBe(2);
  });

  it('a manual edit racing a suggestion conflicts per change, not for the whole batch', async () => {
    const h = await withBatch([
      change({ op: 'set', path: 'location.city', value: 'Seattle', basis: null }),
      change({ op: 'set', path: 'applicant.type', value: 'city', basis: null }),
    ]);
    const edited = await h.service.patchProject(h.owner, h.project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'location.city', value: 'Tacoma' }],
    });
    const r = await apply(h, h.ids, edited.project.revision);
    expect(r.batch.changes.map((c) => c.disposition)).toEqual(['conflict', 'applied']);
    expect(r.project.profile.location.city).toBe('Tacoma'); // the user's edit is not overwritten
    expect(r.project.profile.applicant.type).toBe('city');
  });

  it('a late response cannot overwrite an edit made while the model was working', async () => {
    const h = await setup();
    h.fake.queue.push(async (input) => {
      await h.service.patchProject(h.owner, h.project.id, {
        expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'location.city', value: 'Tacoma' }],
      });
      // The model saw city = null, so that is the basis of its proposal.
      return reply({ changes: [change({ op: 'set', path: 'location.city', value: 'Seattle', basis: input.profile.location.city })] });
    });
    const turn = await h.turn('we are in Seattle');
    expect(turn.batch!.baseRevision).toBe(1);
    const cur = (await h.service.getProject(h.owner, h.project.id)).project;
    const err = await h.service
      .applySuggestion(h.owner, h.project.id, turn.batch!.id, {
        expectedRevision: cur.revision, requestId: rid(), acceptedChangeIds: [turn.batch!.changes[0].id],
      })
      .catch((e) => e);
    expect(err.code).toBe('SUGGESTION_STALE');
    expect((await h.service.getProject(h.owner, h.project.id)).project.profile.location.city).toBe('Tacoma');
  });

  it('when every selected change conflicts: 409 SUGGESTION_STALE, batch marked stale, nothing applied', async () => {
    const h = await withBatch([change({ op: 'set', path: 'location.city', value: 'Seattle', basis: null })]);
    const edited = await h.service.patchProject(h.owner, h.project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'set', path: 'location.city', value: 'Tacoma' }],
    });
    expect(await code(apply(h, h.ids, edited.project.revision))).toBe('SUGGESTION_STALE');
    const batches = await h.service.listSuggestions(h.owner, h.project.id);
    expect(batches.items[0].state).toBe('stale');
    expect(batches.items[0].changes[0].disposition).toBe('conflict');
    expect((await h.service.getProject(h.owner, h.project.id)).project.revision).toBe(edited.project.revision);
  });

  it('removed targets are conflicts', async () => {
    const h = await setup();
    const { project: p1 } = await h.service.patchProject(h.owner, h.project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'add', path: 'outcomes', value: { description: 'Fewer crashes' } }],
    });
    const item = p1.profile.outcomes[0];
    h.fake.queue.push(reply({ changes: [change({ op: 'update', path: 'outcomes', itemId: item.id, value: { unit: '%' }, basis: item })] }));
    const t = await h.service.runDiscoveryTurn(h.owner, h.project.id, { message: 'x', expectedRevision: p1.revision, requestId: rid() });
    const { project: p2 } = await h.service.patchProject(h.owner, h.project.id, {
      expectedRevision: p1.revision, requestId: rid(), changes: [{ op: 'remove', path: 'outcomes', itemId: item.id }],
    });
    expect(
      await code(h.service.applySuggestion(h.owner, h.project.id, t.batch!.id, {
        expectedRevision: p2.revision, requestId: rid(), acceptedChangeIds: [t.batch!.changes[0].id],
      }))
    ).toBe('SUGGESTION_STALE');
  });

  it('a new batch marks the previous pending one stale; stale batches cannot be applied', async () => {
    const h = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    h.fake.queue.push(reply({ changes: [change({ op: 'add', path: 'constraints', value: 'two' })] }));
    const second = await h.turn('more', 1);
    const all = await h.service.listSuggestions(h.owner, h.project.id);
    expect(all.items.map((b) => b.state)).toEqual(['pending', 'stale']);
    expect((await h.service.listSuggestions(h.owner, h.project.id, { state: 'pending' })).items[0].id).toBe(second.batch!.id);
    expect(await code(apply(h, h.ids))).toBe('SUGGESTION_STALE');
  });

  it('is one-time: applying again is stale; replay with the same requestId returns the stored result', async () => {
    const h = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    const requestId = rid();
    const a = await apply(h, h.ids, undefined, requestId);
    const again = await apply(h, h.ids, undefined, requestId);
    expect(again).toEqual(a);
    expect((await h.service.getProject(h.owner, h.project.id)).project.revision).toBe(2);
    expect(await code(apply(h, h.ids, 2))).toBe('SUGGESTION_STALE');
  });

  it('an empty selection is a dismiss; explicit dismiss works once', async () => {
    const h = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    const r = await apply(h, []);
    expect(r.batch.state).toBe('dismissed');
    expect(r.batch.changes[0].disposition).toBe('dismissed');
    expect(r.project.revision).toBe(1);

    const h2 = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    const d = await h2.service.dismissSuggestion(h2.owner, h2.project.id, h2.batch.id, { requestId: rid() });
    expect(d.batch.state).toBe('dismissed');
    expect(await code(h2.service.dismissSuggestion(h2.owner, h2.project.id, h2.batch.id, { requestId: rid() }))).toBe('SUGGESTION_STALE');
  });

  it('applies atomically and revalidates the full profile', async () => {
    const h = await withBatch([
      change({ op: 'set', path: 'schedule.startDate', value: '2027-06-01', basis: null }),
      change({ op: 'set', path: 'schedule.endDate', value: '2027-01-01', basis: null }),
    ]);
    // Individually fine, together invalid: nothing applies and the batch stays reviewable.
    expect(await code(apply(h, h.ids))).toBe('INVALID_PROFILE');
    expect((await h.service.getProject(h.owner, h.project.id)).project.revision).toBe(1);
    expect((await h.service.listSuggestions(h.owner, h.project.id)).items[0].state).toBe('pending');
    await expect(apply(h, [h.ids[0]])).resolves.toBeDefined();
  });

  it('uses the write revision check, validates ids, and respects ownership and archiving', async () => {
    const h = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    expect(await code(apply(h, h.ids, 99))).toBe('REVISION_CONFLICT');
    expect((await h.service.listSuggestions(h.owner, h.project.id)).items[0].state).toBe('pending');
    expect(await code(apply(h, ['not-a-change-id']))).toBe('VALIDATION_ERROR');
    expect(await code(apply(h, h.ids, undefined, rid(), h.other))).toBe('PROJECT_NOT_FOUND');
    expect(await code(h.service.dismissSuggestion(h.other, h.project.id, h.batch.id, { requestId: rid() }))).toBe('PROJECT_NOT_FOUND');
    expect(await code(h.service.listSuggestions(h.other, h.project.id))).toBe('PROJECT_NOT_FOUND');
    expect(await code(h.service.listMessages(h.other, h.project.id))).toBe('PROJECT_NOT_FOUND');
    const archived = await h.service.setStatus(h.owner, h.project.id, { expectedRevision: 1, requestId: rid(), status: 'archived' });
    expect(await code(apply(h, h.ids, archived.project.revision))).toBe('PROJECT_ARCHIVED');
  });

  it('never applies client-supplied values: the request carries only change ids', async () => {
    const h = await withBatch([change({ op: 'set', path: 'applicant.type', value: 'city', basis: null })]);
    expect(
      await code(h.service.applySuggestion(h.owner, h.project.id, h.batch.id, {
        expectedRevision: 1, requestId: rid(), acceptedChangeIds: h.ids, changes: [{ op: 'set', path: 'applicant.type', value: 'state' }],
      }))
    ).toBe('VALIDATION_ERROR');
    const r = await apply(h, h.ids);
    expect(r.project.profile.applicant.type).toBe('city');
  });

  it('an unknown path set to a real value by an accepted suggestion is cleared from unknowns', async () => {
    const h = await setup();
    const { project } = await h.service.patchProject(h.owner, h.project.id, {
      expectedRevision: 1, requestId: rid(), changes: [{ op: 'add', path: 'unknowns', value: 'budget.totalCostCents' }],
    });
    h.fake.queue.push(reply({ changes: [change({ op: 'set', path: 'budget.totalCostCents', value: 500000, basis: null })] }));
    const t = await h.service.runDiscoveryTurn(h.owner, h.project.id, { message: 'cost is $5,000', expectedRevision: project.revision, requestId: rid() });
    const r = await h.service.applySuggestion(h.owner, h.project.id, t.batch!.id, {
      expectedRevision: project.revision, requestId: rid(), acceptedChangeIds: [t.batch!.changes[0].id],
    });
    expect(r.project.profile.unknowns).toEqual([]);
    expect(r.project.profile.budget.totalCostCents).toBe(500000);
  });

  it('deleting the project removes its messages, batches and request rows', async () => {
    const h = await withBatch([change({ op: 'add', path: 'constraints', value: 'one' })]);
    await h.service.deleteProject(h.owner, h.project.id, { expectedRevision: 1, requestId: rid() });
    const left = await h.store.read((d) => ({
      content: [d.messages, d.batches, d.discoveryRequests].map((c) => Object.keys(c).length),
      // Only the delete's own 24h replay marker may remain: no profile, message or suggestion text.
      idem: Object.values(d.idempotency).map((r) => r.result),
    }));
    expect(left.content).toEqual([0, 0, 0]);
    expect(left.idem).toEqual([{ deleted: true }]);
  });
});
