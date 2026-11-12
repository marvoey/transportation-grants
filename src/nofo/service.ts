import { logger } from '../config/config.js';
import { buildAdvisory, type Advisory } from './advisory.js';
import type { Derived } from './assessment/arithmetic.js';
import { assess, type AssessmentResult } from './assessment/assess.js';
import { extractFacts, mergeFacts, parseIncomingFacts, type ExtractFactsResult } from './assessment/facts.js';
import { createInterpretCache, type InterpretCache } from './assessment/interpret.js';
import { readAnswers } from './assessment/answers.js';
import { createDetailCache, detailCandidates, listedWording, sanitizeSpec, shownWording, toDetailQuestion, writeDetailQuestions, type DetailCache } from './assessment/detail-questions.js';
import { diffFindings, type Changes } from './assessment/changes.js';
import { buildQuestions, MAX_QUESTION_ROUNDS, pickStage, type QuestionStage } from './assessment/questions.js';
import { defaultStagePlan, requirementsHash, stageOfGroupIn, stageOfRequirementIn } from './assessment/stages.js';
import { writeReply, type AssessReply } from './assessment/reply.js';
import { writeSuggestedReply, type SuggestedReply } from './assessment/suggest.js';
import {
  AssessInputSchema,
  type DetailAnswers,
  type FactKey,
  type Finding,
  type NotApplicable,
  type ProjectFacts,
  type Question,
} from './assessment/schemas.js';
import { createAnthropicLlm, type LlmFn } from './llm.js';
import { safeProgress, type ProgressFn } from './progress.js';
import { parseOpportunityId } from './schemas.js';
import { PackageStore } from './store.js';

export class AssessmentError extends Error {
  constructor(
    message: string,
    /** Maps to an HTTP status in the web layer: VALIDATION_ERROR -> 400, NOT_FOUND -> 404. */
    public readonly code: 'VALIDATION_ERROR' | 'NOT_FOUND' = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}

export interface AssessTurnDeps {
  store?: PackageStore;
  llm?: LlmFn;
  interpretCache?: InterpretCache;
  /** The wording of detail questions, so a question keeps the same words from turn to turn. */
  detailCache?: DetailCache;
  /** Called as each step really starts and finishes, so a screen can say what is happening. */
  onProgress?: ProgressFn;
}

export interface AssessTurnResult {
  opportunityId: string;
  opportunity: { title: string | null; opportunityNumber: string | null; status: string } | null;
  /** All facts now known (previous ones plus anything new from the latest message). Send these back next turn. */
  facts: ProjectFacts;
  newFacts: FactKey[];
  rejectedFacts: ExtractFactsResult['rejected'];
  derived: Derived;
  findings: Finding[];
  notApplicable: NotApplicable[];
  skippedCount: number;
  questions: Question[];
  /**
   * Every other requirement that can still be asked about, as a detail question with its words (template, or the model's
   * if it was worded before). Not asked in the conversation: listed in the Answers drawer, where each can be answered too.
   */
  openDetails: Question[];
  /**
   * Where the applicant is in the conversation: three stages of questions (who you are, whether the money works, whether you
   * are ready), at most one stage per message. `round` is the stage last asked (send it back with the next request), `stage`
   * says which one this is, `open` is how many requirements could still be asked about in all, and `later` how many of those
   * are in stages still to come.
   */
  questionRound: { round: number; of: number; open: number; later: number; stage: QuestionStage | null };
  /** What moved since the previous message (needs `previous` in the request), written by code. Null on the first message. */
  changes: Changes | null;
  /** The applicant's yes/no answers to detail questions so far (send them back next turn, like `facts`). */
  answers: DetailAnswers;
  advisory: Advisory;
  /**
   * The conversational reply: written by the language model from the checked findings below (and checked by code), or by a
   * template when there is no model or its text did not pass. The findings, sources and questions are not part of it.
   */
  reply: AssessReply;
  /**
   * A made-up example reply to the questions being asked, written like a person typing it, for the Answers drawer (null when no
   * question is asked; empty text when the model could not write one, then the page uses its template).
   */
  suggestedReply: SuggestedReply | null;
  requirements: { generatedAt: string; status: 'complete' | 'partial'; total: number; needsReview: number; verified: number; model: string };
  interpretation: AssessmentResult['interpretation'];
  warnings: string[];
}

// One cache per process, so an unchanged description of the project never costs a second model call.
const sharedCache = createInterpretCache();
const sharedDetailCache = createDetailCache();

/** The fixed questions come first in a round; detail questions made from the requirements fill the rest. */
/** How many other open requirements are listed (not asked) for the Answers drawer. */
const MAX_LISTED_DETAILS = 70;

/**
 * One conversational turn. Stateless: everything needed comes in the call and
 * the new state (the facts) comes back. Reads the stored requirements only; it
 * never fetches, parses or re-extracts the notice.
 */
export async function assessTurn(input: unknown, deps: AssessTurnDeps = {}): Promise<AssessTurnResult> {
  const parsed = AssessInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AssessmentError('The request is not valid: it needs an opportunity ID and 1-40 messages of at most 4,000 characters each.');
  }
  const { messages } = parsed.data;
  if (!messages.some((m) => m.role === 'user')) throw new AssessmentError('The conversation has no message from the applicant.');

