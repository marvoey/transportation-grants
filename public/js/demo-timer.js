/**
 * The stopwatch at the top of the projects and answers window (demo-projects.html). Counts up.
 *   Start     begins from 0:00 (ready state only)
 *   Stop      freezes the time (running only)
 *   Continue  resumes from the frozen time (stopped only)
 *   Reset     stops and returns to 0:00 (running or stopped)
 * Time is kept as milliseconds already counted plus the clock time of the last start, and the display is recomputed from
 * the clock a few times a second, so a throttled background window never makes it drift. Not saved on reload.
 * Takes no input from the user, the URL or the app page; every string is rendered with textContent.
 */
(function () {
  'use strict';

  var TICK_MS = 250;
  var state = 'ready'; // 'ready' | 'running' | 'stopped'
  var countedMs = 0; // time counted before the current run began
  var startedAt = 0; // Date.now() when the current run began
  var timer = null;
  var els = {};

  function elapsed() {
    return countedMs + (state === 'running' ? Math.max(0, Date.now() - startedAt) : 0);
  }

  /** "0:07", "12:34", "1:02:03". */
  function format(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var ss = (s < 10 ? '0' : '') + s;
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + ss;
    return m + ':' + ss;
  }

  function render() {
    els.clock.textContent = format(elapsed());
    els.start.disabled = state !== 'ready';
    els.stop.disabled = state !== 'running';
    els.cont.disabled = state !== 'stopped';
    els.reset.disabled = state === 'ready';
    els.box.setAttribute('data-state', state);
  }

  function say(message) {
    if (window.PresenterKit && typeof window.PresenterKit.say === 'function') window.PresenterKit.say(message);
  }

  function beginRun() {
    startedAt = Date.now();
    state = 'running';
    clearInterval(timer);
    timer = setInterval(render, TICK_MS);
    render();
  }

  function start() {
    if (state !== 'ready') return;
    countedMs = 0;
    beginRun();
    say('Timer started');
  }

  function stop() {
    if (state !== 'running') return;
    countedMs = elapsed();
    state = 'stopped';
    clearInterval(timer);
    timer = null;
    render();
    say('Timer stopped at ' + format(countedMs));
  }

  function continueRun() {
    if (state !== 'stopped') return;
    beginRun();
    say('Timer continued');
  }

  function reset() {
    if (state === 'ready') return;
    clearInterval(timer);
    timer = null;
    countedMs = 0;
    state = 'ready';
    render();
    say('Timer reset');
  }

  function init() {
    els.box = document.getElementById('dsTimer');
    els.clock = document.getElementById('dsClock');
    els.start = document.getElementById('dsTimerStart');
    els.stop = document.getElementById('dsTimerStop');
    els.cont = document.getElementById('dsTimerContinue');
    els.reset = document.getElementById('dsTimerReset');
    if (!els.box || !els.clock || !els.start || !els.stop || !els.cont || !els.reset) return;
    els.start.addEventListener('click', start);
    els.stop.addEventListener('click', stop);
    els.cont.addEventListener('click', continueRun);
    els.reset.addEventListener('click', reset);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
