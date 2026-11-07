/**
 * Developer mode: one switch for everything meant for developers (the developer console, the API calls and the
 * explanations of how a list was built on Find grants). Off by default.
 *
 *   DevMode.isOn()         -> boolean
 *   DevMode.set(true)      -> turns it on or off, remembers the choice, and announces "devmodechange"
 *
 * Developer-only content carries the class "dev-only" and is hidden by CSS unless <body> has the class "dev-mode", so
 * flipping the switch works on what is already on the page, with no re-render. The choice is kept in localStorage
 * where the browser allows it; when it does not (private window, blocked storage), the switch still works for the
 * life of the page.
 */
(function () {
  'use strict';

  var KEY = 'grantflow.devMode';
  var on = false;

  try {
    on = window.localStorage.getItem(KEY) === 'on';
  } catch (e) {
    on = false;
  }

  function apply() {
    document.body.classList.toggle('dev-mode', on);
  }

  function set(value) {
    on = !!value;
    try {
      window.localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (e) {
      /* the choice just is not remembered */
    }
    apply();
    document.dispatchEvent(new CustomEvent('devmodechange', { detail: { on: on } }));
  }

  window.DevMode = { isOn: function () { return on; }, set: set };
  apply();
})();