  const opportunityId = parseOpportunityId(parsed.data.opportunityId);
  const prior = parseIncomingFacts(parsed.data.facts);
  const store = deps.store ?? PackageStore.fromConfig();
  const emit = safeProgress(deps.onProgress);

  emit({ id: 'load', status: 'running', message: 'Loading the extracted requirements for this opportunity…' });
  const requirements = await store.readRequirements(opportunityId);
  if (!requirements) {
    throw new AssessmentError(`No extracted requirements for ${opportunityId}. Run: npm run nofo:extract -- ${opportunityId}`, 'NOT_FOUND');
  }
  const opportunity = await store.readOpportunity(opportunityId).catch(() => null);
  const title = opportunity?.title ? ` for ${opportunity.title.slice(0, 120)}` : '';
  emit({ id: 'load', status: 'done', message: `Loaded ${requirements.requirements.length} requirements${title}${requirements.status === 'partial' ? ' (the extraction was incomplete)' : ''}.` });

  const warnings: string[] = [];
  let llm = deps.llm;
  if (!llm) {
    try {
      llm = createAnthropicLlm();
    } catch {
      warnings.push('The language model is not configured, so new facts cannot be read from your message and free-text conditions cannot be interpreted.');
    }
  }

  let extracted: ExtractFactsResult = { facts: {}, rejected: [], warnings: [] };
  // `readMessage: false` re-assesses with the facts as given (for example after the user removes a fact), without re-reading the message.
  if (llm && parsed.data.readMessage !== false) {
    emit({ id: 'read', status: 'running', message: 'Sending your message to the language model to read the facts you stated…' });
    extracted = await extractFacts({ messages, llm });
    const added = Object.keys(extracted.facts).length;
    const dropped = extracted.rejected.length;
    emit({
      id: 'read',
      status: extracted.warnings.length > 0 && added === 0 ? 'failed' : 'done',
      message:
        (added > 0 ? `Read ${added} new fact${added === 1 ? '' : 's'} from your message.` : 'No new facts found in your message.') +
        (dropped > 0 ? ` ${dropped} proposed fact${dropped === 1 ? ' was' : 's were'} discarded because ${dropped === 1 ? 'it' : 'they'} could not be matched to your own words.` : ''),
    });
  } else if (parsed.data.readMessage === false) {
    emit({ id: 'read', status: 'done', message: 'Re-checking the facts you already gave, without reading your message again.' });
  } else {
    emit({ id: 'read', status: 'failed', message: 'The language model is not configured, so no facts could be read from your message.' });
  }
  warnings.push(...extracted.warnings);
  const facts = mergeFacts(prior, extracted.facts);

