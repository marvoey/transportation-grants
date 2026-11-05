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
  var API = '/api/nofo';
  var MAX_SENT_MESSAGES = 12;

  var state = {
    opportunities: [],
    opportunityId: null,
    messages: [], // { role, content }
    windowStart: 0, // messages before this index are not sent (after a fact was removed)
    facts: {},
    result: null,
    busy: false
  };

  var els = {};

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
    if (!readMessage) body.readMessage = false;
    return request('/assess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function runTurn(options) {
    if (state.busy || !state.opportunityId) return;
    setBusy(true);
    var pending = addMessage('assistant', 'Reading your message and checking it against the requirements… this can take up to a minute.', { pending: true });
    try {
      var data = await assess(options);
      removePending();
      if (!data) return;
      state.facts = data.facts || {};
      state.result = data;
      renderResults(data);
      if (!options || options.readMessage !== false) {
        var reply = el('div');
        append(reply, el('p', null, data.advisory.headline));
        if (data.questions.length > 0) {
          append(reply, el('p', 'nofo-reply-label', 'To sharpen this, tell me:'));
          var list = el('ul', 'nofo-reply-list');
          data.questions.forEach(function (q) { list.appendChild(el('li', null, q.text)); });
          reply.appendChild(list);
        }
        addMessage('assistant', '', { node: reply });
        state.messages.push({ role: 'assistant', content: U.assistantTurnText(data.advisory.headline, data.questions) });
      } else {
        addMessage('assistant', 'Updated. ' + data.advisory.headline);
      }
    } catch (e) {
      removePending();
      addError(e.message || 'Something went wrong.');
    } finally {
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
    runTurn();
  }

  function removeFact(key) {
    if (state.busy) return;
    delete state.facts[key];
    // Later turns must not read the removed statement again from older messages.
    state.windowStart = state.messages.length;
    runTurn({ readMessage: false });
  }

  function startOver() {
    if (state.busy) return;
    state.messages = [];
    state.windowStart = 0;
    state.facts = {};
    state.result = null;
    clear(els.messages);
    clear(els.results);
    showIntroMessage();
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
        append(text, el('span', 'nofo-chip-label', U.factLabel(key)));
        append(text, el('strong', null, U.formatFactValue(key, fact.value)));
        if (fact.quote) append(text, el('span', 'nofo-chip-quote', 'You said: “' + U.truncate(fact.quote, 160) + '”'));
        var remove = button('Remove', 'nofo-link-button', function () { removeFact(key); });
        remove.dataset.removeFact = key;
        remove.setAttribute('aria-label', 'Remove ' + U.factLabel(key));
        append(chip, text, remove);
        list.appendChild(chip);
      });
      section.appendChild(list);
    }
    (data.rejectedFacts || []).forEach(function (r) {
      append(section, el('p', 'nofo-meta', 'Not recorded: ' + U.factLabel(r.key) + ' (' + r.reason + ').'));
    });
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

  function renderResults(data) {
    clear(els.results);
    var findingsById = {};
    data.findings.forEach(function (f) { findingsById[f.requirementId] = f; });

    // Summary
    var summary = el('section', 'card nofo-summary');
    append(summary, el('p', 'nofo-label', data.advisory.label));
    append(summary, el('h3', null, data.advisory.headline));
    var meta = data.opportunity ? (data.opportunity.title || 'Selected opportunity') : 'Selected opportunity';
    append(summary, el('p', 'nofo-meta', meta + ' · ' + data.requirements.total + ' requirements (' + data.requirements.needsReview + ' flagged for review, ' + data.requirements.verified + ' verified by a person), extraction ' + data.requirements.status));
    var arith = arithmeticLine(data);
    if (arith) summary.appendChild(arith);
    (data.warnings || []).forEach(function (w) { append(summary, el('p', 'nofo-warning', w)); });
    els.results.appendChild(summary);

    els.results.appendChild(factsPanel(data));

    // Key findings
    if (data.advisory.keyFindings.length > 0) {
      var key = el('section', 'card');
      append(key, el('h3', null, 'Findings to look at first'));
      var list = el('ul', 'nofo-findings');
      data.advisory.keyFindings.forEach(function (item) { list.appendChild(findingCard(item, findingsById)); });
      key.appendChild(list);
      els.results.appendChild(key);
    }

    // Questions
    if (data.questions.length > 0) {
      var qs = el('section', 'card');
      append(qs, el('h3', null, 'Questions that would sharpen this'));
      var ql = el('ol', 'nofo-questions');
      data.questions.forEach(function (q) {
        var li = el('li');
        append(li, el('strong', null, q.text));
        (q.because || []).slice(0, 2).forEach(function (b) {
          var why = el('p', 'nofo-meta', 'Why it matters: ' + b.title);
          if (b.source) why.appendChild(sourceButton(b.source, 'View source'));
          li.appendChild(why);
        });
        ql.appendChild(li);
      });
      qs.appendChild(ql);
      els.results.appendChild(qs);
    }

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
      var nofoActive = !els.panel.hidden;
      if (nofoActive) params.set('mode', 'nofo'); else params.delete('mode');
      if (nofoActive && state.opportunityId) params.set('opportunity', state.opportunityId); else params.delete('opportunity');
      var query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
    } catch (e) {
      /* the address bar is a convenience only */
    }
  }

  function setMode(mode) {
    var nofo = mode === 'nofo';
    els.panel.hidden = !nofo;
    els.searchPanel.hidden = nofo;
    els.tabNofo.setAttribute('aria-selected', nofo ? 'true' : 'false');
    els.tabSearch.setAttribute('aria-selected', nofo ? 'false' : 'true');
    els.tabNofo.classList.toggle('active', nofo);
    els.tabSearch.classList.toggle('active', !nofo);
    syncUrl();
    if (nofo && !state.loaded) {
      state.loaded = true;
      loadOpportunities();
    }
  }

  function init() {
    els.tabSearch = document.getElementById('modeSearchTab');
    els.tabNofo = document.getElementById('modeNofoTab');
    els.searchPanel = document.getElementById('searchPanel');
    els.panel = document.getElementById('nofoPanel');
    els.select = document.getElementById('nofoOpportunity');
    els.info = document.getElementById('nofoOpportunityInfo');
    els.loadError = document.getElementById('nofoLoadError');
    els.empty = document.getElementById('nofoEmpty');
    els.messages = document.getElementById('nofoMessages');
    els.form = document.getElementById('nofoForm');
    els.input = document.getElementById('nofoInput');
    els.send = document.getElementById('nofoSend');
    els.reset = document.getElementById('nofoReset');
    els.results = document.getElementById('nofoResults');
    if (!els.panel || !els.tabNofo || !U) return;

    els.tabSearch.addEventListener('click', function () { setMode('search'); });
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
    setMode(params.mode);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
