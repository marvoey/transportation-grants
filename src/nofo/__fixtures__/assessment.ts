import type { LlmCall, LlmResult } from '../llm.js';
import type { Check, Requirement, RequirementsFile } from '../extraction/schemas.js';
import { FACTS_SYSTEM_PROMPT } from '../assessment/facts.js';
import { INTERPRET_SYSTEM_PROMPT } from '../assessment/interpret.js';
import type { FactKey, ProjectFacts } from '../assessment/schemas.js';
import { DOC_ID, llmResult, scriptedLlm, type ScriptedLlm } from './extraction.js';
import { OPP_A } from './helpers.js';

/** Builds a Requirement with sensible defaults. Synthetic rules shaped like a funding notice. */
export function req(overrides: Partial<Requirement> & { id: string }): Requirement {
  return {
    opportunityId: OPP_A,
    category: 'funding',
    topic: 'other',
    title: overrides.id,
    description: `${overrides.id} description`,
    mandatory: true,
    programVariant: null,
    appliesWhen: [],
    evidenceNeeded: [],
    sources: [{ documentId: DOC_ID, page: 3, section: null, quote: `Evidence quote for ${overrides.id} in the notice.`, authority: 'controlling', verified: true, locationCorrected: false }],
    reviewStatus: 'unreviewed',
    ...overrides,
  };
}

export function reqFile(requirements: Requirement[], overrides: Partial<RequirementsFile> = {}): RequirementsFile {
  return {
    schemaVersion: 1,
    opportunityId: OPP_A,
    generatedAt: '2026-11-05T00:00:00Z',
    model: 'test-model',
    promptVersion: '4',
    passes: 1,
    sourceManifestHash: 'a'.repeat(64),
    status: 'complete',
    documents: [],
    batches: { total: 1, succeeded: 1, split: 0, failed: [] },
    usage: { inputTokens: 0, outputTokens: 0 },
    stats: { candidates: requirements.length, rejected: 0, merged: 0, kept: requirements.length, sourcesRejected: 0, locationsCorrected: 0, checksDropped: 0 },
    rejections: [],
    requirements,
    ...overrides,
  };
}

const any = { areaType: 'any', grantCategory: 'any' } as const;
const check = (c: Check): Check => c;

export const urbanMin = req({
  id: 'req-00000001', topic: 'minimum_request', title: 'Minimum request for urban capital projects', programVariant: 'capital',
  check: check({ kind: 'amount_min', amountUsd: 5_000_000, appliesTo: { areaType: 'urban', grantCategory: 'capital' } }),
});
export const ruralMin = req({
  id: 'req-00000002', topic: 'minimum_request', title: 'Minimum request for rural capital projects', programVariant: 'capital',
  check: check({ kind: 'amount_min', amountUsd: 1_000_000, appliesTo: { areaType: 'rural', grantCategory: 'capital' } }),
});
export const maxRequest = req({
  id: 'req-00000003', topic: 'maximum_request', title: 'Maximum request', check: check({ kind: 'amount_max', amountUsd: 25_000_000, appliesTo: any }),
});
export const shareCapUrban = req({
  id: 'req-00000004', topic: 'federal_share', title: 'Federal share capped at 80 percent for urban projects',
  description: 'The federal share shall not exceed 80 percent unless the project is rural or has a special designation.',
  check: check({ kind: 'federal_share_max_pct', pct: 80, appliesTo: { areaType: 'urban', grantCategory: 'any' } }),
});
export const shareCapPlain = req({
  id: 'req-00000005', topic: 'federal_share', title: 'Federal share capped at 50 percent', description: 'The federal share may not exceed 50 percent.',
  check: check({ kind: 'federal_share_max_pct', pct: 50, appliesTo: any }),
});
export const matchMin = req({
  id: 'req-00000006', topic: 'non_federal_match', title: 'Minimum non-federal match of 20 percent', check: check({ kind: 'match_min_pct', pct: 20, appliesTo: any }),
});
export const applicantTypes = req({
  id: 'req-00000007', category: 'eligibility', topic: 'applicant_type', title: 'Eligible applicant types',
  check: check({ kind: 'applicant_type_in', values: ['States and the District of Columbia', 'A unit of local government', 'A transit agency'] }),
});
export const bca = req({
  id: 'req-00000008', category: 'application', topic: 'benefit_cost_analysis', title: 'Benefit-cost analysis required for capital projects', programVariant: 'capital',
  check: check({ kind: 'document_required', documentKey: 'benefit_cost_analysis' }),
});
export const bcaDuplicate = req({
  id: 'req-00000009', category: 'application', topic: 'benefit_cost_analysis', title: 'Two benefit-cost analysis files required', programVariant: 'capital',
  check: check({ kind: 'document_required', documentKey: 'bca_files' }),
});
export const form = req({
  id: 'req-0000000a', category: 'application', topic: 'application_content', title: 'Standard form required', check: check({ kind: 'document_required', documentKey: 'sf424' }),
});
export const projectTypes = req({
  id: 'req-0000000b', category: 'eligibility', topic: 'project_type', title: 'Ineligible project types', description: 'School buses and standalone broadband are not eligible.',
});
export const designStatus = req({
  id: 'req-0000000c', category: 'readiness', topic: 'design_status', title: 'State the level of design', mandatory: null, programVariant: 'capital',
});
export const nepa = req({ id: 'req-0000000d', category: 'readiness', topic: 'environmental_nepa', title: 'State the environmental review class of action' });
export const matchRule = req({ id: 'req-0000000e', topic: 'non_federal_match', title: 'Toll credits count as federal, not non-federal match' });
export const optionalItem = req({ id: 'req-0000000f', category: 'application', topic: 'application_content', title: 'Accessibility compliance encouraged', mandatory: false });
export const planningOnly = req({ id: 'req-00000010', category: 'eligibility', topic: 'project_type', title: 'Planning projects must lead to a capital project', programVariant: 'planning' });

