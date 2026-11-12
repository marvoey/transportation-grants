import type { LlmFn } from '../llm.js';
import { safeProgress, type ProgressFn } from '../progress.js';
import { mapLimit } from '../util.js';
import type { Requirement, RequirementsFile } from '../extraction/schemas.js';
import { deriveArithmetic, type Derived } from './arithmetic.js';
import { evaluateCheck } from './checks.js';
import { interpretBatch, visibleFacts, type InterpretCache, type Interpretation } from './interpret.js';
import type { DetailAnswers, FactKey, Finding, FindingSource, FindingStatus, NotApplicable, ProjectFacts } from './schemas.js';

/**
 * Compare stated project facts with the extracted requirements. Reads only
 * `requirements.json`; the notice is never re-fetched, re-parsed or
 * re-extracted when a fact changes.
 *
 * Routing, per requirement:
 *   optional wording                  -> skipped
 *   wrong project type                -> not applicable
 *   has a machine-checkable check     -> plain code (checks.ts)
 *   free-text condition on the facts  -> model interpretation (interpret.ts), always provisional
 *   a deliverable still to prepare    -> unknown (checklist)
 * A missing fact is always `unknown`: never a pass, never a fail.
 */

export interface AssessOptions {
  requirements: RequirementsFile;
  facts: ProjectFacts;
  /** Absent => requirements needing interpretation stay unknown. */
  llm?: LlmFn;
  cache?: InterpretCache;
  batchSize?: number;
  /** Upper bound on requirements sent to the model in one assessment. */
  maxInterpreted?: number;
  /** Called as each stage really starts and finishes, so a screen can say what is happening. */
  onProgress?: ProgressFn;
  /** The applicant's yes/no answers to detail questions (questions made from requirements): their own statements. */
  answers?: DetailAnswers;
  /** The wording of an answered detail question, by the id the answer is kept under, so a finding can quote it. */
  answerQuestion?: (leadId: string) => string | undefined;
}

export interface AssessmentResult {
  findings: Finding[];
  notApplicable: NotApplicable[];
  skipped: Array<{ requirementId: string; title: string; reason: string }>;
  derived: Derived;
  warnings: string[];
  interpretation: { requirements: number; modelCalls: number; cacheHits: number };
}

/** Topics whose evaluation depends on a specific stated fact (a question is asked when it is missing). */
const TOPIC_FACTS: Record<string, FactKey[]> = {
  applicant_type: ['applicantType'],
  design_status: ['designStatus'],
  environmental_nepa: ['environmentalStatus'],
  benefit_cost_analysis: ['bcaCompleted'],
  non_federal_match: ['nonFederalMatchUsd', 'matchCommitted'],
};
/** Of those, the topics a model can interpret once the fact exists. The rest need documents a conversation cannot supply. */
const MODEL_TOPICS = new Set(['applicant_type', 'design_status', 'environmental_nepa']);
const READINESS_MODEL_TOPICS = new Set(['design_status', 'environmental_nepa', 'right_of_way', 'schedule', 'planning_consistency', 'project_location', 'applicant_capacity']);

/**
 * A requirement that says there is NO match or cost sharing to provide ("No matching share required"). It must not be
 * treated as a rule waiting for match facts: nothing is owed, so no question about match should be asked because of it.
 */
const MATCH_WORD = '(?:match|matching|cost[- ]?shar\\w*)';
const NO_MATCH_PATTERNS = [
  new RegExp(`^\\s*no\\b[^.;]{0,40}\\b${MATCH_WORD}`, 'i'), // a title that begins "No matching share ..."
  new RegExp(`\\bno\\b[^.;]{0,30}\\b${MATCH_WORD}\\b[^.;]{0,30}\\b(?:required|needed)\\b`, 'i'), // "no match is required"
  new RegExp(`\\b${MATCH_WORD}\\b[^.;]{0,30}\\b(?:is|are)? ?(?:not required|not needed|waived)\\b`, 'i'), // "cost sharing is not required"
];

export function statesNoMatchRequired(requirement: Requirement): boolean {
  if (requirement.topic !== 'non_federal_match' || requirement.check) return false;
  return NO_MATCH_PATTERNS.some((pattern) => pattern.test(`${requirement.title}. ${requirement.description}`));
}

