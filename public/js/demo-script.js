/**
 * The presenter window for demo mode (opened from the floating menu). It shows the live-app demo script one scene at a time
 * (SHOW/DO, SAY, DIRECTING NOTE), with a Copy button on each SAY block (clipboard only).
 * The window has three tabs: Script (this file), and Samples and Answers (demo-script-tabs.js, which uses the helpers this file
 * shares as window.DemoScriptKit). Copy on a SAY block only copies; the Samples and Answers tabs type into the app.
 * The content is /demo/demo-script.json, built from docs/GrantFlow_BigBuild_Live_App_Demo_Script.md by `npm run demo:script`.
 * Everything is rendered with textContent, never as HTML.
 */
(function () {
  'use strict';

  var data = null;
  var index = 0;
  var els = {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Text with **bold** and `code` marks, as elements (no HTML parsing). */
  function inline(parent, text) {
    String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (part) {
      if (!part) return;
      if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') parent.appendChild(el('strong', null, part.slice(2, -2)));
      else if (part.length > 2 && part.charAt(0) === '`' && part.slice(-1) === '`') parent.appendChild(el('code', null, part.slice(1, -1)));
      else parent.appendChild(document.createTextNode(part));
    });
    return parent;
  }

  function plain(text) {
    return String(text).replace(/\*\*/g, '').replace(/`/g, '');
  }

  function say(message) {
    els.status.textContent = message;
    clearTimeout(say.timer);
    say.timer = setTimeout(function () { els.status.textContent = ''; }, 2500);
  }

  /**
   * Types `text` into the question box of the app window (Find grants or Assess, whichever is open), using the app's own
   * typing routine. Returns true when the box is being filled; false when this window was not opened from the app, the app
   * page was closed or has no such box, or the box is not available right now (for example while a request runs).
   */
  function fillApp(text) {
    try {
      var app = window.opener;
      if (app && !app.closed && app.DrawerKit && typeof app.DrawerKit.fillQuestion === 'function') return !!app.DrawerKit.fillQuestion(text, 'replace');
    } catch (e) {
      /* the opener is gone or not readable: the clipboard copy still happens */
    }
    return false;
  }

  function copy(text, what, intoApp) {
    var filled = intoApp ? fillApp(text) : false;
    var note = intoApp && !filled ? ' (the app\'s question box is not available: open this window from the app\'s menu, with Find grants or Assess showing)' : '';
    var done = function () { say(filled ? 'Typing into the app: ' + what + ' (also copied)' : 'Copied: ' + what + note); };
    var fallback = function () {
      var area = el('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      if (ok || filled) done(); else say('Could not copy: select the text and copy it.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function copyButton(text, what, intoApp, label) {
    var b = el('button', 'ds-btn ds-copy', label || 'Copy');
    b.type = 'button';
    b.setAttribute('aria-label', (intoApp ? 'Type into the app and copy ' : 'Copy ') + what);
    b.addEventListener('click', function () { copy(text, what, intoApp); });
    return b;
  }

  function renderSetup() {
    data.setup.forEach(function (item) {
      var li = el('li');
      inline(li, item.text);
      if (item.sub.length) {
        var ul = el('ul');
        item.sub.forEach(function (s) { inline(ul.appendChild(el('li')), s); });
        li.appendChild(ul);
      }
      els.setup.appendChild(li);
    });
  }

  function renderChips() {
    data.scenes.forEach(function (scene, i) {
      var chip = el('button', 'ds-chip', scene.time.split(/[–-]/)[0]);
      chip.type = 'button';
      chip.setAttribute('aria-label', 'Scene ' + (i + 1) + ': ' + scene.time + ' ' + scene.title);
      chip.addEventListener('click', function () { go(i); });
      els.chips.appendChild(chip);
    });
  }

  function renderScene() {
    var scene = data.scenes[index];
    els.scene.textContent = '';
    var head = el('div', 'ds-scene-head');
    head.appendChild(el('span', 'ds-time', scene.time));
    head.appendChild(el('h2', null, scene.title));
    els.scene.appendChild(head);
    scene.blocks.forEach(function (block) {
      if (block.kind === 'fallback') { els.scene.appendChild(el('h3', 'ds-fallback', plain(block.label))); return; }
      var box = el('section', 'ds-block ds-block-' + block.kind);
      var top = el('div', 'ds-block-top');
      top.appendChild(el('span', 'ds-label', plain(block.label)));
      if (block.kind === 'say') top.appendChild(copyButton(plain(block.text), 'the words to say'));
      box.appendChild(top);
      var p = el('p', block.kind === 'say' ? 'ds-say' : null);
      inline(p, block.text);
      box.appendChild(p);
      els.scene.appendChild(box);
    });
    els.position.textContent = 'Scene ' + (index + 1) + ' of ' + data.scenes.length;
    els.prev.disabled = index === 0;
    els.next.disabled = index === data.scenes.length - 1;
    Array.prototype.forEach.call(els.chips.children, function (chip, i) {
      chip.classList.toggle('ds-chip-active', i === index);
      if (i === index) chip.setAttribute('aria-current', 'true'); else chip.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  var TABS = ['script', 'samples', 'answers'];
  var activeTab = 'script';

  function showTab(name, focus) {
    if (TABS.indexOf(name) < 0) return;
    activeTab = name;
    document.body.dataset.tab = name;
    TABS.forEach(function (t) {
      var tab = document.getElementById('dsTab' + t.charAt(0).toUpperCase() + t.slice(1));
      var panel = document.getElementById('dsPanel' + t.charAt(0).toUpperCase() + t.slice(1));
      var on = t === name;
      tab.classList.toggle('ds-tab-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && focus) tab.focus();
    });
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('dstabchange', { detail: { tab: name } }));
  }

  function wireTabs() {
    var tabs = document.querySelectorAll('.ds-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () { showTab(tab.dataset.tab, false); });
      tab.addEventListener('keydown', function (event) {
        var i = TABS.indexOf(tab.dataset.tab);
        if (event.key === 'ArrowRight') { event.preventDefault(); showTab(TABS[(i + 1) % TABS.length], true); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); showTab(TABS[(i + TABS.length - 1) % TABS.length], true); }
      });
    });
  }

  window.DemoScriptKit = { el: el, say: say, copy: copy, copyButton: copyButton, fillApp: fillApp, activeTab: function () { return activeTab; } };

  function go(i) {
    index = Math.max(0, Math.min(data.scenes.length - 1, i));
    renderScene();
  }

  function init() {
    els.status = document.getElementById('dsCopyStatus');
    els.setup = document.getElementById('dsSetup');
    els.chips = document.getElementById('dsChips');
    els.scene = document.getElementById('dsScene');
    els.position = document.getElementById('dsPosition');
    els.prev = document.getElementById('dsPrev');
    els.next = document.getElementById('dsNext');
    els.error = document.getElementById('dsError');
    wireTabs();
    if (window.DemoScriptTabs) window.DemoScriptTabs.init(window.DemoScriptKit);
    els.prev.addEventListener('click', function () { go(index - 1); });
    els.next.addEventListener('click', function () { go(index + 1); });
    document.addEventListener('keydown', function (event) {
      if (!data || activeTab !== 'script' || event.altKey || event.ctrlKey || event.metaKey) return;
      var target = event.target && event.target.tagName;
      if (target === 'INPUT' || target === 'TEXTAREA' || target === 'SUMMARY') return;
      if (event.key === 'ArrowRight') go(index + 1);
      else if (event.key === 'ArrowLeft') go(index - 1);
    });
    fetch('/demo/demo-script.json').then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.json();
    }).then(function (json) {
      if (!json || !Array.isArray(json.scenes) || !Array.isArray(json.setup) || json.scenes.length === 0) throw new Error('unreadable');
      data = json;
      document.getElementById('dsTitle').textContent = plain(data.title || 'Demo script');
      renderSetup();
      renderChips();
      go(0);
    }).catch(function () {
      els.error.textContent = 'The demo script could not be loaded. Run "npm run demo:script" to build it from the markdown.';
      els.error.hidden = false;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
