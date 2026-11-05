/**
 * Shared behavior for the slide-out trays on the right edge of the chat page (sample project descriptions, suggested
 * answers). Exposes window.DrawerKit.
 *
 *   var tray = DrawerKit.create({ drawer, tab, panel, close });
 *   tray.setAvailable(false);   // hide it (and close it)
 *   DrawerKit.copyText(text).then(...);
 *
 * A tray is closed by default. The tab toggles it; the × button and Escape close it; only one tray is open at a time;
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

  /** Shows `text` on a button for a moment, then puts its own label back. */
  function flash(button, text) {
    var original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(function () { button.textContent = original; }, 1500);
  }

  /** A copy button's behavior: copy, flash the result, and announce it through `say` (a screen-reader line). */
  function wireCopyButton(button, getText, label, say) {
    button.addEventListener('click', function () {
      copyText(getText()).then(
        function () {
          flash(button, 'Copied ✓');
          say('Copied ' + label + ' to the clipboard.');
        },
        function () {
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

  window.DrawerKit = { create: create, copyText: copyText, flash: flash, wireCopyButton: wireCopyButton };
})();
