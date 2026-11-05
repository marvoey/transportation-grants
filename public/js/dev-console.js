/**
 * A developer-console style log for the Find grants screen: it shows, line by line, how the Simpler.Grants.gov search is
 * being built from the project profile, the request that is sent, and what came back. Exposes window.DevConsole.
 *
 *   var c = DevConsole.create({ root, log, copy, clear });
 *   c.begin('Turn 1');           // a separator, and the live cursor
 *   c.push({ kind, text });      // for each line the server streams
 *   c.end();                     // result arrived: show everything now, stop the cursor
 *
 * The server writes every line from the search plan and a summary of the response. The API key is never sent to the
 * page. Every string is rendered with textContent. Lines appear with a short stagger so the build can be followed; the
 * stagger only affects the console and never holds back the results.
 */
(function () {
  'use strict';

  var KINDS = { cmd: 1, note: 1, add: 1, http: 1, json: 1, ok: 1, warn: 1, error: 1 };
  var MAX_LINES = 1200; // the oldest lines are dropped beyond this, so a long session cannot grow without limit
  var BASE_DELAY_MS = 45;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function create(parts) {
    var texts = []; // what was printed, for Copy
    var queue = [];
    var timer = null;
    var cursor = null;
    var turns = 0;

    function nearBottom() {
      return parts.log.scrollHeight - parts.log.scrollTop - parts.log.clientHeight < 48;
    }

    function removeCursor() {
      if (cursor && cursor.parentNode) cursor.parentNode.removeChild(cursor);
    }

    function print(line) {
      var stick = nearBottom();
      var kind = KINDS[line.kind] ? line.kind : 'note';
      var node = el('div', 'dc-line dc-' + kind, line.text);
      removeCursor();
      parts.log.appendChild(node);
      if (cursor) parts.log.appendChild(cursor);
      texts.push(line.text);
      while (parts.log.childElementCount > MAX_LINES + (cursor ? 1 : 0)) {
        var first = parts.log.firstElementChild;
        if (first === cursor) break;
        parts.log.removeChild(first);
        texts.shift();
      }
      if (stick) parts.log.scrollTop = parts.log.scrollHeight;
    }

    function pump() {
      timer = null;
      var line = queue.shift();
      if (!line) return;
      print(line);
      if (queue.length === 0) return;
      // The longer the backlog, the faster it drains, so the console never falls far behind the real work.
      var delay = Math.max(6, (line.kind === 'json' ? BASE_DELAY_MS * 2 : BASE_DELAY_MS) - queue.length * 3);
      timer = setTimeout(pump, delay);
    }

    function show() {
      parts.root.hidden = false;
    }

    function push(line) {
      if (!line || typeof line.text !== 'string') return;
      show();
      if (prefersReducedMotion()) {
        print(line);
        return;
      }
      queue.push(line);
      if (timer === null) timer = setTimeout(pump, 0);
    }

    /** Prints everything still waiting, at once. */
    function flush() {
      clearTimeout(timer);
      timer = null;
      var rest = queue;
      queue = [];
      rest.forEach(print);
    }

    /** A new turn starts: a separator, and a blinking cursor while the server works. */
    function begin(label) {
      show();
      turns += 1;
      push({ kind: 'cmd', text: (turns > 1 ? '\n' : '') + '── ' + label + ' ──' });
      if (!cursor) {
        cursor = el('div', 'dc-cursor');
        cursor.setAttribute('aria-hidden', 'true');
        cursor.textContent = '▍';
      }
      parts.log.appendChild(cursor);
    }

    function end() {
      flush();
      removeCursor();
      cursor = null;
    }

    function clear() {
      flush();
      removeCursor();
      cursor = null;
      texts = [];
      turns = 0;
      while (parts.log.firstChild) parts.log.removeChild(parts.log.firstChild);
    }

    function copyAll() {
      var original = parts.copy.textContent;
      function flash(text) {
        parts.copy.textContent = text;
        setTimeout(function () { parts.copy.textContent = original; }, 1500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texts.join('\n')).then(function () { flash('Copied'); }, function () { flash('Copy failed'); });
      } else {
        flash('Copy not available');
      }
    }

    if (parts.copy) parts.copy.addEventListener('click', copyAll);
    if (parts.clear) parts.clear.addEventListener('click', clear);

    return { begin: begin, push: push, flush: flush, end: end, clear: clear };
  }

  window.DevConsole = { create: create };
})();
