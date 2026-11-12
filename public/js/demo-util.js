/**
 * Pure helpers for demo mode (no DOM access, so they can be unit-tested). Exposes window.DemoUtil.
 * Demo mode replays a recorded run of the real app: see demo-mode.js and docs/NOFO_DEMO.md.
 *
 * A recording is { version, recordedAt, note, discover: [turn], assess: [turn], projectDescription, prepareReady },
 * where a turn is { lines: [{ t, line }] }: `line` is one progress / console / result line exactly as the server
 * sent it, and `t` is the milliseconds since the request started.
 */
(function (root) {
  'use strict';

  var VERSION = 1;
  var LINE_TYPES = ['progress', 'console', 'result', 'error'];

  // How long the scripted "prepare" job takes on screen, per stage.
  var INGEST_MS = 5000;
  var EXTRACT_MS = 7000;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function validateTurn(turn, label) {
    if (!isObject(turn) || !Array.isArray(turn.lines) || turn.lines.length === 0) return label + ' has no lines.';
    var last = -1;
    for (var i = 0; i < turn.lines.length; i++) {
      var entry = turn.lines[i];
      if (!isObject(entry) || typeof entry.t !== 'number' || !isFinite(entry.t) || entry.t < 0) return label + ' line ' + (i + 1) + ' has no valid time.';
      if (entry.t < last) return label + ' line ' + (i + 1) + ' is out of order.';
      last = entry.t;
      if (!isObject(entry.line) || LINE_TYPES.indexOf(entry.line.type) === -1) return label + ' line ' + (i + 1) + ' has an unknown type.';
    }
    var finalLine = turn.lines[turn.lines.length - 1].line;
    if (finalLine.type !== 'result' && finalLine.type !== 'error') return label + ' does not end with a result.';
    return null;
  }

  /**
   * Checks a recording before it is used. Returns { ok: true } or { ok: false, error } with a plain message.
   * A recording needs at least one discover turn; assess turns, the project description and the prepared state are
   * optional (a missing one is reported when that step is replayed, not here).
   */
  function validateRecording(recording) {
    if (!isObject(recording)) return { ok: false, error: 'The demo recording is not a JSON object.' };
    if (recording.version !== VERSION) return { ok: false, error: 'The demo recording has an unsupported version.' };
    var problem = null;
    ['discover', 'assess'].forEach(function (key) {
      if (problem) return;
      var turns = recording[key];
      if (turns === undefined) turns = [];
      if (!Array.isArray(turns)) { problem = 'The demo recording "' + key + '" is not a list.'; return; }
      for (var i = 0; i < turns.length && !problem; i++) problem = validateTurn(turns[i], key + ' turn ' + (i + 1));
    });
    if (problem) return { ok: false, error: problem };
    if (!Array.isArray(recording.discover) || recording.discover.length === 0) return { ok: false, error: 'The demo recording has no discover turns.' };
    return { ok: true };
  }

  /** The turn for the Nth call (0-based) of an endpoint. Past the last turn it repeats the last one. */
  function pickTurn(turns, callIndex) {
    if (!Array.isArray(turns) || turns.length === 0) return null;
    var index = Math.max(0, Math.floor(Number(callIndex) || 0));
    return turns[Math.min(index, turns.length - 1)];
  }

  /**
   * Turns a recorded turn into a replay schedule: [{ delay, line }], where `delay` is the wait in ms before this line
   * is sent. Each gap between recorded lines is capped at `capMs` and divided by `speed`, so a slow real run replays
   * briskly but still visibly step by step.
   */
  function scheduleLines(lines, capMs, speed) {
    var cap = Number(capMs) > 0 ? Number(capMs) : 2500;
    var factor = Number(speed) > 0 ? Number(speed) : 1;
    var previous = 0;
    return (lines || []).map(function (entry) {
      var gap = Math.min(Math.max(0, entry.t - previous), cap);
      previous = entry.t;
      return { delay: Math.round(gap / factor), line: entry.line };
    });
  }

  /** One NDJSON line, as the server writes it. */
  function toNdjson(line) {
    return JSON.stringify(line) + '\n';
  }

  /**
   * The scripted state of a "prepare" job `elapsedMs` after it started, in the shape the server reports
   * (src/nofo/prepare/manager.ts PrepareState). `finalState` is the recorded "ready" state (or null).
   */
  function prepareStateAt(elapsedMs, opportunityId, finalState, startedAtIso) {
    var elapsed = Math.max(0, Number(elapsedMs) || 0);
    var base = { opportunityId: opportunityId, partial: false, failedStep: null, error: null, startedAt: startedAtIso || null, finishedAt: null, requirements: null };
    if (elapsed < INGEST_MS) {
      return Object.assign(base, { status: 'ingesting', message: 'Downloading and reading the official documents…' });
    }
    if (elapsed < INGEST_MS + EXTRACT_MS) {
      return Object.assign(base, { status: 'extracting', message: 'Extracting the requirements with the language model…' });
    }
    var ready = isObject(finalState) ? finalState : {};
    return Object.assign(base, ready, {
      opportunityId: opportunityId,
      status: 'ready',
      message: typeof ready.message === 'string' ? ready.message : 'Ready to assess.',
      failedStep: null,
      error: null,
      startedAt: startedAtIso || null,
      finishedAt: startedAtIso ? new Date(Date.parse(startedAtIso) + INGEST_MS + EXTRACT_MS).toISOString() : null
    });
  }

  /** Reads the demo flag from a query string: "1" on, "0" off, "record" recording, anything else unchanged (null). */
  function parseFlag(search) {
    var match = /(?:^|[?&])demo=([^&]*)/.exec(String(search || ''));
    if (!match) return null;
    var value = decodeURIComponent(match[1]);
    if (value === '1' || value === '0' || value === 'record') return value;
    return null;
  }

  /** True for the opportunity API paths that only read local files and are safe to pass through in demo mode. */
  function isLocalRead(method, path) {
    if (String(method).toUpperCase() !== 'GET') return false;
    return /^\/opportunities(\/|$)/.test(path);
  }

  root.DemoUtil = {
    VERSION: VERSION,
    INGEST_MS: INGEST_MS,
    EXTRACT_MS: EXTRACT_MS,
    validateRecording: validateRecording,
    pickTurn: pickTurn,
    scheduleLines: scheduleLines,
    toNdjson: toNdjson,
    prepareStateAt: prepareStateAt,
    parseFlag: parseFlag,
    isLocalRead: isLocalRead
  };
})(typeof window !== 'undefined' ? window : globalThis);
