import { describe, expect, it } from 'vitest';
import { assess } from './assess.js';
import { createInterpretCache } from './interpret.js';
import { buildQuestions } from './questions.js';
import type { Finding, ProjectFacts } from './schemas.js';
import {
  DEMO_FACTS, RULEBOOK, bca, bcaDuplicate, designStatus, facts, form, isInterpretCall, matchRule, maxRequest, modelStandIn,
  nepa, optionalItem, planningOnly, projectTypes, reqFile, ruralMin, urbanMin,
} from '../__fixtures__/assessment.js';

const run = (f: ProjectFacts, llm = modelStandIn(), extra: Partial<Parameters<typeof assess>[0]> = {}) =>
  assess({ requirements: reqFile(RULEBOOK), facts: f, llm, cache: createInterpretCache(), ...extra });
const byId = (findings: Finding[], id: string): Finding => {
  const found = findings.find((f) => f.requirementId === id);
  if (!found) throw new Error(`no finding for ${id}`);
  return found;
};

describe('scenario 1: a plausible state DOT road project (the guide\'s demo)', () => {
  // Urban, so the urban minimum applies; $18M of a $25M project; $7M state match; no benefit-cost analysis yet.
  const demo = { ...DEMO_FACTS, ...facts({ areaType: 'urban' }) };

  it('finds the applicable provisions, each with evidence and the right status', async () => {
    const llm = modelStandIn({
      interpretation: (id) =>
        id === projectTypes.id ? { status: 'supported', explanation: 'A road project is not an ineligible type.', factsUsed: ['projectDescription'] }
        : id === designStatus.id ? { status: 'supported', explanation: 'Design status stated.', factsUsed: ['designStatus'] }
        : undefined,
    });
    const r = await run(demo, llm);

    expect(byId(r.findings, urbanMin.id)).toMatchObject({ status: 'supported', method: 'deterministic' });
    expect(byId(r.findings, urbanMin.id).explanation).toMatch(/\$18,000,000 meets the \$5,000,000 minimum/);
    expect(byId(r.findings, maxRequest.id).status).toBe('supported');
    expect(byId(r.findings, 'req-00000007').status).toBe('supported');
    expect(byId(r.findings, 'req-00000004')).toMatchObject({ status: 'supported' });
    expect(byId(r.findings, 'req-00000004').explanation).toMatch(/72%, within the 80% limit/);
    expect(byId(r.findings, projectTypes.id)).toMatchObject({ status: 'supported', method: 'llm', provisional: true });
    // Every finding carries the requirement's evidence.
    for (const f of r.findings) expect(f.sources.length).toBeGreaterThan(0);
  });

  it('the missing benefit-cost analysis is a preparation gap with its source, and both related rules are reported', async () => {
    const r = await run(demo);
    for (const id of [bca.id, bcaDuplicate.id]) {
      const f = byId(r.findings, id);
      expect(f).toMatchObject({ gap: true, method: 'deterministic' });
    }
    expect(byId(r.findings, bca.id)).toMatchObject({ status: 'conflict', gap: true });
    expect(byId(r.findings, bca.id).sources[0].documentId).toBeTruthy();
  });

  it('keeps unresolved provisions as unknown, never as pass or fail', async () => {
    const r = await run(demo);
    for (const id of [form.id, nepa.id, matchRule.id]) {
      const f = byId(r.findings, id);
      expect(f.status).toBe('unknown');
    }
    expect(byId(r.findings, form.id)).toMatchObject({ method: 'none', gap: false });
    expect(byId(r.findings, nepa.id).missingFacts).toEqual(['environmentalStatus']);
  });

  it('the arithmetic is verified and exposed', async () => {
    const r = await run(demo);
    expect(r.derived.federalSharePct).toBe(72);
    expect(r.derived.consistency.status).toBe('consistent');
  });

  it('sorts conflicts and specialist review first, supported last', async () => {
    const r = await run(demo);
    const order = r.findings.map((f) => f.status);
    expect(order.indexOf('conflict')).toBeLessThan(order.indexOf('unknown'));
    expect(order.indexOf('unknown')).toBeLessThan(order.indexOf('supported'));
  });
});

