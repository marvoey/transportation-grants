import { logger } from '../../config/config.js';
import { safeConsole, type ConsoleFn } from '../progress.js';
import { buildLines, describeApiCall, profileLines, requestLines, responseLines } from './console.js';
import { cannotPrepare, checkDocuments, documentsLast, type AttachmentListSource, type DocumentsCache } from './documents.js';
import { explainSearch } from './explain.js';
import type { LlmFn } from '../llm.js';
import type { OpportunitySearchSource } from '../simpler/source.js';
import { primaryPlans, wideningPlan, type SearchPlan } from './filters.js';
import { codeOnlyTerms, extractProfile, hasProjectSignal, keywordProfile, type TermTrace } from './profile.js';
import { buildTrace } from './trace.js';
import { writeFindReply } from './reply.js';
import { describeScored, likelyCount, money, rankCandidates, RESULTS_SHOWN_FIRST, selectResults, SHORTLIST_MIN } from './rank.js';
import {
  DISCOVERY_DISCLAIMER,
  DiscoverInputSchema,
  MAX_USER_MESSAGES,
  PROJECT_TYPE_LABELS,
  type GuidedQuestion,
  type GuidedQuestionId,
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
  /**
   * Called with each line of the developer console: the search being built, the request that goes out and a summary
   * of the response. A callback that throws never affects the result.
   */
  onConsole?: ConsoleFn;
  /** Shown in the console as the address the request goes to. */
  apiBaseUrl?: string;
  /**
   * When given, the shortlisted opportunities are checked for listed documents (the attachment list only; nothing is
   * downloaded). Without it the check is skipped and the cards say nothing about documents.
   */
  documents?: AttachmentListSource;
  documentsCache?: DocumentsCache;
}

const DEFAULT_API_BASE_URL = 'https://api.simpler.grants.gov';

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
 * Question policy. The user wants to be guided until the questions are answered, but never trapped:
 * - Before searching, up to GUIDED_BATCH questions are asked about what is still missing from the profile (project
 *   type first, then applicant and the federal request). Each is a fixed template, and no search is made until the
 *   user answers or chooses to search now. A question is asked only if its answer changes the search or the ranking:
 *   the project stage does not (it is shown but never filters or scores), and it only fits construction projects, so it
 *   is read when the applicant says it but never asked for.
 * - A question that is still unanswered is asked again on the next message, so up to three questions take at most two
 *   rounds when each is answered. There is no round limit; the ends are the visible "Search now" button and the message
 *   limit (MAX_USER_MESSAGES): at the last message a list is always returned.
 * - `asked` holds the ids the applicant has been shown and chose to skip. The page sends none by default, so a question
 *   repeats until it is answered; a caller can send ids to stop asking about them.
 * - "Search now" skips every question. If the project type is still unknown the list is the closest open programs, and
 *   the summary says so.
 */
export const GUIDED_BATCH = 2;

const QUESTION_TEXT: Record<GuidedQuestionId, string> = {
  projectType:
    'What kind of transportation project is this? For example, a bridge replacement, a trail or sidewalk, a bus or transit project, a rail crossing, or a wildlife crossing.',
  applicant: 'Who is the applicant: a state, county, city, tribe, transit agency or another public body?',
  phase: 'Is the project at the planning, design, or construction-ready stage?',
  request: 'Roughly how much federal funding would you request? (This helps match award sizes.)',
};

/** Questions whose answer is still missing from the profile and that have not been asked yet, in asking order. */
export function pendingQuestions(profile: ProjectProfile, asked: readonly GuidedQuestionId[] = []): GuidedQuestion[] {
  const missing: GuidedQuestionId[] = [];
  if (!hasProjectSignal(profile)) missing.push('projectType');
  if (!profile.applicantType) missing.push('applicant');
  if (!profile.federalAskUsd) missing.push('request');
  return missing.filter((id) => !asked.includes(id)).map((id) => ({ id, text: QUESTION_TEXT[id] }));
}

/** The questions to ask before searching, or none when the search should go ahead. */
export function guidedQuestions(profile: ProjectProfile, messageCount: number, forced: boolean, asked: readonly GuidedQuestionId[] = []): GuidedQuestion[] {
  // At the message limit the applicant cannot answer another question, so a list is always returned.
  if (forced || messageCount >= MAX_USER_MESSAGES) return [];
  return pendingQuestions(profile, asked).slice(0, GUIDED_BATCH);
}

