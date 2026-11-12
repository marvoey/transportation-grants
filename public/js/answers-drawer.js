/**
 * Slide-out tray of suggested answers to the follow-up questions (the "To sharpen this, tell me:" list). Closed by
 * default, available on the Find grants and Assess tabs. Each time an assessment returns, nofo.js announces its questions
 * and known facts in an "assessresult" event; the Find grants page does the same with "findquestions". The tray keeps the
 * latest of each, shows the one for the tab that is open, and turns it into made-up example answers
 * (answer-suggestions.js) that can be copied and pasted into the conversation. Open/close and copy behavior come from drawer-kit.js.
 *
 * Every string is rendered with textContent.
 */
(function () {
  'use strict';

  var K = window.DrawerKit;
  var S = window.AnswerSuggestions;
  var els = {};
  var tray = null;
  var latest = { find: null, nofo: null }; // the questions last announced by each tab
  var current = 'find';

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

  /** Copying an answer closes the tray, so the pasted text can be seen and edited in the conversation. */
  function closeTray(filled) {
    // Focus stays in the question box when it was filled, rather than going back to the tab.
    if (tray) tray.setOpen(false, !filled);
  }

  /**
   * Copy puts the text straight into the question box and onto the clipboard. A reply to everything at once replaces what
   * is in the box; an answer to one question is added after it, so several answers can be built up.
   */
  function copyButton(text, label, ariaLabel, fillMode) {
    var button = el('button', 'nofo-secondary find-small', label);
    button.type = 'button';
    button.setAttribute('aria-label', ariaLabel);
    K.wireCopyButton(button, function () { return text; }, ariaLabel.replace(/^Copy /, ''), say, closeTray, fillMode);
    return button;
  }

  function renderReply(reply) {
    var card = el('article', 'answers-reply');
    card.appendChild(el('h3', null, reply.label));
    card.appendChild(el('p', 'samples-text', reply.text));
    card.appendChild(copyButton(reply.text, 'Copy reply', 'Copy the ' + reply.label.toLowerCase(), 'replace'));
    return card;
  }

  var CATEGORY_NAMES = { eligibility: 'Eligibility', funding: 'Funding', readiness: 'Readiness', application: 'Application checklist' };

  /**
   * Every other requirement that can still be answered (not being asked in the conversation) as complete replies, one per
   * choice, each answering all of them in one message, kept closed until opened. Pasting one is read as an answer to each
   * requirement it names. The requirements are listed under a second, closed heading so you can see what a reply covers.
   */
  function renderOpenRequirements(listed, facts) {
    var built = S.buildOpen(listed, facts);
    if (built.total === 0) return null;
    var box = el('details', 'answers-open');
    box.appendChild(el('summary', null, 'All other open requirements (' + built.total + ')'));
    box.appendChild(el('p', 'nofo-meta', 'Every requirement from the notice that is still unevaluated, answered in one reply. Copy one to put it in your message; each sentence names its requirement.'));
    built.replies.forEach(function (reply) { box.appendChild(renderReply(reply)); });
    var covered = el('details', 'answers-covered');
    covered.appendChild(el('summary', null, 'The ' + built.total + ' requirements these replies cover'));
    var ul = el('ul', 'nofo-reply-list');
    built.items.forEach(function (item) {
      var name = CATEGORY_NAMES[item.category];
      ul.appendChild(el('li', null, (name ? name + ': ' : '') + item.question));
    });
    covered.appendChild(ul);
    box.appendChild(covered);
    return box;
  }

  /** Rebuilds the tray from the latest assessment (null = there is none right now). */
  function show(detail) {
    clear(els.list);
    if (!detail) {
      els.list.appendChild(el('p', 'nofo-meta', 'Nothing to suggest yet. Once you are asked follow-up questions, example answers will appear here.'));
      return;
    }
    var suggestions = S.build(detail.questions, detail.facts);
    var open = renderOpenRequirements(detail.detailQuestions || [], detail.facts);
    if (suggestions.items.length === 0) {
      els.list.appendChild(el('p', 'nofo-meta', 'There are no follow-up questions right now, so there is nothing to answer.'));
      if (open) els.list.appendChild(open);
      return;
    }
    var heading = el('h3', 'answers-section', 'Answer everything at once');
    els.list.appendChild(heading);
    // One complete reply, for a project that is well advanced. When the language model could write one it reads like a person
    // typing; otherwise the template reply built from the questions is offered instead.
    var written = detail.suggestedReply && detail.suggestedReply.text ? detail.suggestedReply : null;
    if (written) {
      els.list.appendChild(renderReply({ stage: 'advanced', label: 'Complete reply', text: written.text }));
      els.list.appendChild(el('p', 'nofo-meta', 'An example written by the language model. It is made up for trying the app out and says nothing true about your project.'));
    } else {
      suggestions.replies.filter(function (reply) { return reply.stage === 'advanced'; }).forEach(function (reply) {
        els.list.appendChild(renderReply({ stage: reply.stage, label: 'Complete reply', text: reply.text }));
      });
    }
    // The drawer offers only complete replies (each answers every question being asked), never one answer at a time; a second
    // set, closed, covers the other open requirements (Assess).
    els.list.appendChild(el('p', 'nofo-meta', 'Each reply answers all the questions being asked. Copy one to put it in your message.'));
    if (open) els.list.appendChild(open);
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

    // Find grants and Assess ask questions; the original chat tab does not.
    function applyMode(mode) {
      current = mode;
      tray.setAvailable(mode === 'nofo' || mode === 'find');
      if (mode === 'nofo' || mode === 'find') show(latest[mode]);
    }
    applyMode(document.body.dataset.chatMode || 'find');
    document.addEventListener('chatmodechange', function (event) { applyMode(event.detail && event.detail.mode); });
    // A tab's questions are stored always, and shown only while that tab is the open one.
    document.addEventListener('assessresult', function (event) {
      latest.nofo = event.detail || null;
      if (current === 'nofo') show(latest.nofo);
    });
    document.addEventListener('findquestions', function (event) {
      latest.find = event.detail || null;
      if (current === 'find') show(latest.find);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
