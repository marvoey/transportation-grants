/**
 * Scenario arithmetic for the Big Build impact slide (no DOM access, so it can be unit-tested).
 * Exposes window.BigBuildModel.
 *
 * Everything here is an ILLUSTRATIVE MODEL built from stated assumptions. Nothing measures usage or
 * achieved savings. Defaults match docs/GovRail_GrantFlow_Big_Build_ConOps.md:
 *   manual assessment 6-10 h (midpoint 8), assisted 2-3 h (midpoint 2.5), 300 applications, 50% adoption.
 * Rounding is for display only: the exact numbers are always computed first and are never changed.
 */
(function (root) {
  'use strict';

  var MANUAL_HOURS = { low: 6, high: 10 };
  var ASSISTED_HOURS = { low: 2, high: 3 };

  var DEFAULTS = {
    applications: 300,
    adoptionPct: 50,
    hoursSavedPerAssessment: 5.5
  };

  var LIMITS = {
    applications: { min: 1, max: 5000, integer: true },
    adoptionPct: { min: 0, max: 100, integer: false },
    hoursSavedPerAssessment: { min: 0, max: 40, integer: false }
  };

  function midpoint(range) { return (range.low + range.high) / 2; }

  /** Number in [min, max]; anything that is not a finite number falls back to the default. */
  function clamp(value, key) {
    var lim = LIMITS[key];
    var n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isFinite(n)) return DEFAULTS[key];
    if (lim.integer) n = Math.round(n);
    return Math.min(lim.max, Math.max(lim.min, n));
  }

  /** Per-assessment effort reduction at the midpoints: (8 - 2.5) / 8 = 68.75%. */
  function perAssessment() {
    var manual = midpoint(MANUAL_HOURS);
    var assisted = midpoint(ASSISTED_HOURS);
    return {
      manualHours: manual,
      assistedHours: assisted,
      hoursSaved: manual - assisted,
      percentReduction: ((manual - assisted) / manual) * 100
    };
  }

  /** One funding round: applications x adoption share x hours saved per assisted assessment. */
  function scenario(input) {
    var src = input || {};
    var applications = clamp(src.applications === undefined ? DEFAULTS.applications : src.applications, 'applications');
    var adoptionPct = clamp(src.adoptionPct === undefined ? DEFAULTS.adoptionPct : src.adoptionPct, 'adoptionPct');
    var hours = clamp(src.hoursSavedPerAssessment === undefined ? DEFAULTS.hoursSavedPerAssessment : src.hoursSavedPerAssessment, 'hoursSavedPerAssessment');
    var assisted = (applications * adoptionPct) / 100;
    return {
      applications: applications,
      adoptionPct: adoptionPct,
      hoursSavedPerAssessment: hours,
      assistedAssessments: assisted,
      hoursPotentiallyFreed: assisted * hours
    };
  }

  /** The hypothetical federal-side scenario from the ConOps. An assumption chain, not an observed outcome. */
  function federalHypothesis(input) {
    var src = input || {};
    var assisted = src.assistedApplicants === undefined ? 150 : src.assistedApplicants;
    var incidence = src.exchangeIncidence === undefined ? 0.4 : src.exchangeIncidence;
    var avoided = src.avoidedShare === undefined ? 0.25 : src.avoidedShare;
    var hoursEach = src.hoursPerExchange === undefined ? 1 : src.hoursPerExchange;
    var exchanges = assisted * incidence * avoided;
    return { exchangesAvoided: exchanges, hours: exchanges * hoursEach };
  }

  /** Round to the nearest `step`, for headline numerals such as "~800". The exact value stays available. */
  function roundTo(value, step) { return Math.round(value / step) * step; }

  /** Hours headline: nearest 100 from 200 up, nearest 10 from 50, otherwise a whole number. 825 -> 800. */
  function approxHours(hours) {
    if (hours >= 200) return roundTo(hours, 100);
    if (hours >= 50) return roundTo(hours, 10);
    return Math.round(hours);
  }

  /** Percent headline: nearest 5. 68.75 -> 70. */
  function approxPercent(pct) { return roundTo(pct, 5); }

  var api = {
    MANUAL_HOURS: MANUAL_HOURS,
    ASSISTED_HOURS: ASSISTED_HOURS,
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    clamp: clamp,
    perAssessment: perAssessment,
    scenario: scenario,
    federalHypothesis: federalHypothesis,
    approxHours: approxHours,
    approxPercent: approxPercent
  };

  root.BigBuildModel = api;
})(typeof window !== 'undefined' ? window : this);
