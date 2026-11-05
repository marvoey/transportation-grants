import type { LlmFn } from '../llm.js';
import { safeProgress, type ProgressFn } from '../progress.js';
import { mapLimit } from '../util.js';
import type { Requirement, RequirementsFile } from '../extraction/schemas.js';
import { deriveArithmetic, type Derived } from './arithmetic.js';
import { evaluateCheck } from './checks.js';
import { interpretBatch, visibleFacts, type InterpretCache, type Interpretation } from './interpret.js';
import type { FactKey, Finding, FindingSource, FindingStatus, NotApplicable, ProjectFacts } from './schemas.js';

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
const READINESS_MODEL_TOPICS = new Set(['design_status', 'environmental_nepa', 'right_of_way', 'schedule', 'planning_consistency', 'project_location']);

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
