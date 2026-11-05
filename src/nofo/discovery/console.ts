import type { SearchPlan } from './filters.js';
import type { PlanOutcome } from './search.js';
import type { ConsoleFn } from '../progress.js';
import type { ProjectProfile } from './schemas.js';
import { money } from './rank.js';
import type { ApiCall } from './schemas.js';

/**
 * The developer console: plain, ordered lines that show how a Simpler.Grants.gov search is built from the project
 * profile, what is sent, and what came back. Everything here is derived from the search plan (already built from
 * verified, sanitized terms) and the parsed response. The API key is a header added by the HTTP client and is never
 * available here; the header line below is a fixed placeholder. No applicant text and no raw response is written.
 */

export const SEARCH_PATH = '/v1/opportunities/search';

const json = (value: unknown): string => JSON.stringify(value);

/** What each part of a request means, in the words used on screen. */
const FILTER_NOTES: Record<string, string> = {
  top_level_agency: 'hard filter: the agency field is reliable',
  opportunity_status: 'hard filter: open, or closed when history is included',
  funding_category: 'hard filter, only when widening beyond DOT',
};

export function profileLines(profile: ProjectProfile, emit: ConsoleFn): void {
  emit({ kind: 'note', text: '# project profile so far (each value is backed by a quote from what you wrote)' });
  const row = (name: string, value: string | undefined): void =>
    emit({ kind: 'add', text: `${name.padEnd(24)} = ${value ?? '(not stated yet)'}` });
  row('profile.projectTypes', profile.projectTypes.length ? json(profile.projectTypes.map((t) => t.value)) : undefined);
  row('profile.applicantType', profile.applicantType ? json(profile.applicantType.value) : undefined);
  row('profile.phase', profile.phase ? json(profile.phase.value) : undefined);
  row('profile.federalAsk', profile.federalAskUsd ? money(profile.federalAskUsd.value) : undefined);
  if (profile.totalCostUsd) row('profile.totalCost', money(profile.totalCostUsd.value));
  row('profile.searchWords', profile.terms.length ? json(profile.terms) : undefined);
}

/** The request being assembled, one field per line, each with the reason it is there. */
export function buildLines(plan: SearchPlan, emit: ConsoleFn, draft: boolean): void {
  const body = plan.body;
  emit({ kind: 'cmd', text: `$ build search "${plan.id}"${draft ? '   # draft only, not sent' : ''}` });
  emit({ kind: 'note', text: `# ${plan.label}` });
  const filters = body.filters ?? {};
  for (const [name, value] of Object.entries(filters)) {
    emit({ kind: 'add', text: `+ filters.${name} = ${json(value)}   # ${FILTER_NOTES[name] ?? 'filter'}` });
  }
  if (body.query !== undefined) {
    emit({ kind: 'add', text: `+ query = ${json(body.query)}   # your project words (100 characters at most)` });
    emit({ kind: 'add', text: `+ query_operator = ${json(body.query_operator ?? 'OR')}   # a listing matching any word counts` });
  } else {
    emit({ kind: 'note', text: '# no query: this is a broad pull of every listing that passes the filters' });
  }
  const sort = body.pagination.sort_order[0];
  emit({
    kind: 'add',
    text: `+ pagination = page ${body.pagination.page_offset}, ${body.pagination.page_size} per page, ordered by ${sort?.order_by ?? 'default'} ${sort?.sort_direction ?? ''}`.trimEnd(),
  });
  emit({ kind: 'note', text: '# not filtered, only scored afterwards: applicant type, award size, cost sharing (the listings often leave them blank)' });
}

/** The exact request that goes out. The key is never part of this: the HTTP client adds it. */
export function requestLines(plan: SearchPlan, baseUrl: string, emit: ConsoleFn): void {
  emit({ kind: 'http', text: `→ [${plan.id}] POST ${baseUrl.replace(/\/+$/, '')}${SEARCH_PATH}` });
  emit({ kind: 'note', text: '  X-API-Key: ••••••••   (added by the server, never shown)' });
  emit({ kind: 'note', text: '  Content-Type: application/json' });
  emit({ kind: 'json', text: JSON.stringify(plan.body, null, 2) });
}

const SHOWN_TITLES = 3;

export function responseLines(outcome: PlanOutcome, emit: ConsoleFn): void {
  const id = outcome.plan.id;
  if (outcome.error) {
    emit({ kind: 'error', text: `← [${id}] failed after ${outcome.elapsedMs} ms: ${outcome.error}` });
    return;
  }
  const result = outcome.result;
  const returned = result?.candidates.length ?? 0;
  const total = result?.totalRecords ?? null;
  if (outcome.cached) {
    emit({ kind: 'ok', text: `← [${id}] no request sent: reused an identical search from the last few minutes` });
  } else {
    emit({ kind: 'ok', text: `← [${id}] 200 OK in ${outcome.elapsedMs} ms` });
  }
  emit({
    kind: 'note',
    text: `  total_records: ${total ?? 'unknown'} · returned: ${returned}${result && result.skipped > 0 ? ` · skipped (unexpected format): ${result.skipped}` : ''}`,
  });
  (result?.candidates ?? []).slice(0, SHOWN_TITLES).forEach((c, i) => {
    emit({ kind: 'note', text: `  ${i + 1}. ${c.title ?? '(untitled)'}  [${c.status}]` });
  });
  if (returned > SHOWN_TITLES) emit({ kind: 'note', text: `  … and ${returned - SHOWN_TITLES} more` });
}

/** A POSTable shell command for the same request. The key is a placeholder to be filled in from the reader's own environment. */
export function curlCommand(plan: SearchPlan, baseUrl: string): string {
  const body = JSON.stringify(plan.body).replace(/'/g, "'\\''");
  return [
    `curl -X POST '${baseUrl.replace(/\/+$/, '')}${SEARCH_PATH}'`,
    "  -H 'Content-Type: application/json'",
    "  -H \"X-API-Key: $SIMPLER_GRANTS_API_KEY\"",
    `  -d '${body}'`,
  ].join(' \\\n');
}

/** The call exactly as made, for the results screen. The key is never part of it. */
export function describeApiCall(outcome: PlanOutcome, baseUrl: string): ApiCall {
  return {
    planId: outcome.plan.id,
    label: outcome.plan.label,
    method: 'POST',
    url: `${baseUrl.replace(/\/+$/, '')}${SEARCH_PATH}`,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': '(your key, never shown)' },
    body: outcome.plan.body,
    curl: curlCommand(outcome.plan, baseUrl),
    sent: !outcome.cached && !outcome.error,
    cached: outcome.cached,
    ok: !outcome.error,
    error: outcome.error,
    returned: outcome.result?.candidates.length ?? 0,
    totalRecords: outcome.result?.totalRecords ?? null,
  };
}
