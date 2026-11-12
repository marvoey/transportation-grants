/**
 * A small toggle at the bottom-right of the page that hides the tabs of the slide-out trays (Samples, Answers, Dev, Settings),
 * for a clean screen while recording. It adds the class "hide-tray-tabs" to <body> (the CSS does the hiding), remembers the
 * choice in this browser, and keeps working when the tabs are hidden. A tray that is open keeps its tab, so it can be closed.
 * The page works without it.
 */
(function () {
  'use strict';

  var KEY = 'grantflow.hideTrayTabs';
  var CLASS = 'hide-tray-tabs';

  function read() {
    try { return window.localStorage.getItem(KEY) === 'on'; } catch (e) { return false; }
  }

  function write(on) {
    try { window.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* not remembered, still works for this page */ }
  }

  function init() {
    if (!document.querySelector('.tray')) return; // a page without trays has nothing to hide
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'tray-toggle';

    function apply(hidden) {
      document.body.classList.toggle(CLASS, hidden);
      button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      var label = hidden ? 'Show the side tabs' : 'Hide the side tabs';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.textContent = hidden ? '‹' : '›'; // a chevron pointing toward where the tabs are, or into the edge
    }

    button.addEventListener('click', function () {
      var hidden = !document.body.classList.contains(CLASS);
      apply(hidden);
      write(hidden);
    });
    apply(read());
    document.body.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
