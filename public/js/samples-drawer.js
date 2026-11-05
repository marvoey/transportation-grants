/**
 * Slide-out tray of sample project descriptions (data: sample-projects.js). Closed by default. A small tab on the
 * right edge opens and closes it. It is available on the Find grants and Assess tabs only: on the original chat tab it
 * is hidden, and it closes if you switch there. Open/close and copy behavior comes from drawer-kit.js.
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
    K.wireCopyButton(button, function () { return project.text; }, project.title, say, function () {
      // Copying a description closes the tray, so the pasted text can be seen in the conversation.
      if (tray) tray.setOpen(false, true);
    });
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

    // Available on Find grants and Assess; hidden (and closed) on the original chat tab.
    function applyMode(mode) { tray.setAvailable(mode !== 'search'); }
    applyMode(document.body.dataset.chatMode || 'find');
    document.addEventListener('chatmodechange', function (event) { applyMode(event.detail && event.detail.mode); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
