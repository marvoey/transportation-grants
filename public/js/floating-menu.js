/**
 * Floating menu button. Adds a round button in the top-right corner that opens a small menu of links.
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

  // Every entry has an icon name from ICONS below. Icons are decorative (aria-hidden): the text is the label.
  var ITEMS = [
    { label: 'Big Build presentation companion', href: '/big-build-v2.html', icon: 'slides' },
    { label: 'Documentation', href: '/docs', icon: 'book' },
    // Demo mode entry points (see /js/demo-mode.js and docs/NOFO_DEMO.md).
    { label: 'Open the app in demo mode', href: '/?demo=1', icon: 'play' },
    { label: 'Open the app live (demo mode off)', href: '/?demo=0', icon: 'bolt' },
    { label: 'Record a demo run', href: '/chat.html?demo=record', icon: 'record' },
  ];

  // Fixed 24x24 outline icons (stroke only). Each value is a list of SVG path "d" strings, built with createElementNS,
  // never from an HTML string.
  var ICONS = {
    slides: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'],
    book: ['M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z', 'M4 21V5', 'M9 7h6'],
    play: ['M8 5v14l11-7z'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    record: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 21h16'],
    toggle: ['M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z', 'M7 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
    restart: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
    script: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h7'],
    projects: ['M3 7h7l2 2h9v11H3z', 'M3 7V5h7l2 2']
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function makeIcon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fab-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (ICONS[name] || []).forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  // Fills a link or button: the icon, then the text (in its own span so it can wrap beside the icon).
  function fillEntry(el, icon, label) {
    el.appendChild(makeIcon(icon));
    var text = document.createElement('span');
    text.textContent = label;
    el.appendChild(text);
  }

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
    fillEntry(a, item.icon, item.label);
    li.appendChild(a);
    menu.appendChild(li);
  });

  // Demo-mode actions (see /js/demo-mode.js). These are buttons, not links, so they open nothing new.
  function addAction(label, icon, run) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab-link fab-action';
    fillEntry(b, icon, label);
    b.addEventListener('click', run);
    li.appendChild(b);
    menu.appendChild(li);
  }

  var demo = window.DemoMode;
  if (demo) {
    if (demo.isRecording()) {
      addAction('Download recording', 'download', function () { demo.download(); });
    } else {
      addAction(demo.isOn() ? 'Demo mode: On (turn off)' : 'Demo mode: Off (turn on)', 'toggle', function () { demo.toggle(); });
      if (demo.isOn()) addAction('Restart demo', 'restart', function () { demo.reset(); window.location.reload(); });
    }
  }

  // Separate windows to keep beside the app: the demo script, the click-through, and the sample projects with suggested answers. Offered in
  // every mode (demo on, off or recording) and on every page that has this menu. Each reuses its window if it is open.
  addAction('Open the demo script window', 'script', function () {
    window.open('/demo-script.html', 'grantflowDemoScript', 'popup=yes,width=560,height=900,left=40,top=40');
  });
  addAction('Open the click-through window', 'script', function () {
    window.open('/demo-click-through.html', 'grantflowDemoClickThrough', 'popup=yes,width=560,height=900,left=340,top=60');
  });
  addAction('Open the projects and answers window', 'projects', function () {
    window.open('/demo-projects.html', 'grantflowDemoProjects', 'popup=yes,width=560,height=900,left=640,top=40');
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
