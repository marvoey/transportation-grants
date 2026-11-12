/**
 * Fact cards ("What I am using from your words" on Assess, "What I understood from your description" on Find grants) are
 * all the same height, so a long value or quote is cut short with an ellipsis. For a card whose text is cut, this makes the
 * text area a button that opens a modal with the full text; the person reads it and closes it.
 * Exposes window.ChipModal.
 *
 *   ChipModal.attach(chipEl, textEl, { label, value, quote })
 *
 * Call it after the card is in the page (it measures what is cut). `value` and `quote` are the FULL strings; `quote` is the
 * text without any "You said:" wrapper. Cards that are not cut stay plain text, not buttons. A resize re-checks every
 * attached card, because the width decides how much is cut.
 *
 * The modal is a native <dialog> opened with showModal(), so the browser traps focus, closes on Escape, and returns focus to
 * the card. It also closes from the Close button or a click on the dark backdrop. Every string is set with textContent.
 */
(function () {
  'use strict';

  var attached = [];
  var dialog = null;
  var fields = null;
  var resizeTimer = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = el('dialog', 'chip-modal');
    var head = el('div', 'chip-modal-head');
    fields = { label: el('h2', 'chip-modal-label'), value: el('p', 'chip-modal-value'), quote: el('p', 'chip-modal-quote') };
    fields.label.id = 'chipModalTitle';
    dialog.setAttribute('aria-labelledby', fields.label.id);
    var close = el('button', 'chip-modal-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { dialog.close(); });
    head.appendChild(fields.label);
    head.appendChild(close);
    dialog.appendChild(head);
    dialog.appendChild(fields.value);
    dialog.appendChild(fields.quote);
    // A click on the backdrop lands on the dialog element itself (its content fills the box, so inside clicks do not).
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function open(data) {
    var d = ensureDialog();
    fields.label.textContent = data.label || '';
    fields.value.textContent = data.value || '';
    fields.quote.textContent = data.quote ? 'You said: “' + data.quote + '”' : '';
    fields.quote.hidden = !data.quote;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  /** True when any text inside the card is cut short. */
  function isCut(textEl) {
    var parts = textEl.children;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].scrollHeight > parts[i].clientHeight + 1) return true;
    }
    return false;
  }

  function setInteractive(entry, on) {
    var t = entry.textEl;
    if (on === entry.on) return;
    entry.on = on;
    t.classList.toggle('chip-text-more', on);
    if (on) {
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      t.setAttribute('aria-haspopup', 'dialog');
      t.setAttribute('aria-label', 'Read the full text of ' + (entry.data.label || 'this item'));
      t.title = 'Click to read the full text';
    } else {
      t.removeAttribute('role');
      t.removeAttribute('tabindex');
      t.removeAttribute('aria-haspopup');
      t.removeAttribute('aria-label');
      t.removeAttribute('title');
    }
  }

  function check(entry) {
    if (!document.body.contains(entry.textEl)) return false; // the card was replaced: forget it
    setInteractive(entry, isCut(entry.textEl));
    return true;
  }

  function attach(chipEl, textEl, data) {
    var entry = { chipEl: chipEl, textEl: textEl, data: data || {}, on: false };
    textEl.addEventListener('click', function () { if (entry.on) open(entry.data); });
    textEl.addEventListener('keydown', function (event) {
      if (entry.on && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        open(entry.data);
      }
    });
    attached.push(entry);
    // The card is added to the page by the caller right after this; measure once it is laid out.
    requestAnimationFrame(function () { check(entry); });
  }

  function recheckAll() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { attached = attached.filter(check); }, 150);
  }

  // The width decides how much is cut, and a card in a hidden view cannot be measured, so look again after a resize or
  // when the person switches between Find grants and Assess.
  window.addEventListener('resize', recheckAll);
  document.addEventListener('chatmodechange', recheckAll);

  window.ChipModal = { attach: attach };
})();
