import { logger } from '../../config/config.js';
import type { LlmFn } from '../llm.js';
import type { OpportunitySearchSource } from '../simpler/source.js';
import { primaryPlans, wideningPlan, type SearchPlan } from './filters.js';
import { extractProfile, hasProjectSignal, keywordProfile } from './profile.js';
import { likelyCount, money, rankCandidates, selectShortlist, SHORTLIST_MIN } from './rank.js';
import {
  DISCOVERY_DISCLAIMER,
  DiscoverInputSchema,
  PROJECT_TYPE_LABELS,
  type DiscoverResult,
  type FilterNote,
  type ProgressEvent,
  type ProjectProfile,
  type SearchInspection,
} from './schemas.js';
import { mergeCandidates, runPlans, SearchCache, type PlanHooks, type PlanOutcome } from './search.js';

export class DiscoveryError extends Error {
  constructor(
    message: string,
    /** VALIDATION_ERROR -> 400; SEARCH_FAILED -> 502. */
    public readonly code: 'VALIDATION_ERROR' | 'SEARCH_FAILED' = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

export interface DiscoverDeps {
  source: OpportunitySearchSource;
  /** null/undefined = no model configured: a keyword reader is used and a warning is returned. */
  llm?: LlmFn | null;
  now?: () => Date;
  cache?: SearchCache;
  /**
   * Called as each step really starts and finishes, so a screen can say what the code is doing. A callback
   * that throws never affects the result.
   */
  onProgress?: (event: ProgressEvent) => void;
}

const APPLICANT_SHORT: Record<string, string> = {
  state: 'State government',
  county: 'County government',
  city_or_township: 'City or township',
  special_district: 'Special district',
  tribal: 'Tribal government',
  mpo: 'Metropolitan planning organization',
  other: 'Other applicant',
};

/** One plain line about what was understood (labels and numbers only, never the applicant's own words). */
export function describeProfile(profile: ProjectProfile): string | null {
  const parts: string[] = [];
  const types = profile.projectTypes.map((t) => PROJECT_TYPE_LABELS[t.value]);
  if (types.length) parts.push(types.join(' + '));
  if (profile.applicantType) parts.push(APPLICANT_SHORT[profile.applicantType.value] ?? 'Applicant');
  if (profile.federalAskUsd) parts.push(`request ${money(profile.federalAskUsd.value)}`);
  else if (profile.totalCostUsd) parts.push(`total cost ${money(profile.totalCostUsd.value)}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Question policy (the user asked us to stop asking):
 * - At most ONE required question, only on the first message, and only when no project type can be found
 *   (without one there is nothing to search for). Never after that, and never when the user asked for results.
 * - Otherwise search at once. Up to two OPTIONAL refinements are offered, only on the first two messages.
 * - From the third message on there are no questions at all, and a list is always returned.
 */
export const MAX_REFINING_MESSAGES = 2;

const ASK_PROJECT_TYPE =
  'What kind of transportation project is this? For example, a bridge replacement, a trail or sidewalk, a bus or transit project, a rail crossing, or a wildlife crossing.';

export function refinementQuestions(profile: ProjectProfile, messageCount: number, forced: boolean): string[] {
  if (forced || messageCount >= MAX_REFINING_MESSAGES + 1) return [];
  const out: string[] = [];
  if (!profile.federalAskUsd) out.push('Roughly how much federal funding would you request? (This helps match award sizes.)');
  if (!profile.applicantType) out.push('Who is the applicant: a state, county, city, tribe, or transit agency?');
  if (!profile.phase) out.push('Is the project at the planning, design, or construction-ready stage?');
  return out.slice(0, 2);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Turns the search runner's hooks into progress events, one line per search. */
function searchHooks(emit: (event: ProgressEvent) => void): PlanHooks {
  const id = (plan: SearchPlan): string => `search:${plan.id}`;
  return {
    onStart: (plan) =>
      emit({
        id: id(plan),
        status: 'running',
        message: `Sending a request to Simpler.Grants.gov: ${plan.label}`,
        detail: plan.body.query ? `Search words: ${plan.body.query}` : undefined,
      }),
    onDone: (o) => {
      if (o.error) {
        emit({ id: id(o.plan), status: 'failed', message: `That search failed and was skipped: ${o.plan.label}` });
        return;
      }
      const returned = o.result?.candidates.length ?? 0;
      const total = o.result?.totalRecords ?? null;
      const count = total !== null && total > returned ? `${returned} of ${total} listings` : `${returned} ${plural(returned, 'listing', 'listings')}`;
      emit({
        id: id(o.plan),
        status: 'done',
        message: `${o.cached ? 'Reused a recent result' : 'Simpler.Grants.gov answered'}: ${count} for ${o.plan.label}`,
      });
    },
  };
}

function describeSearches(outcomes: PlanOutcome[]): FilterNote[] {
  return outcomes.map((o) => ({
    label: o.plan.label,
    detail: o.error ? `${o.plan.detail} This search failed: ${o.error}` : o.plan.detail,
    records: o.result?.totalRecords ?? null,
  }));
}

/** The searches exactly as they happened, for a person to read. The API key is a header and is never part of this. */
function describeInspection(outcomes: PlanOutcome[]): SearchInspection[] {
  return outcomes.map((o) => ({
    planId: o.plan.id,
    label: o.plan.label,
    request: o.plan.body,
    response: o.result?.raw ?? null,
    ok: !o.error,
    error: o.error,
    cached: o.cached,
    elapsedMs: o.elapsedMs,
    returned: o.result?.candidates.length ?? 0,
    totalRecords: o.result?.totalRecords ?? null,
    skipped: o.result?.skipped ?? 0,
  }));
}

export async function discoverTurn(rawInput: unknown, deps: DiscoverDeps): Promise<DiscoverResult> {
  const parsed = DiscoverInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new DiscoveryError('The request is not valid.', 'VALIDATION_ERROR');
  const input = parsed.data;
  const messages = input.messages.map((m) => m.content);
  const includeHistorical = input.includeHistorical === true;
  const forced = input.forceResults === true;
  const inspect = input.inspect === true;
  const now = (deps.now ?? (() => new Date()))();
  const warnings: string[] = [];
  const emit = (event: ProgressEvent): void => {
    try {
      deps.onProgress?.(event);
    } catch {
      /* progress is a courtesy; it must never change the result */
    }
  };

  let profile: ProjectProfile;
  if (deps.llm) {
    emit({ id: 'read', status: 'running', message: 'Sending your description to the language model to pick out the project facts…' });
    const extracted = await extractProfile({ messages, llm: deps.llm });
    profile = extracted.profile;
    warnings.push(...extracted.warnings);
    emit(
      extracted.warnings.length > 0
        ? { id: 'read', status: 'done', message: 'The model could not read the description, so a simple keyword reader was used instead.' }
        : { id: 'read', status: 'done', message: 'The language model has read your description.' }
    );
  } else {
    emit({ id: 'read', status: 'running', message: 'Reading your description for project keywords…' });
    profile = keywordProfile(messages);
    warnings.push('No language model is configured, so a simple keyword reader was used. Results may be less precise.');
    emit({ id: 'read', status: 'done', message: 'Read your description with the keyword reader (no language model is configured).' });
  }

  const ready = hasProjectSignal(profile);
  const understood = describeProfile(profile);
  emit({
    id: 'understood',
    status: ready ? 'done' : 'failed',
    message: ready ? `Understood: ${understood ?? 'a transportation project'}` : 'I could not tell what kind of project this is.',
  });

  // The one required question: first message, nothing to search for, user has not asked for results.
  if (!ready && messages.length === 1 && !forced) {
    emit({ id: 'ask', status: 'done', message: 'I need one detail before I can search.' });
    return {
      preliminary: true,
      stage: 'ask',
      profile,
      questions: [ASK_PROJECT_TYPE],
      shortlist: [],
      searches: [],
      summary: 'I need to know what kind of project this is before I can look for matching opportunities.',
      warnings,
      includeHistorical,
      disclaimer: DISCOVERY_DISCLAIMER,
    };
  }

  const planOptions = { includeHistorical };
  emit({ id: 'plan', status: 'running', message: 'Building the search from your project…' });
  const plans: SearchPlan[] = primaryPlans(profile, planOptions);
  const hasWords = plans.some((p) => p.body.query);
  emit({
    id: 'plan',
    status: 'done',
    message: `Built ${plans.length} search${plans.length === 1 ? '' : 'es'}: ${plans.map((p) => p.label).join('; ')}`,
    detail: hasWords ? `Search words: ${profile.terms.join(', ')}` : 'No project words to search for, so only the broad pull will run.',
  });
  const hooks = searchHooks(emit);
  const outcomes = await runPlans(deps.source, plans, deps.cache, hooks, inspect);
  if (outcomes.every((o) => o.error)) {
    throw new DiscoveryError(outcomes[0].error ?? 'Search failed.', 'SEARCH_FAILED');
  }
  for (const o of outcomes) if (o.error) warnings.push(`One search failed and was skipped: ${o.error}`);
  const skipped = outcomes.reduce((n, o) => n + (o.result?.skipped ?? 0), 0);
  if (skipped > 0) warnings.push(`${skipped} listing${skipped === 1 ? '' : 's'} had an unexpected format and ${skipped === 1 ? 'was' : 'were'} left out.`);

  let all = [...outcomes];
  const uniqueCount = (): number => new Set(mergeCandidates(all).map((c) => c.opportunityId)).size;
  emit({ id: 'rank', status: 'running', message: `Scoring ${uniqueCount()} unique listings against your project (project words, applicant type, award size, timing)…` });
  let ranked = rankCandidates(mergeCandidates(all), { profile, now });

  // Widen beyond DOT only when too few listings matched the project's words.
  if (ready && likelyCount(ranked) < SHORTLIST_MIN) {
    const widening = wideningPlan(profile, planOptions);
    if (widening) {
      emit({ id: 'widen', status: 'running', message: `Only ${likelyCount(ranked)} listing${likelyCount(ranked) === 1 ? '' : 's'} matched your words, so I am widening the search beyond DOT…` });
      const extra = await runPlans(deps.source, [widening], deps.cache, hooks, inspect);
      emit({ id: 'widen', status: extra[0].error ? 'failed' : 'done', message: extra[0].error ? 'The wider search failed and was skipped.' : 'The wider search is finished.' });
      if (extra[0].error) warnings.push(`The wider search failed and was skipped: ${extra[0].error}`);
      all = [...all, ...extra];
      emit({ id: 'rank', status: 'running', message: `Scoring ${uniqueCount()} unique listings against your project…` });
      ranked = rankCandidates(mergeCandidates(all), { profile, now });
    }
  }

  const shortlist = selectShortlist(ranked);
  const examined = uniqueCount();
  const likely = shortlist.filter((s) => s.match === 'likely').length;
  emit({
    id: 'rank',
    status: 'done',
    message: shortlist.length > 0 ? `Scored ${examined} listings and chose ${shortlist.length} to show.` : `Scored ${examined} listings; none looked like a match.`,
  });

  let summary: string;
  if (shortlist.length === 0) {
    summary = includeHistorical
      ? `I checked ${examined} listings and none looked like a match for this project.`
      : `I checked ${examined} open listings and none looked like a match for this project. You can include closed and archived opportunities to see past programs.`;
  } else if (!ready) {
    summary = `I could not tell the project type from what you wrote, so these are the closest open transportation programs I found (${examined} listings checked). Tell me more about the project to narrow them.`;
  } else {
    const weaker = shortlist.length - likely;
    summary =
      `I checked ${examined} ${plural(examined, 'listing', 'listings')}. ` +
      `${likely} ${plural(likely, 'matches', 'match')} your project's words` +
      (weaker > 0 ? `; ${weaker} ${plural(weaker, 'is', 'are')} the closest other transportation ${plural(weaker, 'program', 'programs')}, marked as weaker matches.` : '.');
  }

  logger.info(`Discover: ${messages.length} message(s), ${all.length} search(es), ${examined} candidate(s), ${shortlist.length} listed`);

  return {
    preliminary: true,
    stage: 'results',
    profile,
    questions: refinementQuestions(profile, messages.length, forced),
    shortlist,
    searches: describeSearches(all),
    summary,
    warnings,
    includeHistorical,
    disclaimer: DISCOVERY_DISCLAIMER,
    ...(inspect ? { inspection: describeInspection(all) } : {}),
  };
}
