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

  /**
   * What a result card says about documents, from the item's `documents` (set by the server: names only, nothing is
   * downloaded). Returns null when the check was not run. "none" is worded as "none listed", never "none exist", and it
   * names where else to look: only links the listing itself gives (its Simpler.Grants.gov page and the program's own page).
   * "no_notice" is documents listed but none looking like the notice (no NOFO or amendment by file name, the same rule
   * preparing uses), so preparing would stop. `blocksPrepare` is true for "none" and "no_notice": there is nothing to prepare.
   * Returns { state: 'none' | 'no_notice' | 'listed' | 'unknown', blocksPrepare, headline, text, files, moreFiles, links }.
   */
  function documentsView(item) {
    var d = item && item.documents;
    if (!d || (d.status !== 'none' && d.status !== 'listed' && d.status !== 'unknown')) return null;
    var links = [];
    var pageUrl = safeUrl(item.simplerUrl);
    var infoUrl = safeUrl(item.additionalInfoUrl);
    if (pageUrl) links.push({ label: 'Opportunity page on Simpler.Grants.gov', url: pageUrl });
    if (infoUrl) links.push({ label: 'The program\u2019s own page (another website)', url: infoUrl });
    if (d.status === 'none') {
      return {
        state: 'none',
        blocksPrepare: true,
        headline: 'No documents listed',
        text: 'Simpler.Grants.gov lists no documents for this opportunity, so it cannot be prepared or assessed here. That does not mean none exist: the notice may be on another page.' + (infoUrl ? '' : ' The listing gives no other page to check.'),
        files: [],
        moreFiles: 0,
        links: links
      };
    }
    if (d.status === 'listed') {
      var files = Array.isArray(d.files) ? d.files.filter(function (f) { return typeof f === 'string'; }) : [];
      var count = typeof d.count === 'number' ? d.count : files.length;
      if (d.hasNotice === false) {
        return {
          state: 'no_notice',
          blocksPrepare: true,
          headline: 'No notice document listed',
          text: 'Simpler.Grants.gov lists ' + count + ' document' + (count === 1 ? '' : 's') + ', but none looks like the notice of funding (a NOFO or an amendment), which preparing needs, so it cannot be assessed here. The notice may not be published yet, or it may be on another page.' + (infoUrl ? '' : ' The listing gives no other page to check.'),
          files: files,
          moreFiles: Math.max(0, count - files.length),
          links: links
        };
      }
      return {
        state: 'listed',
        blocksPrepare: false,
        headline: count + ' document' + (count === 1 ? '' : 's') + ' listed',
        text: '',
        files: files,
        moreFiles: Math.max(0, count - files.length),
        links: []
      };
    }
    return {
      state: 'unknown',
      blocksPrepare: false,
      headline: 'Could not check which documents are listed',
      text: 'You can still try to prepare it.',
      files: [],
      moreFiles: 0,
      links: []
    };
  }

  function count(n) {
    return Number(n).toLocaleString('en-US');
  }

  /** Word counts are not exact (text extraction splits differently), so thousands are rounded to the nearest hundred. */
  function approxWords(n) {
    return count(n >= 1000 ? Math.round(n / 100) * 100 : n);
  }

  var ROLE_LABELS = { notice: 'Notice', guidance: 'Guidance', other: 'Other' };
  var CATEGORY_LABELS = { eligibility: 'eligibility', funding: 'funding', application: 'application', readiness: 'readiness', evaluation: 'evaluation', post_award: 'post-award' };

  /**
   * What a card says about the documents downloaded for its opportunity, from item.downloaded (set by the server from
   * local files): a headline, one row per document (type, role, pages, words) and a line on the requirements extracted
   * from them. Every number is a count; nothing here estimates time. Null when nothing is downloaded.
   * Pages exist for PDFs only; a Word document shows words and no pages rather than a guess.
   */
  function downloadedView(item) {
    var d = item && item.downloaded;
    if (!d || !Array.isArray(d.documents) || d.documents.length === 0) return null;
    var n = d.documents.length;
    var parts = [n + ' document' + (n === 1 ? '' : 's')];
    if (d.totalPages > 0) parts.push(count(d.totalPages) + ' PDF page' + (d.totalPages === 1 ? '' : 's'));
    if (d.totalWords > 0) parts.push('about ' + approxWords(d.totalWords) + ' words');
    var rows = d.documents.map(function (doc) {
      return {
        title: String(doc.title || ''),
        format: String(doc.format || 'Other'),
        role: ROLE_LABELS[doc.role] || 'Other',
        pages: typeof doc.pages === 'number' ? count(doc.pages) : '\u2014',
        words: typeof doc.words === 'number' ? count(doc.words) : '\u2014',
        unread: doc.parsed === false
      };
    });
    var r = d.requirements;
    var requirements = null;
    if (r && r.total > 0) {
      var cats = (r.byCategory || []).map(function (c) { return count(c.count) + ' ' + (CATEGORY_LABELS[c.category] || c.category); }).join(', ');
      requirements = 'GrantFlow read these documents and extracted ' + count(r.total) + ' requirement' + (r.total === 1 ? '' : 's') + (cats ? ': ' + cats : '') + '. ' +
        count(r.toPrepare) + ' ' + (r.toPrepare === 1 ? 'is a document or form' : 'are documents or forms') + ' to prepare, and ' + count(r.checkedByCode) + ' can be checked automatically against the facts you give. ' +
        (r.verified > 0 ? count(r.verified) + ' verified by a person.' : 'None has been verified by a person yet.');
    }
    return {
      headline: parts.join(' \u00b7 '),
      rows: rows,
      requirements: requirements,
      downloadedOn: typeof d.downloadedOn === 'string' ? d.downloadedOn : null,
      legend: 'Notice = the notice of funding or an amendment; Guidance = a template, FAQ, webinar or checklist. A Word document has no fixed page count.'
    };
  }

  /**
   * The strip above the cards: the downloaded documents of the listings shown, added up (the server sums them).
   * `shown` is how many listings are on screen. Null when none of them has downloaded documents.
   */
  function downloadedTotalsView(totals, shown) {
    if (!totals || !(totals.listings > 0)) return null;
    var stats = [
      { value: count(totals.documents), label: totals.documents === 1 ? 'document to read' : 'documents to read' },
      { value: count(totals.pages), label: 'PDF pages' },
      { value: approxWords(totals.words), label: 'words (approximate)' }
    ];
    if (totals.requirements > 0) stats.push({ value: count(totals.requirements), label: 'requirements to check' });
    if (totals.toPrepare > 0) stats.push({ value: count(totals.toPrepare), label: totals.toPrepare === 1 ? 'document or form to prepare' : 'documents and forms to prepare' });
    return {
      title: totals.listings + ' of these ' + shown + ' grants ha' + (totals.listings === 1 ? 's' : 've') + ' documents downloaded and read',
      stats: stats,
      note: 'That is the reading and checking a specialist would do by hand for these grants. GrantFlow has already read the documents and extracted the requirements from each notice; none has been verified by a person yet.'
    };
  }

  /**
   * The listings shown at first and the ones behind the "Show the other N" button. `showFirst` comes from the server; when it
   * is missing or not a sensible number everything is shown at once (no button).
   */
  function splitResults(items, showFirst) {
    var list = Array.isArray(items) ? items : [];
    var n = Number.isInteger(showFirst) && showFirst >= 1 ? showFirst : list.length;
    return { first: list.slice(0, n), rest: list.slice(n) };
  }

  /** The downloaded-document figures of these listings added up (the same sums the server makes), or null when none has any. */
  function totalsFor(items) {
    var withDocs = (Array.isArray(items) ? items : []).filter(function (i) { return i && i.downloaded && Array.isArray(i.downloaded.documents); });
    if (withDocs.length === 0) return null;
    function sum(read) { return withDocs.reduce(function (n, i) { return n + (read(i.downloaded) || 0); }, 0); }
    return {
      listings: withDocs.length,
      documents: sum(function (d) { return d.documents.length; }),
      pages: sum(function (d) { return d.totalPages; }),
      words: sum(function (d) { return d.totalWords; }),
      requirements: sum(function (d) { return d.requirements && d.requirements.total; }),
      toPrepare: sum(function (d) { return d.requirements && d.requirements.toPrepare; })
    };
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
    // The reply shown last turn, so a short follow-up ("yes") is answered in context. Capped to what the server accepts.
    if (options && typeof options.previousReply === 'string' && options.previousReply.trim()) body.previousReply = options.previousReply.trim().slice(0, 2000);
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
    documentsView: documentsView,
    downloadedView: downloadedView,
    downloadedTotalsView: downloadedTotalsView,
    splitResults: splitResults,
    totalsFor: totalsFor,
    loadCommands: loadCommands,
    nextMessages: nextMessages,
    messagesLeft: messagesLeft,
    buildRequest: buildRequest
  };
  root.DiscoverUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
