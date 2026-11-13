/**
 * Helpers shared by the two presenter windows: the demo script (demo-script.html) and the projects and answers window
 * (demo-projects.html). Both are opened from the floating menu of the app page.
 *
 *   el(tag, className, text)              a text-only element (nothing is ever parsed as HTML)
 *   say(message)                          a short message in the bar at the bottom of the window (#dsCopyStatus)
 *   fillApp(text)                         type the text into the app window's question box (the app's own typing routine)
 *   sendApp()                             click Send in the app window (the app's own Send button of the open tab)
 *   copy(text, what, intoApp, sendAfterMs)  copy to the clipboard, and also type into the app when intoApp is true; with sendAfterMs
 *                                         (milliseconds) it then clicks Send in the app that long after, if the box was filled
 *   copyButton(text, what, intoApp, label, sendAfterMs)  a Copy button doing that
 *
 * Exposes window.PresenterKit.
 */
(function () {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function say(message) {
    var status = document.getElementById('dsCopyStatus');
    if (!status) return;
    status.textContent = message;
    clearTimeout(say.timer);
    say.timer = setTimeout(function () { status.textContent = ''; }, 2500);
  }

  /**
   * Types `text` into the question box of the app window (Find grants or Assess, whichever is open), using the app's own
   * typing routine. Returns true when the box is being filled; false when this window was not opened from the app, the app
   * page was closed or has no such box, or the box is not available right now (for example while a request runs).
   */
  // When true, filling the app's question box does not scroll the app page to the box (the click-through window turns this on).
  var keepAppScroll = false;
  function setKeepAppScroll(on) {
    keepAppScroll = !!on;
    pushHold(keepAppScroll);
  }
  /** Tells the app page to hold still (not scroll itself during a turn) or to go back to normal. */
  function pushHold(on) {
    try {
      var app = window.opener;
      if (app && !app.closed && app.DrawerKit && typeof app.DrawerKit.setHoldScroll === 'function') app.DrawerKit.setHoldScroll(on);
    } catch (e) {
      /* the opener is gone or not readable */
    }
  }
  // Closing or reloading this window gives the app its own scrolling back.
  window.addEventListener('pagehide', function () { if (keepAppScroll) pushHold(false); });

  function fillApp(text) {
    try {
      var app = window.opener;
      if (app && !app.closed && app.DrawerKit && typeof app.DrawerKit.fillQuestion === 'function') return !!app.DrawerKit.fillQuestion(text, 'replace', keepAppScroll ? { preventScroll: true } : undefined);
    } catch (e) {
      /* the opener is gone or not readable: the clipboard copy still happens */
    }
    return false;
  }

  /** Clicks Send in the app window. Returns true when it was clicked; false when the app is gone, has nothing to send, or is busy. */
  function sendApp() {
    try {
      var app = window.opener;
      if (app && !app.closed && app.DrawerKit && typeof app.DrawerKit.sendQuestion === 'function') return !!app.DrawerKit.sendQuestion();
    } catch (e) {
      /* the opener is gone or not readable */
    }
    return false;
  }

  function copy(text, what, intoApp, sendAfterMs) {
    clearTimeout(copy.sendTimer); // a Send still waiting from an earlier Copy is cancelled, so two messages are never sent together
    if (keepAppScroll) pushHold(true); // again, in case the app page was reloaded since this window opened
    var filled = intoApp ? fillApp(text) : false;
    if (filled && sendAfterMs > 0) {
      copy.sendTimer = setTimeout(function () {
        say(sendApp() ? 'Clicked Send in the app' : 'Could not click Send: the app is busy or its question box is empty');
      }, sendAfterMs);
    }
    var note = intoApp && !filled ? ' (the app\'s question box is not available: open this window from the app\'s menu, with Find grants or Assess showing)' : '';
    var done = function () { say(filled ? 'Typing into the app: ' + what + ' (also copied)' + (sendAfterMs > 0 ? '; Send is clicked in ' + Math.round(sendAfterMs / 1000) + ' seconds' : '') : 'Copied: ' + what + note); };
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

  function copyButton(text, what, intoApp, label, sendAfterMs) {
    var b = el('button', 'ds-btn ds-copy', label || 'Copy');
    b.type = 'button';
    b.setAttribute('aria-label', (intoApp ? 'Type into the app and copy ' : 'Copy ') + what);
    b.addEventListener('click', function () { copy(text, what, intoApp, sendAfterMs); });
    return b;
  }

  window.PresenterKit = { el: el, say: say, setKeepAppScroll: setKeepAppScroll, fillApp: fillApp, sendApp: sendApp, copy: copy, copyButton: copyButton };
})();
