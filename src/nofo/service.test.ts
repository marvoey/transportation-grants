import { afterEach, describe, expect, it } from 'vitest';
import { AssessmentError, assessTurn } from './service.js';
import { createInterpretCache } from './assessment/interpret.js';
import { FactsError } from './assessment/facts.js';
import { PackageStore } from './store.js';
import { RULEBOOK, facts, isFactsCall, isInterpretCall, modelStandIn, reqFile } from './__fixtures__/assessment.js';
import { OPP_A, makeOpportunity, tmpStore } from './__fixtures__/helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(options: { requirements?: boolean; status?: 'complete' | 'partial' } = {}) {
  const t = await tmpStore();
  cleanups.push(t.cleanup);
  await t.store.writeOpportunity(OPP_A, makeOpportunity());
  if (options.requirements !== false) await t.store.writeRequirements(OPP_A, reqFile(RULEBOOK, { status: options.status ?? 'complete' }));
  return t;
}

const turn = (store: PackageStore, llm: ReturnType<typeof modelStandIn>, input: Record<string, unknown>) =>
  assessTurn({ opportunityId: OPP_A, ...input }, { store, llm, interpretCache: createInterpretCache() });

describe('assessTurn: one stateless conversational turn', () => {
  it('reads facts from the latest message, assesses, and returns the new state to send back', async () => {
    const { store } = await setup();
    const llm = modelStandIn({
      facts: {
        requestedFederalUsd: { value: 18_000_000, quote: '$18 million' },
        areaType: { value: 'urban', quote: 'urban area' },
        grantCategory: { value: 'capital', quote: 'capital project' },
        totalProjectCostUsd: { value: 25_000_000, quote: '$25 million' },
      },
    });
    const r = await turn(store, llm, {
      messages: [{ role: 'user', content: 'It is a capital project in an urban area with a total cost of $25 million and we want to request $18 million.' }],
    });

    expect(r.opportunity).toMatchObject({ title: 'Synthetic Test Opportunity', opportunityNumber: 'TEST-OPP-001' });
    expect(r.newFacts.sort()).toEqual(['areaType', 'grantCategory', 'requestedFederalUsd', 'totalProjectCostUsd']);
    expect(r.facts.requestedFederalUsd?.value).toBe(18_000_000);
    expect(r.findings.find((f) => f.requirementId === 'req-00000003')?.status).toBe('supported');
    expect(r.derived.federalSharePct).toBe(72);
    expect(r.advisory.label).toBe('Preliminary assessment');
    expect(r.requirements).toMatchObject({ total: RULEBOOK.length, status: 'complete', verified: 0 });
    expect(r.questions.length).toBeLessThanOrEqual(3);
  });

  it('is stateless: the client sends the facts back and they are merged with new ones; newest statement wins', async () => {
    const { store } = await setup();
    const first = await turn(store, modelStandIn({ facts: { requestedFederalUsd: { value: 18_000_000, quote: '$18 million' } } }), {
      messages: [{ role: 'user', content: 'We will request $18 million.' }],
    });
    const second = await turn(store, modelStandIn({ facts: { requestedFederalUsd: { value: 30_000_000, quote: '$30 million' }, areaType: { value: 'urban', quote: 'urban' } } }), {
      messages: [{ role: 'user', content: 'Actually $30 million, and it is urban.' }],
      facts: first.facts,
    });
    expect(second.facts.requestedFederalUsd?.value).toBe(30_000_000);
    expect(second.facts.areaType?.value).toBe('urban');
    expect(second.findings.find((f) => f.requirementId === 'req-00000003')?.status).toBe('conflict');
  });

  it('keeps client-supplied facts when the new message adds none', async () => {
    const { store } = await setup();
    const r = await turn(store, modelStandIn(), { messages: [{ role: 'user', content: 'Thanks.' }], facts: facts({ requestedFederalUsd: 18_000_000 }) });
    expect(r.facts.requestedFederalUsd?.value).toBe(18_000_000);
    expect(r.newFacts).toEqual([]);
  });

  it('a fact the model invents (no quote in the user\'s words) is dropped and reported', async () => {
    const { store } = await setup();
    const r = await turn(store, modelStandIn({ facts: { requestedFederalUsd: { value: 99_000_000, quote: 'ninety nine million' } } }), {
      messages: [{ role: 'user', content: 'Hello, we are a state DOT.' }],
    });
    expect(r.facts.requestedFederalUsd).toBeUndefined();
    expect(r.rejectedFacts).toEqual([{ key: 'requestedFederalUsd', reason: 'the quote does not appear in anything the applicant said' }]);
  });

  it('reads the stored requirements only: nothing is fetched, parsed or extracted', async () => {
    const { store } = await setup(); // no package manifest or documents exist at all
    const llm = modelStandIn();
    const r = await turn(store, llm, { messages: [{ role: 'user', content: 'Hello.' }] });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(llm.calls.every((c) => isFactsCall(c) || isInterpretCall(c))).toBe(true);
  });

  it('degrades with warnings, not a crash, when the model is unavailable for reading facts', async () => {
    const { store } = await setup();
    const llm = modelStandIn();
    const broken = Object.assign(async () => { throw new Error('boom'); }, { calls: [] });
    const r = await assessTurn(
      { opportunityId: OPP_A, messages: [{ role: 'user', content: 'Hello.' }], facts: facts({ requestedFederalUsd: 18_000_000 }) },
      { store, llm: broken as unknown as typeof llm, interpretCache: createInterpretCache() }
    );
    expect(r.warnings.join(' ')).toMatch(/Could not read the latest message/);
    expect(r.facts.requestedFederalUsd?.value).toBe(18_000_000);
  });

  it('warns when the requirements are partial', async () => {
    const { store } = await setup({ status: 'partial' });
    const r = await turn(store, modelStandIn(), { messages: [{ role: 'user', content: 'Hello.' }] });
    expect(r.requirements.status).toBe('partial');
    expect(r.warnings.join(' ')).toMatch(/incomplete/);
  });
});

