/**
 * "Assess a project" panel on the chat page: pick an already-ingested funding
 * opportunity, describe a project, answer follow-up questions, read the
 * preliminary assessment and open the source text behind each finding.
 *
 * Plain DOM code. Every string from the server or the user is rendered with
 * textContent, never as HTML. The conversation and the project facts live in
 * this page only; the server is stateless and stores nothing.
 */
(function () {
  'use strict';

  var U = window.NofoUtil;
  var P = window.ProgressPanel;
  var API = '/api/nofo';
  var MAX_SENT_MESSAGES = 12;

  var state = {
    opportunities: [],
    opportunityId: null,
    messages: [], // { role, content }
    windowStart: 0, // messages before this index are not sent (after a fact was removed)
    facts: {},
    skipFacts: [], // facts the applicant said they do not know yet: no question is asked about them
    answers: {}, // yes/no answers to detail questions (questions made from the notice's requirements), by requirement id
    askedDetails: [], // the detail questions shown with the last result: { id, covers, question }
    skipDetails: [], // detail questions the applicant said they do not know yet
    lastStatuses: {}, // each finding's status at the last result, sent back so the next message can say what changed
    questionRound: 0, // how many rounds of questions the applicant has been asked (the app asks at most three)
    answersOpen: null, // whether the answers section is open (null = decide by how many there are)
    undoAnswers: null, // the answers cleared by "Clear all answers", so they can be restored
    result: null,
    busy: false
  };

  var els = {};
  var panel = null; // the live progress panel (see progress-panel.js)

  // ---------------------------------------------------------------------------
  // Small DOM helpers
  // ---------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var child = arguments[i];
      if (child) parent.appendChild(child);
    }
    return parent;
  }

  function badge(text, kind) {
    return el('span', 'badge ' + kind, text);
  }

  function button(text, className, onClick) {
    var b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** A request that always yields a readable message, and never logs request bodies. */
  async function request(path, options) {
    var response;
    try {
      response = await fetch(API + path, options);
    } catch (e) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    var body = null;
    try {
      body = await response.json();
    } catch (e) {
      body = null;
    }
    if (!response.ok || !body || !body.success) {
      var message = body && body.error ? body.error : 'The request failed (HTTP ' + response.status + ').';
      var err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return body.data;
  }

  function assetPath(opportunityId, source) {
    var base = '/opportunities/' + encodeURIComponent(opportunityId) + '/documents/' + encodeURIComponent(source.documentId);
    if (typeof source.page === 'number') return base + '/pages/' + source.page;
    return base + '/sections/' + encodeURIComponent(source.section || '');
  }

  // ---------------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------------

  function addMessage(role, content, extra) {
    var div = el('div', 'chat-message ' + role);
    if (extra && extra.pending) div.dataset.pending = 'true';
    if (extra && extra.node) div.appendChild(extra.node);
    else div.textContent = content;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    // The conversation grows with the page, so bring the start of a new reply into view.
    if (role === 'assistant' && !(extra && extra.pending) && div.scrollIntoView) {
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      div.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    return div;
  }

  function addError(message) {
    var div = el('div', 'error', message);
    div.setAttribute('role', 'alert');
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function removePending() {
    var pending = els.messages.querySelector('[data-pending="true"]');
    if (pending) pending.remove();
  }

  function setBusy(busy) {
    state.busy = busy;
    els.input.disabled = busy;
    els.send.disabled = busy;
    els.select.disabled = busy;
    els.reset.disabled = busy;
    els.results.setAttribute('aria-busy', busy ? 'true' : 'false');
    var removeButtons = els.results.querySelectorAll('button[data-remove-fact]');
    for (var i = 0; i < removeButtons.length; i++) removeButtons[i].disabled = busy;
  }

  /**
   * When nothing is left to ask (every question answered or set aside), the box and the Send button go away, because there
   * is nothing more to send. "Start over" stays. Any new result, a removed answer or a reset brings them back.
   */
  function setComposerDone(done) {
    var label = els.form.querySelector('label[for="nofoInput"]');
    els.input.hidden = done;
    els.send.hidden = done;
    if (label) label.hidden = done;
    if (els.doneNote) els.doneNote.hidden = !done;
    if (done) els.draftNote.hidden = true;
  }

  /** Tells the rest of the page (the suggested-answers tray) what the latest assessment asked; null when there is none. */
  function announceResult(data) {
    document.dispatchEvent(new CustomEvent('assessresult', { detail: data ? { questions: data.questions || [], detailQuestions: data.openDetails || [], facts: data.facts || {}, suggestedReply: data.suggestedReply || null } : null }));
  }

  function lastUserMessageIndex() {
    for (var i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].role === 'user') return i;
    return -1;
  }

  /**
   * One round trip. `readMessage: false` re-checks the facts as they stand
   * (after removing a fact or switching opportunity) without reading the
   * latest message again.
   */
  async function assess(options) {
    var readMessage = !options || options.readMessage !== false;
    var sent = U.windowMessages(state.messages.slice(state.windowStart), MAX_SENT_MESSAGES);
    if (sent.length === 0) {
      // Re-assessing after a removal: the request still needs one applicant message, which is not read.
      var idx = lastUserMessageIndex();
      if (idx < 0) return null;
      sent = [state.messages[idx]];
    }
    var body = { opportunityId: state.opportunityId, messages: sent };
    if (Object.keys(state.facts).length > 0) body.facts = state.facts;
    if (state.skipFacts.length > 0) body.skipFacts = state.skipFacts.slice();
    // The detail questions are carried like the facts: the answers so far, the ones just shown (so this message is read as
    // their answer), and the ones set aside.
    if (Object.keys(state.answers).length > 0) body.answers = state.answers;
    if (readMessage && state.askedDetails.length > 0) body.asked = state.askedDetails;
    if (state.skipDetails.length > 0) body.skipDetails = state.skipDetails.slice();
    if (state.questionRound > 0) body.round = state.questionRound;
    if (readMessage && Object.keys(state.lastStatuses).length > 0) body.previous = state.lastStatuses;
    if (!readMessage) body.readMessage = false;
    // The server reports each step as it really happens; fall back to a plain request if the panel is unavailable.
    if (panel && P) return P.stream(API + '/assess?stream=1', body, panel.push);
    return request('/assess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function runTurn(options) {
    if (state.busy || !state.opportunityId) return;
    if (!options || options.readMessage !== false) state.undoAnswers = null; // a new message ends the chance to undo a clear
    setBusy(true);
    var pending = null;
    if (panel) {
      // The progress shows in the conversation, right under the message just sent: the panel moves to the end of the
      // messages each turn, hides when the turn is done, and the reply is added after it.
      var progressRoot = document.getElementById('nofoProgress');
      if (progressRoot) els.messages.appendChild(progressRoot);
      panel.start();
      els.messages.scrollTop = els.messages.scrollHeight;
    }
    else pending = addMessage('assistant', 'Reading your message and checking it against the requirements… this can take up to a minute.', { pending: true });
    try {
      var data = await assess(options);
      if (panel) { panel.flush(); panel.stop(); }
      removePending();
      if (!data) return;
      state.facts = data.facts || {};
      state.answers = data.answers || {};
      if (data.questionRound && typeof data.questionRound.round === 'number') state.questionRound = data.questionRound.round;
      state.lastStatuses = {};
      (data.findings || []).forEach(function (f) { state.lastStatuses[f.requirementId] = f.status; });
      // The detail questions asked now, plus the other open requirements listed in the Answers drawer (shown: false), so a
      // reply that answers any of them is read as an answer.
      var asked = function (q, shown) {
        var item = { id: String(q.group).replace(/^detail:/, ''), covers: q.requirementIds || [], question: q.text };
        if (q.spec) item.spec = q.spec; // how the question was asked, so the reply is read and counted the same way
        if (!shown) item.shown = false;
        return item;
      };
      state.askedDetails = (data.questions || []).filter(function (q) { return q.kind === 'detail'; }).map(function (q) { return asked(q, true); })
        .concat((data.openDetails || []).map(function (q) { return asked(q, false); }));
      state.result = data;
      renderResults(data);
      announceResult(data);
      setComposerDone(!!data.questionRound && data.questionRound.open === 0 && (data.questions || []).length === 0);
      if (!options || options.readMessage !== false) {
        var reply = el('div');
        // The model-written (or template) reply leads the chat message; the code-written findings stay in the panel below.
        var spoken = data.reply && typeof data.reply.text === 'string' && data.reply.text ? data.reply : null;
        if (spoken) {
          spoken.text.split('\n\n').forEach(function (paragraph) { append(reply, el('p', null, paragraph)); });
          append(reply, el('p', 'nofo-meta nofo-reply-source', spoken.source === 'model'
            ? 'Written by the language model from the checked findings below, and checked by code. Preliminary.'
            : 'Written from a template using the checked findings below. Preliminary.'));
        } else {
          append(reply, el('p', null, data.advisory.headline));
        }
        var asking = questionsBlock(data.questions, data.questionRound);
        if (asking) reply.appendChild(asking);
        else if (lastRoundNote(data.questionRound)) reply.appendChild(lastRoundNote(data.questionRound));
        addMessage('assistant', '', { node: reply });
        state.messages.push({ role: 'assistant', content: U.assistantTurnText(spoken ? spoken.text : data.advisory.headline, data.questions) });
      } else {
        var updated = el('div');
        append(updated, el('p', null, 'Updated. ' + (data.reply && data.reply.text ? data.reply.text.split('\n\n')[0] : data.advisory.headline)));
        var stillAsking = questionsBlock(data.questions, data.questionRound);
        if (stillAsking) updated.appendChild(stillAsking);
        else if (lastRoundNote(data.questionRound)) updated.appendChild(lastRoundNote(data.questionRound));
        addMessage('assistant', '', { node: updated });
      }
    } catch (e) {
      if (panel) panel.stop();
      removePending();
      addError(e.message || 'Something went wrong.');
    } finally {
      if (panel) panel.stop();
      if (pending && pending.parentNode) pending.remove();
      setBusy(false);
      if (!els.input.disabled) els.input.focus();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    var text = els.input.value.trim();
    if (!text || state.busy) return;
    if (!state.opportunityId) {
      addError('Choose a funding opportunity first.');
      return;
    }
    state.messages.push({ role: 'user', content: text });
    addMessage('user', text);
    els.input.value = '';
    clearDraftNote();
    runTurn();
  }

  function removeFact(key) {
    if (state.busy) return;
    delete state.facts[key];
    // Later turns must not read the removed statement again from older messages.
    state.windowStart = state.messages.length;
    runTurn({ readMessage: false });
  }

  function removeAnswer(id) {
    if (state.busy) return;
    delete state.answers[id];
    state.undoAnswers = null;
    runTurn({ readMessage: false });
  }

  /** One click clears every answer (kept for "Undo"), for example after a complete reply was pasted by mistake. */
  function clearAnswers() {
    if (state.busy || Object.keys(state.answers).length === 0) return;
    state.undoAnswers = state.answers;
    state.answers = {};
    runTurn({ readMessage: false });
  }

  function restoreAnswers() {
    if (state.busy || !state.undoAnswers) return;
    state.answers = state.undoAnswers;
    state.undoAnswers = null;
    runTurn({ readMessage: false });
  }

  var CATEGORY_NAMES = { eligibility: 'Eligibility', funding: 'Funding', readiness: 'Readiness', application: 'Application checklist' };

  /** The short badge for one answer: Yes, No, the option chosen, the number given, Described, or Not sure. */
  function answerBadge(a) {
    var kind = a.answer === 'yes' ? 'yes' : a.answer === 'no' ? 'no' : a.answer === 'unsure' ? 'unsure' : 'other';
    if (a.kind === 'choice' && a.spec && a.spec.options && a.option !== undefined && a.spec.options[a.option]) {
      var outcome = a.spec.options[a.option].outcome;
      kind = outcome === 'meets' ? 'yes' : outcome === 'does_not_meet' ? 'no' : 'other';
    }
    return { text: answerValue(a), kind: kind };
  }

  /**
   * Your answers to the notice's questions, as a closed section with a one-line summary: a compact row for each (a badge, the
   * requirement's own title, Remove), grouped by category. The full question and your own words open in the modal. "Clear all
   * answers" undoes a pasted complete reply in one click, and can itself be undone.
   */
  function answersPanel(data) {
    var ids = Object.keys(data.answers || {});
    if (ids.length === 0 && !state.undoAnswers) return null;
    var byReq = {};
    (data.findings || []).forEach(function (f) { byReq[f.requirementId] = f; });
    var section = el('section', 'card nofo-answers');
    if (ids.length === 0) {
      // Everything was just cleared: say so, with the way back.
      append(section, el('p', 'nofo-meta', 'All your answers to the notice\'s questions were cleared.'));
      append(section, button('Undo: restore ' + Object.keys(state.undoAnswers).length + ' cleared answer' + (Object.keys(state.undoAnswers).length === 1 ? '' : 's'), 'nofo-secondary find-small', restoreAnswers));
      return section;
    }
    var details = el('details', 'nofo-answers-details');

    var counts = { yes: 0, no: 0, other: 0, unsure: 0 };
    var rows = ids.map(function (id) {
      var a = data.answers[id];
      var badge = answerBadge(a);
      counts[badge.kind] += 1;
      var finding = byReq[id] || byReq[(a.covers || [])[0]];
      return { id: id, a: a, badge: badge, title: (finding && finding.title) || a.question || id, category: (finding && finding.category) || '' };
    });
    var parts = [];
    if (counts.yes) parts.push(counts.yes + ' yes');
    if (counts.no) parts.push(counts.no + ' no');
    if (counts.other) parts.push(counts.other + ' other');
    if (counts.unsure) parts.push(counts.unsure + ' not sure');

    var summary = el('summary', null, 'Your answers to the notice\'s questions (' + ids.length + ')' + (parts.length ? ' · ' + parts.join(' · ') : ''));
    details.appendChild(summary);
    append(details, el('p', 'nofo-meta', 'These are your own statements and have not been checked against the notice. Click a row for the full question and your words.'));

    CATEGORY_ORDER.concat(['']).forEach(function (cat) {
      var group = rows.filter(function (r) { return (CATEGORY_NAMES[r.category] ? r.category : '') === cat; });
      if (group.length === 0) return;
      details.appendChild(el('h4', 'nofo-answers-group', (cat ? CATEGORY_NAMES[cat] : 'Other') + ' (' + group.length + ')'));
      var ul = el('ul', 'nofo-answer-rows');
      group.forEach(function (r) {
        var li = el('li', 'nofo-answer-row');
        var open = el('button', 'nofo-answer-open');
        open.type = 'button';
        append(open, el('span', 'nofo-answer-badge is-' + r.badge.kind, r.badge.text), el('span', 'nofo-answer-title', r.title + ((r.a.covers || []).length > 1 ? ' (+' + (r.a.covers.length - 1) + ' related)' : '')));
        open.setAttribute('aria-label', 'Show the question and your words: ' + r.title);
        open.addEventListener('click', function () {
          if (window.ChipModal) window.ChipModal.open({ label: 'Your answer: ' + r.badge.text, value: r.a.question || r.title, quote: r.a.quote || '' });
        });
        var remove = button('Remove', 'nofo-link-button', function () { removeAnswer(r.id); });
        remove.setAttribute('aria-label', 'Remove your answer to: ' + r.title);
        append(li, open, remove);
        ul.appendChild(li);
      });
      details.appendChild(ul);
    });

    var actions = el('div', 'nofo-answers-actions');
    if (ids.length > 0) append(actions, button('Clear all answers', 'nofo-secondary find-small', clearAnswers));
    if (state.undoAnswers) append(actions, button('Undo: restore ' + Object.keys(state.undoAnswers).length + ' cleared answer' + (Object.keys(state.undoAnswers).length === 1 ? '' : 's'), 'nofo-secondary find-small', restoreAnswers));
    if (actions.childNodes.length > 0) details.appendChild(actions);
    section.appendChild(details);
    // Open only when there are few of them, and stay as the person left it when the results are redrawn.
    details.open = state.answersOpen === null ? ids.length <= 3 : state.answersOpen;
    details.addEventListener('toggle', function () { state.answersOpen = details.open; });
    return section;
  }

  var CATEGORY_ORDER = ['eligibility', 'funding', 'readiness', 'application'];

  function startOver() {
    if (state.busy) return;
    state.messages = [];
    state.windowStart = 0;
    state.facts = {};
    state.skipFacts = [];
    state.answers = {};
    state.undoAnswers = null;
    state.askedDetails = [];
    state.skipDetails = [];
    state.questionRound = 0;
    state.lastStatuses = {};
    state.result = null;
    announceResult(null);
    setComposerDone(false);
    clear(els.messages);
    clear(els.results);
    showIntroMessage();
    if (els.input.value.trim() === state.lastDraft) els.input.value = '';
    clearDraftNote();
    els.input.focus();
  }

  function showIntroMessage() {
    var node = el('div');
    append(node, el('p', null, 'Describe your project in your own words. Useful things to mention: who the applicant is, what the project is, whether it is urban or rural, the total cost, how much you plan to request, what match is committed, and whether a benefit-cost analysis has been done.'));
    addMessage('assistant', '', { node: node });
  }

  // ---------------------------------------------------------------------------
  // Opportunity selection
  // ---------------------------------------------------------------------------

  function coverageText(coverage) {
    if (coverage.status === 'api_listed_processed') return 'All documents the listing offered were processed (other documents may exist elsewhere).';
    if (coverage.status === 'partial') return 'Some documents could not be processed, so the package is incomplete.';
    return 'No documents were processed.';
  }

  function renderOpportunityInfo() {
    clear(els.info);
    var o = state.opportunities.find(function (x) { return x.opportunityId === state.opportunityId; });
    if (!o) return;
    var line = el('p', 'nofo-meta');
    var parts = [];
    if (o.opportunityNumber) parts.push('Opportunity number ' + o.opportunityNumber);
    parts.push('Status in Simpler.Grants.gov: ' + o.status);
    if (o.closeDate) parts.push('Close date ' + o.closeDate);
    line.textContent = parts.join(' · ');
    append(els.info, line);
    var r = o.requirements;
    var detail = r.total + ' requirements extracted from ' + o.documents + ' document' + (o.documents === 1 ? '' : 's') + '; ' +
      r.needsReview + ' flagged for human review; ' + (r.verified === 0 ? 'none verified by a person yet' : r.verified + ' verified by a person') + '. ' + coverageText(o.coverage);
    append(els.info, el('p', 'nofo-meta', detail));
    if (r.status === 'partial') append(els.info, el('p', 'nofo-warning', 'The requirement extraction for this opportunity is incomplete, so some requirements may be missing from the assessment.'));
    if (o.coverage.status !== 'api_listed_processed') append(els.info, el('p', 'nofo-warning', 'The document package is incomplete: ' + (o.coverage.reasons[0] || 'see the operator notes') + '.'));
  }

  function fillOpportunities() {
    clear(els.select);
    var placeholder = el('option', null, 'Select a funding opportunity…');
    placeholder.value = '';
    els.select.appendChild(placeholder);
    state.opportunities.forEach(function (o) {
      var label = (o.title || 'Untitled opportunity') + (o.opportunityNumber ? ' (' + o.opportunityNumber + ')' : '');
      var option = el('option', null, o.requirements.ready ? label : label + ' — not ready (requirements not extracted)');
      option.value = o.opportunityId;
      option.disabled = !o.requirements.ready;
      els.select.appendChild(option);
    });
    if (state.opportunityId) els.select.value = state.opportunityId;
  }

  function selectOpportunity(id, options) {
    var changed = id !== state.opportunityId;
    state.opportunityId = id || null;
    els.select.value = id || '';
    renderOpportunityInfo();
    els.form.hidden = !state.opportunityId;
    syncUrl();
    if (!changed || (options && options.silent)) return;
    state.result = null;
    state.skipFacts = [];
    state.answers = {};
    state.undoAnswers = null;
    state.askedDetails = [];
    state.skipDetails = [];
    state.questionRound = 0;
    state.lastStatuses = {};
    announceResult(null);
    setComposerDone(false);
    clear(els.results);
    // Same project, different notice: re-check the facts already given, without reading anything again.
    if (state.opportunityId && lastUserMessageIndex() >= 0) {
      runTurn({ readMessage: false });
    }
  }

  async function loadOpportunities() {
    try {
      var data = await request('/opportunities');
      state.opportunities = data.opportunities;
    } catch (e) {
      els.select.disabled = true;
      els.loadError.textContent = e.message;
      els.loadError.hidden = false;
      return;
    }
    var ready = state.opportunities.filter(function (o) { return o.requirements.ready; });
    if (state.opportunities.length === 0 || ready.length === 0) {
      els.empty.hidden = false;
    }
    fillOpportunities();
    var wanted = state.requestedOpportunity;
    if (wanted) {
      var match = ready.find(function (o) { return o.opportunityId === wanted; });
      if (match) selectOpportunity(wanted, { silent: true });
      else {
        els.loadError.textContent = 'That opportunity has not been prepared for assessment on this server.';
        els.loadError.hidden = false;
      }
    } else if (ready.length === 1) {
      selectOpportunity(ready[0].opportunityId, { silent: true });
    }
    if (state.opportunityId) els.form.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  function sourceButton(source, label) {
    var b = button(label || 'View source (' + U.locationLabel(source) + ')', 'nofo-link-button', function () { openSource(state.opportunityId, source, b); });
    b.setAttribute('aria-haspopup', 'dialog');
    return b;
  }

  function sourceBlock(source) {
    var block = el('div', 'nofo-source');
    append(block, el('blockquote', 'nofo-quote', '“' + U.truncate(source.quote, 320) + '”'));
    var meta = el('div', 'nofo-source-meta');
    append(meta, badge(U.authorityLabel(source.authority), source.authority === 'controlling' ? 'badge-secondary' : 'badge-warning'));
    append(meta, sourceButton(source));
    append(block, meta);
    return block;
  }

  function uniqueSources(finding) {
    var seen = {};
    return (finding.sources || []).filter(function (s) {
      var k = s.documentId + '|' + s.page + '|' + s.section;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function findingCard(item, findingsById) {
    var info = U.statusInfo(item);
    var card = el('li', 'nofo-finding nofo-finding-' + info.kind);
    var head = el('div', 'nofo-finding-head');
    append(head, badge(info.label, info.badge));
    if (item.provisional) append(head, badge('Provisional', 'badge-secondary'));
    append(card, head);
    append(card, el('h4', null, item.title));
    append(card, el('p', null, item.text || item.explanation));
    var finding = findingsById[item.requirementId];
    var sources = finding ? uniqueSources(finding) : (item.source ? [item.source] : []);
    sources.slice(0, 3).forEach(function (s) { card.appendChild(sourceBlock(s)); });
    if (sources.length === 0) append(card, el('p', 'nofo-meta', 'No source passage is attached to this item.'));
    if (item.relatedCount > 0) {
      var details = el('details', 'nofo-related');
      append(details, el('summary', null, '+' + item.relatedCount + ' related requirement' + (item.relatedCount === 1 ? '' : 's') + ' with the same outcome'));
      var list = el('ul');
      (item.relatedRequirementIds || []).forEach(function (id) {
        var f = findingsById[id];
        var li = el('li', null, f ? f.title : id);
        if (f && f.sources && f.sources[0]) li.appendChild(sourceButton(f.sources[0], 'View source'));
        list.appendChild(li);
      });
      details.appendChild(list);
      card.appendChild(details);
    }
    append(card, el('p', 'nofo-req-id', 'Requirement ' + item.requirementId));
    return card;
  }

  function factsPanel(data) {
    var section = el('section', 'card nofo-facts');
    append(section, el('h3', null, 'What I am using from your words'));
    var keys = U.orderedFactKeys(data.facts);
    if (keys.length === 0) {
      append(section, el('p', 'nofo-meta', 'Nothing yet. Facts are only taken from what you write; nothing is assumed.'));
    } else {
      var list = el('ul', 'nofo-chips');
      keys.forEach(function (key) {
        var fact = data.facts[key];
        var chip = el('li', 'nofo-chip');
        var text = el('div', 'nofo-chip-text');
        var valueText = U.formatFactValue(key, fact.value);
        append(text, el('span', 'nofo-chip-label', U.factLabel(key)));
        append(text, el('strong', null, valueText));
        if (fact.quote) append(text, el('span', 'nofo-chip-quote', 'You said: “' + U.truncate(fact.quote, 160) + '”'));
        // A card whose text is cut short opens the full text in a modal (chip-modal.js).
        if (window.ChipModal) window.ChipModal.attach(chip, text, { label: U.factLabel(key), value: valueText, quote: fact.quote || '' });
        var remove = button('Remove', 'nofo-link-button', function () { removeFact(key); });
        remove.dataset.removeFact = key;
        remove.setAttribute('aria-label', 'Remove ' + U.factLabel(key));
        append(chip, text, remove);
        list.appendChild(chip);
      });
      section.appendChild(list);
    }
    // Statements that could not be matched to the applicant's own words are one quiet, closed note, not a line each.
    var rejected = data.rejectedFacts || [];
    if (rejected.length > 0) {
      var note = el('details', 'nofo-rejected');
      note.appendChild(el('summary', null, rejected.length + (rejected.length === 1 ? ' statement' : ' statements') + ' could not be matched to your words, so ' + (rejected.length === 1 ? 'it was' : 'they were') + ' not used'));
      var rl = el('ul', 'nofo-simple-list');
      rejected.forEach(function (r) { rl.appendChild(el('li', 'nofo-meta', U.factLabel(r.key) + ' (' + r.reason + ')')); });
      note.appendChild(rl);
      section.appendChild(note);
    }
    return section;
  }

  function arithmeticLine(data) {
    var d = data.derived;
    var box = el('div', 'nofo-arith');
    var shares = [];
    if (d.federalSharePct !== null && d.federalSharePct !== undefined) shares.push('Federal share of total cost: ' + d.federalSharePct + '%');
    if (d.nonFederalSharePct !== null && d.nonFederalSharePct !== undefined) shares.push('Non-federal share: ' + d.nonFederalSharePct + '%');
    if (shares.length > 0) append(box, el('p', null, shares.join(' · ')));
    if (d.consistency && d.consistency.message) append(box, el('p', 'nofo-meta', d.consistency.message));
    (d.assumptions || []).forEach(function (a) { append(box, el('p', 'nofo-meta', 'Assumption: ' + a)); });
    return box.childNodes.length > 0 ? box : null;
  }

  function simpleList(findings, withMissing) {
    var list = el('ul', 'nofo-simple-list');
    findings.forEach(function (f) {
      var li = el('li');
      append(li, el('strong', null, f.title));
      if (withMissing && f.missingFacts && f.missingFacts.length > 0) {
        append(li, el('span', 'nofo-meta', ' — waiting for: ' + f.missingFacts.map(U.factLabel).join(', ')));
      } else if (f.explanation) {
        append(li, el('span', 'nofo-meta', ' — ' + f.explanation));
      }
      if (f.sources && f.sources[0]) li.appendChild(sourceButton(f.sources[0], 'View source'));
      list.appendChild(li);
    });
    return list;
  }

  function collapsible(title, content) {
    var details = el('details', 'nofo-collapsible');
    append(details, el('summary', null, title));
    details.appendChild(content);
    return details;
  }

  var TYPE_LABELS = { yes_no: 'a yes or no question', choice: 'a multiple-choice question', number: 'a question for a number', describe: 'a question to describe' };

  /** A detail question says what kind of question it is and why (the model's reason), so the person can see how it was chosen. */
  function typeLine(q) {
    if (!q || q.kind !== 'detail' || !q.answerType || !TYPE_LABELS[q.answerType]) return '';
    return 'Asked as ' + TYPE_LABELS[q.answerType] + (q.reason ? ': ' + q.reason : '.');
  }

  /** What an answer says, for its card: yes or no, the option chosen, the number given, or that it was described. */
  function answerValue(a) {
    if (a.answer === 'unsure') return 'Not sure yet';
    if (a.kind === 'choice' && a.spec && a.spec.options && a.option !== undefined && a.spec.options[a.option]) return a.spec.options[a.option].label;
    if (a.kind === 'number' && a.number !== undefined) return a.number.toLocaleString('en-US') + (a.spec && a.spec.comparison && a.spec.comparison.unit ? ' ' + a.spec.comparison.unit : '');
    if (a.kind === 'describe') return 'Described';
    return a.answer === 'yes' ? 'Yes' : a.answer === 'no' ? 'No' : 'Answered';
  }

  /**
   * "I don't know yet": sets the facts behind the questions on screen aside, so they are not asked about again, and
   * re-checks without reading a message. The requirements waiting on them stay unknown (never a pass or a fail), and any
   * other open question is still asked. There is always a way out of being asked.
   */
  function skipButton(questions) {
    var keys = [];
    var details = [];
    (questions || []).forEach(function (q) {
      (q.factKeys || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      if (q.kind === 'detail') details.push(String(q.group).replace(/^detail:/, ''));
    });
    var plural = (questions || []).length === 1;
    var button = el('button', 'nofo-secondary find-small', plural ? 'I don\'t know this yet' : 'I don\'t know these yet');
    button.type = 'button';
    button.addEventListener('click', function () {
      if (state.busy) return;
      keys.forEach(function (k) { if (state.skipFacts.indexOf(k) < 0) state.skipFacts.push(k); });
      details.forEach(function (id) { if (state.skipDetails.indexOf(id) < 0) state.skipDetails.push(id); });
      runTurn({ readMessage: false });
    });
    return button;
  }

  /**
   * The follow-up questions, as part of the assistant's message in the conversation: each question, what kind of question it is
   * and why, and why it matters with a link to its source. This is the one place they are listed (not repeated in the results
   * below or in the next steps). Null when nothing is being asked.
   */
  function questionsBlock(questions, info) {
    if (!questions || questions.length === 0) return null;
    var box = el('div', 'nofo-chat-questions');
    var stage = info && info.stage ? info.stage : null;
    append(box, el('p', 'nofo-reply-label', stage ? 'Step ' + stage.index + ' of ' + info.of + ': ' + stage.title : 'To sharpen this, tell me:'));
    if (stage) append(box, el('p', 'nofo-meta', stage.why));
    var ol = el('ol', 'nofo-questions');
    questions.forEach(function (q) {
      var li = el('li');
      append(li, el('strong', null, q.text));
      var kindLine = typeLine(q);
      if (kindLine) append(li, el('p', 'nofo-meta', kindLine));
      (q.because || []).slice(0, 2).forEach(function (b) {
        var why = el('p', 'nofo-meta', 'Why it matters: ' + b.title);
        if (b.source) why.appendChild(sourceButton(b.source, 'View source'));
        li.appendChild(why);
      });
      ol.appendChild(li);
    });
    box.appendChild(ol);
    var later = info && info.later > 0 ? info.later : 0;
    append(box, el('p', 'nofo-meta', (later ? 'There ' + (later === 1 ? 'is' : 'are') + ' ' + later + ' more to come in the next ' + (later === 1 ? 'step' : 'steps') + '. ' : '') + 'If you do not know yet, you can set these aside.'));
    box.appendChild(skipButton(questions));
    return box;
  }

  /**
   * After the last round nothing more is asked. What is still open stays unknown (never a pass or a fail) and can be answered
   * at any time from the Answers drawer, so say so once instead of going quiet.
   */
  function lastRoundNote(info) {
    if (!info || !(info.round >= 1) || !(info.open > 0)) return null;
    return el('p', 'nofo-meta', 'That was the last of my questions. ' + info.open + ' requirement' + (info.open === 1 ? ' is' : 's are') +
      ' still unevaluated and stay unknown (not a pass or a fail). You can answer them any time from the Answers drawer, under "All other open requirements".');
  }

  function renderResults(data) {
    clear(els.results);
    var findingsById = {};
    data.findings.forEach(function (f) { findingsById[f.requirementId] = f; });

    // Summary
    var summary = el('section', 'card nofo-summary');
    var standing = data.advisory.standing;
    append(summary, el('p', 'nofo-label', standing ? 'Where you stand · ' + data.advisory.label : data.advisory.label));
    append(summary, el('h3', null, standing ? standing.line : data.advisory.headline));
    if (standing) {
      var tiles = el('div', 'nofo-standing');
      [['workable', standing.workable, 'Looks workable'], ['attention', standing.attention, 'Needs attention'], ['unknown', standing.unknown, 'Can\'t tell yet']].forEach(function (t) {
        var tile = el('div', 'nofo-standing-tile is-' + t[0]);
        append(tile, el('strong', null, String(t[1])), el('span', null, t[2]));
        tiles.appendChild(tile);
      });
      summary.appendChild(tiles);
    }
    if (data.changes && data.changes.line) append(summary, el('p', 'nofo-changes', data.changes.line));
    append(summary, el('p', 'nofo-meta', 'These findings are written by code from the notice\'s extracted requirements and what you stated; each one links to its source. The reply in the conversation is written by the language model from them.'));
    var meta = data.opportunity ? (data.opportunity.title || 'Selected opportunity') : 'Selected opportunity';
    append(summary, el('p', 'nofo-meta', meta + ' · ' + data.requirements.total + ' requirements (' + data.requirements.needsReview + ' flagged for review, ' + data.requirements.verified + ' verified by a person), extraction ' + data.requirements.status));
    var arith = arithmeticLine(data);
    if (arith) summary.appendChild(arith);
    (data.warnings || []).forEach(function (w) { append(summary, el('p', 'nofo-warning', w)); });
    els.results.appendChild(summary);

    els.results.appendChild(factsPanel(data));
    var answered = answersPanel(data);
    if (answered) els.results.appendChild(answered);

    // Key findings
    if (data.advisory.keyFindings.length > 0) {
      var key = el('section', 'card');
      append(key, el('h3', null, 'Findings to look at first'));
      var list = el('ul', 'nofo-findings');
      data.advisory.keyFindings.forEach(function (item) { list.appendChild(findingCard(item, findingsById)); });
      key.appendChild(list);
      els.results.appendChild(key);
    }

    // The questions are in the conversation, under the reply (questionsBlock), with their sources; they are not repeated here.

    // Next steps
    if (data.advisory.nextSteps.length > 0) {
      var ns = el('section', 'card');
      append(ns, el('h3', null, 'Suggested next steps'));
      var nl = el('ul');
      data.advisory.nextSteps.forEach(function (s) { nl.appendChild(el('li', null, s)); });
      ns.appendChild(nl);
      els.results.appendChild(ns);
    }

    // The rest, collapsed
    var more = el('section', 'card');
    var supported = data.findings.filter(function (f) { return f.status === 'supported'; });
    var unknown = data.findings.filter(function (f) { return f.status === 'unknown'; });
    if (supported.length > 0) more.appendChild(collapsible('Looks supported by what you stated (' + supported.length + ')', simpleList(supported, false)));
    if (unknown.length > 0) more.appendChild(collapsible('Not yet evaluated (' + unknown.length + '): unknown is not a pass or a fail', simpleList(unknown, true)));
    if (data.notApplicable.length > 0) {
      var na = el('ul', 'nofo-simple-list');
      data.notApplicable.forEach(function (n) {
        var li = el('li');
        append(li, el('strong', null, n.title));
        append(li, el('span', 'nofo-meta', ' — ' + n.reason));
        na.appendChild(li);
      });
      more.appendChild(collapsible('Not applicable to this project (' + data.notApplicable.length + ')', na));
    }
    if (more.childNodes.length > 0) els.results.appendChild(more);

    append(els.results, el('p', 'nofo-disclaimer', data.advisory.disclaimer));
  }

  // ---------------------------------------------------------------------------
  // Source drawer
  // ---------------------------------------------------------------------------

  var drawer = null;
  var drawerTrigger = null;

  function buildDrawer() {
    var overlay = el('div', 'nofo-overlay');
    overlay.hidden = true;
    var panel = el('div', 'nofo-drawer');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'nofoDrawerTitle');
    panel.tabIndex = -1;
    var head = el('div', 'nofo-drawer-head');
    var title = el('h3', null, 'Source');
    title.id = 'nofoDrawerTitle';
    var close = button('Close', 'nofo-close', closeDrawer);
    close.setAttribute('aria-label', 'Close source');
    append(head, title, close);
    var body = el('div', 'nofo-drawer-body');
    append(panel, head, body);
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDrawer(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      var focusable = panel.querySelectorAll('button, a[href]');
      if (focusable.length === 0) { e.preventDefault(); return; }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.appendChild(overlay);
    drawer = { overlay: overlay, panel: panel, title: title, body: body, close: close };
  }

  function closeDrawer() {
    if (!drawer || drawer.overlay.hidden) return;
    drawer.overlay.hidden = true;
    document.body.classList.remove('nofo-no-scroll');
    if (drawerTrigger && document.contains(drawerTrigger)) drawerTrigger.focus();
    drawerTrigger = null;
  }

  function renderSourceText(location, quote) {
    var wrap = el('div');
    var parts = U.splitAroundQuote(location.text, quote);
    if (parts.match === '') {
      append(wrap, el('p', 'nofo-warning', 'The exact passage could not be located on this ' + (location.kind === 'pdf' ? 'page' : 'section') + ' (the text may be laid out differently). The quoted passage is shown above; read the full text to confirm.'));
    }
    var pre = el('pre', 'nofo-source-text');
    pre.appendChild(document.createTextNode(parts.before));
    if (parts.match) {
      var mark = document.createElement('mark');
      mark.textContent = parts.match;
      pre.appendChild(mark);
      pre.appendChild(document.createTextNode(parts.after));
    }
    wrap.appendChild(pre);
    return { wrap: wrap, mark: pre.querySelector('mark') };
  }

  async function openSource(opportunityId, source, trigger) {
    if (!drawer) buildDrawer();
    drawerTrigger = trigger || null;
    clear(drawer.body);
    drawer.title.textContent = 'Source';
    append(drawer.body, el('p', 'nofo-meta', 'Loading the source text…'));
    drawer.overlay.hidden = false;
    document.body.classList.add('nofo-no-scroll');
    drawer.close.focus();
    try {
      var location = await request(assetPath(opportunityId, source));
      clear(drawer.body);
      drawer.title.textContent = location.title || 'Source';
      var meta = el('div', 'nofo-source-meta');
      append(meta, badge(U.authorityLabel(location.authority), location.authority === 'controlling' ? 'badge-secondary' : 'badge-warning'));
      var where = location.kind === 'pdf' ? 'Page ' + location.page + ' of ' + location.pageCount : 'Section ' + location.section + (location.heading ? ': ' + location.heading : '');
      append(meta, el('span', 'nofo-meta', where + ' · ' + location.fileName));
      drawer.body.appendChild(meta);
      append(drawer.body, el('p', 'nofo-label', 'Passage the assessment relies on'));
      append(drawer.body, el('blockquote', 'nofo-quote', '“' + source.quote + '”'));
      var rendered = renderSourceText(location, source.quote);
      drawer.body.appendChild(rendered.wrap);
      var links = el('div', 'nofo-drawer-links');
      if (location.originalAvailable) {
        var a = el('a', null, 'Open the original PDF at page ' + location.page);
        a.href = API + '/opportunities/' + encodeURIComponent(opportunityId) + '/documents/' + encodeURIComponent(location.documentId) + '/original#page=' + location.page;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        links.appendChild(a);
      }
      var safe = location.sourceUrl && /^https?:\/\//i.test(location.sourceUrl) ? location.sourceUrl : null;
      if (safe) {
        var o = el('a', null, 'Official file on the funding portal');
        o.href = safe;
        o.target = '_blank';
        o.rel = 'noopener noreferrer';
        links.appendChild(o);
      }
      if (links.childNodes.length > 0) drawer.body.appendChild(links);
      if (rendered.mark && rendered.mark.scrollIntoView) rendered.mark.scrollIntoView({ block: 'center' });
    } catch (e) {
      clear(drawer.body);
      append(drawer.body, el('p', 'error', e.message || 'The source text could not be loaded.'));
      append(drawer.body, el('blockquote', 'nofo-quote', '“' + source.quote + '”'));
    }
  }

  // ---------------------------------------------------------------------------
  // Mode switch and start-up
  // ---------------------------------------------------------------------------

  function syncUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      // "find" is the default mode, so it needs no parameter.
      var mode = state.mode || 'find';
      if (mode !== 'find') params.set('mode', mode); else params.delete('mode');
      if (mode === 'nofo' && state.opportunityId) params.set('opportunity', state.opportunityId); else params.delete('opportunity');
      var query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
    } catch (e) {
      /* the address bar is a convenience only */
    }
  }

  /** Two modes share the page: "find" (default) and "nofo" (assess). */
  function setMode(mode) {
    mode = mode === 'nofo' ? mode : 'find';
    state.mode = mode;
    // Other parts of the page (the sample-projects tray) follow the mode without knowing how it is switched.
    document.body.dataset.chatMode = mode;
    document.dispatchEvent(new CustomEvent('chatmodechange', { detail: { mode: mode } }));
    var panels = { find: els.findPanel, nofo: els.panel };
    var tabs = { find: els.tabFind, nofo: els.tabNofo };
    Object.keys(panels).forEach(function (key) {
      var active = key === mode;
      if (panels[key]) panels[key].hidden = !active;
      if (tabs[key]) {
        tabs[key].setAttribute('aria-selected', active ? 'true' : 'false');
        tabs[key].classList.toggle('active', active);
      }
    });
    syncUrl();
    if (mode === 'nofo' && !state.loaded) {
      state.loaded = true;
      loadOpportunities();
    }
  }

  /** Called by the Find grants panel: open the Assess tab on an opportunity (without a page reload). */
  /**
   * Pre-fills the first message with a project description drafted on the Find grants tab. Only when nothing has been
   * said here yet, and never over text the person typed themselves (a draft from an earlier click may be replaced).
   */
  function applyDraft(draft) {
    if (!draft || typeof draft.text !== 'string' || !draft.text.trim()) return;
    if (lastUserMessageIndex() >= 0) return;
    var current = els.input.value.trim();
    if (current && current !== state.lastDraft) return;
    els.input.value = draft.text;
    els.input.rows = 9;
    state.lastDraft = draft.text;
    els.draftNote.textContent = draft.source === 'model'
      ? 'Drafted by the language model from what you told Find grants, using only the facts you gave. Read it, correct anything, add what is missing, then send it.'
      : 'This is what you told Find grants, joined together (a drafted description was not available). Edit it, add what is missing, then send it.';
    els.draftNote.hidden = false;
  }

  function clearDraftNote() {
    els.draftNote.hidden = true;
    els.input.rows = 3;
    state.lastDraft = null;
  }

  function openAssess(id, options) {
    if (!U.isUuid(id)) return;
    state.requestedOpportunity = String(id).toLowerCase();
    els.loadError.hidden = true;
    els.empty.hidden = true;
    if (state.opportunityId !== state.requestedOpportunity) {
      // A different notice than before: do not show an old assessment under it.
      state.opportunityId = null;
      state.result = null;
      announceResult(null);
      clear(els.results);
    }
    state.loaded = true;
    setMode('nofo');
    applyDraft(options && options.draft);
    Promise.resolve(loadOpportunities()).then(function () {
      if (els.input && !els.form.hidden) els.input.focus();
    });
  }

  function init() {
    els.tabFind = document.getElementById('modeFindTab');
    els.findPanel = document.getElementById('findPanel');
    els.tabNofo = document.getElementById('modeNofoTab');
    els.panel = document.getElementById('nofoPanel');
    els.select = document.getElementById('nofoOpportunity');
    els.info = document.getElementById('nofoOpportunityInfo');
    els.loadError = document.getElementById('nofoLoadError');
    els.empty = document.getElementById('nofoEmpty');
    els.messages = document.getElementById('nofoMessages');
    els.form = document.getElementById('nofoForm');
    els.input = document.getElementById('nofoInput');
    els.draftNote = document.getElementById('nofoDraftNote');
    els.doneNote = document.getElementById('nofoDoneNote');
    els.send = document.getElementById('nofoSend');
    els.reset = document.getElementById('nofoReset');
    els.results = document.getElementById('nofoResults');
    els.progress = document.getElementById('nofoProgress');
    if (!els.panel || !els.tabNofo || !U) return;
    if (P && els.progress) {
      panel = P.create({
        root: els.progress,
        title: document.getElementById('nofoProgressTitle'),
        time: document.getElementById('nofoProgressTime'),
        steps: document.getElementById('nofoSteps')
      });
    }

    if (els.tabFind) els.tabFind.addEventListener('click', function () { setMode('find'); });
    els.tabNofo.addEventListener('click', function () { setMode('nofo'); });
    els.select.addEventListener('change', function () { selectOpportunity(els.select.value); });
    els.form.addEventListener('submit', onSubmit);
    els.reset.addEventListener('click', startOver);
    els.input.addEventListener('keydown', function (e) {
      // Enter sends; Shift+Enter adds a line.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); }
    });

    showIntroMessage();
    els.form.hidden = true;
    // Read the link once: switching modes rewrites the address bar.
    var params = U.readParams(window.location.search);
    state.requestedOpportunity = params.opportunity;
    window.NofoApp = { openAssess: openAssess };
    setMode(params.mode);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