  // The reply is also read as the answer to the detail questions that were open with the last result.
  const detailCache = deps.detailCache ?? sharedDetailCache;
  const reqById = new Map(requirements.requirements.map((r) => [r.id, r]));
  // A spec comes back from the page, so it is re-checked against the requirement's own text before it is used; an answer that
  // needs a spec it no longer has (a choice or number question whose spec did not hold) is dropped rather than guessed at.
  let answers: DetailAnswers = {};
  for (const [lead, a] of Object.entries(parsed.data.answers ?? {})) {
    const spec = a.kind && a.kind !== 'yes_no' ? sanitizeSpec(a.spec, reqById.get(lead)) : undefined;
    if (a.kind && a.kind !== 'yes_no' && spec?.type !== a.kind) continue;
    answers[lead] = spec ? { ...a, spec } : a;
  }
  const askedDetails = (parsed.data.asked ?? []).filter((a) => reqById.has(a.id));
  if (llm && parsed.data.readMessage !== false && askedDetails.length > 0) {
    emit({ id: 'answers', status: 'running', message: 'Reading your reply as answers to the detail questions…' });
    const open = askedDetails.map((a) => ({
      requirementId: a.id,
      covers: a.covers.filter((id) => reqById.has(id)),
      // The words the page says it showed; the cache or a template stand in when it sent none.
      question: a.question?.trim() || shownWording(a.id, reqById.get(a.id), detailCache) || 'the detail question',
      shown: a.shown,
      spec: sanitizeSpec(a.spec, reqById.get(a.id)),
    }));
    const read = await readAnswers({ messages, open, llm, turn: messages.filter((m) => m.role === 'user').length });
    answers = { ...answers, ...read.answers };
    warnings.push(...read.warnings);
    const got = Object.keys(read.answers).length;
    emit({ id: 'answers', status: 'done', message: got > 0 ? `Read ${got} answer${got === 1 ? '' : 's'} to the detail questions.` : 'No answers to the detail questions found in your message.' });
  }

  const result = await assess({
    requirements,
    facts,
    llm,
    cache: deps.interpretCache ?? sharedCache,
    onProgress: deps.onProgress,
    answers,
    answerQuestion: (lead) => shownWording(lead, reqById.get(lead), detailCache),
  });
  emit({ id: 'summary', status: 'running', message: 'Building the findings, the follow-up questions and the summary…' });
  // At most three rounds of questions, each sized from how many are open so that all of them fit. Fixed questions come first
  // (they unlock exact checks); detail questions made from the requirements fill the rest of the round.
  const allFixed = buildQuestions(result.findings, 1000, parsed.data.skipFacts ?? []);
  const allCandidates = detailCandidates({ findings: result.findings, requirements: requirements.requirements, answers, skipped: parsed.data.skipDetails ?? [] });
  // Each stage asks about one topic: the fixed questions and the detail questions that belong to it, best first.
  // The stages were planned for this grant (saved with it) and checked in code; if there is no plan, or it was made from other
  // requirements, the three fixed stages are used. The web server only reads the plan, it never makes one.
  const savedPlan = await store.readStages(opportunityId);
  const stagePlan = savedPlan && savedPlan.requirementsHash === requirementsHash(requirements) ? savedPlan : defaultStagePlan(requirements);
  const fixedByStage = (stage: number) => allFixed.filter((q) => stageOfGroupIn(stagePlan, q.group) === stage);
  const detailByStage = (stage: number) => allCandidates.filter((c) => stageOfRequirementIn(stagePlan, { id: c.leadId, category: c.category }) === stage);
  const openIn = (stage: number): number => fixedByStage(stage).length + detailByStage(stage).length;
  const plan = pickStage([openIn(1), openIn(2), openIn(3)], parsed.data.round ?? 0, parsed.data.readMessage !== false);
  const stageFixed = plan.stage > 0 ? fixedByStage(plan.stage) : [];
  const fixed = stageFixed.slice(0, plan.size);
  const room = Math.max(0, plan.size - fixed.length);
  const stageDetails = plan.stage > 0 ? detailByStage(plan.stage) : [];
  const candidates = stageDetails.slice(0, room);
  const asked = new Set(candidates.map((c) => c.leadId));
  const openDetails = allCandidates.filter((c) => !asked.has(c.leadId)).slice(0, MAX_LISTED_DETAILS).map((c) => toDetailQuestion(c, listedWording(c, detailCache)));
  const openTotal = allFixed.length + allCandidates.length;
  const plannedStage = plan.stage > 0 ? stagePlan.stages.find((s) => s.index === plan.stage) : undefined;
  const stageInfo: QuestionStage | null = plannedStage ? { index: plannedStage.index as 1 | 2 | 3, title: plannedStage.title, why: plannedStage.why, source: stagePlan.source } : null;
  const laterOpen = plan.stage > 0 ? [1, 2, 3].filter((s) => s > plan.stage).reduce((n, s) => n + openIn(s), 0) : 0;
  const changes = diffFindings(parsed.data.previous, result.findings);
  if (candidates.length > 0) emit({ id: 'details', status: 'running', message: `Writing ${candidates.length === 1 ? 'a question' : `${candidates.length} questions`} from the notice's own requirements…` });
  const wording = candidates.length > 0 ? await writeDetailQuestions(candidates, llm, detailCache) : new Map();
  if (candidates.length > 0) emit({ id: 'details', status: 'done', message: `Made ${candidates.length === 1 ? 'a detail question' : `${candidates.length} detail questions`} from requirements that still cannot be evaluated.` });
  const questions = [...fixed, ...candidates.map((c) => toDetailQuestion(c, wording.get(c.leadId) ?? { text: shownWording(c.leadId, reqById.get(c.leadId)) ?? 'Does your project meet this requirement?', source: 'code' as const, spec: { type: 'yes_no' as const } }))];
  const advisory = buildAdvisory(result, questions);
  emit({ id: 'summary', status: 'done', message: `Built ${result.findings.length} findings and ${questions.length} follow-up question${questions.length === 1 ? '' : 's'}.` });

