/**
 * Shared behavior for the slide-out trays on the right edge of the chat page (sample project descriptions, suggested
 * answers). Exposes window.DrawerKit.
 *
 *   var tray = DrawerKit.create({ drawer, tab, panel, close });
 *   tray.setAvailable(false);   // hide it (and close it)
 *   DrawerKit.copyText(text).then(...);
 *   DrawerKit.fillQuestion(text, 'replace' | 'append')   // types text into the question box of the open tab
 *
 * A tray is closed by default. The tab toggles it; copying from it closes it; the × button and Escape close it; only one tray is open at a time;
 * a closed tray cannot be reached by keyboard.
 */
(function () {
  'use strict';

  /** Copies text to the clipboard. Resolves when it worked, rejects when it did not. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  // The typing in progress, if any: { box, timer, finish }. Only one at a time.
  var typing = null;

  /** Ends any typing in progress at once, leaving the whole text in the box. Safe to call when nothing is typing. */
  function finishTyping() {
    if (typing) typing.finish();
  }

  // Sending the question (the Send button or Enter, both of which submit the form) while text is still being typed in
  // completes it first, so a half-typed message is never sent. Capture phase: this runs before the page's own handler.
  document.addEventListener('submit', finishTyping, true);

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * Puts `text` in the question box of the tab that is open (Find grants or Assess), so a tray's Copy button needs no
   * paste. 'replace' swaps what is in the box; 'append' adds it after what is there, under a blank line (or replaces it if
   * the result would be longer than the box accepts).
   *
   * The text is typed in, character by character, at a human and uneven pace (typing-util.js), while the box is read-only.
   * All of it is typed within 1.5 seconds, however long it is.
   * It appears all at once instead when the person asks their system for reduced motion or typing-util.js is missing.
   * Clicking a second Copy while one is typing cancels the first. Returns true when the box is being filled, false when
   * there is no box to fill (another tab, or the box is switched off while a request runs), in which case the clipboard copy
   * is all that happens.
   */
  function fillQuestion(text, mode) {
    var ids = { find: 'findInput', nofo: 'nofoInput' };
    var box = document.getElementById(ids[document.body.dataset.chatMode || 'find']);
    if (!box || box.disabled || box.offsetParent === null) return false;
    finishTyping(); // a copy still being typed in is completed (not left half done) before this one starts
    var current = box.value.replace(/\s+$/, '');
    var base = mode === 'append' && current ? current + '\n\n' : '';
    if (box.maxLength > 0 && base.length + text.length > box.maxLength) base = '';
    if (box.id === 'nofoInput') {
      box.rows = 9;
      // A note about an earlier drafted description would now be wrong.
      var note = document.getElementById('nofoDraftNote');
      if (note) note.hidden = true;
    }

    var delays = window.TypingUtil && !reducedMotion() ? window.TypingUtil.schedule(text) : null;
    function done() {
      clearTimeout(job.timer);
      if (typing === job) typing = null;
      box.value = base + text;
      box.readOnly = job.wasReadOnly;
      box.removeAttribute('aria-busy');
      box.setSelectionRange(box.value.length, box.value.length);
      box.scrollTop = box.scrollHeight;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var job = { box: box, timer: null, wasReadOnly: box.readOnly, finish: done };
    box.focus();
    if (!delays) {
      box.value = base + text;
      done();
      return true;
    }
    typing = job;
    box.value = base;
    box.readOnly = true;
    box.setAttribute('aria-busy', 'true');
    // The delays add up to at most 1.5 seconds, so a long text has under a millisecond per character, which no timer can
    // fire at. Instead, every ~16 ms show all the characters whose time has come (a few at once, in uneven bursts).
    var due = [];
    var running = 0;
    for (var i = 0; i < delays.length; i++) {
      running += delays[i];
      due.push(running);
    }
    var startedAt = Date.now();
    var shown = 0;
    (function tick() {
      if (box.value !== base + text.slice(0, shown)) {
        // The page changed the box while it was being typed in (Start over, a message sent): stop, do not write over it.
        if (typing === job) typing = null;
        box.readOnly = job.wasReadOnly;
        box.removeAttribute('aria-busy');
        return;
      }
      var elapsed = Date.now() - startedAt;
      var n = shown;
      while (n < text.length && due[n] <= elapsed) n++;
      if (n !== shown) {
        shown = n;
        box.value = base + text.slice(0, shown);
        box.scrollTop = box.scrollHeight;
      }
      if (shown >= text.length) done();
      else job.timer = setTimeout(tick, 16);
    })();
    return true;
  }

  /** Shows `text` on a button for a moment, then puts its own label back. */
  function flash(button, text) {
    var original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(function () { button.textContent = original; }, 1500);
  }

  /**
   * A copy button's behavior: put the text straight into the question box (when `fillMode` is 'replace' or 'append'; see
   * fillQuestion) and copy it to the clipboard too, flash the result, and announce it through `say` (a screen-reader line).
   * The box is filled even if the clipboard is refused. `onCopied(filled)` (optional) runs after either worked; the trays use it to
   * close themselves, and `filled` says whether the question box now holds the text (and so has the keyboard focus).
   */
  function wireCopyButton(button, getText, label, say, onCopied, fillMode) {
    button.addEventListener('click', function () {
      var text = getText();
      var filled = fillMode ? fillQuestion(text, fillMode) : false;
      function worked(copied) {
        flash(button, 'Copied ✓');
        say(filled
          ? 'Typing ' + label + ' into the question box' + (copied ? ' (also copied to the clipboard).' : '.')
          : 'Copied ' + label + ' to the clipboard.');
        if (onCopied) onCopied(filled);
      }
      copyText(text).then(
        function () { worked(true); },
        function () {
          if (filled) {
            worked(false);
            return;
          }
          flash(button, 'Copy failed');
          say('Copying did not work. Select the text and press Control C.');
        }
      );
    });
  }

  function create(parts) {
    var drawer = parts.drawer;
    var tab = parts.tab;
    var panel = parts.panel;
    var close = parts.close;

    function isOpen() {
      return drawer.classList.contains('is-open');
    }

    /** Slides the tray out or in. `focus` moves keyboard focus to where it belongs (the close button, or back to the tab). */
    function setOpen(open, focus) {
      drawer.classList.toggle('is-open', open);
      tab.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      // A closed tray must not be reachable by keyboard.
      if ('inert' in panel) panel.inert = !open;
      if (open) {
        tab.classList.remove('has-news');
        // Opening one tray closes the others.
        document.dispatchEvent(new CustomEvent('trayopen', { detail: { id: drawer.id } }));
      }
      // While a tray is open, the other tabs move to sit beside its panel, so they stay reachable (see .tray-open in the CSS).
      document.body.classList.toggle('tray-open', !!document.querySelector('.tray.is-open'));
      if (focus) (open ? close : tab).focus();
    }

    function setAvailable(available) {
      if (!available) setOpen(false, false);
      drawer.hidden = !available;
    }

    tab.addEventListener('click', function () { setOpen(!isOpen(), true); });
    close.addEventListener('click', function () { setOpen(false, true); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        setOpen(false, true);
      }
    });
    document.addEventListener('trayopen', function (event) {
      if (event.detail && event.detail.id !== drawer.id && isOpen()) setOpen(false, false);
    });

    setOpen(false, false);
    return { setOpen: setOpen, isOpen: isOpen, setAvailable: setAvailable };
  }

  window.DrawerKit = { create: create, copyText: copyText, flash: flash, wireCopyButton: wireCopyButton, fillQuestion: fillQuestion, finishTyping: finishTyping };
})();
