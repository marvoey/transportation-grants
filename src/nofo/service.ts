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
import { parseOpportunityId } from './schemas.js';
import { PackageStore } from './store.js';

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}

export interface AssessTurnDeps {
  store?: PackageStore;
  llm?: LlmFn;
  interpretCache?: InterpretCache;
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

  const requirements = await store.readRequirements(opportunityId);
  if (!requirements) {
    throw new AssessmentError(`No extracted requirements for ${opportunityId}. Run: npm run nofo:extract -- ${opportunityId}`);
  }
  const opportunity = await store.readOpportunity(opportunityId).catch(() => null);

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
  if (llm) extracted = await extractFacts({ messages, llm });
  warnings.push(...extracted.warnings);
  const facts = mergeFacts(prior, extracted.facts);

  const result = await assess({ requirements, facts, llm, cache: deps.interpretCache ?? sharedCache });
  const questions = buildQuestions(result.findings);
  const advisory = buildAdvisory(result, questions);
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

