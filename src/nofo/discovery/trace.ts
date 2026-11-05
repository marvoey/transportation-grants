import type { TermTrace } from './profile.js';
import type { SearchPlan } from './filters.js';
import { PROJECT_TYPE_LABELS, type BuildTrace, type ParameterSource, type ProjectProfile, type TraceStep } from './schemas.js';
import { money } from './rank.js';

/**
 * A plain account of how THIS search's API parameters were built from what the applicant said: who did each part (the
 * applicant, the language model, or code), and where every parameter value came from. It is written here, in code, from
 * the verified profile and the plans that ran, so it describes what actually happened and cannot drift from it. The
 * language model writes none of it. The only words of the applicant's that appear are the verbatim quotes that already
 * back each fact on the results screen.
 */

export interface TraceInput {
  /** How the profile was read. */
  reader: 'model' | 'keyword_fallback' | 'keyword';
  messageCount: number;
  profile: ProjectProfile;
  /** What the model proposed and code threw out, in code's own words (never the applicant's). */
  rejected: string[];
  terms: TermTrace;
  /** Every search that ran. */
  plans: SearchPlan[];
  includeHistorical: boolean;
  /** Set when a wider, beyond-DOT search ran: how many likely matches there were before it. */
  widenedAfterLikely: number | null;
  minimumLikely: number;
}

const list = (words: string[]): string => words.map((w) => `“${w}”`).join(', ');
const json = (value: unknown): string => JSON.stringify(value);

function factItems(profile: ProjectProfile): string[] {
  const items: string[] = [];
  for (const t of profile.projectTypes) items.push(`Project type: ${PROJECT_TYPE_LABELS[t.value]} — your words: “${t.quote}”`);
  if (profile.applicantType) items.push(`Applicant type: ${profile.applicantType.value.replace(/_/g, ' ')} — your words: “${profile.applicantType.quote}”`);
  if (profile.phase) items.push(`Stage: ${profile.phase.value.replace(/_/g, ' ')} — your words: “${profile.phase.quote}”`);
  if (profile.federalAskUsd) items.push(`Federal request: ${money(profile.federalAskUsd.value)} — your words: “${profile.federalAskUsd.quote}”`);
  if (profile.totalCostUsd) items.push(`Total project cost: ${money(profile.totalCostUsd.value)} — your words: “${profile.totalCostUsd.quote}”`);
  if (profile.stateName) items.push(`State: ${profile.stateName.value} — your words: “${profile.stateName.quote}”`);
  return items;
}

