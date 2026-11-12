/**
 * A simulated "Prepare this opportunity" for demonstrations. Needs nothing else; exposes window.PrepareReplay.
 *
 * When an opportunity's documents are already downloaded and its requirements already extracted on this server, there is
 * nothing real to wait for. With "Simulate preparing" switched on in Settings (app-settings.js), the card still shows the
 * download-and-read progress as if the documents were new, and then finishes at the real "Prepared" state.
 *
 * Nothing is downloaded and the language model is not called. The names, page counts and requirement counts shown are the
 * real ones from the local files (item.downloaded); only the pacing is made up, and the panel says so.
 *
 *   PrepareReplay.applies(item, { enabled, demoModeOn })  -> boolean
 *   PrepareReplay.plan(item)  -> [{ state: { status, message, requirements? }, holdMs }]
 *
 * "state" has the same shape as the server's prepare state, so the existing progress panel can draw it. "holdMs" is how long
 * the step stays on screen before the next one. The last step is always { status: 'ready' }.
 *
 * Every string here is plain text for textContent; document titles are untrusted file metadata, so they are shortened.
 */
(function (root) {
  'use strict';

  var MAX_TITLE = 70;
  var MAX_SHOWN_DOCS = 12; // more than this and the rest are folded into the last step, so the replay stays short
  var DOWNLOAD_MS = 700;
  var READ_MS = 500;
  var EXTRACT_TICKS = 8;
  var EXTRACT_TICK_MS = 900;

  var EXTRACT_MESSAGE = 'Reading the notice with the language model to extract its requirements…';

  /** True only for an opportunity that is really prepared: replaying a job that never ran would show something untrue. */
  function applies(item, options) {
    var o = options || {};
    return !!(o.enabled && !o.demoModeOn && item && item.readyToAssess === true);
  }

  function shorten(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1) + '…' : t;
  }

  function documentsOf(item) {
    var d = item && item.downloaded;
    if (!d || !Array.isArray(d.documents)) return [];
    return d.documents.slice(0, MAX_SHOWN_DOCS);
  }

  function totalRequirements(item) {
    var r = item && item.downloaded && item.downloaded.requirements;
    return r && typeof r.total === 'number' && r.total > 0 ? Math.floor(r.total) : null;
  }

  function pagesText(doc) {
    return typeof doc.pages === 'number' && doc.pages > 0 ? ' (' + doc.pages + ' page' + (doc.pages === 1 ? '' : 's') + ')' : '';
  }

  /** The steps of the replay, in order. */
  function plan(item) {
    var steps = [];
    var docs = documentsOf(item);
    var n = docs.length;
    var total = totalRequirements(item);

    if (n === 0) {
      steps.push({ state: { status: 'ingesting', message: 'Downloading the official documents from Simpler.Grants.gov and reading them…' }, holdMs: 3000 });
    } else {
      docs.forEach(function (doc, i) {
        steps.push({
          state: { status: 'ingesting', message: 'Downloading document ' + (i + 1) + ' of ' + n + ': ' + shorten(doc.title) },
          holdMs: DOWNLOAD_MS
        });
      });
      docs.forEach(function (doc, i) {
        steps.push({
          state: { status: 'ingesting', message: 'Reading document ' + (i + 1) + ' of ' + n + ': ' + shorten(doc.title) + pagesText(doc) },
          holdMs: READ_MS
        });
      });
    }

    if (total === null) {
      steps.push({ state: { status: 'extracting', message: EXTRACT_MESSAGE }, holdMs: EXTRACT_TICKS * EXTRACT_TICK_MS / 2 });
    } else {
      // The counter climbs to the real number of requirements on file, never past it.
      for (var t = 1; t <= EXTRACT_TICKS; t++) {
        var found = Math.min(total, Math.ceil(total * t / EXTRACT_TICKS));
        steps.push({
          state: { status: 'extracting', message: EXTRACT_MESSAGE + ' ' + found + ' of ' + total + ' requirements found so far.' },
          holdMs: EXTRACT_TICK_MS
        });
      }
    }

    steps.push({ state: { status: 'ready', message: 'Ready to assess.', requirements: total }, holdMs: 0 });
    return steps;
  }

  root.PrepareReplay = { applies: applies, plan: plan };
})(typeof window !== 'undefined' ? window : globalThis);
