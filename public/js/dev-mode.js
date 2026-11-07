/**
 * Developer mode: one switch for everything meant for developers on Find grants, plus one choice per section. Off by
 * default; when it is turned on, every section is shown until it is unticked in the Dev tray.
 *
 *   DevMode.isOn()               -> boolean (the master switch)
 *   DevMode.set(true)            -> turns the master switch on or off
 *   DevMode.sections             -> the section ids
 *   DevMode.sectionOn(id)        -> whether that section is ticked (it only shows while the master switch is on)
 *   DevMode.setSection(id, true) -> ticks or unticks a section
 *   DevMode.shows(id)            -> isOn() && sectionOn(id): whether that section is visible right now
 *
 * Developer-only content carries the classes "dev-only dev-section-<id>". CSS hides it unless <body> has the class
 * "dev-mode", and hides a section whose id is unticked through the body class "dev-hide-<id>". So flipping a switch
 * works on what is already on the page, with no re-render. The choices are kept in localStorage where the browser
 * allows it; when it does not (private window, blocked storage), they still work for the life of the page.
 * Each change announces "devmodechange" with { on, sections: { id: boolean } }.
 */
(function () {
  'use strict';

  var MODE_KEY = 'grantflow.devMode';
  var SECTIONS_KEY = 'grantflow.devSections';
  var SECTIONS = ['console', 'apicalls', 'note', 'trace', 'built', 'scored'];

  var on = false;
  var enabled = {};

  SECTIONS.forEach(function (id) { enabled[id] = true; });

  try {
    on = window.localStorage.getItem(MODE_KEY) === 'on';
  } catch (e) {
    on = false;
  }

  try {
    var stored = JSON.parse(window.localStorage.getItem(SECTIONS_KEY));
    // A list of the ticked section ids; anything else (missing, damaged, unknown ids) means "all ticked".
    if (Array.isArray(stored)) {
      SECTIONS.forEach(function (id) { enabled[id] = stored.indexOf(id) !== -1; });
    }
  } catch (e) {
    /* keep every section ticked */
  }

  function save() {
    try {
      window.localStorage.setItem(MODE_KEY, on ? 'on' : 'off');
      window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(SECTIONS.filter(function (id) { return enabled[id]; })));
    } catch (e) {
      /* the choices just are not remembered */
    }
  }

  function apply() {
    document.body.classList.toggle('dev-mode', on);
    SECTIONS.forEach(function (id) { document.body.classList.toggle('dev-hide-' + id, !enabled[id]); });
  }

  function announce() {
    var copy = {};
    SECTIONS.forEach(function (id) { copy[id] = enabled[id]; });
    document.dispatchEvent(new CustomEvent('devmodechange', { detail: { on: on, sections: copy } }));
  }

  function set(value) {
    on = !!value;
    save();
    apply();
    announce();
  }

  function setSection(id, value) {
    if (SECTIONS.indexOf(id) === -1) return;
    enabled[id] = !!value;
    save();
    apply();
    announce();
  }

  window.DevMode = {
    sections: SECTIONS.slice(),
    isOn: function () { return on; },
    set: set,
    sectionOn: function (id) { return enabled[id] === true; },
    setSection: setSection,
    shows: function (id) { return on && enabled[id] === true; }
  };
  apply();
})();
