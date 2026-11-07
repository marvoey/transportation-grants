/**
 * The "Dev" slide-out tray: holds the developer-mode switch (dev-mode.js). Closed by default, next to the Samples and
 * Answers trays, and it closes itself after the switch is used. Open/close behavior comes from drawer-kit.js. Every string is set with textContent.
 */
(function () {
  'use strict';

  var K = window.DrawerKit;
  var M = window.DevMode;

  function init() {
    var drawer = document.getElementById('devDrawer');
    var tab = document.getElementById('devTab');
    var panel = document.getElementById('devPanel');
    var close = document.getElementById('devClose');
    var toggle = document.getElementById('devModeToggle');
    var status = document.getElementById('devStatus');
    if (!K || !M || !drawer || !tab || !panel || !close || !toggle || !status) return;

    var tray = K.create({ drawer: drawer, tab: tab, panel: panel, close: close });

    function show(on) {
      toggle.checked = on;
      tab.dataset.on = on ? 'true' : 'false';
      tab.title = on ? 'Developer mode (on)' : 'Developer mode (off)';
    }

    show(M.isOn());
    toggle.addEventListener('change', function () {
      M.set(toggle.checked);
      status.textContent = toggle.checked ? 'Developer mode is on.' : 'Developer mode is off.';
      // Like copying from the Samples and Answers trays, using the switch closes the tray so the page is visible.
      tray.setOpen(false, true);
    });
    // Kept in step if something else changes the mode.
    document.addEventListener('devmodechange', function (event) { show(!!(event.detail && event.detail.on)); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
