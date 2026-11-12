/**
 * Pacing for "typed in" text: the Copy buttons in the Samples and Answers trays put their text into the question box as if
 * a person were typing it (drawer-kit.js). This file only decides WHEN each character appears. Exposes window.TypingUtil.
 *
 *   TypingUtil.schedule(text, random)  -> number[]   one delay in ms before each character, same length as `text`
 *
 * The delays add up to at most MAX_TOTAL_MS (1.5 seconds), whatever the length of the text. A long text therefore has delays
 * of only a millisecond or so per character, far below what a timer can fire at, so the player (drawer-kit.js) works from
 * the running total and shows every character that is due at each tick, rather than waiting one timer per character.
 *
 * `random` is a function returning [0, 1) (Math.random by default; tests pass a seeded one).
 *
 * It is meant to look human, not metronomic:
 *  - each character takes a different time, around 25 to 55 ms, and the typist's rhythm drifts: a run of faster characters,
 *    then a slower run, never one steady speed;
 *  - capitals, digits and symbols are a little slower;
 *  - there are small pauses between some words, longer ones after a comma, longer still after the end of a sentence or a
 *    line break, and now and then a short hesitation, as if choosing the next word;
 *  - a text that would take longer than MAX_TOTAL_MS at that pace is sped up as a whole, keeping its shape (the same uneven
 *    rhythm and pauses, only faster); a very short one keeps its natural pace.
 * The text itself is never changed: no typos, no corrections.
 */
(function (root) {
  'use strict';

  var START_MS = [150, 350];       // a beat before the first character
  var BASE_MS = [24, 54];          // time for an ordinary character, before rhythm and pauses
  var RHYTHM = [0.7, 1.45];        // the drifting speed factor
  var RHYTHM_RUN = [6, 22];        // characters before the rhythm changes
  var WORD_PAUSE = { chance: 0.12, ms: [50, 170] };
  var COMMA_PAUSE = [110, 260];
  var SENTENCE_PAUSE = [260, 620];
  var LINE_PAUSE = [320, 720];
  var HESITATE = { chance: 0.012, ms: [380, 900] };
  var HARD_KEY_MS = 14;            // extra for a capital, digit or symbol
  var MAX_TOTAL_MS = 1500;

  function between(random, range) {
    return range[0] + random() * (range[1] - range[0]);
  }

  function schedule(text, random) {
    var rand = typeof random === 'function' ? random : Math.random;
    var s = String(text);
    var delays = [];
    var rhythm = between(rand, RHYTHM);
    var runLeft = Math.round(between(rand, RHYTHM_RUN));
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (runLeft-- <= 0) {
        rhythm = between(rand, RHYTHM);
        runLeft = Math.round(between(rand, RHYTHM_RUN));
      }
      var ms = i === 0 ? between(rand, START_MS) : between(rand, BASE_MS) * rhythm;
      if (/[A-Z0-9$%&()"'“”]/.test(ch)) ms += HARD_KEY_MS * (0.5 + rand());
      if (ch === ' ') {
        if (rand() < WORD_PAUSE.chance) ms += between(rand, WORD_PAUSE.ms);
      } else if (ch === ',' || ch === ';' || ch === ':') {
        ms += between(rand, COMMA_PAUSE);
      } else if (ch === '.' || ch === '!' || ch === '?') {
        // Only a sentence end when a space or the end of the text follows (not the dot in "3.5" or "U.S.").
        var next = s.charAt(i + 1);
        if (next === '' || next === ' ' || next === '\n') ms += between(rand, SENTENCE_PAUSE);
      } else if (ch === '\n') {
        ms += between(rand, LINE_PAUSE);
      }
      if (i > 0 && rand() < HESITATE.chance) ms += between(rand, HESITATE.ms);
      delays.push(ms);
    }
    var total = delays.reduce(function (a, b) { return a + b; }, 0);
    if (total > MAX_TOTAL_MS) {
      var scale = MAX_TOTAL_MS / total;
      delays = delays.map(function (d) { return d * scale; });
    }
    // Hundredths of a millisecond: whole milliseconds would round a fast long text's 0.7 ms delays up and break the cap.
    return delays.map(function (d) { return Math.max(0.01, Math.round(d * 100) / 100); });
  }

  root.TypingUtil = { schedule: schedule, MAX_TOTAL_MS: MAX_TOTAL_MS };
})(typeof window !== 'undefined' ? window : globalThis);
