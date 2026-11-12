/**
 * Slide-out tray of sample project descriptions (data: sample-projects.js). Closed by default. A small tab on the
 * right edge opens and closes it, on both the Find grants and Assess tabs. Open/close and copy behavior comes from
 * drawer-kit.js.
 *
 * Every string is rendered with textContent.
 */
(function () {
  'use strict';

  var K = window.DrawerKit;
  var projects = window.SampleProjects || [];
  var els = {};
var tray = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function say(message) {
    els.status.textContent = '';
    // A short pause makes a screen reader announce a repeat of the same message.
    setTimeout(function () { els.status.textContent = message; }, 30);
  }

  function renderItem(project) {
    var item = el('article', 'samples-item');
    item.appendChild(el('h3', null, project.title));
    if (project.note) item.appendChild(el('p', 'samples-note', 'Tests: ' + project.note));
    item.appendChild(el('p', 'samples-text', project.text));
    var button = el('button', 'nofo-secondary find-small', 'Copy');
    button.type = 'button';
    button.setAttribute('aria-label', 'Copy the description: ' + project.title);
    // Copy puts the description straight into the question box (replacing what is there) and onto the clipboard, then
    // closes the tray so the text can be seen and edited.
    K.wireCopyButton(button, function () { return project.text; }, project.title, say, function (filled) {
      // Focus stays in the question box when it was filled, rather than going back to the tab.
      if (tray) tray.setOpen(false, !filled);
    }, 'replace');
    item.appendChild(button);
    return item;
  }

  function init() {
    els.drawer = document.getElementById('samplesDrawer');
    els.tab = document.getElementById('samplesTab');
    els.panel = document.getElementById('samplesPanel');
    els.close = document.getElementById('samplesClose');
    els.list = document.getElementById('samplesList');
    els.status = document.getElementById('samplesStatus');
    if (!K || !els.drawer || !els.tab || !els.panel || !els.close || !els.list || !els.status) return;
    if (projects.length === 0) {
      els.drawer.hidden = true;
      return;
    }

    projects.forEach(function (project) { els.list.appendChild(renderItem(project)); });
    tray = K.create({ drawer: els.drawer, tab: els.tab, panel: els.panel, close: els.close });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
