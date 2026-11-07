/**
 * The "Dev" slide-out tray: the developer-mode switch and one checkbox per developer section (dev-mode.js). Closed by
 * default, next to the Samples and Answers trays. Using the main switch closes the tray, like copying from the other
 * trays; the section checkboxes leave it open so several can be changed in one visit. The checkboxes are disabled
 * while developer mode is off. Open/close behavior comes from drawer-kit.js. Every string is set with textContent.
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
    var group = panel && panel.querySelector('.dev-sections');
    var boxes = panel ? Array.prototype.slice.call(panel.querySelectorAll('input[data-dev-section]')) : [];
    if (!K || !M || !drawer || !tab || !panel || !close || !toggle || !status || !group) return;

    var tray = K.create({ drawer: drawer, tab: tab, panel: panel, close: close });

    function show() {
      var on = M.isOn();
      toggle.checked = on;
      group.disabled = !on;
      boxes.forEach(function (box) { box.checked = M.sectionOn(box.dataset.devSection); });
      tab.dataset.on = on ? 'true' : 'false';
      tab.title = on ? 'Developer mode (on)' : 'Developer mode (off)';
    }

    show();

    toggle.addEventListener('change', function () {
      M.set(toggle.checked);
      status.textContent = toggle.checked ? 'Developer mode is on.' : 'Developer mode is off.';
      // Like copying from the Samples and Answers trays, using the switch closes the tray so the page is visible.
      tray.setOpen(false, true);
    });

    boxes.forEach(function (box) {
      box.addEventListener('change', function () {
        M.setSection(box.dataset.devSection, box.checked);
        var label = box.parentNode.querySelector('strong');
        status.textContent = (label ? label.textContent : 'Section') + (box.checked ? ' is shown.' : ' is hidden.');
      });
    });

    // Kept in step if something else changes the mode.
    document.addEventListener('devmodechange', show);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