describe('scenario 2: a verified conflict', () => {
  it('a request over the maximum is a cited conflict, not a vague warning', async () => {
    const r = await run({ ...DEMO_FACTS, ...facts({ areaType: 'urban', requestedFederalUsd: 30_000_000 }) });
    const f = byId(r.findings, maxRequest.id);
    expect(f.status).toBe('conflict');
    expect(f.gap).toBe(false);
    expect(f.explanation).toMatch(/\$30,000,000 exceeds the \$25,000,000 maximum/);
    expect(f.sources[0]).toMatchObject({ documentId: expect.any(String), page: 3, authority: 'controlling' });
    expect(r.warnings.join(' ')).toMatch(/do not add up/); // $30M + $7M != $25M is surfaced too
  });

  it('a request below the minimum is a conflict', async () => {
    const r = await run({ ...DEMO_FACTS, ...facts({ areaType: 'urban', requestedFederalUsd: 3_000_000, totalProjectCostUsd: 10_000_000, nonFederalMatchUsd: 7_000_000 }) });
    expect(byId(r.findings, urbanMin.id).status).toBe('conflict');
  });

  it('a rural project is held to the rural minimum, not the urban one', async () => {
    const r = await run({ ...DEMO_FACTS, ...facts({ areaType: 'rural', requestedFederalUsd: 2_000_000, totalProjectCostUsd: 9_000_000, nonFederalMatchUsd: 7_000_000 }) });
    expect(byId(r.findings, ruralMin.id).status).toBe('supported');
    expect(r.findings.find((f) => f.requirementId === urbanMin.id)).toBeUndefined();
    expect(r.notApplicable.find((n) => n.requirementId === urbanMin.id)?.reason).toMatch(/this project is rural/);
  });

  it('a model "conflict" is provisional and must cite stated facts, or it is downgraded', async () => {
    const cited = modelStandIn({ interpretation: (id) => (id === projectTypes.id ? { status: 'conflict', explanation: 'On the ineligible list.', factsUsed: ['projectDescription'] } : undefined) });
    const r1 = await run(DEMO_FACTS, cited);
    expect(byId(r1.findings, projectTypes.id)).toMatchObject({ status: 'conflict', method: 'llm', provisional: true });

    const uncited = modelStandIn({ interpretation: (id) => (id === projectTypes.id ? { status: 'conflict', explanation: 'I think so.', factsUsed: [] } : undefined) });
    const r2 = await run(DEMO_FACTS, uncited);
    expect(byId(r2.findings, projectTypes.id).status).toBe('unknown');
  });
});

describe('scenario 3: missing information', () => {
  it('with nothing known, every requirement is unknown (no pass, no fail) and no model call is made', async () => {
    const llm = modelStandIn();
    const r = await run({}, llm);
    expect(r.findings.every((f) => f.status === 'unknown')).toBe(true);
    expect(llm.calls.filter(isInterpretCall)).toHaveLength(0);
    expect(byId(r.findings, projectTypes.id).missingFacts).toEqual(['projectDescription']);
  });

  it('asks targeted questions: the request first, then what it takes to evaluate the other limits', async () => {
    const r = await run(facts({ applicantType: 'state', grantCategory: 'capital' }));
    const questions = buildQuestions(r.findings);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(3);
    expect(questions[0].group).toBe('request');
    expect(questions.every((q) => q.because.length > 0 && q.because[0].source !== null)).toBe(true);
  });

  it('asks about match funding and its commitment when the match rule cannot be evaluated', async () => {
    const r = await run(facts({ requestedFederalUsd: 18_000_000, applicantType: 'state', grantCategory: 'capital', areaType: 'urban', bcaCompleted: true, designStatus: 'preliminary', environmentalStatus: 'underway' }));
    expect(buildQuestions(r.findings).map((q) => q.group)).toContain('costMatch');
  });

  it('does not ask for what it already knows', async () => {
    const r = await run({ ...DEMO_FACTS, ...facts({ areaType: 'urban', environmentalStatus: 'categorical exclusion expected' }) });
    const groups = buildQuestions(r.findings).map((q) => q.group);
    expect(groups).not.toContain('request');
    expect(groups).not.toContain('bca');
    expect(groups).not.toContain('area');
  });
});

