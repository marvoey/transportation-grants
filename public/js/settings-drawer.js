/**
 * The "Settings" slide-out tray: two switches (app-settings.js). One shows or hides the "Preliminary only" notice at the
 * top of Find grants; the other turns on a simulated "Prepare this opportunity" for opportunities whose documents are
 * already downloaded (prepare-replay.js). Closed by default, next to the Samples, Answers and Dev trays. Using a switch
 * closes the tray, like the other trays, so the page is visible. The tray is only offered on the Find grants view,
 * because that is where both settings apply. Open/close behavior comes from drawer-kit.js. Every string is set with
 * textContent.
 */
(function () {
  'use strict';

  var K = window.DrawerKit;
  var S = window.AppSettings;

  function init() {
    var drawer = document.getElementById('settingsDrawer');
    var tab = document.getElementById('settingsTab');
    var panel = document.getElementById('settingsPanel');
    var close = document.getElementById('settingsClose');
    var toggle = document.getElementById('findNoticeToggle');
    var simulateToggle = document.getElementById('simulatePrepareToggle');
    var status = document.getElementById('settingsStatus');
    if (!K || !S || !drawer || !tab || !panel || !close || !toggle || !simulateToggle || !status) return;

    var tray = K.create({ drawer: drawer, tab: tab, panel: panel, close: close });

    function show() {
      toggle.checked = S.showFindNotice();
      simulateToggle.checked = S.simulatePrepare();
    }
    show();

    toggle.addEventListener('change', function () {
      S.setShowFindNotice(toggle.checked);
      status.textContent = toggle.checked ? 'The notice is shown on Find grants.' : 'The notice is hidden on Find grants.';
      // Like copying from the Samples and Answers trays, using the switch closes the tray so the page is visible.
      tray.setOpen(false, true);
    });

    simulateToggle.addEventListener('change', function () {
      S.setSimulatePrepare(simulateToggle.checked);
      status.textContent = simulateToggle.checked
        ? 'Preparing is simulated for opportunities whose documents are already downloaded, from the next search.'
        : 'Preparing is not simulated.';
      tray.setOpen(false, true);
    });

    // Kept in step if something else changes the setting.
    document.addEventListener('appsettingschange', show);

    // Both settings apply to Find grants only, so the tray is offered there only.
    function applyMode(mode) {
      tray.setAvailable(mode === 'find');
    }
    applyMode(document.body.dataset.chatMode || 'find');
    document.addEventListener('chatmodechange', function (event) { applyMode(event.detail && event.detail.mode); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
