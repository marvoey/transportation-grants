/**
 * "Find grants" panel on the chat page: describe a transportation project in plain words and get a short,
 * explained list of funding opportunities worth a closer look.
 *
 * Plain DOM code. Every string from the server or the user is rendered with textContent, never as HTML.
 * The conversation lives in this page only; the server is stateless and stores nothing.
 */
(function () {
  'use strict';

  var D = window.DiscoverUtil;
  var API = '/api/nofo';

  var state = {
    messages: [], // the applicant's messages only: { role: 'user', content }
    stage: null, // 'ask' | 'results' | null
    asked: [], // ids of guided questions the applicant chose to skip; none by default, so a question repeats until answered
    busy: false,
    openQuestions: 0, // questions still open with the latest list (optional ones, after "Search now"); 0 once all are answered
    lastReply: '', // the text of the reply shown last turn, sent back so a short follow-up ("yes") is answered in context
    inspection: null // the Simpler.Grants.gov requests and responses of the latest turn, when asked for
  };
  var els = {};
  var devConsole = { begin: function () {}, push: function () {}, end: function () {}, clear: function () {} }; // replaced at start-up

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
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function badge(text, kind) {
    return el('span', 'badge badge-' + kind, text);
  }

  function list(className, items) {
    var ul = el('ul', className);
    items.forEach(function (text) { append(ul, el('li', null, text)); });
    return ul;
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
      throw new Error(body && body.error ? body.error : 'The request failed (HTTP ' + response.status + ').');
    }
    return body.data;
  }

  // ---------------------------------------------------------------------------
  // Conversation thread
  // ---------------------------------------------------------------------------

  /** Developer mode and its sections are chosen in the Dev tray (dev-mode.js). The raw Simpler.Grants.gov traffic is only requested while the API calls section is showing. */
  function developerShows(section) {
    return !!(window.DevMode && window.DevMode.shows(section));
  }

  function addThread(role, text) {
    var div = el('div', 'chat-message ' + role, text);
    append(els.thread, div);
    els.thread.scrollTop = els.thread.scrollHeight;
    return div;
  }

  /** An assistant message made of a label and a list, like the "To sharpen this, tell me:" list on the Assess tab. */
  function addQuestions(intro, questions) {
    var div = el('div', 'chat-message assistant');
    append(div, el('p', null, intro), el('p', 'nofo-reply-label', 'To sharpen this, tell me:'));
    var ol = el('ol', 'nofo-reply-list find-questions');
    questions.forEach(function (q) { append(ol, el('li', null, q.text)); });
    append(div, ol);
    append(div, el('p', 'nofo-meta', 'Answer in your own words, all in one message. Anything you skip is fine.'));
    append(els.thread, div);
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  /**
   * Tells the suggested-answers tray what was just asked (null when nothing is open). The tray's builder wants a
   * `group` per question; for this page that is the question's id.
   */
  function announceQuestions(questions, profile) {
    var detail = null;
    if (questions) {
      var facts = {};
      if (profile && profile.totalCostUsd) facts.totalProjectCostUsd = { value: profile.totalCostUsd.value };
      if (profile && profile.federalAskUsd) facts.requestedFederalUsd = { value: profile.federalAskUsd.value };
      detail = { questions: questions.map(function (q) { return { group: q.id, text: q.text }; }), facts: facts };
    }
    document.dispatchEvent(new CustomEvent('findquestions', { detail: detail }));
  }

  /** The plain-language explanation of the search, as an assistant message, with a line saying who wrote it. */
  function addExplanation(explanation) {
    if (!explanation || typeof explanation.text !== 'string') return;
    var div = el('div', 'chat-message assistant find-explanation dev-only dev-section-note');
    append(div, el('p', null, explanation.text));
    append(div, el('p', 'nofo-meta', explanation.source === 'model'
      ? 'About this search. Written by the language model from your description and the results; it describes the search and is not advice. Check it against the API call below.'
      : 'About this search. Written by the app from a template (the language model was not used for this one).'));
    append(els.thread, div);
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  /**
   * The conversational reply that introduces the list. Written by the language model from the understood project, the first
   * listings and the open question and checked by code, or by a template; the list below it is written by code.
   */
  function addReply(reply, closest) {
    if (!reply || typeof reply.text !== 'string' || !reply.text) return;
    state.lastReply = reply.text;
    var div = el('div', 'chat-message assistant find-reply');
    reply.text.split('\n\n').forEach(function (paragraph) { append(div, el('p', null, paragraph)); });
    append(div, el('p', 'nofo-meta', reply.source === 'model'
      ? 'Written by the language model from the list below, and checked by code. A starting point, not advice.'
      : 'Written from a template using the list below. A starting point, not advice.'));
    // Buttons that jump to the parts of the page the reply talks about (only the ones that exist on this page).
    var jumps = el('div', 'find-reply-actions');
    if (document.getElementById('findUnderstood')) append(jumps, jumpButton('Go to what I understood', function () { return document.getElementById('findUnderstood'); }));
    if (document.getElementById('findOpportunities')) append(jumps, jumpButton('Go to the opportunities, best fit first', function () { return document.getElementById('findOpportunities'); }));
    if (closest && closest.opportunityId) append(jumps, closestButton(closest));
    if (jumps.childNodes.length > 0) append(div, jumps);
    append(els.thread, div);
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  /** Scrolls a part of the results into view and moves keyboard focus to it, so the jump works for everyone. */
  function jumpTo(target) {
    if (!target) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  /** A button under a reply that jumps to a part of the page. `find` returns the element when it is clicked. */
  function jumpButton(label, find) {
    var go = el('button', 'find-reply-action nofo-secondary', label);
    go.type = 'button';
    go.addEventListener('click', function () { jumpTo(find()); });
    return go;
  }

  /**
   * "Go to <closest listing>": takes the person to that listing's card in the list. (What its own button does, such as
   * preparing it or assessing a project against it, is on the card.)
   */
  function closestButton(item) {
    var title = String(item.title || 'this opportunity');
    var short = title.length > 60 ? title.slice(0, 59).trim() + '\u2026' : title;
    return jumpButton('Go to the closest listing: ' + short, function () {
      var cards = els.results.querySelectorAll('[data-opportunity-id]');
      for (var i = 0; i < cards.length; i++) if (cards[i].dataset.opportunityId === item.opportunityId) return cards[i];
      return null;
    });
  }

  /** Brings the newest message (the questions) into view, with the input box right below it. */
  function showLatestMessage() {
    var last = els.thread.lastElementChild;
    if (!last) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () { last.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }, 60);
  }

  function setError(message) {
    els.error.textContent = message || '';
    els.error.hidden = !message;
  }

  function setBusy(busy) {
    state.busy = busy;
    els.send.disabled = busy;
    els.now.disabled = busy;
    els.reset.disabled = busy;
    els.historical.disabled = busy;
    els.inspect.disabled = busy;
    els.results.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /** Reflects the conversation state in the form: what to type next, and whether "Skip the questions and search" makes sense. */
  function syncForm() {
    var left = D.messagesLeft(state.messages);
    var started = state.messages.length > 0;
    els.input.disabled = left === 0;
    els.input.rows = started ? 3 : 5; // once the conversation has begun, the box gives room back to the console and results
    els.send.textContent = !started ? 'Continue' : state.stage === 'ask' ? 'Send answers' : 'Update the list';
    els.now.hidden = state.stage !== 'ask';
    // Once every question is answered and the list is shown there is nothing left to add, so the optional box and its
    // "Update the list" button and the closed-and-archived checkbox go away. (After "Search now" the questions are still open, so they stay.) Start over remains.
    var finished = started && state.stage === 'results' && state.openQuestions === 0;
    els.input.hidden = finished;
    els.send.hidden = finished;
    // The "Include closed and archived" choice is part of the same optional update, so it goes too (its label is the checkbox's parent).
    if (els.historical.parentNode) els.historical.parentNode.hidden = finished;
    els.limit.hidden = left > 0;
    if (!started) {
      els.input.placeholder = 'For example: We are a state DOT and want to replace a structurally deficient bridge on a rural route. The project costs about $24 million and we would request $15 million in federal funds. Design is complete.';
    } else if (state.stage === 'ask') {
      els.input.placeholder = 'Answer the questions above in your own words…';
    } else {
      els.input.placeholder = 'Optional: add detail to refine the list.';
    }
  }

  // ---------------------------------------------------------------------------
  // Running a turn
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Live progress: the server reports each step as it really happens (reading the description, building
  // the query, each request to Simpler.Grants.gov, scoring). Nothing here is a timed guess.
  // ---------------------------------------------------------------------------

  var MIN_VISIBLE_MS = 300; // a step stays "running" on screen at least this long, so quick steps are readable
  var progress = { steps: [], nodes: {}, shownAt: {}, pending: {}, timers: {}, tick: null, startedAt: 0 };

  function progressClearTimers() {
    Object.keys(progress.timers).forEach(function (id) { clearTimeout(progress.timers[id]); });
    progress.timers = {};
    progress.pending = {};
  }

  function progressReset() {
    progress.steps = [];
    progress.nodes = {};
    progress.shownAt = {};
    progressClearTimers();
    clear(els.steps);
    els.progressTitle.textContent = 'Starting…';
    els.progressTime.textContent = '';
  }

  function progressStart() {
    progressReset();
    progress.startedAt = Date.now();
    // The progress shows in the conversation, right under the message that was just sent (the panel moves to the end of
    // the thread each turn; replies are added after it once it is done).
    els.thread.appendChild(els.progress);
    els.progress.hidden = false;
    els.progress.classList.remove('find-progress-complete');
    clearInterval(progress.tick);
    progress.tick = setInterval(function () {
      els.progressTime.textContent = Math.round((Date.now() - progress.startedAt) / 1000) + 's';
    }, 1000);
  }

  function progressStop() {
    clearInterval(progress.tick);
    progress.tick = null;
    progressClearTimers();
    var finished = progress.steps.length > 0 && progress.steps.every(function (s) { return s.status === 'done'; });
    if (finished && window.DemoMode && window.DemoMode.isOn() && progress.startedAt) {
      // Demo mode: leave the finished panel on screen, every step ticked, until the next run clears it.
      // (A run that failed or left a step unfinished is hidden as usual.)
      els.progressTime.textContent = Math.round((Date.now() - progress.startedAt) / 1000) + 's';
      els.progressTitle.textContent = 'Completed';
      els.progress.classList.add('find-progress-complete');
      return;
    }
    els.progress.hidden = true;
  }

  function showStep(event) {
    progress.steps = D.applyProgress(progress.steps, event);
    var step = progress.steps.filter(function (s) { return s.id === event.id; })[0];
    if (!step) return;
    var node = progress.nodes[step.id];
    if (!node) {
      node = { li: el('li', 'find-step'), icon: el('span', 'find-icon'), msg: el('span', 'find-step-msg'), detail: el('span', 'find-step-detail') };
      node.icon.setAttribute('aria-hidden', 'true');
      var text = el('span', 'find-step-text');
      append(text, node.msg, node.detail);
      append(node.li, node.icon, text);
      append(els.steps, node.li);
      progress.nodes[step.id] = node;
    }
    node.li.className = 'find-step find-step-' + step.status;
    node.icon.textContent = step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : '';
    node.msg.textContent = step.message;
    node.detail.textContent = step.detail;
    node.detail.hidden = !step.detail;
    var current = D.currentStep(progress.steps);
    if (current) els.progressTitle.textContent = current.message;
  }

  /**
   * Shows a reported step the moment it arrives. A step that finishes almost instantly keeps its "running" look for
   * MIN_VISIBLE_MS first. There is no queue, so a slow step never delays another and the result is never held back.
   */
  function enqueueStep(event) {
    var id = event.id;
    if (event.status === 'running') {
      clearTimeout(progress.timers[id]);
      delete progress.timers[id];
      delete progress.pending[id];
      progress.shownAt[id] = Date.now();
      showStep(event);
      return;
    }
    var wait = progress.shownAt[id] ? MIN_VISIBLE_MS - (Date.now() - progress.shownAt[id]) : 0;
    if (wait <= 0) {
      showStep(event);
      return;
    }
    progress.pending[id] = event;
    clearTimeout(progress.timers[id]);
    progress.timers[id] = setTimeout(function () {
      var held = progress.pending[id];
      delete progress.pending[id];
      delete progress.timers[id];
      if (held) showStep(held);
    }, wait);
  }

  /** The result has arrived: show any held step now. */
  function flushSteps() {
    var held = progress.pending;
    progressClearTimers();
    Object.keys(held).forEach(function (id) { showStep(held[id]); });
  }

  /** Brings the progress panel (and the console under it) into view, so a turn can be followed without scrolling. */
  function scrollToProgress() {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () { els.progress.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }, 60);
  }

  async function runTurn(options) {
    if (state.busy || state.messages.length === 0) return;
    setError('');
    setBusy(true);
    clear(els.results);
    progressStart();
    scrollToProgress();
    devConsole.begin('Turn ' + state.messages.length + (options && options.forceResults ? ' (searching now)' : ''));
    try {
      var data = await window.ProgressPanel.stream(
        API + '/discover?stream=1',
        D.buildRequest(state.messages, {
          includeHistorical: els.historical.checked,
          inspect: developerShows('apicalls') && els.inspect.checked,
          forceResults: !!(options && options.forceResults),
          asked: state.asked,
          previousReply: state.lastReply
        }),
        enqueueStep,
        devConsole.push
      );
      flushSteps();
      devConsole.end();
      progressStop();
      state.stage = data.stage;
      state.openQuestions = (data.questions || []).length;
      announceQuestions(data.questions, data.profile);
      if (data.stage === 'ask') {
        addQuestions(data.summary, data.questions);
        clear(els.results);
        showLatestMessage();
      } else {
        // The summary is shown once, at the top of the results, not repeated in the thread.
        renderResults(data);
        addExplanation(data.explanation);
        addReply(data.reply, D.splitResults(data.shortlist, data.showFirst).first[0]);
        showLatestMessage();
      }
    } catch (e) {
      devConsole.push({ kind: 'error', text: '✕ ' + e.message });
      devConsole.end();
      progressStop();
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
      syncForm();
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (state.busy) return;
    var next = D.nextMessages(state.messages, els.input.value);
    if (!next) {
      setError(els.input.value.trim() ? 'That message is too long, or the limit for this search has been reached. Start over to try a new description.' : 'Describe your project first.');
      return;
    }
    var text = els.input.value;
    var previous = state.messages;
    state.messages = next;
    addThread('user', next[next.length - 1].content);
    els.input.value = '';
    try {
      await runTurn();
    } catch (e) {
      // Nothing was found out from this message: put it back so it can be sent again.
      state.messages = previous;
      els.thread.lastElementChild && els.thread.lastElementChild.classList.contains('user') && els.thread.lastElementChild.remove();
      els.input.value = text;
      syncForm();
    }
  }

  function onShowNow() {
    runTurn({ forceResults: true }).catch(function () { /* the error is already shown */ });
  }

  function onHistoricalChange() {
    // Only re-run when there is already a list to change.
    if (state.stage === 'results') runTurn().catch(function () { /* the error is already shown */ });
  }

  function startOver() {
    if (state.busy) return;
    state.messages = [];
    state.stage = null;
    state.asked = [];
    state.lastReply = '';
    state.openQuestions = 0;
    state.inspection = null;
    announceQuestions(null);
    devConsole.clear();
    clear(els.thread);
    clear(els.results);
    setError('');
    els.input.value = '';
    syncForm();
    els.input.focus();
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  function renderFacts(profile) {
    var facts = D.profileFacts(profile);
    if (facts.length === 0) return null;
    var card = el('div', 'card');
    append(card, el('h3', null, 'What I understood from your description'));
    var ul = el('ul', 'nofo-chips');
    facts.forEach(function (f) {
      var li = el('li', 'nofo-chip');
      var text = el('div', 'nofo-chip-text');
      append(text, el('span', 'nofo-chip-label', f.label), el('strong', null, f.value), el('span', 'nofo-chip-quote', '“' + f.quote + '”'));
      // A card whose text is cut short opens the full text in a modal (chip-modal.js).
      if (window.ChipModal) window.ChipModal.attach(li, text, { label: f.label, value: f.value, quote: f.quote });
      append(li, text);
      append(ul, li);
    });
    append(card, ul);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Preparing an opportunity for assessment (download + read its documents, then extract its requirements)
  // ---------------------------------------------------------------------------

  var POLL_MS = 3000;
  var DEMO_POLL_MS = 250; // demo mode's scripted prepare is over in about 1.5 s, so it is read often

  /**
   * Opens the Assess tab on this opportunity, with the first message pre-filled: a project description the language
   * model writes from what was said here (code-checked; the applicant's own messages if that fails). Assess opens
   * either way, so a failure here never blocks it.
   */
  function assessButton(item) {
    var label = 'Assess my project against this';
    var go = el('button', null, label);
    go.type = 'button';
    go.addEventListener('click', async function () {
      go.disabled = true;
      go.textContent = 'Writing your project description…';
      var draft = null;
      try {
        var data = await request('/project-description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: state.messages.map(function (m) { return { role: 'user', content: m.content }; }) })
        });
        draft = { text: data.text, source: data.source };
      } catch (e) {
        // Fall back to the applicant's own messages, joined, so Assess still opens with something to edit.
        draft = { text: state.messages.map(function (m) { return m.content; }).join('\n\n'), source: 'code' };
      }
      go.disabled = false;
      go.textContent = label;
      window.NofoApp.openAssess(item.opportunityId, { draft: draft });
    });
    return go;
  }

  /** Demo mode: the finished Prepare progress (both steps ticked), kept on screen above the "Prepared" line. */
  function showCompletedPrepare(box, state) {
    var wrap = el('div', 'find-progress find-progress-complete find-prepare-complete');
    var head = el('div', 'find-progress-head');
    var spinner = el('span', 'find-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    append(head, spinner, el('strong', null, 'Completed'));
    var bar = el('div', 'find-bar');
    bar.setAttribute('aria-hidden', 'true');
    append(bar, el('span'));
    var steps = el('ol', 'find-steps');
    D.prepareSteps(Object.assign({}, state, { status: 'ready' })).forEach(function (step) {
      var li = el('li', 'find-step find-step-' + step.status);
      var icon = el('span', 'find-icon', step.status === 'done' ? '✓' : '');
      icon.setAttribute('aria-hidden', 'true');
      append(li, icon, el('span', 'find-step-text', step.label));
      append(steps, li);
    });
    append(wrap, head, bar, steps);
    append(box, wrap);
  }

  function showReady(item, box, state) {
    item.readyToAssess = true;
    clear(box);
    if (window.DemoMode && window.DemoMode.isOn() && state && state.startedAt) showCompletedPrepare(box, state);
    append(box, el('p', 'nofo-meta', 'Prepared: ' + (state && state.requirements ? state.requirements + ' requirements extracted from the official documents.' : 'the requirements were extracted from the official documents.')));
    if (state && state.partial) append(box, el('p', 'nofo-warning', state.message));
    append(box, window.NofoApp ? assessButton(item) : el('p', 'nofo-meta', 'Open the Assess tab to continue.'));
  }

  /** The "not prepared yet" view: a button, and the manual commands as a fallback. `problem` is a message from a failed try. */
  function showPrepareOffer(item, box, problem) {
    clear(box);
    if (problem) append(box, el('p', 'error', problem));
    append(box, el('p', 'nofo-meta', 'This opportunity has not been prepared for assessment on this server yet. Preparing downloads its official documents from Simpler.Grants.gov and reads them with the language model to extract the requirements. It can take several minutes and uses the server\'s API quota, and only one opportunity can be prepared at a time.'));
    var go = el('button', null, problem ? 'Try again' : 'Prepare this opportunity for assessment');
    go.type = 'button';
    go.addEventListener('click', function () { startPrepare(item, box, go); });
    append(box, go);
    var commands = D.loadCommands(item.opportunityId);
    if (commands.length) {
      var details = el('details', 'nofo-collapsible');
      append(details, el('summary', null, 'Prefer to do it by hand? Operator commands'));
      commands.forEach(function (command) { append(details, el('code', 'find-command', command)); });
      append(box, details);
    }
  }

  function showPrepareProgress(item, box, state, startedAt, simulated) {
    clear(box);
    var head = el('div', 'find-progress-head');
    var spinner = el('span', 'find-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    var title = el('strong', null, state.message);
    title.setAttribute('role', 'status');
    var time = el('span', 'nofo-meta', D.formatElapsed((Date.now() - startedAt) / 1000));
    time.setAttribute('aria-hidden', 'true');
    time.dataset.elapsed = 'true';
    append(head, spinner, title, time);
    var bar = el('div', 'find-bar');
    bar.setAttribute('aria-hidden', 'true');
    append(bar, el('span'));
    var steps = el('ol', 'find-steps');
    steps.setAttribute('aria-hidden', 'true');
    D.prepareSteps(state).forEach(function (step) {
      var li = el('li', 'find-step find-step-' + step.status);
      var icon = el('span', 'find-icon', step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : '');
      icon.setAttribute('aria-hidden', 'true');
      append(li, icon, el('span', 'find-step-text', step.label));
      append(steps, li);
    });
    append(box, head, bar, steps);
    // Said on screen, so a replay is never mistaken for a live download.
    if (simulated) append(box, el('p', 'nofo-meta', 'Simulated: this opportunity\'s documents are already downloaded and read on this server, so nothing is being downloaded and the language model is not being called. The documents and counts shown are the real ones.'));
  }

  function pollMs() {
    return window.DemoMode && window.DemoMode.isOn() ? DEMO_POLL_MS : POLL_MS;
  }

  /** Polls the server until the job finishes. Stops quietly if the card has been replaced by a new search. */
  function trackPrepare(item, box, state) {
    var startedAt = state.startedAt ? Date.parse(state.startedAt) || Date.now() : Date.now();
    var ticker = null;
    var timer = null;
    function stop() {
      clearInterval(ticker);
      clearTimeout(timer);
    }
    showPrepareProgress(item, box, state, startedAt);
    ticker = setInterval(function () {
      if (!document.body.contains(box)) { stop(); return; }
      var t = box.querySelector('[data-elapsed]');
      if (t) t.textContent = D.formatElapsed((Date.now() - startedAt) / 1000);
    }, 1000);

    async function poll() {
      if (!document.body.contains(box)) { stop(); return; }
      try {
        var next = await request('/prepare/' + encodeURIComponent(item.opportunityId));
        if (next.status === 'ready') { stop(); showReady(item, box, next); return; }
        if (next.status === 'failed') { stop(); showPrepareOffer(item, box, next.error || next.message); return; }
        if (next.status === 'idle') { stop(); showPrepareOffer(item, box, 'The server lost track of this job (it may have restarted). You can try again.'); return; }
        showPrepareProgress(item, box, next, startedAt);
      } catch (e) {
        // A hiccup while polling is not a failed job: keep trying.
      }
      timer = setTimeout(poll, pollMs());
    }
    timer = setTimeout(poll, pollMs());
  }

  async function startPrepare(item, box, button) {
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      var state = await request('/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId: item.opportunityId })
      });
      if (state.status === 'ready') showReady(item, box, state);
      else if (D.isPreparing(state)) trackPrepare(item, box, state);
      else showPrepareOffer(item, box, state.error || state.message);
    } catch (e) {
      showPrepareOffer(item, box, e.message);
    }
  }

  /** If a job for this card is already running (for example after searching again), show it instead of the offer. */
  async function resumePrepare(item, box) {
    try {
      var state = await request('/prepare/' + encodeURIComponent(item.opportunityId));
      if (!document.body.contains(box)) return;
      if (D.isPreparing(state)) trackPrepare(item, box, state);
      else if (state.status === 'ready') showReady(item, box, state);
    } catch (e) {
      /* the offer stays; nothing to resume */
    }
  }

  /** This opportunity is already prepared and "Simulate preparing" is on in Settings. Demo mode always counts as on, whatever the saved setting. */
  function replaysPrepare(item) {
    return !!window.PrepareReplay && window.PrepareReplay.applies(item, {
      enabled: (!!window.DemoMode && window.DemoMode.isOn()) || (!!window.AppSettings && window.AppSettings.simulatePrepare())
    }) && !!window.NofoApp;
  }

  /** Plays the simulated preparation step by step, then shows the real "Prepared" view. Stops if the card is replaced. */
  function runReplay(item, box, overview) {
    var steps = window.PrepareReplay.plan(item);
    var startedAt = Date.now();
    var ticker = null;
    var timer = null;
    function stop() {
      clearInterval(ticker);
      clearTimeout(timer);
    }
    function play(i) {
      if (!document.body.contains(box)) { stop(); return; }
      var step = steps[i];
      if (step.state.status === 'ready') {
        stop();
        // The documents overview was held back while the simulation ran; it appears now that "reading" is done.
        if (overview) overview.hidden = false;
        showReady(item, box, Object.assign({ opportunityId: item.opportunityId, partial: false }, step.state));
        return;
      }
      showPrepareProgress(item, box, Object.assign({ opportunityId: item.opportunityId }, step.state), startedAt, true);
      timer = setTimeout(function () { play(i + 1); }, step.holdMs);
    }
    ticker = setInterval(function () {
      if (!document.body.contains(box)) { stop(); return; }
      var t = box.querySelector('[data-elapsed]');
      if (t) t.textContent = D.formatElapsed((Date.now() - startedAt) / 1000);
    }, 1000);
    play(0);
  }

  /** The offer for an already-prepared opportunity while "Simulate preparing" is on in Settings. */
  function showReplayOffer(item, box, overview) {
    clear(box);
    append(box, el('p', 'nofo-meta', 'This opportunity\'s documents are already downloaded and read on this server. "Simulate preparing" is on in Settings, so the button below replays the download and reading steps for a demonstration. Nothing is downloaded and the language model is not called.'));
    var go = el('button', null, 'Prepare this opportunity for assessment');
    go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true;
      runReplay(item, box, overview);
    });
    append(box, go);
  }

  /** `overview` is the card's documents box when the simulation is holding it back (see renderCard), else null. */
  function renderAssessAction(item, overview) {
    var box = el('div', 'find-actions');
    if (replaysPrepare(item)) {
      showReplayOffer(item, box, overview);
      return box;
    }
    if (item.readyToAssess && window.NofoApp) {
      append(box, assessButton(item));
      return box;
    }
    showPrepareOffer(item, box, '');
    // The card is not in the page yet; look for a running job once it is.
    setTimeout(function () { resumePrepare(item, box); }, 0);
    return box;
  }

  /**
   * The documents downloaded for this opportunity, as a table (title, type, role, pages, words) with a line on the
   * requirements extracted from them: how much a specialist would have to read and check. Counts only. Every string is
   * set with textContent.
   */
  function renderDownloaded(view) {
    var box = el('div', 'find-reading');
    append(box, el('p', 'nofo-reply-label', 'Documents to review'));
    append(box, el('p', 'find-reading-headline', view.headline));
    var wrap = el('div', 'find-doc-table-wrap');
    var table = el('table', 'find-doc-table');
    var head = el('tr');
    ['Document', 'Type', 'Role', 'Pages', 'Words'].forEach(function (label, i) {
      var th = el('th', i >= 3 ? 'find-num' : null, label);
      th.scope = 'col';
      append(head, th);
    });
    append(table, el('thead'), el('tbody'));
    append(table.firstChild, head);
    view.rows.forEach(function (row) {
      var tr = el('tr');
      append(tr, el('td', null, row.title + (row.unread ? ' (could not be read)' : '')), el('td', null, row.format), el('td', null, row.role), el('td', 'find-num', row.pages), el('td', 'find-num', row.words));
      append(table.lastChild, tr);
    });
    append(wrap, table);
    append(box, wrap);
    if (view.requirements) append(box, el('p', 'find-reading-requirements', view.requirements));
    append(box, el('p', 'nofo-meta', view.legend + (view.downloadedOn ? ' Downloaded ' + view.downloadedOn + '.' : '')));
    return box;
  }

  /** The strip above the cards: the downloaded documents of the listings shown, added up. */
  function renderImpact(view) {
    var box = el('div', 'find-impact');
    append(box, el('p', 'find-impact-title', view.title));
    var list = el('ul', 'find-impact-stats');
    view.stats.forEach(function (stat) {
      var li = el('li');
      append(li, el('span', 'find-impact-num', stat.value), el('span', 'find-impact-label', stat.label));
      append(list, li);
    });
    append(box, list);
    append(box, el('p', 'nofo-meta', view.note));
    return box;
  }

  /**
   * What Simpler.Grants.gov lists for this opportunity: a note for "none listed" (with the other pages to check), or the
   * file names for "listed". Every string is text, and the links open in a new tab.
   */
  function renderDocuments(view) {
    var box = el('div', 'find-docs find-docs-' + view.state);
    if (view.blocksPrepare) {
      var warning = el('p', 'nofo-warning');
      append(warning, el('strong', null, view.headline + '. '), document.createTextNode(view.text));
      append(box, warning);
      if (view.files.length > 0) {
        var listedFiles = el('details', 'nofo-collapsible');
        append(listedFiles, el('summary', null, 'Documents listed on Simpler.Grants.gov (file names)'));
        var fileList = el('ul', 'nofo-reply-list');
        view.files.forEach(function (name) { append(fileList, el('li', null, name)); });
        if (view.moreFiles > 0) append(fileList, el('li', null, '…and ' + view.moreFiles + ' more'));
        append(listedFiles, fileList);
        append(box, listedFiles);
      }
      if (view.links.length > 0) {
        append(box, el('p', 'nofo-reply-label', 'Where else to look'));
        var ul = el('ul', 'nofo-reply-list');
        view.links.forEach(function (link) {
          var li = el('li');
          var a = el('a', null, link.label);
          a.href = link.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          append(li, a);
          append(ul, li);
        });
        append(box, ul);
      }
      return box;
    }
    if (view.state === 'listed' && view.files.length > 0) {
      var details = el('details', 'nofo-collapsible');
      append(details, el('summary', null, view.headline + ' on Simpler.Grants.gov (file names)'));
      var names = el('ul', 'nofo-reply-list');
      view.files.forEach(function (name) { append(names, el('li', null, name)); });
      if (view.moreFiles > 0) append(names, el('li', null, '…and ' + view.moreFiles + ' more'));
      append(details, names);
      append(box, details);
      return box;
    }
    append(box, el('p', 'nofo-meta', view.headline + (view.text ? '. ' + view.text : '')));
    return box;
  }

  function renderCard(item) {
    var card = el('article', 'card find-card');
    card.dataset.opportunityId = String(item.opportunityId || '');
    var head = el('div', 'find-card-head');
    var heading = el('h3');
    var pageUrl = D.safeUrl(item.simplerUrl);
    if (pageUrl) {
      // The title opens the opportunity on Simpler.Grants.gov in a new tab.
      var titleLink = el('a', 'find-title-link', item.title);
      titleLink.href = pageUrl;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.setAttribute('aria-label', item.title + ' (opens the Simpler.Grants.gov page in a new tab)');
      append(heading, titleLink);
    } else {
      heading.textContent = item.title;
    }
    append(head, heading);
    var badges = el('div', 'find-badges');
    var match = D.matchInfo(item);
    var status = D.statusInfo(item);
    append(badges, badge(match.text, match.kind), badge(status.text, status.kind));
    append(head, badges);
    append(card, head);
    append(card, el('p', 'nofo-meta', D.metaParts(item).join(' · ')));
    if (item.otherEditions > 0) {
      append(card, el('p', 'nofo-meta', 'Includes ' + item.otherEditions + ' other edition' + (item.otherEditions === 1 ? '' : 's') + ' of this program; the most relevant one is shown.'));
    }
    if (item.whyItMayFit.length > 0) {
      append(card, el('p', 'nofo-reply-label', 'Why it may fit'), list('nofo-reply-list', item.whyItMayFit));
    }
    if (item.watchOuts.length > 0) {
      append(card, el('p', 'nofo-reply-label', 'Watch out for'), list('nofo-reply-list find-watch', item.watchOuts));
    }
    // An already-prepared opportunity is assessable whatever Simpler lists, so the documents note is only for the rest.
    var docs = item.readyToAssess ? null : D.documentsView(item);
    var reading = D.downloadedView(item);
    // The reading table already lists every file, with pages, so the list of names is not repeated.
    if (reading && docs) {
      if (docs.state === 'listed') docs = null;
      else { docs.files = []; docs.moreFiles = 0; }
    }
    var url = D.safeUrl(item.additionalInfoUrl);
    // When there is nothing to prepare the note below names this page itself, so it is not repeated here.
    if (url && !(docs && docs.blocksPrepare)) {
      var p = el('p', 'nofo-meta');
      var a = el('a', null, 'More information from the program');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      append(p, a);
      append(card, p);
    }
    var raw = state.inspection ? D.findRawListing(state.inspection, item.opportunityId) : null;
    if (raw) {
      var rawDetails = el('details', 'nofo-collapsible find-inspect-item dev-only dev-section-apicalls');
      append(rawDetails, el('summary', null, 'Raw listing from Simpler.Grants.gov (from: ' + raw.label + ')'));
      var block = jsonBlock('Listing as received', raw.listing, 'listing-' + D.safeFileName(item.opportunityNumber || item.opportunityId));
      append(rawDetails, block.node);
      rawDetails.addEventListener('toggle', function () { if (rawDetails.open) block.fill(); });
      append(card, rawDetails);
    }
    // While "Simulate preparing" is on, the documents overview is hidden until the simulated reading finishes.
    var overview = reading ? renderDownloaded(reading) : null;
    if (overview) {
      overview.hidden = replaysPrepare(item);
      append(card, overview);
    }
    if (docs) append(card, renderDocuments(docs));
    // Nothing to prepare without a notice document: say why instead of offering a job that can only fail.
    if (!(docs && docs.blocksPrepare)) append(card, renderAssessAction(item, overview && overview.hidden ? overview : null));
    return card;
  }

  function renderSearches(searches) {
    if (!searches.length) return null;
    var details = el('details', 'nofo-collapsible dev-only dev-section-built');
    append(details, el('summary', null, 'How the list was built (' + searches.length + ' search' + (searches.length === 1 ? '' : 'es') + ')'));
    var ul = el('ul', 'nofo-reply-list');
    searches.forEach(function (s) {
      var li = el('li');
      append(li, el('strong', null, s.label + (s.records === null ? '' : ' — ' + s.records + ' listing' + (s.records === 1 ? '' : 's'))), el('br'), document.createTextNode(s.detail));
      append(ul, li);
    });
    append(details, ul);
    append(details, el('p', 'nofo-meta', 'Applicant type, award size, cost sharing and category are used to rank the results, never to exclude any, because many listings leave them blank or list “other”.'));
    return details;
  }

  // ---------------------------------------------------------------------------
  // Inspecting the raw Simpler.Grants.gov traffic
  // ---------------------------------------------------------------------------

  function flash(button, text) {
    var original = button.textContent;
    button.textContent = text;
    setTimeout(function () { button.textContent = original; }, 1500);
  }

  function copyText(text, button) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(button, 'Copied'); }, function () { flash(button, 'Copy failed'); });
    } else {
      flash(button, 'Copy not available');
    }
  }

  function downloadJson(value, fileName) {
    var blob = new Blob([D.prettyJson(value)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function smallButton(text, onClick) {
    var b = el('button', 'nofo-secondary find-small', text);
    b.type = 'button';
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }

  /** A titled, scrollable block of JSON with Copy and Download. The text is filled in on demand (responses can be large). */
  function jsonBlock(title, value, fileName) {
    var node = el('div', 'find-json-block');
    var head = el('div', 'find-json-head');
    append(head, el('strong', null, title));
    append(head, smallButton('Copy', function (b) { copyText(D.prettyJson(value), b); }));
    append(head, smallButton('Download', function () { downloadJson(value, fileName); }));
    var pre = el('pre', 'find-json');
    pre.tabIndex = 0;
    append(node, head, pre);
    var filled = false;
    return {
      node: node,
      fill: function () {
        if (filled) return;
        filled = true;
        pre.textContent = D.prettyJson(value);
      }
    };
  }

  function renderInspection(inspection) {
    var card = el('div', 'card find-inspect dev-only dev-section-apicalls');
    append(card, el('h3', null, 'Simpler.Grants.gov requests and responses'));
    append(card, el('p', 'nofo-meta', 'Exactly what this server sent to Simpler.Grants.gov and what came back, for each search. The API key travels in a header and is never shown here. The responses are public listing data.'));
    var all = smallButton('Download everything (JSON)', function () {
      downloadJson({ inspectedAt: new Date().toISOString(), searches: inspection }, 'simpler-grants-inspection.json');
    });
    append(card, all);
    inspection.forEach(function (item) {
      var details = el('details', 'nofo-collapsible find-inspect-item');
      append(details, el('summary', null, item.label + ' — ' + D.describeInspection(item)));
      var base = D.safeFileName(item.planId || item.label);
      var request = jsonBlock('Request sent (POST /v1/opportunities/search)', item.request, 'request-' + base);
      append(details, request.node);
      var blocks = [request];
      if (item.ok && item.response !== null) {
        var response = jsonBlock('Response received', item.response, 'response-' + base);
        append(details, response.node);
        blocks.push(response);
      } else {
        append(details, el('p', 'error', item.error || 'This search failed, so there is no response.'));
      }
      details.addEventListener('toggle', function () {
        if (details.open) blocks.forEach(function (b) { b.fill(); });
      });
      append(card, details);
    });
    return card;
  }

  function callSummary(call) {
    if (!call.ok) return 'failed';
    var count = call.totalRecords !== null && call.totalRecords > call.returned ? call.returned + ' of ' + call.totalRecords + ' listings' : call.returned + ' listing' + (call.returned === 1 ? '' : 's');
    return (call.cached ? 'reused a recent answer, ' : '') + count;
  }

  /** The requests that were made, with every parameter, and a curl command for each. */
  function renderApiCalls(calls) {
    if (!calls || calls.length === 0) return null;
    var card = el('div', 'card find-apicalls dev-only dev-section-apicalls');
    append(card, el('h3', null, 'The Simpler.Grants.gov API call' + (calls.length === 1 ? '' : 's')));
    append(card, el('p', 'nofo-meta', 'Exactly what this server sent, one request per search, with every parameter. The API key is a header the server adds and is never shown; the curl command reads it from SIMPLER_GRANTS_API_KEY in your own environment.'));
    // The search that carries the project's words is the interesting one, so it starts open.
    var primary = calls.filter(function (c) { return c.body && c.body.query; })[0] || calls[0];
    calls.forEach(function (call) {
      var details = el('details', 'nofo-collapsible find-inspect-item');
      if (call === primary) details.open = true;
      append(details, el('summary', null, call.label + ' — ' + callSummary(call)));
      append(details, el('code', 'find-command', call.method + ' ' + call.url));
      var headerText = Object.keys(call.headers).map(function (name) { return name + ': ' + call.headers[name]; }).join('\n');
      var headers = el('pre', 'find-json find-headers', headerText);
      append(details, headers);
      var body = jsonBlock('Request body (JSON)', call.body, 'request-' + D.safeFileName(call.planId));
      append(details, body.node);
      if (details.open) body.fill();
      details.addEventListener('toggle', function () { if (details.open) body.fill(); });
      var tools = el('div', 'find-json-head');
      append(tools, el('strong', null, 'As a curl command'));
      append(tools, smallButton('Copy curl command', function (b) { copyText(call.curl, b); }));
      var curl = el('pre', 'find-json', call.curl);
      curl.tabIndex = 0;
      append(details, tools, curl);
      if (call.error) append(details, el('p', 'error', call.error));
      append(card, details);
    });
    return card;
  }

  function signed(points) {
    return (points > 0 ? '+' : points < 0 ? '−' : '') + Math.abs(points);
  }

  /** A collapsible table of every listing that was scored, with the signals behind each score. */
  function renderScored(scored) {
    if (!scored || scored.length === 0) return null;
    var details = el('details', 'nofo-collapsible find-scored dev-only dev-section-scored');
    var shown = scored.filter(function (r) { return r.shown; }).length;
    append(details, el('summary', null, 'All ' + scored.length + ' listings that were scored (' + shown + ' shown below)'));
    append(details, el('p', 'nofo-meta', 'Every listing the searches returned, best score first. The score is the sum of the signals listed under each title; no model is involved. Earlier editions of the same program are folded into one row.'));
    var wrap = el('div', 'find-table-wrap');
    var table = el('table', 'find-table');
    var head = el('tr');
    ['#', 'Listing and what made up its score', 'Score', 'Match', 'In the list'].forEach(function (name) { append(head, el('th', null, name)); });
    var thead = el('thead');
    append(thead, head);
    append(table, thead);
    var tbody = el('tbody');
    scored.forEach(function (row, index) {
      var tr = el('tr', row.shown ? 'find-row-shown' : null);
      append(tr, el('td', 'find-num', String(index + 1)));
      var info = el('td');
      var pageUrl = D.safeUrl(row.simplerUrl);
      if (pageUrl) {
        var link = el('a', 'find-title-link', row.title);
        link.href = pageUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        append(info, link);
      } else {
        append(info, el('strong', null, row.title));
      }
      append(info, el('div', 'nofo-meta', [row.opportunityNumber, row.status + (row.historical ? ' (historical)' : ''), row.otherEditions > 0 ? '+' + row.otherEditions + ' other edition' + (row.otherEditions === 1 ? '' : 's') : null].filter(Boolean).join(' · ')));
      if (row.parts.length > 0) {
        var ul = el('ul', 'find-parts');
        row.parts.forEach(function (part) {
          append(ul, el('li', part.points < 0 ? 'find-part-neg' : 'find-part-pos', signed(part.points) + '  ' + part.label));
        });
        append(info, ul);
      } else {
        append(info, el('div', 'nofo-meta', 'No signal added or removed points.'));
      }
      append(tr, info);
      append(tr, el('td', 'find-score', String(row.score)));
      append(tr, el('td', null, row.match === 'likely' ? 'Likely' : 'Weaker'));
      append(tr, el('td', null, (row.shown ? '✓ ' : '') + row.note));
      append(tbody, tr);
    });
    append(table, tbody);
    append(wrap, table);
    append(details, wrap);
    return details;
  }

  var ACTORS = { you: 'You', model: 'Language model', code: 'Code' };
  var ORIGINS = { rule: 'Fixed rule', words: 'Your words', choice: 'Your choice' };

  /** How this search's parameters were built, step by step, and where each value came from. Written by code on the server. */
  function renderTrace(trace) {
    if (!trace || !trace.steps || trace.steps.length === 0) return null;
    var card = el('div', 'card find-trace dev-only dev-section-trace');
    append(card, el('h3', null, 'How the code and the language model built these API calls'));
    append(card, el('p', 'nofo-meta', 'Written by the app from what actually happened in this search (not by the language model), so it matches the calls above. The model proposes facts from your words; code checks them and builds every parameter.'));
    var ol = el('ol', 'find-trace-steps');
    trace.steps.forEach(function (step) {
      var li = el('li', 'find-trace-step');
      var head = el('div', 'find-trace-head');
      append(head, el('span', 'find-actor find-actor-' + step.actor, ACTORS[step.actor] || step.actor), el('strong', null, step.title));
      append(li, head, el('p', null, step.detail));
      if (step.items && step.items.length) append(li, list('find-trace-items', step.items));
      append(ol, li);
    });
    append(card, ol);
    if (trace.parameters && trace.parameters.length) {
      append(card, el('h4', null, 'Where each parameter came from'));
      var wrap = el('div', 'find-table-wrap');
      var table = el('table', 'find-table');
      var thead = el('thead');
      var hr = el('tr');
      ['Search', 'Parameter', 'Value', 'Source', 'Why'].forEach(function (name) { append(hr, el('th', null, name)); });
      append(thead, hr);
      append(table, thead);
      var tbody = el('tbody');
      trace.parameters.forEach(function (row) {
        var tr = el('tr');
        append(tr, el('td', null, row.call), el('td', null, row.parameter), el('td', 'find-trace-value', row.value));
        var origin = el('td');
        append(origin, el('span', 'find-origin find-origin-' + row.origin, ORIGINS[row.origin] || row.origin));
        append(tr, origin, el('td', null, row.why));
        append(tbody, tr);
      });
      append(table, tbody);
      append(wrap, table);
      append(card, wrap);
    }
    return card;
  }

  function renderResults(data) {
    clear(els.results);
    var apiCalls = renderApiCalls(data.apiCalls);
    if (apiCalls) append(els.results, apiCalls);
    var trace = renderTrace(data.trace);
    if (trace) append(els.results, trace);
    var facts = renderFacts(data.profile);
    if (facts) {
      facts.id = 'findUnderstood';
      append(els.results, facts);
    }

    var scoredBox = renderScored(data.scored);
    if (scoredBox) append(els.results, scoredBox);

    var summaryCard = el('div', 'card');
    summaryCard.id = 'findOpportunities';
    append(summaryCard, el('h3', null, data.shortlist.length ? 'Opportunities, best fit first' : 'No listings found'));
    append(summaryCard, el('p', null, data.summary));
    // The strip adds up the documents of the listings that are on screen, and is redone when the rest are revealed.
    var parts = D.splitResults(data.shortlist, data.showFirst);
    var impactBox = el('div');
    function showImpact(items) {
      clear(impactBox);
      var view = D.downloadedTotalsView(D.totalsFor(items), items.length);
      if (view) append(impactBox, renderImpact(view));
    }
    showImpact(parts.first);
    append(summaryCard, impactBox);
    if (data.shortlist.length === 0 && !data.includeHistorical) {
      // The checkbox is developer-only, so the plain hint does not point to it; a developer sees where to find it.
      append(summaryCard, el('p', 'nofo-meta', 'No open listings matched. Try describing the project in more detail, for example the kind of project and who is applying.'));
      append(summaryCard, el('p', 'nofo-meta dev-only dev-section-apicalls', 'Developer mode: tick “Include closed and archived opportunities” above to see past programs.'));
    }
    data.warnings.forEach(function (w) { append(summaryCard, el('p', 'nofo-warning', w)); });
    append(els.results, summaryCard);

    state.inspection = data.inspection || null;
    parts.first.forEach(function (item) { append(els.results, renderCard(item)); });
    if (parts.rest.length > 0) {
      var more = el('div', 'find-more');
      var moreButton = el('button', 'nofo-secondary', 'Show the other ' + parts.rest.length + ' listing' + (parts.rest.length === 1 ? '' : 's'));
      moreButton.type = 'button';
      moreButton.addEventListener('click', function () {
        var firstNew = null;
        parts.rest.forEach(function (item) {
          var card = renderCard(item);
          if (!firstNew) firstNew = card;
          els.results.insertBefore(card, more);
        });
        els.results.removeChild(more);
        showImpact(data.shortlist);
        if (firstNew) {
          firstNew.tabIndex = -1;
          firstNew.focus();
        }
      });
      append(more, moreButton);
      append(els.results, more);
    }
    if (state.inspection) append(els.results, renderInspection(state.inspection));

    if (data.questions.length > 0) {
      var q = el('div', 'card');
      append(q, el('h3', null, 'Optional: tell me more to refine the list'));
      append(q, list('nofo-reply-list', data.questions.map(function (item) { return item.text; })));
      append(q, el('p', 'nofo-meta', 'You skipped the questions, so these are optional. Type in the box above to update the list, or leave it as it is.'));
      append(els.results, q);
    }

    var how = renderSearches(data.searches);
    if (how) append(els.results, how);
    append(els.results, el('p', 'nofo-meta find-disclaimer', data.disclaimer));
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------

  function init() {
    els.form = document.getElementById('findForm');
    els.input = document.getElementById('findInput');
    els.send = document.getElementById('findSend');
    els.now = document.getElementById('findNow');
    els.reset = document.getElementById('findReset');
    els.historical = document.getElementById('findHistorical');
    els.inspect = document.getElementById('findInspect');
    els.limit = document.getElementById('findLimit');
    els.error = document.getElementById('findError');
    els.thread = document.getElementById('findThread');
    els.progress = document.getElementById('findProgress');
    els.progressTitle = document.getElementById('findProgressTitle');
    els.progressTime = document.getElementById('findProgressTime');
    els.steps = document.getElementById('findSteps');
    els.results = document.getElementById('findResults');
    if (!els.form || !D || !els.progress || !els.inspect || !window.ProgressPanel) return;
    var consoleRoot = document.getElementById('findConsole');
    if (consoleRoot && window.DevConsole) {
      devConsole = window.DevConsole.create({
        root: consoleRoot,
        log: document.getElementById('findConsoleLog'),
        copy: document.getElementById('findConsoleCopy'),
        clear: document.getElementById('findConsoleClear')
      });
    }

    els.form.addEventListener('submit', onSubmit);
    els.now.addEventListener('click', onShowNow);
    els.reset.addEventListener('click', startOver);
    els.historical.addEventListener('change', onHistoricalChange);
    els.inspect.addEventListener('change', onHistoricalChange); // same behavior: re-run when a list is showing
    els.input.addEventListener('keydown', function (e) {
      // Enter sends; Shift+Enter adds a line.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); }
    });
    syncForm();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
