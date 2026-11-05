/**
 * An animated progress panel fed by a stream of real steps from the server, shared by screens that run a long job.
 * Exposes window.ProgressPanel. Needs window.DiscoverUtil (its parseNdjson / applyProgress / currentStep helpers).
 *
 *   var panel = ProgressPanel.create({ root, title, time, steps });
 *   panel.start();
 *   var result = await ProgressPanel.stream(url, body, panel.push);
 *   panel.flush(); panel.stop();
 *
 * Every string is rendered with textContent. Nothing here guesses at progress: it only shows what the server reported.
 */
(function () {
  'use strict';

  var D = window.DiscoverUtil;
  var MIN_VISIBLE_MS = 300; // a step stays "running" on screen at least this long, so quick steps are readable

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * parts: { root, title, time, steps } are the existing elements of the panel (the container, the headline, the
   * elapsed-time label and the list). Returns { start, stop, push, flush }.
   */
  function create(parts) {
    var steps = [];
    var nodes = {};
    var shownAt = {};
    var pending = {};
    var timers = {};
    var tick = null;
    var startedAt = 0;

    function clearTimers() {
      Object.keys(timers).forEach(function (id) { clearTimeout(timers[id]); });
      timers = {};
      pending = {};
    }

    function show(event) {
      steps = D.applyProgress(steps, event);
      var step = steps.filter(function (s) { return s.id === event.id; })[0];
      if (!step) return;
      var node = nodes[step.id];
      if (!node) {
        node = { li: el('li', 'find-step'), icon: el('span', 'find-icon'), msg: el('span', 'find-step-msg'), detail: el('span', 'find-step-detail') };
        node.icon.setAttribute('aria-hidden', 'true');
        var text = el('span', 'find-step-text');
        text.appendChild(node.msg);
        text.appendChild(node.detail);
        node.li.appendChild(node.icon);
        node.li.appendChild(text);
        parts.steps.appendChild(node.li);
        nodes[step.id] = node;
      }
      node.li.className = 'find-step find-step-' + step.status;
      node.icon.textContent = step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : '';
      node.msg.textContent = step.message;
      node.detail.textContent = step.detail;
      node.detail.hidden = !step.detail;
      var current = D.currentStep(steps);
      if (current) parts.title.textContent = current.message;
    }

    /**
     * Shows a reported step the moment it arrives. A step that finishes almost at once keeps its "running" look for
     * MIN_VISIBLE_MS first. There is no queue, so a slow step never delays another and the result is never held back.
     */
    function push(event) {
      var id = event.id;
      if (event.status === 'running') {
        clearTimeout(timers[id]);
        delete timers[id];
        delete pending[id];
        shownAt[id] = Date.now();
        show(event);
        return;
      }
      var wait = shownAt[id] ? MIN_VISIBLE_MS - (Date.now() - shownAt[id]) : 0;
      if (wait <= 0) {
        show(event);
        return;
      }
      pending[id] = event;
      clearTimeout(timers[id]);
      timers[id] = setTimeout(function () {
        var held = pending[id];
        delete pending[id];
        delete timers[id];
        if (held) show(held);
      }, wait);
    }

    /** The result has arrived: show any held step now. */
    function flush() {
      var held = pending;
      clearTimers();
      Object.keys(held).forEach(function (id) { show(held[id]); });
    }

    function start() {
      steps = [];
      nodes = {};
      shownAt = {};
      clearTimers();
      clear(parts.steps);
      parts.title.textContent = 'Starting…';
      parts.time.textContent = '';
      startedAt = Date.now();
      parts.root.hidden = false;
      clearInterval(tick);
      tick = setInterval(function () {
        parts.time.textContent = D.formatElapsed((Date.now() - startedAt) / 1000);
      }, 1000);
    }

    function stop() {
      clearInterval(tick);
      tick = null;
      clearTimers();
      parts.root.hidden = true;
    }

    return { start: start, stop: stop, push: push, flush: flush };
  }

  /**
   * POSTs JSON to a streaming endpoint and reads its lines: progress lines go to onStep, developer-console lines (if
   * any) go to onConsole, and the result line is
   * returned. A request refused before streaming began (bad input, rate limit, missing configuration) comes back as an
   * ordinary JSON error and is thrown with its message.
   */
  async function stream(url, body, onStep, onConsole) {
    var response;
    try {
      response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (!response.ok || (response.headers.get('content-type') || '').indexOf('ndjson') === -1) {
      var failure = null;
      try { failure = await response.json(); } catch (e) { failure = null; }
      var err = new Error(failure && failure.error ? failure.error : 'The request failed (HTTP ' + response.status + ').');
      err.status = response.status;
      throw err;
    }
    var result = null;
    function handle(line) {
      if (line.type === 'progress') onStep(line);
      else if (line.type === 'console') { if (onConsole) onConsole(line); }
      else if (line.type === 'result') result = line.data;
      else if (line.type === 'error') throw new Error(line.error || 'The request failed.');
    }
    if (response.body && response.body.getReader) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var parsed = D.parseNdjson(buffer);
        buffer = parsed.rest;
        parsed.events.forEach(handle);
      }
      D.parseNdjson(buffer + decoder.decode() + '\n').events.forEach(handle);
    } else {
      D.parseNdjson((await response.text()) + '\n').events.forEach(handle);
    }
    if (!result) throw new Error('The request ended before a result arrived. Please try again.');
    return result;
  }

  window.ProgressPanel = { create: create, stream: stream };
})();
