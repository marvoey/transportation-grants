/**
 * Brings a freshly rendered reply in as if it were being typed, so the page grows smoothly instead of jumping. Needs
 * typing-util.js (the same uneven, human pacing as the Copy buttons). Exposes window.Reveal.
 *
 *   Reveal.play([{ roots: [element, ...], maxMs: 1500 }, { roots: [element], maxMs: 1500 }])
 *
 * Call it right after the elements are built and added to the page, in the same turn of the event loop, so nothing is
 * painted before it has taken over. The segments play one after the other, so the whole thing takes at most the sum of
 * their `maxMs` (the pages use 1.5 s for the conversation message and 1.5 s for the panel under it: 3 seconds at most,
 * whatever the length of the text). Within a segment the text is typed at a human pace, squeezed to fit `maxMs`.
 *
 * How: the text of each root is read once (text nodes, in document order), emptied, and put back a few characters at a time,
 * so the element grows as the text arrives. Buttons, summaries and selects are hidden until the typing reaches them, then
 * shown whole. Nothing here builds markup: text goes back with nodeValue, so it stays plain text. Text that is not on screen
 * (hidden elements, collapsed <details>, <pre> blocks such as raw JSON) is left alone and costs no time.
 *
 * Safe by design: reduced motion or a missing typing-util.js means no reveal at all; starting a new reveal completes the one
 * still running first; roots that were removed from the page (Start over, a new search) end it quietly; and the
 * conversation's live region is marked busy while it plays so a screen reader reads the finished text, not each character.
 */
(function (root) {
  'use strict';

  var TICK_MS = 16;
  var SKIP = 'pre, script, style, textarea, noscript';
  var INTERACTIVE = 'button, summary, select, [role="button"]';
  var active = null;

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** The things to reveal under `node`, in order: { text, full, start } for typed text, { el, start } for hidden-then-shown. */
  function collect(node, units, counter) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (/\S/.test(c.nodeValue)) {
          units.push({ text: c, full: c.nodeValue, start: counter.n });
          counter.n += c.nodeValue.length;
        }
        continue;
      }
      if (c.nodeType !== 1) continue;
      if (c.hidden || c.matches(SKIP) || c.getClientRects().length === 0) continue; // not on screen: leave it as it is
      if (c.matches(INTERACTIVE)) {
        units.push({ el: c, start: counter.n });
        continue;
      }
      if (c.tagName === 'DETAILS' && !c.open) {
        var summary = c.querySelector(':scope > summary');
        if (summary) {
          units.push({ el: c, container: true, start: counter.n });
          units.push({ el: summary, start: counter.n });
        }
        continue;
      }
      // A block (a card, a list, a list item...) that holds anything to reveal stays hidden until the typing reaches its first
      // piece, so its frame, padding and bullets arrive together with its text and the panel grows without a jump.
      var before = units.length;
      var at = units.length;
      collect(c, units, counter);
      if (units.length > before) units.splice(at, 0, { el: c, container: true, first: null, start: units[at].start });
    }
  }

  function prepareSegment(segment) {
    var units = [];
    var counter = { n: 0 };
    var roots = (segment.roots || []).filter(function (r) { return r && r.nodeType === 1 && root.document.body.contains(r); });
    roots.forEach(function (r) { collect(r, units, counter); });
    if (counter.n === 0) return null;
    var joined = units.map(function (u) { return u.full || ''; }).join('');
    var delays = root.TypingUtil.schedule(joined, null, segment.maxMs);
    var due = [];
    var running = 0;
    for (var i = 0; i < delays.length; i++) {
      running += delays[i];
      due.push(running);
    }
    return { roots: roots, units: units, total: counter.n, due: due, duration: running, shown: 0, next: 0 };
  }

  function hideAndEmpty(segment) {
    segment.units.forEach(function (u) {
      if (u.text) u.text.nodeValue = '';
      else {
        u.saved = u.el.style.display;
        u.el.style.display = 'none';
      }
    });
  }

  /** The first unit that is not itself a block, at or after `i`: what a block waits for. */
  function firstLeaf(units, i) {
    while (units[i].container) i++;
    return units[i];
  }

  /** True once the typing has got to this unit: its first character for text, its position for anything else. */
  function reached(u, shown) {
    return u.text ? shown > u.start : shown >= u.start;
  }

  /** Writes what is due: every unit before the cursor whole, the one under it partly. */
  function paint(segment, shown) {
    var units = segment.units;
    while (segment.next < units.length) {
      var u = units[segment.next];
      if (u.text) {
        var end = u.start + u.full.length;
        if (shown >= end) {
          u.text.nodeValue = u.full;
          segment.next++;
          continue;
        }
        if (shown > u.start) u.text.nodeValue = u.full.slice(0, shown - u.start);
        return;
      }
      if (reached(u.container ? firstLeaf(segment.units, segment.next + 1) : u, shown)) {
        u.el.style.display = u.saved;
        segment.next++;
        continue;
      }
      return;
    }
  }

  function setBusy(segments, busy) {
    segments.forEach(function (segment) {
      segment.roots.forEach(function (r) {
        var live = r.closest('[aria-live]');
        if (!live) return;
        if (busy) live.setAttribute('aria-busy', 'true');
        else live.setAttribute('aria-busy', 'false');
      });
    });
  }

  function play(list) {
    if (active) active.finish();
    if (!root.TypingUtil || reducedMotion() || !Array.isArray(list)) return;
    // Read everything first (one layout), then change anything.
    var segments = list.map(prepareSegment).filter(Boolean);
    if (segments.length === 0) return;
    segments.forEach(hideAndEmpty);
    segments.forEach(function (segment) { paint(segment, 0); });
    setBusy(segments, true);

    var job = { timer: null, index: 0, startedAt: Date.now() };
    function finish() {
      clearTimeout(job.timer);
      segments.forEach(function (segment) { paint(segment, segment.total + 1); });
      setBusy(segments, false);
      if (active === job) active = null;
    }
    job.finish = finish;
    active = job;

    (function tick() {
      var segment = segments[job.index];
      // The roots were removed from the page (Start over, a new search): nothing left to show.
      if (!segment.roots.some(function (r) { return root.document.body.contains(r); })) {
        finish();
        return;
      }
      var elapsed = Date.now() - job.startedAt;
      var n = segment.shown;
      while (n < segment.total && segment.due[n] <= elapsed) n++;
      if (n !== segment.shown) {
        segment.shown = n;
        paint(segment, n);
      }
      if (segment.shown >= segment.total) {
        // Next segment starts now (not at its own clock), so the total stays within the sum of the budgets.
        job.index++;
        job.startedAt = Date.now();
        if (job.index >= segments.length) {
          finish();
          return;
        }
      }
      job.timer = setTimeout(tick, TICK_MS);
    })();
  }

  root.Reveal = {
    play: play,
    MESSAGE_MS: 1500, // the conversation message
    PANEL_MS: 1500    // the panel under it; together 3 seconds at most
  };
})(typeof window !== 'undefined' ? window : globalThis);
