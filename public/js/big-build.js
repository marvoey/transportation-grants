/**
 * Behavior for /big-build.html: mode handling, the funding-round tile grid, the scenario calculator
 * and Reveal.js start-up. Every string is written with textContent; nothing here builds HTML.
 * No network requests are made by this file.
 */
(function () {
  'use strict';

  var Model = window.BigBuildModel;
  var root = document.documentElement;

  /** "audience" (default), "presenter" or "record". Anything else is treated as audience. */
  function readMode() {
    var m = '';
    try { m = new URLSearchParams(window.location.search).get('mode') || ''; } catch (e) { m = ''; }
    return m === 'presenter' || m === 'record' ? m : 'audience';
  }

  var mode = readMode();
  root.setAttribute('data-mode', mode);

  // The checklist slide exists only for the presenter. Everywhere else it is removed, so it cannot be reached.
  var checklist = document.querySelector('[data-presenter-slide]');
  if (checklist) {
    if (mode === 'presenter') checklist.removeAttribute('data-visibility');
    else checklist.remove();
  }
  if (mode !== 'presenter') {
    Array.prototype.forEach.call(document.querySelectorAll('.presenter-only'), function (el) { el.remove(); });
  }

  // ---- Funding-round illustration: many small tiles, built with createElement -------------------
  var grid = document.getElementById('applicantGrid');
  if (grid) {
    for (var i = 0; i < 60; i++) {
      var tile = document.createElement('span');
      tile.className = 'tile';
      grid.appendChild(tile);
    }
  }

  // ---- Scenario calculator ---------------------------------------------------------------------
  var els = {
    apps: document.getElementById('calcApps'),
    adoption: document.getElementById('calcAdoption'),
    hours: document.getElementById('calcHours'),
    out: document.getElementById('calcOut'),
    reset: document.getElementById('calcReset'),
    numApps: document.getElementById('numApps'),
    numAdoption: document.getElementById('numAdoption'),
    numFreed: document.getElementById('numFreed'),
    numPercent: document.getElementById('numPercent')
  };

  function fmt(n) {
    // Whole numbers stay whole; otherwise one decimal. Never changes the underlying value.
    return (Math.round(n * 10) / 10).toLocaleString('en-US');
  }

  function renderScenario() {
    if (!Model || !els.apps) return;
    var s = Model.scenario({
      applications: els.apps.value,
      adoptionPct: els.adoption.value,
      hoursSavedPerAssessment: els.hours.value
    });
    els.numApps.textContent = fmt(s.applications);
    els.numAdoption.textContent = fmt(s.adoptionPct);
    els.numFreed.textContent = fmt(Model.approxHours(s.hoursPotentiallyFreed));
    els.out.textContent = fmt(s.assistedAssessments) + ' assisted assessments × ' + fmt(s.hoursSavedPerAssessment) +
      ' h = ' + fmt(s.hoursPotentiallyFreed) + ' h potentially freed (modeled, not measured)';
  }

  function resetScenario() {
    els.apps.value = String(Model.DEFAULTS.applications);
    els.adoption.value = String(Model.DEFAULTS.adoptionPct);
    els.hours.value = String(Model.DEFAULTS.hoursSavedPerAssessment);
    renderScenario();
  }

  if (Model && els.apps) {
    els.numPercent.textContent = '~' + String(Model.approxPercent(Model.perAssessment().percentReduction));
    ['input', 'change'].forEach(function (evt) {
      [els.apps, els.adoption, els.hours].forEach(function (input) { input.addEventListener(evt, renderScenario); });
    });
    els.reset.addEventListener('click', resetScenario);
    // Keys typed into the calculator must not turn slides.
    [els.apps, els.adoption, els.hours].forEach(function (input) {
      input.addEventListener('keydown', function (e) { e.stopPropagation(); });
    });
    renderScenario();
  }

  // ---- Reveal.js -------------------------------------------------------------------------------
  if (typeof Reveal === 'undefined') {
    var warn = document.createElement('p');
    warn.className = 'deck-error';
    warn.textContent = 'The presentation engine did not load. Check that public/vendor/reveal/ is present (npm run presentation:vendor).';
    document.body.insertBefore(warn, document.body.firstChild);
    return;
  }

  var record = mode === 'record';
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduceMotion = false; }
  if (record || reduceMotion) root.setAttribute('data-motion', 'off');

  var plugins = [];
  // The speaker view is presenter material: it is not loaded for the recording view.
  if (!record && typeof RevealNotes !== 'undefined') plugins.push(RevealNotes);

  var deck = new Reveal(document.getElementById('main-deck'), {
    width: 1920,
    height: 1080,
    margin: 0.02,
    center: false,
    display: 'flex',
    hash: true,
    history: false,
    controls: !record,
    controlsTutorial: false,
    controlsLayout: 'bottom-right',
    progress: !record,
    slideNumber: record ? false : 'c/t',
    transition: record || reduceMotion ? 'none' : 'fade',
    transitionSpeed: 'default',
    backgroundTransition: 'none',
    fragments: true,
    keyboard: true,
    touch: true,
    help: !record,
    plugins: plugins
  });

  deck.initialize();
  window.BigBuildDeck = deck; // handle for rehearsal and browser checks
})();