describe('assessTurn: input validation and failures', () => {
  it.each([
    ['no messages', { messages: [] }],
    ['an empty message', { messages: [{ role: 'user', content: '' }] }],
    ['an over-long message', { messages: [{ role: 'user', content: 'x'.repeat(4001) }] }],
    ['too many messages', { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'hi' })) }],
    ['a bad role', { messages: [{ role: 'system', content: 'hi' }] }],
    ['an unexpected key', { messages: [{ role: 'user', content: 'hi' }], admin: true }],
  ])('rejects %s', async (_label, input) => {
    const { store } = await setup();
    await expect(turn(store, modelStandIn(), input)).rejects.toThrow(AssessmentError);
  });

  it('rejects a conversation with no applicant message', async () => {
    const { store } = await setup();
    await expect(turn(store, modelStandIn(), { messages: [{ role: 'assistant', content: 'hello' }] })).rejects.toThrow(/no message from the applicant/);
  });

  it('rejects invalid facts and invalid opportunity IDs', async () => {
    const { store } = await setup();
    await expect(turn(store, modelStandIn(), { messages: [{ role: 'user', content: 'hi' }], facts: { requestedFederalUsd: { value: 'lots', provenance: 'user' } } })).rejects.toThrow(FactsError);
    await expect(assessTurn({ opportunityId: '../../etc/passwd', messages: [{ role: 'user', content: 'hi' }] }, { store, llm: modelStandIn() })).rejects.toThrow(/Invalid opportunity ID/);
  });

  it('says what to do when the opportunity has no extracted requirements', async () => {
    const { store } = await setup({ requirements: false });
    await expect(turn(store, modelStandIn(), { messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/Run: npm run nofo:extract/);
  });
});