/** A compact rulebook that exercises every route. */
export const RULEBOOK = [urbanMin, ruralMin, maxRequest, shareCapUrban, applicantTypes, bca, bcaDuplicate, form, projectTypes, designStatus, nepa, matchRule, optionalItem, planningOnly];

/** Builds ProjectFacts from plain values (every fact is "stated by the user"). */
export function facts(values: Partial<Record<FactKey, unknown>>): ProjectFacts {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) out[key] = { value, provenance: 'user' };
  return out as ProjectFacts;
}

/** The scenario in the guide: a state DOT, a $25M capital project, $18M requested, $7M state match committed, no BCA. */
export const DEMO_FACTS = facts({
  applicantType: 'state',
  grantCategory: 'capital',
  totalProjectCostUsd: 25_000_000,
  requestedFederalUsd: 18_000_000,
  nonFederalMatchUsd: 7_000_000,
  matchCommitted: true,
  bcaCompleted: false,
  projectDescription: 'Intersection redesign, pedestrian improvements and signals on a state roadway.',
  activities: ['intersection redesign', 'pedestrian improvements', 'signals'],
  designStatus: 'preliminary design',
});

/**
 * A scripted model that answers BOTH kinds of call: reading facts from a message and interpreting requirements.
 * `interpretation` decides the status for each requirement id; the default is "unknown".
 */
export function modelStandIn(options: {
  facts?: Record<string, { value: unknown; quote: string }> | ((call: LlmCall) => Record<string, { value: unknown; quote: string }>);
  interpretation?: (id: string) => { status: string; explanation?: string; factsUsed?: string[] } | undefined;
} = {}): ScriptedLlm {
  return scriptedLlm((call): LlmResult => {
    if (call.system === FACTS_SYSTEM_PROMPT) {
      const given = typeof options.facts === 'function' ? options.facts(call) : (options.facts ?? {});
      const wire: Record<string, unknown> = {};
      for (const key of ['applicantType', 'stateName', 'grantCategory', 'areaType', 'totalProjectCostUsd', 'requestedFederalUsd', 'otherFederalFundsUsd', 'nonFederalMatchUsd', 'matchCommitted', 'bcaCompleted', 'projectDescription', 'activities', 'designStatus', 'environmentalStatus']) {
        const g = given[key];
        wire[key] = g
          ? { present: true, value: g.value, quote: g.quote }
          : { present: false, value: key.endsWith('Usd') ? 0 : key.endsWith('Type') || key === 'grantCategory' ? 'unknown' : key === 'activities' ? [] : key.startsWith('match') || key.startsWith('bca') ? false : '', quote: '' };
      }
      return llmResult(JSON.stringify(wire));
    }
    if (call.system === INTERPRET_SYSTEM_PROMPT) {
      const requirements = JSON.parse(/<requirements>\n([\s\S]*?)\n<\/requirements>/.exec(call.user)![1]) as Array<{ requirementId: string }>;
      const assessments = requirements.map((r) => {
        const chosen = options.interpretation?.(r.requirementId);
        return { requirementId: r.requirementId, status: chosen?.status ?? 'unknown', explanation: chosen?.explanation ?? 'stated facts do not say', factsUsed: chosen?.factsUsed ?? [] };
      });
      return llmResult(JSON.stringify({ assessments }));
    }
    throw new Error('unexpected model call');
  });
}

export const isInterpretCall = (call: LlmCall): boolean => call.system === INTERPRET_SYSTEM_PROMPT;
export const isFactsCall = (call: LlmCall): boolean => call.system === FACTS_SYSTEM_PROMPT;
