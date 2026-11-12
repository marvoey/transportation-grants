/**
 * Floating menu button. Adds a round button in the bottom-left corner that opens a small menu of links.
 *
 * To add a menu entry, add an item to ITEMS. The list is fixed in code and rendered with
 * textContent/setAttribute only, so nothing here is ever built from user input or HTML strings.
 *
 * RULE: every link in this menu opens in a new tab. The loop below applies target/rel to every
 * item, so new entries get it automatically. Do not add a per-item opt-out. (The chat conversation
 * lives only in this browser tab, and following a link in place would lose it.)
 */
(function () {
  'use strict';

  var ITEMS = [
    { label: 'Big Build presentation companion', href: '/big-build-v2.html' },
    { label: 'Documentation', href: '/docs' },
    // Demo mode entry points (see /js/demo-mode.js and docs/NOFO_DEMO.md).
    { label: 'Open the app in demo mode', href: '/?demo=1' },
    { label: 'Open the app live (demo mode off)', href: '/?demo=0' },
    { label: 'Record a demo run', href: '/chat.html?demo=record' },
  ];

  var MENU_ID = 'fabMenu';

  var root = document.createElement('div');
  root.className = 'fab';

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'fab-button';
  button.setAttribute('aria-label', 'Open menu');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', MENU_ID);
  button.textContent = '☰'; // trigram, decorative: the label comes from aria-label

  var menu = document.createElement('ul');
  menu.className = 'fab-menu';
  menu.id = MENU_ID;
  menu.hidden = true;

  ITEMS.forEach(function (item) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'fab-link';
    a.href = item.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.label;
    li.appendChild(a);
    menu.appendChild(li);
  });

  // Demo-mode actions (see /js/demo-mode.js). These are buttons, not links, so they open nothing new.
  function addAction(label, run) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab-link fab-action';
    b.textContent = label;
    b.addEventListener('click', run);
    li.appendChild(b);
    menu.appendChild(li);
  }

  var demo = window.DemoMode;
  if (demo) {
    if (demo.isRecording()) {
      addAction('Download recording', function () { demo.download(); });
    } else {
      addAction(demo.isOn() ? 'Demo mode: On (turn off)' : 'Demo mode: Off (turn on)', function () { demo.toggle(); });
      if (demo.isOn()) addAction('Restart demo', function () { demo.reset(); window.location.reload(); });
    }
  }

  // A separate window with the demo script and the messages to paste, to keep beside the app. Offered in every mode
  // (demo on, off or recording) and on every page that has this menu.
  addAction('Open the demo script window', function () {
    window.open('/demo-script.html', 'grantflowDemoScript', 'popup=yes,width=560,height=900,left=40,top=40');
  });

  function setOpen(open, returnFocus) {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (!open && returnFocus) button.focus();
  }

  button.addEventListener('click', function () {
    setOpen(menu.hidden, false);
  });

  document.addEventListener('click', function (event) {
    if (!menu.hidden && !root.contains(event.target)) setOpen(false, false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !menu.hidden) setOpen(false, true);
  });

  // Close when keyboard focus leaves the widget (Tab past the last link).
  root.addEventListener('focusout', function (event) {
    if (!menu.hidden && event.relatedTarget && !root.contains(event.relatedTarget)) setOpen(false, false);
  });

  // Choosing a link opens a new tab (and an action does its job); close the menu so it is not left open.
  menu.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('a, .fab-action')) setOpen(false, false);
  });

  root.appendChild(button);
  root.appendChild(menu);
  document.body.appendChild(root);
})();
