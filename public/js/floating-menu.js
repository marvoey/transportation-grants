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
    { label: 'Big Build presentation', href: '/big-build.html' },
    { label: 'Documentation', href: '/docs' },
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

  // Choosing a link opens a new tab; close the menu so it is not left open behind it.
  menu.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('a')) setOpen(false, false);
  });

  root.appendChild(button);
  root.appendChild(menu);
  document.body.appendChild(root);
})();
