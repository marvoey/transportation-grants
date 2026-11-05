/**
 * Pure helpers for the "Find grants" panel (no DOM access, so they can be unit-tested).
 * Exposes window.DiscoverUtil. Nothing here builds HTML: callers render every string with textContent.
 */
(function (root) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Must match MAX_USER_MESSAGES on the server. */
  var MAX_MESSAGES = 6;
  var MAX_MESSAGE_CHARS = 4000;

  var PROJECT_TYPE_LABELS = {
    bridge: 'Bridge',
    roadway: 'Roadway / highway',
    safety: 'Safety',
    bike_ped: 'Bicycle / pedestrian',
    transit: 'Transit',
    rail: 'Rail',
    freight_port: 'Freight / port',
    aviation: 'Aviation',
    wildlife_connectivity: 'Wildlife crossing / connectivity',
    resilience: 'Resilience / disaster',
    planning: 'Planning',
    technology: 'Technology / ITS',
    other: 'Other'
  };

  var APPLICANT_LABELS = {
    state: 'State government',
    county: 'County government',
    city_or_township: 'City or township government',
    special_district: 'Special district (for example a transit or port authority)',
    tribal: 'Tribal government',
    mpo: 'Metropolitan planning organization',
    other: 'Other'
  };

  var PHASE_LABELS = {
    planning: 'Planning',
    design: 'Design',
    construction_ready: 'Ready for construction'
  };

  /** "$25 million", "$1.5 billion", "$450,000". */
  function formatMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    if (n >= 1e9) return '$' + +(n / 1e9).toFixed(2) + ' billion';
    if (n >= 1e6) return '$' + +(n / 1e6).toFixed(1) + ' million';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  /** The facts the server understood, each with the applicant's own words, in a fixed order. */
  function profileFacts(profile) {
    var out = [];
    if (!profile) return out;
    (profile.projectTypes || []).forEach(function (t) {
      out.push({ label: 'Project type', value: PROJECT_TYPE_LABELS[t.value] || String(t.value), quote: t.quote });
    });
    if (profile.applicantType) out.push({ label: 'Applicant', value: APPLICANT_LABELS[profile.applicantType.value] || String(profile.applicantType.value), quote: profile.applicantType.quote });
    if (profile.phase) out.push({ label: 'Project stage', value: PHASE_LABELS[profile.phase.value] || String(profile.phase.value), quote: profile.phase.quote });
    if (profile.federalAskUsd) out.push({ label: 'Federal funds you would request', value: formatMoney(profile.federalAskUsd.value), quote: profile.federalAskUsd.quote });
    if (profile.totalCostUsd) out.push({ label: 'Total project cost', value: formatMoney(profile.totalCostUsd.value), quote: profile.totalCostUsd.quote });
    if (profile.stateName) out.push({ label: 'State', value: profile.stateName.value, quote: profile.stateName.quote });
    return out;
  }

  /** Badge text and kind (a CSS modifier) for an opportunity's status. */
  function statusInfo(item) {
    if (item.historical) return { text: 'Closed or archived (past round)', kind: 'secondary' };
    if (item.status === 'forecasted') return { text: 'Forecasted (not open yet)', kind: 'warning' };
    if (item.status === 'posted') return { text: 'Open for applications', kind: 'success' };
    return { text: String(item.status || 'Unknown status'), kind: 'secondary' };
  }

  function matchInfo(item) {
    return item.match === 'likely'
      ? { text: 'Matches your project words', kind: 'success' }
      : { text: 'Weaker match', kind: 'secondary' };
  }

  /** One line of plain facts about an opportunity. Missing values are said to be missing, never filled in. */
  function metaParts(item) {
    var parts = [];
    if (item.opportunityNumber) parts.push('Opportunity number ' + item.opportunityNumber);
    if (item.agency) parts.push(item.agency);
    parts.push(item.closeDate ? (item.historical ? 'Closed ' : 'Closes ') + item.closeDate : 'No close date listed');
    var max = formatMoney(item.awardCeiling);
    parts.push(max ? 'Maximum award ' + max : 'Maximum award not listed');
    return parts;
  }

  /** Only http(s) links are ever rendered as links. */
  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      var u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  /** The operator commands that load an opportunity for assessment. Empty for anything that is not a UUID. */
  function loadCommands(id) {
    if (!UUID.test(String(id))) return [];
    var uuid = String(id).toLowerCase();
    return ['npm run nofo:ingest -- ' + uuid, 'npm run nofo:extract -- ' + uuid];
  }

  /** The conversation after adding `text`, or null when it is empty, too long, or the limit is reached. */
  function nextMessages(messages, text) {
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS || messages.length >= MAX_MESSAGES) return null;
    return messages.concat([{ role: 'user', content: trimmed }]);
  }

  function messagesLeft(messages) {
    return Math.max(0, MAX_MESSAGES - messages.length);
  }

  function buildRequest(messages, options) {
    var body = { messages: messages.map(function (m) { return { role: 'user', content: m.content }; }) };
    if (options && options.includeHistorical) body.includeHistorical = true;
    if (options && options.forceResults) body.forceResults = true;
    if (options && options.inspect) body.inspect = true;
    if (options && Array.isArray(options.asked) && options.asked.length) body.asked = options.asked.slice();
    return body;
  }

  /**
   * Splits streamed text into the complete JSON lines it holds and the unfinished rest (to be joined with the
   * next chunk). A line that is not valid JSON is skipped, never thrown.
   */
  function parseNdjson(buffer) {
    var parts = String(buffer).split('\n');
    var rest = parts.pop();
    var events = [];
    parts.forEach(function (line) {
      line = line.trim();
      if (!line) return;
      try {
        var value = JSON.parse(line);
        if (value && typeof value === 'object') events.push(value);
      } catch (e) {
        /* a damaged line is dropped; the final result line is what matters */
      }
    });
    return { events: events, rest: rest };
  }

  /** Adds or updates one progress step (matched by id, first-seen order kept). Returns a new array. */
  function applyProgress(steps, event) {
    if (!event || typeof event.id !== 'string' || typeof event.message !== 'string') return steps;
    var next = {
      id: event.id,
      status: event.status === 'done' || event.status === 'failed' ? event.status : 'running',
      message: event.message,
      detail: typeof event.detail === 'string' ? event.detail : ''
    };
    var out = steps.slice();
    for (var i = 0; i < out.length; i++) {
      if (out[i].id === next.id) {
        out[i] = next;
        return out;
      }
    }
    out.push(next);
    return out;
  }

  /** The line to announce and show as the headline: the newest running step, else the newest step. */
  function currentStep(steps) {
    for (var i = steps.length - 1; i >= 0; i--) if (steps[i].status === 'running') return steps[i];
    return steps.length ? steps[steps.length - 1] : null;
  }

  /** The raw listing, as Simpler.Grants.gov sent it, for an opportunity ID, from the inspected responses. Null if absent. */
  function findRawListing(inspection, opportunityId) {
    if (!Array.isArray(inspection)) return null;
    var id = String(opportunityId).toLowerCase();
    for (var i = 0; i < inspection.length; i++) {
      var data = inspection[i] && inspection[i].response && inspection[i].response.data;
      if (!Array.isArray(data)) continue;
      for (var j = 0; j < data.length; j++) {
        var entry = data[j];
        if (entry && typeof entry.opportunity_id === 'string' && entry.opportunity_id.toLowerCase() === id) {
          return { label: inspection[i].label, listing: entry };
        }
      }
    }
    return null;
  }

  function prettyJson(value) {
    try {
      var text = JSON.stringify(value, null, 2);
      return text === undefined ? '' : text;
    } catch (e) {
      return '';
    }
  }

  /** A safe download name: lower-case letters, digits and hyphens only. */
  function safeFileName(text) {
    var base = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return (base || 'response') + '.json';
  }

  /** One plain line about an inspected search: how many listings, and how long it took (or that it was reused). */
  function describeInspection(item) {
    if (!item || item.ok === false) return 'failed';
    var count = item.returned + (typeof item.totalRecords === 'number' && item.totalRecords > item.returned ? ' of ' + item.totalRecords : '') + ' listing' + (item.returned === 1 ? '' : 's');
    var timing = item.cached ? 'reused a recent result' : (Math.max(0, item.elapsedMs || 0) / 1000).toFixed(1) + 's';
    return count + ' · ' + timing;
  }

  var PREPARE_LABELS = {
    ingest: 'Download and read the official documents',
    extract: 'Extract the requirements with the language model'
  };

  /** True while a prepare job is running on the server. */
  function isPreparing(state) {
    return !!state && (state.status === 'ingesting' || state.status === 'extracting');
  }

  /**
   * The two stages of preparing an opportunity, each "waiting", "running", "done" or "failed", from the job state the
   * server reports. Anything unexpected shows both stages as waiting rather than guessing.
   */
  function prepareSteps(state) {
    var s = state && state.status;
    var ingest = 'waiting';
    var extract = 'waiting';
    if (s === 'ingesting') { ingest = 'running'; }
    else if (s === 'extracting') { ingest = 'done'; extract = 'running'; }
    else if (s === 'ready') { ingest = 'done'; extract = 'done'; }
    else if (s === 'failed') {
      if (state.failedStep === 'extract') { ingest = 'done'; extract = 'failed'; }
      else { ingest = 'failed'; }
    }
    return [
      { id: 'ingest', status: ingest, label: PREPARE_LABELS.ingest },
      { id: 'extract', status: extract, label: PREPARE_LABELS.extract }
    ];
  }

  /** "2m 05s" / "45s" from whole seconds. */
  function formatElapsed(seconds) {
    var n = Math.max(0, Math.floor(Number(seconds) || 0));
    if (n < 60) return n + 's';
    var secs = n % 60;
    return Math.floor(n / 60) + 'm ' + (secs < 10 ? '0' : '') + secs + 's';
  }

  var api = {
    findRawListing: findRawListing,
    prettyJson: prettyJson,
    safeFileName: safeFileName,
    describeInspection: describeInspection,
    isPreparing: isPreparing,
    prepareSteps: prepareSteps,
    formatElapsed: formatElapsed,
    parseNdjson: parseNdjson,
    applyProgress: applyProgress,
    currentStep: currentStep,
    MAX_MESSAGES: MAX_MESSAGES,
    formatMoney: formatMoney,
    profileFacts: profileFacts,
    statusInfo: statusInfo,
    matchInfo: matchInfo,
    metaParts: metaParts,
    safeUrl: safeUrl,
    loadCommands: loadCommands,
    nextMessages: nextMessages,
    messagesLeft: messagesLeft,
    buildRequest: buildRequest
  };
  root.DiscoverUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