/**
 * Applies the applicant's answers to the requirements still unknown. Only an unknown finding is changed: a code check or a
 * model reading is never overridden by a yes or no. "Yes" means the applicant says they meet what the requirement asks
 * (supported); "no" is a possible conflict, or a preparation gap for readiness and checklist items. "Unsure" changes nothing.
 * Every result is provisional and says it is the applicant's own statement.
 */
export function applyAnswers(findings: Finding[], answers: DetailAnswers, questionFor: (leadId: string) => string | undefined = () => undefined): Finding[] {
  const covered = new Map<string, { lead: string; answer: DetailAnswers[string] }>();
  for (const [lead, a] of Object.entries(answers)) for (const id of a.covers) if (!covered.has(id)) covered.set(id, { lead, answer: a });
  if (covered.size === 0) return findings;
  return findings.map((f) => {
    const hit = covered.get(f.requirementId);
    if (!hit || hit.answer.answer === 'unsure' || f.status !== 'unknown' || f.method === 'deterministic') return f;
    const a = hit.answer;
    const question = (a.question ?? questionFor(hit.lead) ?? `the question about "${f.title}"`).replace(/"/g, "'");
    const gap = f.category === 'readiness' || f.category === 'application';
    const note = 'That is your own statement; it has not been checked against the notice.';
    const decided = (status: 'supported' | 'conflict' | 'needs_specialist_review', explanation: string): Finding => ({
      ...f,
      status,
      gap: status === 'conflict' ? gap : false,
      method: 'answer' as const,
      provisional: true,
      explanation,
      factsUsed: [],
      missingFacts: [],
    });
    const kind = a.kind ?? 'yes_no';

    if (kind === 'yes_no') {
      if (a.answer === 'yes') return decided('supported', `You answered yes to: "${question}" ${note}`);
      if (a.answer === 'no') return decided('conflict', `You answered no to: "${question}" ${note}`);
      return f;
    }
    if (kind === 'choice') {
      const option = a.option !== undefined ? a.spec?.options?.[a.option] : undefined;
      if (!option) return f;
      const said = `You chose "${option.label}" for: "${question}"`;
      if (option.outcome === 'meets') return decided('supported', `${said} ${note}`);
      if (option.outcome === 'does_not_meet') return decided('conflict', `${said} ${note}`);
      return decided('needs_specialist_review', `${said} Whether that meets the requirement needs a person to judge. ${note}`);
    }
    if (kind === 'number') {
      const c = a.spec?.comparison;
      if (!c || a.number === undefined) return f;
      const unit = c.unit ? ` ${c.unit}` : '';
      const ok = c.op === 'at_most' ? a.number <= c.value : c.op === 'at_least' ? a.number >= c.value : a.number === c.value;
      const rule = c.op === 'at_most' ? `at most ${c.value}${unit}` : c.op === 'at_least' ? `at least ${c.value}${unit}` : `exactly ${c.value}${unit}`;
      return decided(ok ? 'supported' : 'conflict', `You said ${a.number}${unit}; the notice sets ${rule}. ${ok ? 'That is within it' : 'That is outside it'} (from "${question}"). ${note}`);
    }
    // A description: recorded in the applicant's own words and left to a person to judge.
    const words = (a.text ?? a.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 300).replace(/"/g, "'");
    return decided('needs_specialist_review', `You described: "${words}" in answer to: "${question}" Whether that meets the requirement needs a person to judge. ${note}`);
  });
}

const STATUS_ORDER: Record<FindingStatus, number> = { conflict: 0, needs_specialist_review: 1, unknown: 2, supported: 3 };

function sourcesOf(requirement: Requirement): FindingSource[] {
  return requirement.sources.map((s) => ({ documentId: s.documentId, page: s.page, section: s.section, quote: s.quote, authority: s.authority }));
}

function finding(requirement: Requirement, partial: Partial<Finding> & Pick<Finding, 'status' | 'method' | 'explanation'>): Finding {
  return {
    requirementId: requirement.id,
    title: requirement.title,
    category: requirement.category,
    topic: requirement.topic,
    mandatory: requirement.mandatory,
    gap: false,
    provisional: true,
    factsUsed: [],
    missingFacts: [],
    sources: sourcesOf(requirement),
    requirementReviewStatus: requirement.reviewStatus,
    ...partial,
  };
}

function modelEligible(requirement: Requirement): boolean {
  if (requirement.category === 'eligibility' || requirement.category === 'funding') return true;
  return requirement.category === 'readiness' && READINESS_MODEL_TOPICS.has(requirement.topic);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function assess(options: AssessOptions): Promise<AssessmentResult> {
  const { facts } = options;
  const emit = safeProgress(options.onProgress);
  emit({ id: 'rules', status: 'running', message: "Applying the notice's exact rules (amounts, match, required documents) to the facts you gave…" });
  const derived = deriveArithmetic(facts);
  const findings: Finding[] = [];
  const notApplicable: NotApplicable[] = [];
  const skipped: AssessmentResult['skipped'] = [];
  const warnings: string[] = [];
  const toInterpret: Requirement[] = [];

  if (options.requirements.status === 'partial') {
    warnings.push('The requirements for this opportunity are incomplete (some extraction batches failed), so this assessment may miss requirements.');
  }
  if (derived.consistency.status === 'inconsistent') warnings.push(derived.consistency.message);

  const category = facts.grantCategory?.value;

  for (const requirement of options.requirements.requirements) {
    if (requirement.mandatory === false) {
      skipped.push({ requirementId: requirement.id, title: requirement.title, reason: 'optional or permissive wording, not a requirement' });
      continue;
    }
    const variant = requirement.programVariant;
    if (variant && variant !== 'both' && category && category !== variant) {
      notApplicable.push({ requirementId: requirement.id, title: requirement.title, reason: `applies to ${variant} projects; this is a ${category} project` });
      continue;
    }

    if (statesNoMatchRequired(requirement)) {
      skipped.push({ requirementId: requirement.id, title: requirement.title, reason: 'the notice states that nothing is required here, so nothing is asked' });
      continue;
    }

    // A requirement about a benefit-cost analysis is evaluated the same way whether or not it carries a check.
    const effective: Requirement =
      !requirement.check && requirement.topic === 'benefit_cost_analysis'
        ? { ...requirement, check: { kind: 'document_required', documentKey: 'benefit_cost_analysis' } }
        : requirement;

    const outcome = evaluateCheck(effective, facts, derived);
    if (outcome) {
      if (outcome.applicability === 'not_applicable') {
        notApplicable.push({ requirementId: requirement.id, title: requirement.title, reason: outcome.explanation });
        continue;
      }
      findings.push(
        finding(requirement, {
          status: outcome.status,
          gap: outcome.gap,
          method: 'deterministic',
          // Only a human-verified requirement makes a deterministic result more than provisional.
          provisional: requirement.reviewStatus !== 'verified',
          explanation: outcome.explanation,
          factsUsed: outcome.factsUsed,
          missingFacts: outcome.missingFacts,
        })
      );
      continue;
    }

    // Free-text or checklist requirements.
    const needed = TOPIC_FACTS[requirement.topic] ?? [];
    const missing = needed.filter((key) => !facts[key]);
    if (needed.length > 0 && missing.length > 0) {
      findings.push(finding(requirement, { status: 'unknown', method: 'none', explanation: `Cannot be evaluated yet: ${describeMissing(missing)} not stated.`, missingFacts: missing }));
      continue;
    }
    if (needed.length > 0 && !MODEL_TOPICS.has(requirement.topic)) {
      findings.push(finding(requirement, { status: 'unknown', method: 'none', explanation: 'The related facts have been stated, but this rule depends on documents (for example the sources of the funds) that a conversation cannot settle; it needs a document review.', factsUsed: needed }));
      continue;
    }
    if (modelEligible(requirement)) {
      toInterpret.push(requirement);
    } else {
      findings.push(finding(requirement, { status: 'unknown', method: 'none', explanation: 'Nothing stated so far shows whether this has been prepared. It belongs on the application checklist.' }));
    }
  }

  emit({
    id: 'rules',
    status: 'done',
    message: `Checked ${options.requirements.requirements.length} requirements: ${notApplicable.length} do not apply to this project, ${skipped.length} are optional wording, ${toInterpret.length} need the language model to interpret.`,
  });

  // ---- model interpretation of the free-text conditions ----------------------------
  const interpretation = { requirements: 0, modelCalls: 0, cacheHits: 0 };
  let batchesRun = 0;
  let batchesFailed = 0;
  const hasVisibleFacts = Object.keys(visibleFacts(facts)).length > 0;
  const limit = options.maxInterpreted ?? 60;
  const selected = toInterpret.slice(0, limit);
  const overflow = toInterpret.slice(limit);

  const results = new Map<string, Interpretation>();
  if (!options.llm) {
    if (toInterpret.length > 0) {
      warnings.push('Model interpretation was not available, so requirements that need it stay unknown.');
      emit({ id: 'interpret', status: 'failed', message: `The language model is not available, so ${toInterpret.length} conditions stay unknown.` });
    }
  } else if (!hasVisibleFacts) {
    // Nothing for the model to read: skip the calls entirely. These stay unknown.
    if (toInterpret.length > 0) emit({ id: 'interpret', status: 'done', message: 'Nothing to interpret yet: describe the project first, and the free-text conditions will be read against it.' });
  } else {
    // Batches are independent, so they run concurrently (a few at a time) instead of one after another.
    const batches = chunk(selected, options.batchSize ?? 12);
    let finished = 0;
    batchesRun = batches.length;
    if (batches.length > 0) {
      emit({ id: 'interpret', status: 'running', message: `Asking the language model to interpret ${selected.length} conditions in ${batches.length} batch${batches.length === 1 ? '' : 'es'}…` });
    }
    const outcomes = await mapLimit(batches, 4, async (batch) => {
      const outcome = await interpretBatch({ llm: options.llm as LlmFn, facts, requirements: batch, cache: options.cache });
      finished += 1;
      emit({ id: 'interpret', status: 'running', message: `Interpreting conditions with the language model: ${finished} of ${batches.length} batch${batches.length === 1 ? '' : 'es'} done…` });
      return outcome;
    });
    outcomes.forEach((outcome, index) => {
      if (outcome.ok) {
        if (outcome.fromCache) interpretation.cacheHits += 1;
        else interpretation.modelCalls += 1;
        interpretation.requirements += batches[index].length;
        for (const [id, value] of outcome.results) results.set(id, value);
      } else {
        interpretation.modelCalls += 1;
        batchesFailed += 1;
        warnings.push(`Some requirements could not be interpreted this time (${outcome.error}).`);
      }
    });
  }
  if (overflow.length > 0) warnings.push(`${overflow.length} requirement(s) were not interpreted because of the per-assessment limit.`);
  if (batchesRun > 0) {
    emit({
      id: 'interpret',
      status: batchesFailed > 0 ? 'failed' : 'done',
      message:
        batchesFailed > 0
          ? `${batchesFailed} of ${batchesRun} batch${batchesRun === 1 ? '' : 'es'} could not be interpreted this time, so those conditions stay unknown.`
          : `Interpreted ${interpretation.requirements} conditions (${interpretation.modelCalls} new model call${interpretation.modelCalls === 1 ? '' : 's'}, ${interpretation.cacheHits} reused from earlier).`,
    });
  }

  for (const requirement of toInterpret) {
    const result = results.get(requirement.id);
    if (result) {
      findings.push(
        finding(requirement, {
          status: result.status,
          method: 'llm',
          provisional: true, // every model judgment is provisional
          explanation: result.explanation,
          factsUsed: result.factsUsed,
        })
      );
    } else {
      findings.push(
        finding(requirement, {
          status: 'unknown',
          method: 'none',
          explanation: hasVisibleFacts ? 'Not interpreted this time.' : 'A description of the project is needed before this can be assessed.',
          missingFacts: hasVisibleFacts ? [] : ['projectDescription'],
        })
      );
    }
  }

  const answered = applyAnswers(findings, options.answers ?? {}, options.answerQuestion);
  // applyAnswers hands back the same array when there is nothing to apply; only replace the contents when it made a new one.
  if (answered !== findings) {
    findings.length = 0;
    findings.push(...answered);
  }

  findings.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.gap !== b.gap) return a.gap ? 1 : -1; // real conflicts before preparation gaps
    const byMandatory = Number(b.mandatory === true) - Number(a.mandatory === true);
    return byMandatory || a.title.localeCompare(b.title);
  });

  return { findings, notApplicable, skipped, derived, warnings, interpretation };
}

const FACT_WORDS: Partial<Record<FactKey, string>> = {
  applicantType: 'the applicant type is',
  designStatus: 'the level of design is',
  environmentalStatus: 'the environmental review status is',
  bcaCompleted: 'whether a benefit-cost analysis is done is',
  nonFederalMatchUsd: 'the non-federal match amount is',
  matchCommitted: 'whether the match is committed is',
};

function describeMissing(keys: FactKey[]): string {
  return keys.map((k) => FACT_WORDS[k] ?? `${k} is`).join(' and ').replace(/ is and /g, ' and ');
}
