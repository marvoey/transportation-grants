/**
 * Pure helpers for the "Assess a project" panel (no DOM access, so they can be
 * unit-tested). Exposes window.NofoUtil. Nothing here builds HTML: callers
 * render every string with textContent.
 */
(function (root) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var FACT_LABELS = {
    applicantType: 'Applicant type',
    stateName: 'State',
    grantCategory: 'Grant category',
    areaType: 'Urban or rural',
    totalProjectCostUsd: 'Total project cost',
    requestedFederalUsd: 'Federal funds requested',
    otherFederalFundsUsd: 'Other federal funds',
    nonFederalMatchUsd: 'Non-federal match',
    matchCommitted: 'Match committed',
    bcaCompleted: 'Benefit-cost analysis done',
    projectDescription: 'Project description',
    activities: 'Activities',
    designStatus: 'Design status',
    environmentalStatus: 'Environmental review status'
  };

  var APPLICANT_LABELS = {
    state: 'State government',
    city: 'City',
    county: 'County',
    tribal: 'Tribal government',
    mpo: 'Metropolitan planning organization',
    transit_agency: 'Transit agency',
    other: 'Other'
  };

  function factLabel(key) {
    return Object.prototype.hasOwnProperty.call(FACT_LABELS, key) ? FACT_LABELS[key] : key;
  }

  function formatUsd(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function formatFactValue(key, value) {
    if (typeof value === 'number') return formatUsd(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    if (key === 'applicantType' && Object.prototype.hasOwnProperty.call(APPLICANT_LABELS, value)) return APPLICANT_LABELS[value];
    if (key === 'grantCategory' || key === 'areaType') return String(value).charAt(0).toUpperCase() + String(value).slice(1);
    return String(value);
  }

  /** Order facts are shown in. Unknown keys sort last. */
  var FACT_ORDER = Object.keys(FACT_LABELS);
  function orderedFactKeys(facts) {
    return Object.keys(facts || {}).sort(function (a, b) {
      var ia = FACT_ORDER.indexOf(a);
      var ib = FACT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  /** The label and badge style for a finding or advisory item. Gaps are NOT conflicts. */
  function statusInfo(item) {
    if (item.status === 'conflict' && item.gap) return { label: 'Preparation gap', badge: 'badge-warning', kind: 'gap' };
    if (item.status === 'conflict') return { label: 'Possible conflict', badge: 'badge-danger', kind: 'conflict' };
    if (item.status === 'needs_specialist_review') return { label: 'Needs specialist review', badge: 'badge-warning', kind: 'specialist' };
    if (item.status === 'supported') return { label: 'Appears supported', badge: 'badge-success', kind: 'supported' };
    return { label: 'Not yet evaluated', badge: 'badge-secondary', kind: 'unknown' };
  }

  var AUTHORITY_LABELS = {
    controlling: 'Notice (controlling)',
    official_guidance: 'Official guidance',
    metadata: 'Listing data',
    unclassified: 'Authority not classified'
  };
  function authorityLabel(authority) {
    return Object.prototype.hasOwnProperty.call(AUTHORITY_LABELS, authority) ? AUTHORITY_LABELS[authority] : 'Authority not classified';
  }

  /** "page 23" or "section s4", from a source reference. */
  function locationLabel(source) {
    if (source && typeof source.page === 'number') return 'page ' + source.page;
    if (source && source.section) return 'section ' + source.section;
    return 'location unknown';
  }

  /**
   * Keeps only letters and digits (NFKC, lower-cased) and remembers where each
   * kept character came from, so a quote can be found in a page regardless of
   * spacing, line breaks and punctuation. This mirrors how the server verifies
   * quotes, so a verified quote is found here too.
   */
  function alnumIndex(text) {
    var key = '';
    var starts = [];
    var ends = [];
    var i = 0;
    var chars = Array.from(String(text));
    for (var c = 0; c < chars.length; c++) {
      var original = chars[c];
      var normalized = original.normalize('NFKC').toLowerCase();
      var parts = Array.from(normalized);
      for (var p = 0; p < parts.length; p++) {
        if (/[\p{L}\p{N}]/u.test(parts[p])) {
          key += parts[p];
          starts.push(i);
          ends.push(i + original.length);
        }
      }
      i += original.length;
    }
    return { key: key, starts: starts, ends: ends };
  }

  /** Where the quote sits in the text: { start, end } character offsets, or null. */
  function findQuote(text, quote) {
    var q = alnumIndex(quote);
    if (q.key.length === 0) return null;
    var t = alnumIndex(text);
    var at = t.key.indexOf(q.key);
    if (at < 0) return null;
    return { start: t.starts[at], end: t.ends[at + q.key.length - 1] };
  }

  /** Splits text into before / match / after around a quote. match is '' when the quote is not found. */
  function splitAroundQuote(text, quote) {
    var found = findQuote(text, quote);
    if (!found) return { before: text, match: '', after: '' };
    return { before: text.slice(0, found.start), match: text.slice(found.start, found.end), after: text.slice(found.end) };
  }

  function truncate(text, max) {
    var s = String(text);
    return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
  }

  /** The conversation sent with a request: at most `max` newest messages, never starting with an assistant turn. */
  function windowMessages(messages, max) {
    var out = messages.slice(-max);
    while (out.length > 0 && out[0].role !== 'user') out.shift();
    return out;
  }

  function readParams(search) {
    var params = new URLSearchParams(search || '');
    var opportunity = params.get('opportunity');
    var mode = params.get('mode');
    return {
      // "find" (project description first) is the default; anything unrecognized falls back to it.
      mode: mode === 'nofo' ? mode : 'find',
      opportunity: opportunity && UUID.test(opportunity) ? opportunity.toLowerCase() : null
    };
  }

  /** The assistant's turn as it is kept in the conversation: what the applicant was asked, so a short answer keeps its context. */
  function assistantTurnText(headline, questions) {
    var lines = [headline];
    (questions || []).forEach(function (q) { lines.push('Question: ' + q.text); });
    return truncate(lines.join('\n'), 3900);
  }

  var api = {
    isUuid: function (v) { return UUID.test(String(v)); },
    factLabel: factLabel,
    formatFactValue: formatFactValue,
    orderedFactKeys: orderedFactKeys,
    statusInfo: statusInfo,
    authorityLabel: authorityLabel,
    locationLabel: locationLabel,
    findQuote: findQuote,
    splitAroundQuote: splitAroundQuote,
    truncate: truncate,
    windowMessages: windowMessages,
    readParams: readParams,
    assistantTurnText: assistantTurnText
  };
  root.NofoUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