/** Optional refinements shown with a list, only when the user skipped the questions with "Search now". */
export function refinementQuestions(profile: ProjectProfile, messageCount: number, forced: boolean, asked: readonly GuidedQuestionId[] = []): GuidedQuestion[] {
  if (!forced || messageCount >= MAX_USER_MESSAGES) return [];
  return pendingQuestions(profile, asked).slice(0, GUIDED_BATCH);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Turns the search runner's hooks into progress events, one line per search. */
function searchHooks(emit: (event: ProgressEvent) => void, log: ConsoleFn, baseUrl: string): PlanHooks {
  const id = (plan: SearchPlan): string => `search:${plan.id}`;
  return {
    onStart: (plan) => {
      requestLines(plan, baseUrl, log);
      emit({
        id: id(plan),
        status: 'running',
        message: `Sending a request to Simpler.Grants.gov: ${plan.label}`,
        detail: plan.body.query ? `Search words: ${plan.body.query}` : undefined,
      });
    },
    onDone: (o) => {
      responseLines(o, log);
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
  const asked = input.asked ?? [];
  const now = (deps.now ?? (() => new Date()))();
  const warnings: string[] = [];
  const emit = (event: ProgressEvent): void => {
    try {
      deps.onProgress?.(event);
    } catch {
      /* progress is a courtesy; it must never change the result */
    }
  };

  const log = safeConsole(deps.onConsole);
  const baseUrl = deps.apiBaseUrl ?? DEFAULT_API_BASE_URL;

  let profile: ProjectProfile;
  let reader: 'model' | 'keyword_fallback' | 'keyword' = 'keyword';
  let rejected: string[] = [];
  let termTrace: TermTrace;
  if (deps.llm) {
    emit({ id: 'read', status: 'running', message: 'Sending your description to the language model to pick out the project facts…' });
    const extracted = await extractProfile({ messages, llm: deps.llm });
    profile = extracted.profile;
    rejected = extracted.rejected;
    termTrace = extracted.terms;
    reader = extracted.warnings.length > 0 ? 'keyword_fallback' : 'model';
    warnings.push(...extracted.warnings);
    emit(
      extracted.warnings.length > 0
        ? { id: 'read', status: 'done', message: 'The model could not read the description, so a simple keyword reader was used instead.' }
        : { id: 'read', status: 'done', message: 'The language model has read your description.' }
    );
  } else {
    emit({ id: 'read', status: 'running', message: 'Reading your description for project keywords…' });
    profile = keywordProfile(messages);
    termTrace = codeOnlyTerms(profile);
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

  profileLines(profile, log);

  // Guided questions: hold the search back while there is something worth asking (and the user has not skipped it).
  const guided = guidedQuestions(profile, messages.length, forced, asked);
  if (guided.length > 0) {
    const draft = primaryPlans(profile, { includeHistorical }).find((p) => p.id === 'keywords');
    if (draft) buildLines(draft, log, true);
    else log({ kind: 'note', text: '# no project words yet, so there is no keyword search to draft' });
    log({ kind: 'note', text: `# waiting for your answers (${guided.length} question${guided.length === 1 ? '' : 's'}); nothing has been sent to Simpler.Grants.gov` });
    emit({ id: 'ask', status: 'done', message: guided.length === 1 ? 'I have one question before I search.' : `I have ${guided.length} questions before I search.` });
    return {
      preliminary: true,
      stage: 'ask',
      profile,
      questions: guided,
      shortlist: [],
      searches: [],
      summary: guided.some((q) => q.id === 'projectType')
        ? 'I need to know what kind of project this is before I can look for matching opportunities.'
        : messages.length > 1
          ? 'Thanks. I still need a little more to rank the list well. Answer what you can, or choose "Search now" to see the list with what I have.'
          : 'A few details will make the list much more relevant. Answer what you can, or search now with what I have.',
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
  for (const plan of plans) buildLines(plan, log, false);
  const hooks = searchHooks(emit, log, baseUrl);
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
  let widenedAfterLikely: number | null = null;
  if (ready && likelyCount(ranked) < SHORTLIST_MIN) {
    const widening = wideningPlan(profile, planOptions);
    if (widening) {
      widenedAfterLikely = likelyCount(ranked);
      buildLines(widening, log, false);
      emit({ id: 'widen', status: 'running', message: `Only ${likelyCount(ranked)} listing${likelyCount(ranked) === 1 ? '' : 's'} matched your words, so I am widening the search beyond DOT…` });
      const extra = await runPlans(deps.source, [widening], deps.cache, hooks, inspect);
      emit({ id: 'widen', status: extra[0].error ? 'failed' : 'done', message: extra[0].error ? 'The wider search failed and was skipped.' : 'The wider search is finished.' });
      if (extra[0].error) warnings.push(`The wider search failed and was skipped: ${extra[0].error}`);
      all = [...all, ...extra];
      emit({ id: 'rank', status: 'running', message: `Scoring ${uniqueCount()} unique listings against your project…` });
      ranked = rankCandidates(mergeCandidates(all), { profile, now });
    }
  }

  // Every scored listing, best fit first (up to a cap). The order is adjusted below once documents are known.
  let shortlist = selectResults(ranked);
  const examined = uniqueCount();
  log({ kind: 'cmd', text: `$ rank ${examined} unique listings   # project words, applicant type, award size, timing` });
  shortlist.forEach((item, i) => log({ kind: 'note', text: `  ${i + 1}. ${item.title}  [${item.match}${item.historical ? ', historical' : ''}]` }));
  if (shortlist.length === 0) log({ kind: 'note', text: '  (no listings to show)' });
  const likely = shortlist.filter((s) => s.match === 'likely').length;
  emit({
    id: 'rank',
    status: 'done',
    message: shortlist.length === 0 ? `Scored ${examined} listings; none to show.` : `Scored ${examined} ${plural(examined, 'listing', 'listings')}${shortlist.length < examined ? `; showing the best ${shortlist.length}` : ''}.`,
  });

  // Which listings have documents to read. Code only: it reads attachment lists and downloads nothing. Listings that list
  // none go last, so the ones that can be prepared and assessed come first.
  let noDocuments = 0;
  if (deps.documents && shortlist.length > 0) {
    const ids = shortlist.map((s) => s.opportunityId);
    emit({ id: 'documents', status: 'running', message: `Checking which of the ${ids.length} ${plural(ids.length, 'listing has', 'listings have')} documents on Simpler.Grants.gov…` });
    log({ kind: 'cmd', text: `$ GET /v1/opportunities/<id>  x${ids.length}   # which documents each opportunity lists (names and sizes only; nothing is downloaded)` });
    const checked = await checkDocuments(deps.documents, ids, deps.documentsCache);
    let withNotice = 0;
    let none = 0;
    let noNotice = 0;
    let unknown = 0;
    for (const item of shortlist) {
      const info = checked.byId.get(item.opportunityId);
      if (!info) continue;
      item.documents = info;
      if (info.status === 'unknown') unknown += 1;
      else if (!cannotPrepare(info)) withNotice += 1;
      else if (info.status === 'none') none += 1;
      else noNotice += 1;
    }
    noDocuments = none + noNotice;
    shortlist = documentsLast(shortlist);
    if (unknown > 0) warnings.push(`Could not check which documents are listed for ${unknown} ${plural(unknown, 'opportunity', 'opportunities')}.`);
    emit({
      id: 'documents',
      status: 'done',
      message: `${withNotice} of ${ids.length} ${plural(ids.length, 'listing lists', 'listings list')} a notice document${noDocuments > 0 ? `; ${noDocuments} ${plural(noDocuments, 'does not', 'do not')} and ${plural(noDocuments, 'goes', 'go')} last` : ''}${unknown > 0 ? `; ${unknown} could not be checked` : ''}.`,
    });
    log({ kind: unknown > 0 ? 'warn' : 'ok', text: `← documents: ${withNotice} with a notice document, ${none} none listed, ${noNotice} listed but none looks like the notice, ${unknown} unknown${checked.cached > 0 ? ` (${checked.cached} reused from a recent check)` : ''}` });
  }

  // The plain-language explanation: the model describes the search from the description, the requests and the outcome.
  emit({ id: 'explain', status: 'running', message: deps.llm ? 'Asking the language model to explain the search in plain language…' : 'Writing a plain-language explanation of the search…' });
  log({ kind: 'cmd', text: deps.llm ? '$ explain search   # the language model writes this from your description, the requests above and the outcome' : '$ explain search   # no language model configured: a template is used' });
  const explanation = await explainSearch(
    {
      messages,
      profile,
      plans: all.map((o) => o.plan),
      examined,
      shownTitles: shortlist.map((s) => s.title),
      includeHistorical,
      widened: all.some((o) => o.plan.id === 'beyond_dot'),
    },
    deps.llm
  );
  emit({
    id: 'explain',
    status: 'done',
    message: explanation.source === 'model' ? 'The language model wrote the explanation.' : 'The explanation was written from a template (the language model was not used or its text did not pass the checks).',
  });
  log({ kind: 'ok', text: `← explanation ready (written by ${explanation.source === 'model' ? 'the language model' : 'a template'})` });

  // The conversational reply: the model writes it from the understood project, the first listings and the open question.
  emit({ id: 'reply', status: 'running', message: deps.llm ? 'Asking the language model to write a reply about the list…' : 'Writing a reply about the list…' });
  const questionsOpen = refinementQuestions(profile, messages.length, forced, asked);
  const reply = await writeFindReply(
    {
      messages,
      profile,
      shown: shortlist.slice(0, RESULTS_SHOWN_FIRST),
      examined,
      listed: shortlist.length,
      questions: questionsOpen,
      latestMessage: messages[messages.length - 1],
      previousReply: input.previousReply,
      isFollowUp: messages.length > 1,
    },
    deps.llm
  );
  emit({
    id: 'reply',
    status: 'done',
    message: reply.source === 'model' ? 'The language model wrote the reply and it passed the checks.' : 'The reply was written from a template (the language model was not used or its text did not pass the checks).',
  });
  log({ kind: 'ok', text: `← reply ready (written by ${reply.source === 'model' ? 'the language model' : `a template; model text not used: ${reply.fallbackReason ?? 'unknown'}`})` });

  let summary: string;
  const docsNote = noDocuments > 0 ? ` ${noDocuments} ${plural(noDocuments, 'has', 'have')} no notice document listed on Simpler.Grants.gov, so ${plural(noDocuments, 'it is', 'they are')} last.` : '';
  if (shortlist.length === 0) {
    summary = includeHistorical
      ? 'I found no listings for this search.'
      : 'I found no open listings for this search. Try describing the project in more detail, for example the kind of project and who is applying.';
  } else if (!ready) {
    summary = `I could not tell the project type from what you wrote, so these ${examined} listings are ordered by general fit only. Tell me more about the project to rank them for it.${docsNote}`;
  } else {
    const showing = shortlist.length < examined ? `the best ${shortlist.length}` : examined === 1 ? 'it' : 'all of them';
    const rest = shortlist.length - RESULTS_SHOWN_FIRST;
    const lead =
      rest > 0
        ? `I checked ${examined} ${plural(examined, 'listing', 'listings')}, best fit to your project first. The best ${RESULTS_SHOWN_FIRST} are shown below; the other ${rest} ${plural(rest, 'is', 'are')} one click away. `
        : `I checked ${examined} ${plural(examined, 'listing', 'listings')} and am showing ${showing}, best fit to your project first. `;
    summary = `${lead}${likely} ${plural(likely, 'matches', 'match')} your project's words; the rest are marked as weaker matches.${docsNote}`;
  }

  logger.info(`Discover: ${messages.length} message(s), ${all.length} search(es), ${examined} candidate(s), ${shortlist.length} listed`);

  return {
    preliminary: true,
    stage: 'results',
    profile,
    questions: refinementQuestions(profile, messages.length, forced, asked),
    shortlist,
    showFirst: RESULTS_SHOWN_FIRST,
    searches: describeSearches(all),
    summary,
    warnings,
    includeHistorical,
    disclaimer: DISCOVERY_DISCLAIMER,
    trace: buildTrace({
      reader,
      messageCount: messages.length,
      profile,
      rejected,
      terms: termTrace,
      plans: all.map((o) => o.plan),
      includeHistorical,
      widenedAfterLikely,
      minimumLikely: SHORTLIST_MIN,
    }),
    scored: describeScored(ranked, new Set(shortlist.map((s) => s.opportunityId))),
    apiCalls: all.map((o) => describeApiCall(o, baseUrl)),
    explanation,
    reply,
    ...(inspect ? { inspection: describeInspection(all) } : {}),
  };
}
