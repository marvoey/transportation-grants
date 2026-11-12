import { describe, expect, it } from 'vitest';
import { DISCLAIMER, buildAdvisory } from './advisory.js';
import { assess } from './assessment/assess.js';
import { buildQuestions } from './assessment/questions.js';
import { DEMO_FACTS, RULEBOOK, facts, modelStandIn, reqFile } from './__fixtures__/assessment.js';

async function advise(f = DEMO_FACTS) {
  const result = await assess({ requirements: reqFile(RULEBOOK), facts: f, llm: modelStandIn() });
  const questions = buildQuestions(result.findings);
  return { result, questions, advisory: buildAdvisory(result, questions) };
}

describe('buildAdvisory', () => {
  it('is labelled preliminary and never claims a determination', async () => {
    const { advisory } = await advise();
    expect(advisory.label).toBe('Preliminary assessment');
    expect(advisory.disclaimer).toBe(DISCLAIMER);
    expect(advisory.disclaimer).toMatch(/not an official eligibility determination/);
    expect(advisory.disclaimer).toMatch(/does not predict an award/);
    const text = JSON.stringify(advisory).toLowerCase();
    expect(text).not.toMatch(/\b(you are eligible|you are ineligible|will be awarded|guaranteed)\b/);
  });

  it('counts findings and folds the same issue stated in several places into one item', async () => {
    const { advisory, result } = await advise();
    expect(advisory.counts.assessed).toBe(result.findings.length);
    expect(advisory.counts.gaps).toBe(2); // two benefit-cost-analysis rules
    const gap = advisory.keyFindings.find((k) => k.gap)!;
    expect(gap.relatedCount).toBe(1);
    expect(gap.relatedRequirementIds).toHaveLength(1);
    expect(advisory.headline).toMatch(/1 preparation gap \(across 2 requirements\)/);
    expect(advisory.nextSteps.filter((s) => s.startsWith('Prepare:'))).toHaveLength(1);
  });

  it('every key finding carries its evidence', async () => {
    const { advisory } = await advise({ ...DEMO_FACTS, ...facts({ requestedFederalUsd: 30_000_000, areaType: 'urban' }) });
    expect(advisory.keyFindings.length).toBeGreaterThan(0);
    for (const k of advisory.keyFindings) {
      expect(k.source).not.toBeNull();
      expect(k.text.length).toBeGreaterThan(0);
    }
    const conflict = advisory.keyFindings.find((k) => k.status === 'conflict' && !k.gap)!;
    expect(conflict.text).toMatch(/exceeds the \$25,000,000 maximum/);
  });

  it('next steps do not repeat the follow-up questions (they are listed once, in the conversation) and always end with confirming with the program office', async () => {
    const { advisory, questions } = await advise(facts({ applicantType: 'state' }));
    expect(questions.length).toBeGreaterThan(0);
    expect(advisory.nextSteps.some((step) => step.startsWith('Tell us:'))).toBe(false);
    expect(advisory.nextSteps[advisory.nextSteps.length - 1]).toMatch(/Confirm the final requirements and any amendments/);
  });

  it('is deterministic: the same input gives the same output (no model involved)', async () => {
    const a = await advise();
    const b = await advise();
    expect(b.advisory).toEqual(a.advisory);
  });

  it('with nothing known, reports everything as not yet evaluated rather than good or bad', async () => {
    const { advisory } = await advise(facts({}));
    expect(advisory.counts.conflicts).toBe(0);
    expect(advisory.counts.supported).toBe(0);
    expect(advisory.counts.unknown).toBe(advisory.counts.assessed);
    expect(advisory.headline).toMatch(/0 conditions that look supported/);
  });
});

describe('where you stand', () => {
  it('gives a plain bottom line and three counts that match the findings', async () => {
    const { advisory } = await advise(facts({ applicantType: 'state' }));
    expect(advisory.standing.workable).toBe(advisory.counts.supported);
    expect(advisory.standing.unknown).toBe(advisory.counts.unknown);
    expect(advisory.standing.line.length).toBeGreaterThan(20);
    if (advisory.standing.attention > 0) expect(advisory.standing.line).toContain(advisory.keyFindings[0].title);
    expect(advisory.standing.line).not.toMatch(/requirements considered/);
  });
});

