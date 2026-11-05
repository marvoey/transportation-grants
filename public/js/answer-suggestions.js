/**
 * Made-up example answers to the assessment's follow-up questions (the "To sharpen this, tell me:" list), for testing.
 * Pure helpers, no DOM access. Exposes window.AnswerSuggestions.
 *
 * The questions themselves are fixed templates written by the server, one per group of missing facts (request,
 * costMatch, area, category, bca, applicant, design, environmental, description). The answers are written here the
 * same way: by code, from the question's group and the facts already known, never by a model. They are what an
 * applicant COULD type; they are not facts about anyone's project.
 *
 * Amounts stay consistent with each other and with what was already said: total cost = federal request + match.
 */
(function (root) {
  'use strict';

  var MILLION = 1e6;

  function roundToMillion(n) {
    return Math.max(MILLION, Math.round(n / MILLION) * MILLION);
  }

  /** "$25 million", "$1.5 million", "$450,000". */
  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n >= MILLION) return '$' + +(n / MILLION).toFixed(1) + ' million';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function value(facts, key) {
    var f = facts && facts[key];
    return f && f.value !== undefined && f.value !== null ? f.value : undefined;
  }

  /**
   * The three amounts, built from what is already known so the answers never contradict the conversation:
   * total cost, federal request and non-federal match, with total = request + match.
   */
  function amounts(facts) {
    var total = value(facts, 'totalProjectCostUsd');
    var request = value(facts, 'requestedFederalUsd');
    var match = value(facts, 'nonFederalMatchUsd');
    var num = function (n) { return typeof n === 'number' && n > 0; };
    if (!num(total)) total = undefined;
    if (!num(request)) request = undefined;
    if (!num(match)) match = undefined;

    if (total !== undefined && request !== undefined) {
      if (match === undefined || Math.abs(total - request - match) > 1) match = total > request ? total - request : roundToMillion(request * 0.25);
      if (total <= request) total = request + match;
    } else if (total !== undefined && match !== undefined) {
      request = total > match ? total - match : roundToMillion(total * 0.6);
      if (total <= match) total = request + match;
    } else if (request !== undefined && match !== undefined) {
      total = request + match;
    } else if (total !== undefined) {
      request = roundToMillion(total * 0.6);
      if (request >= total) request = total / 2;
      match = total - request;
    } else if (request !== undefined) {
      total = roundToMillion(request / 0.6);
      if (total <= request) total = request * 2;
      match = total - request;
    } else if (match !== undefined) {
      total = roundToMillion(match / 0.4);
      if (total <= match) total = match * 2;
      request = total - match;
    } else {
      total = 40 * MILLION;
      request = 25 * MILLION;
      match = 15 * MILLION;
    }
    return { total: total, request: request, match: match };
  }

  var WHO = {
    state: 'We are a state department of transportation.',
    city: 'We are a city.',
    county: 'We are a county.',
    tribal: 'We are a tribal government.',
    mpo: 'We are a metropolitan planning organization.',
    transit_agency: 'We are a transit agency.',
    other: 'We are a public agency.'
  };

  var STAGES = [
    { key: 'advanced', label: 'Well advanced' },
    { key: 'early', label: 'Early stage' }
  ];

  /** The answer for one question group, for each stage. A group that does not depend on the stage gives the same text. */
  function answersFor(group, facts) {
    var a = amounts(facts);
    var committed = value(facts, 'matchCommitted');
    var area = value(facts, 'areaType');
    var category = value(facts, 'grantCategory');
    var who = value(facts, 'applicantType');
    var both = function (text) { return { advanced: text, early: text }; };

    switch (group) {
      case 'request':
        return both('We would request ' + money(a.request) + ' in federal funds.');
      case 'costMatch': {
        var base = 'The total project cost is ' + money(a.total) + '. We would request ' + money(a.request) + ' in federal funds, and the remaining ' + money(a.match) + ' is non-federal match from state and local funds.';
        var yes = base + ' That match is committed in our adopted budget.';
        var no = base + ' That match is not committed yet; it is only anticipated in our capital plan.';
        if (committed === true) return both(yes);
        if (committed === false) return both(no);
        return { advanced: yes, early: no };
      }
      case 'area':
        return both('The project is in ' + (area === 'rural' ? 'a rural' : 'an urban') + ' area.');
      case 'category':
        return both(category === 'planning'
          ? 'This is a planning application: we are paying for studies and design, not construction.'
          : 'This is a capital application: we plan to construct the project.');
      case 'bca':
        return {
          advanced: 'A benefit-cost analysis has been completed for the project.',
          early: 'We have not completed a benefit-cost analysis yet; we plan to do one once design is further along.'
        };
      case 'applicant':
        return both(WHO[who] || WHO.state);
      case 'design':
        return {
          advanced: 'Design is complete: the project is at 100 percent design.',
          early: 'Design is at an early stage: the project is at about 30 percent design.'
        };
      case 'environmental':
        return {
          advanced: 'The environmental review is complete; we received a categorical exclusion.',
          early: 'The environmental review has not started; we expect a categorical exclusion.'
        };
      case 'description':
        return both('The project reconstructs the existing facility, including new pavement, drainage, sidewalks and lighting.');
      default:
        return null;
    }
  }

  /**
   * Suggestions for the questions the assessment just asked.
   * Returns { items, replies }: `items` has one entry per question (the question text and its variants), and `replies`
   * has a complete, paste-ready answer to all of them for each stage. Questions of a group this code does not know are
   * left out rather than guessed at.
   */
  function build(questions, facts) {
    var items = [];
    (Array.isArray(questions) ? questions : []).forEach(function (q) {
      if (!q || typeof q.group !== 'string') return;
      var answers = answersFor(q.group, facts || {});
      if (!answers) return;
      var variants = answers.advanced === answers.early
        ? [{ stage: 'either', label: 'Works for any stage', text: answers.advanced }]
        : STAGES.map(function (s) { return { stage: s.key, label: s.label, text: answers[s.key] }; });
      items.push({ group: q.group, question: String(q.text || ''), variants: variants, answers: answers });
    });

    var replies = STAGES.map(function (s) {
      return {
        stage: s.key,
        label: s.key === 'advanced' ? 'Complete reply: project well advanced' : 'Complete reply: project at an early stage',
        text: items.map(function (item) { return item.answers[s.key]; }).join(' ')
      };
    });
    if (items.length === 0) replies = [];
    return { items: items, replies: replies };
  }

  root.AnswerSuggestions = { build: build, amounts: amounts, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
