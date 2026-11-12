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
 *   PrepareReplay.applies(item, { enabled })  -> boolean
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
  // The whole replay takes about 1.5 seconds, however many documents there are: nothing in a demonstration should make the
  // audience wait more than about two seconds. The documents share INGEST_MS (a download and a read step each) and the
  // requirement counter shares EXTRACT_MS.
  var INGEST_MS = 700;
  var EXTRACT_MS = 800;
  var EXTRACT_TICKS = 8;
  var EXTRACT_TICK_MS = EXTRACT_MS / EXTRACT_TICKS;

  var EXTRACT_MESSAGE = 'Reading the notice with the language model to extract its requirements…';

  /**
   * True only for an opportunity that is really prepared: replaying a job that never ran would show something untrue.
   * Demo mode does not change this: its recorded results mark those opportunities prepared too, so the setting is honored
   * there as well (demo mode's own scripted prepare is only for an opportunity that is not prepared).
   */
  function applies(item, options) {
    var o = options || {};
    return !!(o.enabled && item && item.readyToAssess === true);
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
      steps.push({ state: { status: 'ingesting', message: 'Downloading the official documents from Simpler.Grants.gov and reading them…' }, holdMs: INGEST_MS });
    } else {
      docs.forEach(function (doc, i) {
        steps.push({
          state: { status: 'ingesting', message: 'Downloading document ' + (i + 1) + ' of ' + n + ': ' + shorten(doc.title) },
          holdMs: INGEST_MS / (2 * n)
        });
      });
      docs.forEach(function (doc, i) {
        steps.push({
          state: { status: 'ingesting', message: 'Reading document ' + (i + 1) + ' of ' + n + ': ' + shorten(doc.title) + pagesText(doc) },
          holdMs: INGEST_MS / (2 * n)
        });
      });
    }

    if (total === null) {
      steps.push({ state: { status: 'extracting', message: EXTRACT_MESSAGE }, holdMs: EXTRACT_MS });
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
