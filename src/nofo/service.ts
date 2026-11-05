import { logger } from '../config/config.js';
import { buildAdvisory, type Advisory } from './advisory.js';
import type { Derived } from './assessment/arithmetic.js';
import { assess, type AssessmentResult } from './assessment/assess.js';
import { extractFacts, mergeFacts, parseIncomingFacts, type ExtractFactsResult } from './assessment/facts.js';
import { createInterpretCache, type InterpretCache } from './assessment/interpret.js';
import { buildQuestions } from './assessment/questions.js';
import {
  AssessInputSchema,
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
  advisory: Advisory;
  requirements: { generatedAt: string; status: 'complete' | 'partial'; total: number; needsReview: number; verified: number; model: string };
  interpretation: AssessmentResult['interpretation'];
  warnings: string[];
}

// One cache per process, so an unchanged description of the project never costs a second model call.
const sharedCache = createInterpretCache();

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

  const result = await assess({ requirements, facts, llm, cache: deps.interpretCache ?? sharedCache, onProgress: deps.onProgress });
  emit({ id: 'summary', status: 'running', message: 'Building the findings, the follow-up questions and the summary…' });
  const questions = buildQuestions(result.findings);
  const advisory = buildAdvisory(result, questions);
  emit({ id: 'summary', status: 'done', message: `Built ${result.findings.length} findings and ${questions.length} follow-up question${questions.length === 1 ? '' : 's'}.` });
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
    advisory,
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

