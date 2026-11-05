/**
 * Collapses the introduction above the input box once the user has sent a first message, so the conversation and its
 * results have more of the viewport. "Start over" (which clears the conversation) brings it back, and a small toggle
 * lets the user show or hide it by hand. Pure presentation: it reads no message text and changes no data.
 *
 * Each block is marked data-collapsible and wrapped as .collapsible > .collapsible-inner. The conversation it watches
 * is named by the block's id: findIntro watches #findThread, nofoIntro watches #nofoMessages. A conversation counts
 * as started when it holds a message from the user (.user); the Assess tab's greeting alone does not count.
 */
(function () {
  'use strict';

  var WATCH = { findIntro: 'findThread', nofoIntro: 'nofoMessages' };

  function started(conversation) {
    return !!conversation.querySelector('.user');
  }

  function setup(block) {
    var conversation = document.getElementById(WATCH[block.id] || '');
    if (!conversation) return;

    var inner = block.querySelector('.collapsible-inner');
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'collapsible-toggle nofo-secondary';
    toggle.hidden = true;
    if (inner && inner.id) toggle.setAttribute('aria-controls', inner.id);
    block.parentNode.insertBefore(toggle, block.nextSibling);

    var collapsed = false;

    function apply(next) {
      collapsed = next;
      block.classList.toggle('is-collapsed', collapsed);
      // Collapsed content must not stay reachable by keyboard or screen reader; the CSS visibility change is delayed
      // until the animation ends, so inert makes it immediate.
      if (collapsed) block.setAttribute('inert', '');
      else block.removeAttribute('inert');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? 'Show instructions' : 'Hide instructions';
    }

    function sync() {
      var begun = started(conversation);
      toggle.hidden = !begun;
      apply(begun);
    }

    toggle.addEventListener('click', function () {
      apply(!collapsed);
    });

    // Only direct children matter: messages are appended to, and cleared from, the conversation itself.
    new MutationObserver(sync).observe(conversation, { childList: true });
    apply(false);
    sync();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-collapsible]'), setup);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
