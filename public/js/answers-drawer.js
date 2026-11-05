/**
 * Slide-out tray of suggested answers to the assessment's follow-up questions (the "To sharpen this, tell me:" list).
 * Closed by default, available on the Assess tab only. Each time an assessment returns, nofo.js announces its questions
 * and known facts in an "assessresult" event; this tray turns them into made-up example answers (answer-suggestions.js)
 * that can be copied and pasted into the conversation. Open/close and copy behavior come from drawer-kit.js.
 *
 * Every string is rendered with textContent.
 */
(function () {
  'use strict';

  var K = window.DrawerKit;
  var S = window.AnswerSuggestions;
  var els = {};
  var tray = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function say(message) {
    els.status.textContent = '';
    // A short pause makes a screen reader announce a repeat of the same message.
    setTimeout(function () { els.status.textContent = message; }, 30);
  }

  function copyButton(text, label, ariaLabel) {
    var button = el('button', 'nofo-secondary find-small', label);
    button.type = 'button';
    button.setAttribute('aria-label', ariaLabel);
    K.wireCopyButton(button, function () { return text; }, ariaLabel.replace(/^Copy /, ''), say);
    return button;
  }

  function renderReply(reply) {
    var card = el('article', 'answers-reply');
    card.appendChild(el('h3', null, reply.label));
    card.appendChild(el('p', 'samples-text', reply.text));
    card.appendChild(copyButton(reply.text, 'Copy reply', 'Copy the ' + reply.label.toLowerCase()));
    return card;
  }

  function renderQuestion(item) {
    var card = el('article', 'answers-question');
    card.appendChild(el('p', 'answers-asked', item.question));
    item.variants.forEach(function (variant) {
      var box = el('div', 'answers-variant');
      box.appendChild(el('span', 'answers-variant-label', variant.label));
      box.appendChild(el('p', 'samples-text', variant.text));
      box.appendChild(copyButton(variant.text, 'Copy', 'Copy the suggested answer (' + variant.label.toLowerCase() + ') to: ' + item.question));
      card.appendChild(box);
    });
    return card;
  }

  /** Rebuilds the tray from the latest assessment (null = there is none right now). */
  function show(detail) {
    clear(els.list);
    if (!detail) {
      els.list.appendChild(el('p', 'nofo-meta', 'Nothing to suggest yet. Once the assessment asks follow-up questions, example answers will appear here.'));
      return;
    }
    var suggestions = S.build(detail.questions, detail.facts);
    if (suggestions.items.length === 0) {
      els.list.appendChild(el('p', 'nofo-meta', 'The assessment has no follow-up questions right now, so there is nothing to answer.'));
      return;
    }
    var heading = el('h3', 'answers-section', 'Answer everything at once');
    els.list.appendChild(heading);
    suggestions.replies.forEach(function (reply) { els.list.appendChild(renderReply(reply)); });
    els.list.appendChild(el('h3', 'answers-section', 'Or one question at a time'));
    suggestions.items.forEach(function (item) { els.list.appendChild(renderQuestion(item)); });
    // A small dot on the tab says there is something new inside (cleared when the tray is opened).
    if (!tray.isOpen()) els.tab.classList.add('has-news');
  }

  function init() {
    els.drawer = document.getElementById('answersDrawer');
    els.tab = document.getElementById('answersTab');
    els.panel = document.getElementById('answersPanel');
    els.close = document.getElementById('answersClose');
    els.list = document.getElementById('answersList');
    els.status = document.getElementById('answersStatus');
    if (!K || !S || !els.drawer || !els.tab || !els.panel || !els.close || !els.list || !els.status) return;

    tray = K.create({ drawer: els.drawer, tab: els.tab, panel: els.panel, close: els.close });
    show(null);

    // Only the Assess tab asks follow-up questions, so only it has this tray.
    function applyMode(mode) { tray.setAvailable(mode === 'nofo'); }
    applyMode(document.body.dataset.chatMode || 'find');
    document.addEventListener('chatmodechange', function (event) { applyMode(event.detail && event.detail.mode); });
    document.addEventListener('assessresult', function (event) { show(event.detail || null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
