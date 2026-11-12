/**
 * Small page settings, kept in this browser. The Settings tray (settings-drawer.js) turns them on and off. The notice is
 * off by default; the simulated preparing is on by default:
 *
 *   1. Whether the "Preliminary only" notice is shown at the top of Find grants. (The notice is in the page, with the
 *      hidden attribute, so it never flashes up on load.)
 *   2. Whether "Prepare this opportunity" is a simulated replay for an opportunity whose documents are already
 *      downloaded and read on this server (prepare-replay.js). For demonstrations: nothing is downloaded or sent.
 *
 *   AppSettings.showFindNotice()          -> boolean
 *   AppSettings.setShowFindNotice(true)   -> shows or hides the notice and remembers the choice
 *   AppSettings.simulatePrepare()         -> boolean
 *   AppSettings.setSimulatePrepare(true)  -> turns the simulated preparation on or off and remembers the choice
 *   AppSettings.hideAssessNotice()        -> boolean (the "Preliminary only" box on Assess is shown unless this is true)
 *   AppSettings.setHideAssessNotice(true) -> hides or shows that box and remembers the choice
 *
 * The choices are kept in localStorage where the browser allows it; when it does not (private window, blocked storage)
 * they still work for the life of the page. Each change announces "appsettingschange" with { showFindNotice,
 * simulatePrepare, hideAssessNotice }.
 */
(function () {
  'use strict';

  var KEY = 'grantflow.showFindNotice';
  var SIMULATE_KEY = 'grantflow.simulatePrepare';
  var HIDE_ASSESS_KEY = 'grantflow.hideAssessNotice';
  var NOTICE_ID = 'findNotice';
  var ASSESS_NOTICE_ID = 'assessNotice';

  /** The saved choice, or `fallback` when nothing (or nothing recognisable) is saved or storage is blocked. */
  function remembered(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      if (value === 'on') return true;
      if (value === 'off') return false;
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  function remember(key, value) {
    try {
      window.localStorage.setItem(key, value ? 'on' : 'off');
    } catch (e) {
      /* the choice is just not remembered */
    }
  }

  var shown = remembered(KEY, false);
  var simulate = remembered(SIMULATE_KEY, true);
  var hideAssess = remembered(HIDE_ASSESS_KEY, false);

  function apply() {
    var notice = document.getElementById(NOTICE_ID);
    if (notice) notice.hidden = !shown;
    var assessNotice = document.getElementById(ASSESS_NOTICE_ID);
    if (assessNotice) assessNotice.hidden = hideAssess;
  }

  function announce() {
    document.dispatchEvent(new CustomEvent('appsettingschange', { detail: { showFindNotice: shown, simulatePrepare: simulate, hideAssessNotice: hideAssess } }));
  }

  function set(value) {
    shown = !!value;
    remember(KEY, shown);
    apply();
    announce();
  }

  function setSimulate(value) {
    simulate = !!value;
    remember(SIMULATE_KEY, simulate);
    announce();
  }

  function setHideAssess(value) {
    hideAssess = !!value;
    remember(HIDE_ASSESS_KEY, hideAssess);
    apply();
    announce();
  }

  window.AppSettings = {
    showFindNotice: function () { return shown; },
    setShowFindNotice: set,
    simulatePrepare: function () { return simulate; },
    setSimulatePrepare: setSimulate,
    hideAssessNotice: function () { return hideAssess; },
    setHideAssessNotice: setHideAssess
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
