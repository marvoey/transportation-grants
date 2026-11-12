/**
 * The demo script window (opened from the floating menu). It shows the live-app demo script one scene at a time
 * (SHOW/DO, SAY, DIRECTING NOTE), with a Copy button on each SAY block (clipboard only). The sample projects and suggested
 * answers are in the other presenter window (demo-projects.html). Shared helpers: presenter-kit.js.
 * The content is /demo/demo-script.json, built from docs/GrantFlow_BigBuild_Live_App_Demo_Script.md by `npm run demo:script`.
 * Everything is rendered with textContent, never as HTML.
 */
(function () {
  'use strict';

  var K = window.PresenterKit;
  var el = K.el;
  var copyButton = K.copyButton;
  var data = null;
  var index = 0;
  var els = {};

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

  function go(i) {
    index = Math.max(0, Math.min(data.scenes.length - 1, i));
    renderScene();
  }

  function init() {
    els.setup = document.getElementById('dsSetup');
    els.chips = document.getElementById('dsChips');
    els.scene = document.getElementById('dsScene');
    els.position = document.getElementById('dsPosition');
    els.prev = document.getElementById('dsPrev');
    els.next = document.getElementById('dsNext');
    els.error = document.getElementById('dsError');
    els.prev.addEventListener('click', function () { go(index - 1); });
    els.next.addEventListener('click', function () { go(index + 1); });
    document.addEventListener('keydown', function (event) {
      if (!data || event.altKey || event.ctrlKey || event.metaKey) return;
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
