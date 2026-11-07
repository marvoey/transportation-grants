/**
 * Main navigation: marks the current link and, on chat.html, switches the chat tabs in place.
 *
 * Why in place: the conversation lives only in this browser tab, so following a link to
 * /chat.html?mode=nofo from chat.html would reload the page and lose it. Load this script
 * BEFORE nofo.js on chat.html so it hears the first "chatmodechange" event.
 */
(function () {
  'use strict';

  var TAB_IDS = { find: 'modeFindTab', nofo: 'modeNofoTab', search: 'modeSearchTab' };
  var links = Array.prototype.slice.call(document.querySelectorAll('nav a[data-nav]'));
  var onChatPage = !!document.getElementById(TAB_IDS.find);

  function markCurrent(key) {
    links.forEach(function (link) {
      if (link.getAttribute('data-nav') === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  if (!onChatPage) {
    markCurrent('home');
    return;
  }

  // Start from the mode the page already reports, then follow changes.
  markCurrent(document.body.dataset.chatMode || 'find');
  document.addEventListener('chatmodechange', function (event) {
    var mode = event && event.detail && event.detail.mode;
    if (TAB_IDS[mode]) markCurrent(mode);
  });

  links.forEach(function (link) {
    var key = link.getAttribute('data-nav');
    if (!TAB_IDS[key]) return; // Home is a normal link
    link.addEventListener('click', function (event) {
      // Let the browser handle new-tab / new-window clicks.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var tab = document.getElementById(TAB_IDS[key]);
      if (!tab) return;
      event.preventDefault();
      tab.click();
    });
  });
})();