export function buildTrace(input: TraceInput): BuildTrace {
  const { profile, terms, plans } = input;
  const keyword = plans.find((p) => p.body.query);
  const steps: TraceStep[] = [];

  steps.push({
    actor: 'you',
    title: 'You described the project',
    detail: `You sent ${input.messageCount} message${input.messageCount === 1 ? '' : 's'} (your description and any answers to the questions). Everything below starts from those words and from the two checkboxes you can tick.`,
  });

  if (input.reader === 'model') {
    steps.push({
      actor: 'model',
      title: 'The language model read your words and proposed a profile',
      detail:
        'It proposed the project type or types, the applicant type, the stage, the amounts and up to four search words, and had to copy a quote from your own words for each one. It does not choose the filters, the address, the parameter names or any value in the request.',
    });
  } else {
    steps.push({
      actor: 'code',
      title: 'Code read your words with a keyword reader',
      detail:
        input.reader === 'keyword_fallback'
          ? 'The language model could not read the description, so code matched project words in your text (bridge, trail, bus and so on) instead. It finds the project type and nothing else, so the amounts, applicant and stage were not read.'
          : 'No language model is configured on this server, so code matched project words in your text (bridge, trail, bus and so on). It finds the project type and nothing else, so the amounts, applicant and stage were not read.',
    });
  }

  const checked = factItems(profile);
  steps.push({
    actor: 'code',
    title: input.reader === 'model' ? 'Code checked every proposal against your own words' : 'Code recorded what it found',
    detail:
      input.reader === 'model'
        ? 'A fact is kept only if its quote really appears in what you wrote; a dollar amount is kept only if it appears in its quote, and your request and the total cost are never swapped. Anything that fails is discarded, never shown as a fact.'
        : 'Each project type is kept with the words that matched.',
    items: [...checked, ...(checked.length === 0 ? ['Nothing in your words could be verified as a project fact.'] : []), ...input.rejected.map((r) => `Discarded: ${r}`)],
  });

  const termItems: string[] = [];
  if (terms.proposed.length) termItems.push(`The model proposed: ${list(terms.proposed)}`);
  if (terms.kept.length) termItems.push(`Kept, because they are in your words: ${list(terms.kept)}`);
  if (terms.dropped.length) termItems.push(`Dropped, because they are not in your words: ${list(terms.dropped)}`);
  if (terms.addedByCode.length) termItems.push(`Added by code from its word list for the project type${profile.projectTypes.length ? ` (${profile.projectTypes.map((t) => PROJECT_TYPE_LABELS[t.value].toLowerCase()).join(', ')})` : ''}: ${list(terms.addedByCode)}`);
  if (termItems.length === 0) termItems.push('There were no project words to search for.');
  steps.push({
    actor: 'code',
    title: 'Code decided the search words',
    detail:
      'A search word is only used if it appears in your words or comes from code\'s own list for the project type (for example “infrastructure” for a bridge, because large general programs describe themselves that way and rarely name the bridge). Words are lower-cased, stripped of punctuation and search operators, and limited to six, so nothing you type can change how the search behaves.',
    items: termItems,
  });

  if (keyword?.body.query) {
    const left = profile.terms.filter((t) => !keyword.body.query!.includes(t));
    steps.push({
      actor: 'code',
      title: 'Code built the query string',
      detail:
        'Phrases of several words are put in quotes, the words are joined with spaces, and the operator is OR, so a listing matches if it contains any of them. The API refuses a query longer than 100 characters, so code stops adding words before that.',
      items: [`query = ${json(keyword.body.query)}`, 'query_operator = "OR"', ...(left.length ? [`Left out to stay under 100 characters: ${list(left)}`] : [])],
    });
  } else {
    steps.push({
      actor: 'code',
      title: 'Code found no query to build',
      detail: 'With no project words there is nothing to put in a keyword query, so only the broad pull of every listing that passes the filters was sent.',
    });
  }

  steps.push({
    actor: 'code',
    title: 'Code applied fixed rules for the filters',
    detail: 'These do not depend on the model or on how you worded things.',
    items: [
      'Agency = DOT (U.S. Department of Transportation): the agency field is reliable in the data, and this keeps the search to transportation programs.',
      input.includeHistorical
        ? 'Status = open (posted, forecasted) for the open searches, and closed or archived for the historical one, because you ticked “include closed and archived”.'
        : 'Status = posted or forecasted: only listings that are open or about to open.',
      'Never filtered: applicant type, award size, cost sharing and funding category (except when widening). Many listings leave these blank or list “other”, so filtering on them would drop the right grant. They only affect the order, when the results are scored.',
    ],
  });

  const searchItems = plans.map((p) => `${p.id}: ${p.label}`);
  steps.push({
    actor: 'code',
    title: 'Code chose which searches to run',
    detail:
      input.widenedAfterLikely !== null
        ? `Only ${input.widenedAfterLikely} listing${input.widenedAfterLikely === 1 ? '' : 's'} matched your words (fewer than ${input.minimumLikely}), so code added a wider search across transportation-tagged programs from any agency.`
        : `Every open DOT listing is always pulled, because only about a dozen are open at once and a keyword search can miss broad programs. A keyword search runs next to it. Enough listings matched your words, so no wider search was needed.`,
    items: searchItems,
  });

  steps.push({
    actor: 'code',
    title: 'Code sent the requests and scored the answers',
    detail:
      'The server adds the API key itself; the language model never sees the key or the responses. Each listing returned is scored by points for your words, applicant type, timing and award size, and the best are shown. After that, the model is used twice more, and neither use changes a parameter: to write the plain-language explanation of the search, and, if you choose to assess a grant, to draft the project description.',
  });

  // Where every parameter came from.
  const parameters: ParameterSource[] = [];
  for (const plan of plans) {
    const call = plan.id;
    const f = plan.body.filters ?? {};
    const hist = input.includeHistorical && plan.id === 'historical_recent';
    if (f.top_level_agency) parameters.push({ call, parameter: 'filters.top_level_agency', value: json(f.top_level_agency), origin: 'rule', why: 'Fixed rule: DOT only.' });
    if (f.opportunity_status) {
      parameters.push({
        call,
        parameter: 'filters.opportunity_status',
        value: json(f.opportunity_status),
        origin: input.includeHistorical && (hist || plan.id === 'keywords' || plan.id === 'beyond_dot') && JSON.stringify(f.opportunity_status).includes('closed') ? 'choice' : 'rule',
        why: JSON.stringify(f.opportunity_status).includes('closed') ? 'Includes closed and archived because you ticked the box.' : 'Fixed rule: open listings only.',
      });
    }
    if (f.funding_category) parameters.push({ call, parameter: 'filters.funding_category', value: json(f.funding_category), origin: 'rule', why: 'Fixed rule, used only to widen beyond DOT: transportation and infrastructure programs.' });
    if (plan.body.query !== undefined) {
      parameters.push({ call, parameter: 'query', value: json(plan.body.query), origin: 'words', why: 'Your words: proposed by the model, kept only if found in what you wrote (plus code\'s own words for the project type), then joined by code.' });
      parameters.push({ call, parameter: 'query_operator', value: json(plan.body.query_operator ?? 'OR'), origin: 'rule', why: 'Fixed rule: a listing counts if it matches any word.' });
    }
    parameters.push({ call, parameter: 'pagination.page_size', value: String(plan.body.pagination.page_size), origin: 'rule', why: 'Fixed rule: how many listings to ask for, set per kind of search.' });
    parameters.push({ call, parameter: 'pagination.sort_order', value: json(plan.body.pagination.sort_order), origin: 'rule', why: 'Fixed rule: soonest deadline first for the broad pull, best text match first for keyword searches.' });
  }
  return { steps, parameters };
}
