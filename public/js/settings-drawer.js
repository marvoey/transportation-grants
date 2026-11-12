/**
 * The "Settings" slide-out tray (app-settings.js). On Find grants: one switch shows or hides the "Preliminary only" notice at
 * the top, and another turns on a simulated "Prepare this opportunity" for opportunities whose documents are already
 * downloaded (prepare-replay.js). On Assess: one switch hides the "Preliminary only" box. Each tab shows only its own
 * switches. Closed by default, next to the Samples, Answers and Dev trays. Using a switch closes the tray, like the other
 * trays, so the page is visible. The tray is offered on Find grants and Assess (not on the original chat tab). Open/close
 * behavior comes from drawer-kit.js. Every string is set with textContent.
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
    var assessToggle = document.getElementById('assessNoticeToggle');
    var status = document.getElementById('settingsStatus');
    if (!K || !S || !drawer || !tab || !panel || !close || !toggle || !simulateToggle || !assessToggle || !status) return;

    var tray = K.create({ drawer: drawer, tab: tab, panel: panel, close: close });

    function show() {
      toggle.checked = S.showFindNotice();
      simulateToggle.checked = S.simulatePrepare();
      assessToggle.checked = S.hideAssessNotice();
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

    assessToggle.addEventListener('change', function () {
      S.setHideAssessNotice(assessToggle.checked);
      status.textContent = assessToggle.checked ? 'The Preliminary only box is hidden on Assess.' : 'The Preliminary only box is shown on Assess.';
      tray.setOpen(false, true);
    });

    // Kept in step if something else changes the setting.
    document.addEventListener('appsettingschange', show);

    // Each tab has its own settings: the tray is offered on Find grants and Assess, showing only that tab's switches.
    var groups = panel.querySelectorAll('[data-settings-for]');
    function applyMode(mode) {
      tray.setAvailable(mode === 'find' || mode === 'nofo');
      for (var i = 0; i < groups.length; i++) groups[i].hidden = groups[i].getAttribute('data-settings-for') !== mode;
    }
    applyMode(document.body.dataset.chatMode || 'find');
    document.addEventListener('chatmodechange', function (event) { applyMode(event.detail && event.detail.mode); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
