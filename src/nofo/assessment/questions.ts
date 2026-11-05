import type { FactKey, Finding, Question } from './schemas.js';

/**
 * Follow-up questions. A question is asked only when a stated requirement
 * could not be evaluated for lack of a fact, and each question says which
 * requirement (with its evidence) makes the answer matter. The wording is a
 * fixed template over the missing fact, never free model text, so every
 * question traces to a source.
 */

const GROUP_OF: Record<FactKey, string> = {
  requestedFederalUsd: 'request',
  totalProjectCostUsd: 'costMatch',
  nonFederalMatchUsd: 'costMatch',
  otherFederalFundsUsd: 'costMatch',
  matchCommitted: 'costMatch',
  areaType: 'area',
  grantCategory: 'category',
  bcaCompleted: 'bca',
  applicantType: 'applicant',
  stateName: 'applicant',
  designStatus: 'design',
  environmentalStatus: 'environmental',
  projectDescription: 'description',
  activities: 'description',
};

const TEXT: Record<string, string> = {
  request: 'How much federal funding do you plan to request from this program? (This is the amount you ask for, not the total project cost.)',
  costMatch: 'What is the total project cost, how much non-federal match funding is available (for example state or local funds), and is that match committed?',
  area: "Is the project in an urban or rural area, as the notice defines those terms?",
  category: 'Is this a capital (construction) application or a planning application?',
  bca: 'Has a benefit-cost analysis been completed for the project?',
  applicant: 'What type of organization is applying (for example a state department of transportation, a city, a county, a tribe, or a transit agency)?',
  design: 'How far along is the project design (for example no design, 30, 60 or 90 percent)?',
  environmental: 'What is the status of the environmental review (not started, underway, or complete), and what class of review is expected?',
  description: 'Can you briefly describe what the project includes?',
};

const ORDER = ['request', 'costMatch', 'area', 'category', 'bca', 'applicant', 'design', 'environmental', 'description'];

function weight(finding: Finding): number {
  const method = finding.method === 'deterministic' ? 4 : 1; // a stated number or limit is more consequential
  const mandatory = finding.mandatory === true ? 3 : finding.mandatory === null ? 1 : 0;
  return method + mandatory;
}

export function buildQuestions(findings: Finding[], max = 3): Question[] {
  interface Group {
    score: number;
    keys: Set<FactKey>;
    because: Array<{ weight: number; finding: Finding }>;
  }
  const groups = new Map<string, Group>();

  for (const finding of findings) {
    if (finding.status !== 'unknown' || finding.missingFacts.length === 0) continue;
    for (const key of finding.missingFacts) {
      const name = GROUP_OF[key];
      const group = groups.get(name) ?? { score: 0, keys: new Set<FactKey>(), because: [] };
      group.keys.add(key);
      group.because.push({ weight: weight(finding), finding });
      groups.set(name, group);
    }
  }
  for (const group of groups.values()) {
    // Count each finding once per group, however many of its missing facts fall in the group.
    const unique = new Map(group.because.map((b) => [b.finding.requirementId, b]));
    group.because = [...unique.values()];
    // Rank by the most consequential requirement waiting on the answer. How many related requirements are waiting
    // does not matter (seven related items must not outrank one hard numeric limit); ties go to the fixed order below.
    group.score = Math.max(...group.because.map((b) => b.weight));
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].score - a[1].score || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .slice(0, max)
    .map(([name, group]) => ({
      group: name,
      factKeys: [...group.keys],
      text: TEXT[name],
      because: group.because
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map(({ finding }) => ({ requirementId: finding.requirementId, title: finding.title, source: finding.sources[0] ?? null })),
    }));
}