describe('the checkpoint: changing a fact changes the affected findings without reprocessing', () => {
  const urbanDemo = { ...DEMO_FACTS, ...facts({ areaType: 'urban' }) };

  it('only the money-dependent findings change when the request changes, and the model is not called again', async () => {
    const llm = modelStandIn({ interpretation: (id) => (id === projectTypes.id ? { status: 'supported', explanation: 'fine', factsUsed: ['projectDescription'] } : undefined) });
    const cache = createInterpretCache();
    const requirements = reqFile(RULEBOOK);

    const before = await assess({ requirements, facts: urbanDemo, llm, cache });
    const callsAfterFirst = llm.calls.filter(isInterpretCall).length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const after = await assess({ requirements, facts: { ...urbanDemo, ...facts({ requestedFederalUsd: 30_000_000 }) }, llm, cache });
    expect(llm.calls.filter(isInterpretCall)).toHaveLength(callsAfterFirst); // no new interpretation calls
    expect(after.interpretation).toMatchObject({ modelCalls: 0 });
    expect(after.interpretation.cacheHits).toBeGreaterThan(0);

    expect(byId(before.findings, maxRequest.id).status).toBe('supported');
    expect(byId(after.findings, maxRequest.id).status).toBe('conflict');
    // The model-judged finding is untouched.
    expect(byId(after.findings, projectTypes.id)).toEqual(byId(before.findings, projectTypes.id));
  });

  it('answering a missing question resolves the findings that were waiting on it', async () => {
    const before = await run(facts({ applicantType: 'state', grantCategory: 'capital', areaType: 'urban' }));
    expect(byId(before.findings, maxRequest.id).status).toBe('unknown');
    const after = await run(facts({ applicantType: 'state', grantCategory: 'capital', areaType: 'urban', requestedFederalUsd: 18_000_000 }));
    expect(byId(after.findings, maxRequest.id).status).toBe('supported');
    expect(byId(after.findings, urbanMin.id).status).toBe('supported');
  });

  it('a changed free-text fact does re-interpret, because that is what the model reads', async () => {
    const llm = modelStandIn();
    const cache = createInterpretCache();
    const requirements = reqFile(RULEBOOK);
    await assess({ requirements, facts: urbanDemo, llm, cache });
    const first = llm.calls.filter(isInterpretCall).length;
    await assess({ requirements, facts: { ...urbanDemo, ...facts({ projectDescription: 'A bridge replacement.' }) }, llm, cache });
    expect(llm.calls.filter(isInterpretCall).length).toBeGreaterThan(first);
  });
});

describe('routing rules', () => {
  it('skips optional wording and reports it', async () => {
    const r = await run(DEMO_FACTS);
    expect(r.findings.find((f) => f.requirementId === optionalItem.id)).toBeUndefined();
    expect(r.skipped.map((s) => s.requirementId)).toContain(optionalItem.id);
  });

  it('a planning-only rule does not apply to a capital project, and capital-only rules do not apply to a planning project', async () => {
    const capital = await run(DEMO_FACTS);
    expect(capital.notApplicable.map((n) => n.requirementId)).toContain(planningOnly.id);

    const planning = await run({ ...DEMO_FACTS, ...facts({ grantCategory: 'planning' }) });
    expect(planning.notApplicable.map((n) => n.requirementId)).toEqual(expect.arrayContaining([urbanMin.id, bca.id, bcaDuplicate.id, designStatus.id]));
    expect(planning.findings.find((f) => f.requirementId === bca.id)).toBeUndefined();
  });

  it('provisional unless a human has verified the requirement and the result is deterministic', async () => {
    const verified = reqFile(RULEBOOK.map((r) => (r.id === maxRequest.id ? { ...r, reviewStatus: 'verified' as const } : r)));
    const r = await assess({ requirements: verified, facts: DEMO_FACTS, llm: modelStandIn() });
    expect(byId(r.findings, maxRequest.id).provisional).toBe(false);
    expect(byId(r.findings, urbanMin.id).provisional).toBe(true); // unreviewed requirement
    expect(r.findings.filter((f) => f.method === 'llm').every((f) => f.provisional)).toBe(true);
  });

  it('warns when the requirements are incomplete', async () => {
    const r = await assess({ requirements: reqFile(RULEBOOK, { status: 'partial' }), facts: DEMO_FACTS, llm: modelStandIn() });
    expect(r.warnings.join(' ')).toMatch(/incomplete/);
  });

  it('works without a model: requirements needing interpretation stay unknown, with a warning', async () => {
    const r = await assess({ requirements: reqFile(RULEBOOK), facts: DEMO_FACTS });
    expect(byId(r.findings, projectTypes.id).status).toBe('unknown');
    expect(r.warnings.join(' ')).toMatch(/Model interpretation was not available/);
    expect(byId(r.findings, maxRequest.id).status).toBe('supported'); // numbers never needed the model
  });

  it('a failing model batch leaves those requirements unknown and says so', async () => {
    const llm = modelStandIn();
    const failing = async (call: Parameters<typeof llm>[0]) => { if (isInterpretCall(call)) throw new Error('boom'); return llm(call); };
    const r = await assess({ requirements: reqFile(RULEBOOK), facts: DEMO_FACTS, llm: failing });
    expect(byId(r.findings, projectTypes.id).status).toBe('unknown');
    expect(r.warnings.join(' ')).toMatch(/could not be interpreted/);
  });

  it('honors the per-assessment limit on interpreted requirements', async () => {
    const r = await run(DEMO_FACTS, modelStandIn(), { maxInterpreted: 1 });
    expect(r.warnings.join(' ')).toMatch(/per-assessment limit/);
  });
});
