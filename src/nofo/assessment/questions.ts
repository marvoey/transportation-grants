import type { FactKey, Finding, Question } from './schemas.js';

/**
 * Follow-up questions. A question is asked only when a stated requirement
 * could not be evaluated for lack of a fact, and each question says which
 * requirement (with its evidence) makes the answer matter. The wording is a
 * fixed template over the missing fact, never free model text, so every
 * question traces to a source. (Requirements that no fixed fact covers get a
 * "detail question" instead: detail-questions.ts, worded under code checks.)
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
  onNoticeList: 'listed',
  statedGaps: 'description',
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
  listed: 'The notice limits who may apply to specific organizations (for example particular states or agencies) that it names. Is yours one of them? The notice lists them; the page is cited below.',
  applicant: 'What type of organization is applying (for example a state department of transportation, a city, a county, a tribe, or a transit agency)?',
  design: 'How far along is the project design (for example no design, 30, 60 or 90 percent)?',
  environmental: 'What is the status of the environmental review (not started, underway, or complete), and what class of review is expected?',
  description: 'Can you briefly describe what the project includes?',
};

const ORDER = ['listed', 'request', 'costMatch', 'area', 'category', 'bca', 'applicant', 'design', 'environmental', 'description'];

function weight(finding: Finding): number {
  const method = finding.method === 'deterministic' ? 4 : 1; // a stated number or limit is more consequential
  const mandatory = finding.mandatory === true ? 3 : finding.mandatory === null ? 1 : 0;
  return method + mandatory;
}

/** The most rounds of questions one assessment asks: one for each stage of the conversation below. */
export const MAX_QUESTION_ROUNDS = 3;
/** The most questions asked in one stage; any others stay open (unknown) and can be answered from the Answers drawer. */
export const MAX_ROUND_SIZE = 10;

/**
 * The conversation has three stages, like a consultation that takes one topic at a time: first whether the notice applies to
 * the applicant at all, then whether the money works, then whether they are ready to apply. Each round of questions is one
 * stage. A fixed question or a detail question belongs to the stage of what it asks about.
 */
export interface QuestionStage {
  /** 1 to 3; also the round number. */
  index: 1 | 2 | 3;
  title: string;
  /** One plain sentence on why this comes now, said to the applicant. */
  why: string;
  /** Where the stage came from: planned for this grant by the model, or the three fixed stages. */
  source?: 'model' | 'default';
}

export const QUESTION_STAGES: readonly QuestionStage[] = [
  { index: 1, title: 'Who you are and whether the notice applies to you', why: 'I want to be sure the notice applies to your organization before we talk about the money.' },
  { index: 2, title: 'Whether the money works', why: 'Next I would like to check the funding side: how much you would ask for, and what you can put in.' },
  { index: 3, title: 'Whether you are ready to apply', why: 'Finally, what you would need in hand to apply: the plans, documents and capacity the notice expects.' },
];

/** The stage a fixed question belongs to, by the group of facts it asks for. */
export function stageOfQuestionGroup(group: string): 1 | 2 | 3 {
  if (group === 'listed' || group === 'applicant' || group === 'area' || group === 'category') return 1;
  if (group === 'request' || group === 'costMatch') return 2;
  return 3;
}

/** The stage a detail question belongs to, by the category of its requirement: eligibility, then funding, then the rest. */
export function stageOfCategory(category: string | undefined): 1 | 2 | 3 {
  if (category === 'eligibility') return 1;
  if (category === 'funding') return 2;
  return 3;
}

/**
 * Which stage to ask now. `openByStage` is how many questions are open in stages 1, 2 and 3; `previousStage` is the stage the
 * applicant was last asked (0 for none). A turn that reads a new message moves on to the next stage that has anything open;
 * a re-check (removing an answer, "I don't know yet") stays in the stage on screen, and moves on only if every question in it
 * has been answered or set aside. After stage 3 nothing more is asked: what is still open stays unknown. Returns stage 0 and
 * size 0 when nothing is to be asked.
 */
export function pickStage(openByStage: readonly [number, number, number], previousStage: number, newMessage: boolean): { stage: 0 | 1 | 2 | 3; size: number } {
  const first = newMessage ? previousStage + 1 : Math.max(previousStage, 1);
  for (let stage = first; stage <= MAX_QUESTION_ROUNDS; stage++) {
    const open = openByStage[stage - 1];
    if (open > 0) return { stage: stage as 1 | 2 | 3, size: Math.min(MAX_ROUND_SIZE, open) };
  }
  return { stage: 0, size: 0 };
}

export function buildQuestions(findings: Finding[], max = 3, skip: readonly FactKey[] = []): Question[] {
  interface Group {
    score: number;
    keys: Set<FactKey>;
    because: Array<{ weight: number; finding: Finding }>;
  }
  const groups = new Map<string, Group>();

  for (const finding of findings) {
    if (finding.status !== 'unknown' || finding.missingFacts.length === 0) continue;
    for (const key of finding.missingFacts) {
      if (skip.includes(key)) continue; // the applicant said they do not know this yet: do not ask again
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
      kind: 'fact' as const,
      factKeys: [...group.keys],
      text: TEXT[name],
      because: group.because
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map(({ finding }) => ({ requirementId: finding.requirementId, title: finding.title, source: finding.sources[0] ?? null })),
    }));
}
