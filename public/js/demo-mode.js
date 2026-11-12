/**
 * Demo mode: replays a recorded run of the real app, so a presentation is repeatable without API calls, downloads or
 * parsing. The page code is unchanged: this file wraps window.fetch and answers the /api/nofo calls from a recording
 * (public/demo/demo-run.json). Needs window.DemoUtil (demo-util.js). Load it before any script that calls the API.
 *
 *   ?demo=1       turn demo mode on (remembered in localStorage)     ?demo=0   turn it off
 *   ?demo=record  capture a real run, then "Download recording" in the menu (needs the API keys; nothing replays)
 *   ?demo_speed=2 replay twice as fast (default 1)
 *
 * While on, a request under /api/nofo is answered from the recording or refused. It is never sent on to a real API.
 * The only calls passed through are read-only GETs of local opportunity data (the "View source" views).
 * A replayed answer is never presented as live: while demo mode is on, a small play icon at the bottom-right says so (demo-indicator.js);
 * recording mode keeps a red badge at the top.
 *
 *   DemoMode.isOn()  DemoMode.isRecording()  DemoMode.toggle()  DemoMode.reset()  DemoMode.download()
 */
(function () {
  'use strict';

  var U = window.DemoUtil;
  if (!U) return; // the helpers did not load: leave the page exactly as it is

  var KEY = 'grantflow.demoMode';
  var RECORDING_URL = '/demo/demo-run.json';
  var GAP_CAP_MS = 2500;
  var SESSION_KEY = 'grantflow.demoCapture';

  var flag = U.parseFlag(window.location.search);
  var on = false;
  try {
    if (flag === '1') window.localStorage.setItem(KEY, 'on');
    else if (flag === '0') window.localStorage.setItem(KEY, 'off');
    on = window.localStorage.getItem(KEY) === 'on';
  } catch (e) {
    on = flag === '1'; // storage blocked: the URL flag still works for this page
  }
  var recording = flag === 'record';
  if (recording) on = false;

  var speedMatch = /(?:^|[?&])demo_speed=([0-9.]+)/.exec(window.location.search);
  var speed = speedMatch && Number(speedMatch[1]) > 0 ? Number(speedMatch[1]) : 1;

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var calls = { discover: 0, assess: 0 };
  var jobs = {};
  var loaded = null;

  // What a recording session has captured so far. Kept in sessionStorage too, so a reload does not lose it.
  var capture = { version: U.VERSION, recordedAt: null, note: 'Recorded from a real run with the fictional sample project. No real client data.', discover: [], assess: [], projectDescription: null, prepareReady: null };
  if (recording) {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEY));
      if (saved && saved.version === U.VERSION) capture = saved;
    } catch (e) {
      /* start empty */
    }
  }

  function saveCapture() {
    capture.recordedAt = new Date().toISOString();
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(capture));
    } catch (e) {
      /* too large or blocked: the in-memory copy still works */
    }
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }

  function refuse(message, code) {
    return json(code === 'DEMO_BLOCKED' ? 403 : 503, { success: false, error: message, code: code, retryable: false });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function loadRecording() {
    if (!loaded) {
      loaded = realFetch(RECORDING_URL, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('The demo recording was not found. Record one first (see docs/NOFO_DEMO.md).');
          return response.json();
        })
        .then(function (data) {
          var check = U.validateRecording(data);
          if (!check.ok) throw new Error(check.error);
          return data;
        })
        .catch(function (e) {
          loaded = null; // allow a retry once the file is in place
          throw e;
        });
    }
    return loaded;
  }

  /** The path under /api/nofo (no query string), and whether the request asked for a stream; null for other URLs. */
  function parse(input) {
    var raw = typeof input === 'string' ? input : input && input.url;
    if (!raw) return null;
    var url;
    try { url = new URL(raw, window.location.href); } catch (e) { return null; }
    if (url.pathname !== '/api/nofo' && url.pathname.indexOf('/api/nofo/') !== 0) return null;
    return { path: url.pathname.slice('/api/nofo'.length) || '/', stream: url.searchParams.get('stream') === '1' };
  }

  function methodOf(input, init) {
    return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  }

  function lastResult(turn) {
    for (var i = turn.lines.length - 1; i >= 0; i--) if (turn.lines[i].line.type === 'result') return turn.lines[i].line.data;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  function replayTurn(kind, wantsStream) {
    return loadRecording().then(function (rec) {
      var turn = U.pickTurn(rec[kind], calls[kind]);
      if (!turn) return refuse('Demo mode has no recorded ' + kind + ' step.', 'DEMO_MISSING');
      calls[kind] += 1;
      if (!wantsStream) return json(200, { success: true, data: lastResult(turn) });
      var schedule = U.scheduleLines(turn.lines, GAP_CAP_MS, speed);
      var encoder = new TextEncoder();
      var cancelled = false;
      var body = new ReadableStream({
        start: function (controller) {
          (async function () {
            for (var i = 0; i < schedule.length && !cancelled; i++) {
              if (schedule[i].delay > 0) await sleep(schedule[i].delay);
              if (cancelled) return;
              controller.enqueue(encoder.encode(U.toNdjson(schedule[i].line)));
            }
            if (!cancelled) controller.close();
          })().catch(function (e) { try { controller.error(e); } catch (ignored) { /* already closed */ } });
        },
        cancel: function () { cancelled = true; }
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    });
  }

  function replayPrepare(method, path, input, init) {
    return loadRecording().then(function (rec) {
      var match = /^\/prepare(?:\/([^/]+))?$/.exec(path);
      if (!match) return null;
      var id = match[1] ? decodeURIComponent(match[1]) : null;
      if (method === 'POST' && !id) {
        var body = {};
        try { body = JSON.parse((init && init.body) || '{}'); } catch (e) { body = {}; }
        id = typeof body.opportunityId === 'string' ? body.opportunityId : null;
        if (!id) return refuse('Demo mode needs an opportunity to prepare.', 'DEMO_BLOCKED');
        if (!jobs[id]) jobs[id] = Date.now();
      }
      if (method !== 'POST' && method !== 'GET') return null;
      if (!id) return null;
      if (!jobs[id]) {
        return json(200, { success: true, data: { opportunityId: id, status: 'idle', message: 'Not prepared.', partial: false, failedStep: null, error: null, startedAt: null, finishedAt: null, requirements: null } });
      }
      var state = U.prepareStateAt(Date.now() - jobs[id], id, rec.prepareReady, new Date(jobs[id]).toISOString());
      return json(200, { success: true, data: state });
    });
  }

  function replay(input, init, info) {
    var method = methodOf(input, init);
    var path = info.path;
    if (U.isLocalRead(method, path)) return realFetch(input, init);
    var pending = null;
    if (method === 'POST' && path === '/discover') pending = replayTurn('discover', info.stream);
    else if (method === 'POST' && path === '/assess') pending = replayTurn('assess', info.stream);
    else if (method === 'POST' && path === '/project-description') {
      pending = loadRecording().then(function (rec) {
        if (!rec.projectDescription) return refuse('Demo mode has no recorded project description.', 'DEMO_MISSING');
        return json(200, { success: true, data: rec.projectDescription });
      });
    } else if (/^\/prepare(\/|$)/.test(path)) pending = replayPrepare(method, path, input, init);
    if (!pending) return Promise.resolve(refuse('Demo mode has no recording for this request.', 'DEMO_BLOCKED'));
    return pending.then(function (response) {
      return response || refuse('Demo mode has no recording for this request.', 'DEMO_BLOCKED');
    }, function (e) {
      return refuse(e && e.message ? e.message : 'The demo recording could not be loaded.', 'DEMO_MISSING');
    });
  }

  // ---------------------------------------------------------------------------
  // Recording (a real run, captured in this browser; nothing is sent anywhere)
  // ---------------------------------------------------------------------------

  function captureStream(kind, response, startedAt) {
    var lines = [];
    var reader = response.clone().body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function take(text) {
      text.split('\n').forEach(function (raw) {
        if (!raw.trim()) return;
        try { lines.push({ t: Date.now() - startedAt, line: JSON.parse(raw) }); } catch (e) { /* skip a damaged line */ }
      });
    }
    (async function () {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var cut = buffer.lastIndexOf('\n');
        if (cut >= 0) { take(buffer.slice(0, cut + 1)); buffer = buffer.slice(cut + 1); }
      }
      take(buffer + decoder.decode());
      var last = lines.length ? lines[lines.length - 1].line : null;
      if (last && last.type === 'result') { capture[kind].push({ lines: lines }); saveCapture(); }
    })().catch(function () { /* a broken stream is simply not recorded */ });
  }

  function captureJson(response, onData) {
    response.clone().json().then(function (body) {
      if (body && body.success && body.data) { onData(body.data); saveCapture(); }
    }).catch(function () { /* not JSON: not recorded */ });
  }

  function record(input, init, info) {
    var method = methodOf(input, init);
    var path = info.path;
    var startedAt = Date.now();
    return realFetch(input, init).then(function (response) {
      if (!response.ok) return response;
      if (method === 'POST' && (path === '/discover' || path === '/assess') && info.stream && response.body) {
        captureStream(path.slice(1), response, startedAt);
      } else if (method === 'POST' && path === '/project-description') {
        captureJson(response, function (data) { capture.projectDescription = data; });
      } else if (/^\/prepare(\/|$)/.test(path)) {
        captureJson(response, function (data) {
          if (data.status === 'ready') capture.prepareReady = { message: data.message, partial: !!data.partial, requirements: data.requirements };
        });
      }
      return response;
    });
  }

  if (realFetch && (on || recording)) {
    window.fetch = function (input, init) {
      var info = parse(input);
      if (!info) return realFetch(input, init);
      return recording ? record(input, init, info) : replay(input, init, info);
    };
  }

  // ---------------------------------------------------------------------------
  // Page furniture: the badge, and the actions the floating menu uses
  // ---------------------------------------------------------------------------

  function showBadge() {
    if (recording) {
      var badge = document.createElement('div');
      badge.className = 'demo-badge demo-badge-record';
      badge.setAttribute('role', 'status');
      badge.textContent = 'Recording mode: capturing live responses';
      document.body.appendChild(badge);
    } else if (on && window.DemoIndicator) {
      window.DemoIndicator.show('Demo mode: recorded run, not live');
    }
  }

  if (document.body) showBadge();
  else document.addEventListener('DOMContentLoaded', showBadge);

  function toggle() {
    var next = !on;
    try { window.localStorage.setItem(KEY, next ? 'on' : 'off'); } catch (e) { /* the URL flag carries it */ }
    var url = new URL(window.location.href);
    url.searchParams.set('demo', next ? '1' : '0');
    window.location.assign(url.toString());
  }

  function reset() {
    calls = { discover: 0, assess: 0 };
    jobs = {};
    document.dispatchEvent(new CustomEvent('demomodechange', { detail: { on: on } }));
  }

  function download() {
    var blob = new Blob([JSON.stringify(capture, null, 2) + '\n'], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'demo-run.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  window.DemoMode = {
    isOn: function () { return on; },
    isRecording: function () { return recording; },
    toggle: toggle,
    reset: reset,
    download: download
  };
})();
