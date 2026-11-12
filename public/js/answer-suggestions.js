/**
 * Made-up example answers to the follow-up questions (the "To sharpen this, tell me:" list) on the Assess tab and the
 * guided questions on the Find grants tab, for testing.
 * Pure helpers, no DOM access. Exposes window.AnswerSuggestions.
 *
 * The questions themselves are fixed templates written by the server, one per group of missing facts (Assess: request,
 * listed, costMatch, area, category, bca, applicant, design, environmental, description; Find grants: projectType, applicant,
 * phase, request). The answers are written here the
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

  /**
   * Detail questions (made from the notice's own requirements) come in four kinds, and each suggestion names the question it
   * answers, so several can be pasted into one message and still be read one by one. Yes/no: yes, no, not sure. Choice: one
   * suggestion per option. Number: a figure that meets the limit and one that does not. Describe: a short description and a
   * "still planning" one. "Meets" is the well-advanced stage and "does not" the early one, for the complete replies.
   */
  function detailAnswers(question) {
    var q = question && typeof question === 'object' ? question : { text: question };
    var spec = q.spec || null;
    var asked = String(q.text || 'this question').replace(/\s+/g, ' ').replace(/"/g, "'").replace(/\?+\s*$/, '').trim();
    var sentence = function (tail) { return 'For "' + asked + '": ' + tail; };
    var notSure = { stage: 'unsure', label: 'Not sure yet', text: sentence('we are not sure yet.') };

    if (spec && spec.type === 'choice' && spec.options && spec.options.length) {
      var variants = spec.options.map(function (o, i) { return { stage: 'option-' + i, label: o.label, text: sentence(o.label + '.') }; });
      var good = 0; // the first option that meets the requirement
      var bad = spec.options.length - 1; // the first that does not (or the last one)
      for (var g = 0; g < spec.options.length; g++) if (spec.options[g].outcome === 'meets') { good = g; break; }
      for (var j = 0; j < spec.options.length; j++) if (spec.options[j].outcome === 'does_not_meet') { bad = j; break; }
      return { advanced: variants[good].text, early: variants[bad].text, detail: true, variants: variants.concat([notSure]) };
    }
    if (spec && spec.type === 'number' && spec.comparison) {
      var c = spec.comparison;
      var unit = c.unit ? ' ' + c.unit : '';
      var within = c.value;
      var outside = c.op === 'at_least' ? Math.max(0, c.value - 1) : c.value + 1;
      var meets = { stage: 'meets', label: 'A number that meets it (' + within + ')', text: sentence(within + unit + '.') };
      var misses = { stage: 'fails', label: 'A number that does not (' + outside + ')', text: sentence(outside + unit + '.') };
      return { advanced: meets.text, early: misses.text, detail: true, variants: [meets, misses, notSure] };
    }
    if (spec && spec.type === 'describe') {
      var described = { stage: 'text', label: 'A short description', text: sentence('we have this in place and will describe it in our application.') };
      var planning = { stage: 'planning', label: 'Still being planned', text: sentence('we are still planning this and have not settled the details yet.') };
      return { advanced: described.text, early: planning.text, detail: true, variants: [described, planning, notSure] };
    }
    var yes = sentence('yes, we do.');
    var no = sentence('no, not yet.');
    return {
      advanced: yes,
      early: no,
      detail: true,
      variants: [
        { stage: 'yes', label: 'Yes, we meet this', text: yes },
        { stage: 'no', label: 'No, not yet', text: no },
        notSure
      ]
    };
  }

  /** The answer for one question group, for each stage. A group that does not depend on the stage gives the same text. */
  function answersFor(group, facts, question) {
    var a = amounts(facts);
    var committed = value(facts, 'matchCommitted');
    var area = value(facts, 'areaType');
    var category = value(facts, 'grantCategory');
    var who = value(facts, 'applicantType');
    var both = function (text) { return { advanced: text, early: text }; };

    if (typeof group === 'string' && group.indexOf('detail:') === 0) return detailAnswers(question);

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
      case 'listed':
        return both('Yes, we are one of the organizations the notice names.');
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
      case 'projectType':
        return both('This is a bridge replacement project: we want to replace a structurally deficient bridge.');
      case 'phase':
        return {
          advanced: 'The project is construction-ready: design and environmental review are complete.',
          early: 'The project is at the planning stage: we have not started design yet.'
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
      var answers = answersFor(q.group, facts || {}, q);
      if (!answers) return;
      var variants = answers.variants
        ? answers.variants
        : answers.advanced === answers.early
          ? [{ stage: 'either', label: 'Works for any stage', text: answers.advanced }]
          : STAGES.map(function (s) { return { stage: s.key, label: s.label, text: answers[s.key] }; });
      items.push({ group: q.group, question: String(q.text || ''), variants: variants, answers: answers, detail: !!answers.detail, category: q.category || '' });
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

  /** The most characters one pasted reply may hold (the question box takes 4,000; this leaves room for what is already in it). */
  var MAX_REPLY_CHARS = 3800;
  var OPEN_KINDS = [
    { stage: 'yes', label: 'yes to all' },
    { stage: 'no', label: 'no, not yet, to all' },
    { stage: 'unsure', label: 'not sure about all' }
  ];

  /**
   * Complete replies for a list of detail questions (every other open requirement): one reply per choice, holding one
   * sentence per requirement, in order, as many as fit in one message. Returns { total, items, replies }, where `items` are
   * the detail suggestions the replies are made from and each reply says how many of them it holds.
   */
  function buildOpen(questions, facts) {
    var items = build(questions, facts).items.filter(function (item) { return item.detail; });
    var replies = [];
    OPEN_KINDS.forEach(function (kind) {
      var parts = [];
      var length = 0;
      for (var i = 0; i < items.length; i++) {
        var variant = items[i].variants.filter(function (v) { return v.stage === kind.stage; })[0];
        if (!variant) continue;
        var add = variant.text.length + (parts.length ? 1 : 0);
        if (length + add > MAX_REPLY_CHARS) break;
        parts.push(variant.text);
        length += add;
      }
      if (parts.length === 0) return;
      var count = parts.length === items.length ? String(parts.length) : 'the first ' + parts.length + ' of ' + items.length;
      replies.push({ stage: kind.stage, label: 'Complete reply: ' + kind.label + ' (' + count + ')', text: parts.join(' '), included: parts.length });
    });
    return { total: items.length, items: items, replies: replies };
  }

  root.AnswerSuggestions = { build: build, buildOpen: buildOpen, amounts: amounts, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