  emit({ id: 'reply', status: 'running', message: 'Writing a reply from the checked findings, and an example answer you can copy…' });
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const latestMessage = lastUserIndex >= 0 ? messages[lastUserIndex].content : '';
  // What the assistant said just before this message, so a short answer ("yes") is answered in context.
  const previousReply = [...messages.slice(0, Math.max(0, lastUserIndex))].reverse().find((m) => m.role === 'assistant')?.content;
  const opportunityTitle = opportunity?.title ? opportunity.title.slice(0, 200) : null;
  const firstReply = (parsed.data.round ?? 0) === 0 && parsed.data.readMessage !== false && plan.stage > 0 && !previousReply;
  // The conversational reply and the made-up example answer are independent, so they are written at the same time.
  const [reply, suggestedReply] = await Promise.all([
    writeReply(
      {
        opportunityTitle,
        latestMessage,
        previousReply,
        facts,
        advisory,
        findings: result.findings,
        questions,
        stage: stageInfo ? { index: stageInfo.index, of: MAX_QUESTION_ROUNDS, title: stageInfo.title, why: stageInfo.why } : null,
        // On the very first reply, say how the consultation will go: the steps planned for this grant, in order.
        process: firstReply ? { steps: stagePlan.stages.filter((s) => openIn(s.index) > 0).map((s) => ({ index: s.index, title: s.title })) } : null,
        changes,
      },
      llm
    ),
    writeSuggestedReply({ opportunityTitle, facts, questions }, llm),
  ]);
  emit({
    id: 'reply',
    status: 'done',
    message: reply.source === 'model' ? 'The language model wrote the reply and it passed the checks.' : 'The reply was written from a template (the language model was not used or its text did not pass the checks).',
  });
  warnings.push(...result.warnings);

  logger.info(`Assessed ${opportunityId}: ${result.findings.length} findings, ${questions.length} questions, ${result.interpretation.modelCalls} model call(s)`);

  return {
    opportunityId,
    opportunity: opportunity ? { title: opportunity.title, opportunityNumber: opportunity.opportunityNumber, status: opportunity.status } : null,
    facts,
    newFacts: Object.keys(extracted.facts) as FactKey[],
    rejectedFacts: extracted.rejected,
    derived: result.derived,
    findings: result.findings,
    notApplicable: result.notApplicable,
    skippedCount: result.skipped.length,
    questions,
    openDetails,
    questionRound: { round: plan.stage > 0 ? plan.stage : Math.min(parsed.data.round ?? 0, MAX_QUESTION_ROUNDS), of: MAX_QUESTION_ROUNDS, open: openTotal, later: laterOpen, stage: stageInfo },
    changes,
    answers,
    advisory,
    reply,
    suggestedReply,
    requirements: {
      generatedAt: requirements.generatedAt,
      status: requirements.status,
      total: requirements.requirements.length,
      needsReview: requirements.requirements.filter((r) => r.reviewStatus === 'needs_review').length,
      verified: requirements.requirements.filter((r) => r.reviewStatus === 'verified').length,
      model: requirements.model,
    },
    interpretation: result.interpretation,
    warnings,
  };
}

