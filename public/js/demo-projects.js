/**
 * The projects and answers window (demo-projects.html), the same content as the Samples and Answers trays on the app page.
 *  - Projects (the trays call them Samples): the fixed project descriptions (sample-projects.js), filterable. Copy types one
 *    into the app's question box.
 *  - Answers: made-up example answers for what the app last asked. The app page (presenter-link.js) sends its latest questions
 *    over a same-origin BroadcastChannel; they are turned into replies with answer-suggestions.js, the same builder the tray
 *    uses. Copy types the reply into the app's question box (replacing what is there) and copies it too.
 * Needs window.PresenterKit (presenter-kit.js). Every string is rendered with textContent.
 */
(function () {
  'use strict';

  var kit = window.PresenterKit;
  var S = window.AnswerSuggestions;
  // The demo project goes first in this window: "Short: speeding and drunk driving" (sample-14). The rest keep their order.
  var PINNED_FIRST = ['sample-14'];
  var all = window.SampleProjects || [];
  var projects = all.filter(function (p) { return PINNED_FIRST.indexOf(p.id) >= 0; })
    .sort(function (a, b) { return PINNED_FIRST.indexOf(a.id) - PINNED_FIRST.indexOf(b.id); })
    .concat(all.filter(function (p) { return PINNED_FIRST.indexOf(p.id) < 0; }));
  var latest = { find: null, nofo: null };
  var mode = null; // the tab the app has open: 'find', 'nofo' or something else
  var connected = false;

  var MODE_NAMES = { find: 'Find grants', nofo: 'Assess a project' };
  var CATEGORY_NAMES = { eligibility: 'Eligibility', funding: 'Funding', readiness: 'Readiness', application: 'Application checklist' };

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------------------------------------------------------------- Projects

  function renderProjects(filter) {
    var box = document.getElementById('dsProjects');
    clear(box);
    var needle = String(filter || '').trim().toLowerCase();
    var shown = projects.filter(function (p) {
      return !needle || (p.title + ' ' + (p.note || '') + ' ' + p.text).toLowerCase().indexOf(needle) >= 0;
    });
    if (shown.length === 0) {
      box.appendChild(kit.el('p', 'ds-empty', projects.length === 0 ? 'No projects are available.' : 'No project matches that search.'));
      return;
    }
    shown.forEach(function (p) {
      var item = kit.el('article', 'ds-item');
      item.appendChild(kit.el('h3', null, p.title));
      if (p.note) item.appendChild(kit.el('p', 'ds-item-note', 'Tests: ' + p.note));
      item.appendChild(kit.el('p', 'ds-item-text', p.text));
      item.appendChild(kit.copyButton(p.text, p.title, true));
      box.appendChild(item);
    });
  }

  // ---------------------------------------------------------------- Answers

  function reply(label, text, copyLabel) {
    var card = kit.el('article', 'ds-item');
    card.appendChild(kit.el('h3', null, label));
    card.appendChild(kit.el('p', 'ds-item-text', text));
    card.appendChild(kit.copyButton(text, label.toLowerCase(), true, copyLabel || 'Copy reply'));
    return card;
  }

  function openRequirements(listed, facts) {
    var built = S.buildOpen(listed, facts);
    if (built.total === 0) return null;
    var box = kit.el('details', 'ds-item ds-open');
    box.appendChild(kit.el('summary', null, 'All other open requirements (' + built.total + ')'));
    box.appendChild(kit.el('p', 'ds-item-note', 'Every requirement from the notice that is still unevaluated, answered in one reply. Each sentence names its requirement.'));
    built.replies.forEach(function (r) { box.appendChild(reply(r.label, r.text)); });
    var covered = kit.el('details', 'ds-open');
    covered.appendChild(kit.el('summary', null, 'The ' + built.total + ' requirements these replies cover'));
    var ul = kit.el('ul');
    built.items.forEach(function (item) {
      var name = CATEGORY_NAMES[item.category];
      ul.appendChild(kit.el('li', null, (name ? name + ': ' : '') + item.question));
    });
    covered.appendChild(ul);
    box.appendChild(covered);
    return box;
  }

  function renderAnswers() {
    var box = document.getElementById('dsAnswers');
    var forLabel = document.getElementById('dsAnswersFor');
    clear(box);
    if (!connected) {
      forLabel.textContent = 'Not connected to the app';
      box.appendChild(kit.el('p', 'ds-empty', 'Open the app (chat.html) in another window, on Find grants or Assess. Its questions will appear here.'));
      return;
    }
    if (mode !== 'find' && mode !== 'nofo') {
      forLabel.textContent = 'The app has another tab open';
      box.appendChild(kit.el('p', 'ds-empty', 'Switch the app to Find grants or Assess to see suggested answers.'));
      return;
    }
    forLabel.textContent = 'For: ' + MODE_NAMES[mode];
    var detail = latest[mode];
    if (!detail) {
      box.appendChild(kit.el('p', 'ds-empty', 'Nothing to suggest yet. Once you are asked follow-up questions, example answers will appear here.'));
      return;
    }
    var suggestions = S.build(detail.questions || [], detail.facts || {});
    var open = openRequirements(detail.detailQuestions || [], detail.facts || {});
    if (suggestions.items.length === 0) {
      box.appendChild(kit.el('p', 'ds-empty', 'There are no follow-up questions right now, so there is nothing to answer.'));
      if (open) box.appendChild(open);
      return;
    }
    box.appendChild(kit.el('h3', 'ds-section', 'Answer everything at once'));
    var written = detail.suggestedReply && detail.suggestedReply.text ? detail.suggestedReply : null;
    if (written) {
      box.appendChild(reply('Complete reply', written.text));
      box.appendChild(kit.el('p', 'ds-item-note', 'An example written by the language model. It is made up for trying the app out and says nothing true about your project.'));
    } else {
      suggestions.replies.filter(function (r) { return r.stage === 'advanced'; }).forEach(function (r) { box.appendChild(reply('Complete reply', r.text)); });
    }
    box.appendChild(kit.el('p', 'ds-item-note', 'Each reply answers all the questions being asked.'));
    if (open) box.appendChild(open);
  }

  function markNews() {
    var dot = document.getElementById('dsNews');
    if (dot && activeTab !== 'answers') dot.hidden = false;
  }

  // ---------------------------------------------------------------- Wiring

  function onState(state) {
    if (!state || typeof state !== 'object') return;
    connected = true;
    mode = typeof state.mode === 'string' ? state.mode : mode;
    var l = state.latest && typeof state.latest === 'object' ? state.latest : {};
    var changed = JSON.stringify(l) !== JSON.stringify(latest);
    latest = { find: l.find || null, nofo: l.nofo || null };
    renderAnswers();
    if (changed) markNews();
  }

  // ---------------------------------------------------------------- Tabs

  var TABS = ['projects', 'answers'];
  var activeTab = 'projects';

  function showTab(name, focus) {
    if (TABS.indexOf(name) < 0) return;
    activeTab = name;
    TABS.forEach(function (t) {
      var cap = t.charAt(0).toUpperCase() + t.slice(1);
      var tab = document.getElementById('dsTab' + cap);
      var panel = document.getElementById('dsPanel' + cap);
      var on = t === name;
      tab.classList.toggle('ds-tab-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && focus) tab.focus();
    });
    if (name === 'answers') document.getElementById('dsNews').hidden = true;
    window.scrollTo(0, 0);
  }

  function wireTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.ds-tab'), function (tab) {
      tab.addEventListener('click', function () { showTab(tab.dataset.tab, false); });
      tab.addEventListener('keydown', function (event) {
        var i = TABS.indexOf(tab.dataset.tab);
        if (event.key === 'ArrowRight') { event.preventDefault(); showTab(TABS[(i + 1) % TABS.length], true); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); showTab(TABS[(i + TABS.length - 1) % TABS.length], true); }
      });
    });
  }

  function init() {
    var filter = document.getElementById('dsProjectFilter');
    wireTabs();
    renderProjects('');
    filter.addEventListener('input', function () { renderProjects(filter.value); });
    renderAnswers();
    if (!S || typeof BroadcastChannel !== 'function') return;
    var channel = new BroadcastChannel('grantflow-presenter');
    channel.onmessage = function (event) {
      if (event.data && event.data.type === 'state') onState(event.data.state);
    };
    channel.postMessage({ type: 'hello' }); // ask the app page for what it has now
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
