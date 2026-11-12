/**
 * The numbers on the home page: how much funding a person would otherwise screen by hand. Fetches /api/nofo/stats and
 * fills #homeStats. Every figure is a count Simpler.Grants.gov reports; nothing here estimates time or effort. If the
 * numbers cannot be loaded the section simply stays hidden. Every string is rendered with textContent.
 * Exposes window.HomeStats (tiles, formatInt, describeSource) so the wording can be tested without a page.
 */
(function (root) {
  'use strict';

  function formatInt(n) {
    return Number(n).toLocaleString('en-US');
  }

  /** The five tiles, in order, from the stats object the server returns. */
  function tiles(stats) {
    var localPercent = stats.openOrForecasted > 0 ? Math.round((stats.openToLocalGovernments / stats.openOrForecasted) * 100) : 0;
    var others = Math.max(0, stats.openOrForecasted - stats.dot);
    return [
      {
        key: 'open',
        value: stats.openOrForecasted,
        label: 'open or forecasted opportunities',
        note: formatInt(stats.open) + ' open for applications · ' + formatInt(stats.forecasted) + ' forecasted'
      },
      {
        key: 'agencies',
        value: stats.topLevelAgencies,
        label: 'federal agencies publishing them',
        note: formatInt(stats.agencyOffices) + ' agency offices in all'
      },
      {
        key: 'local',
        value: stats.openToLocalGovernments,
        label: 'list state, county or city governments as eligible applicants',
        note: localPercent >= 50
          ? localPercent + '% of the total: filtering by applicant type alone still leaves most of the list'
          : localPercent + '% of the open and forecasted opportunities'
      },
      {
        key: 'dot',
        value: stats.dot,
        label: 'come from the U.S. Department of Transportation',
        note: 'The other ' + formatInt(others) + ' are published by other agencies'
      },
      {
        key: 'ever',
        value: stats.everPublished,
        label: 'opportunities published on Simpler.Grants.gov in all',
        note: formatInt(stats.closedOrArchived) + ' are closed or archived: past rounds that show what earlier notices required'
      }
    ];
  }

  /** The line under the numbers: where they come from and when. A saved count says so. */
  function describeSource(view) {
    var when = new Date(view.stats.asOf);
    var text = isNaN(when.getTime()) ? '' : when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    if (view.source === 'snapshot') return 'Saved count from ' + text + '; refreshed from Simpler.Grants.gov when reachable.';
    return 'Counts reported by Simpler.Grants.gov as of ' + text + '.';
  }

  root.HomeStats = { tiles: tiles, formatInt: formatInt, describeSource: describeSource };

  if (typeof document === 'undefined') return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Counts the number up once, unless the person prefers less motion. The final text is always the exact figure. */
  function countUp(node, target) {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !window.requestAnimationFrame || target < 20) {
      node.textContent = formatInt(target);
      return;
    }
    var duration = 900;
    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = formatInt(Math.round(target * eased));
      if (t < 1) window.requestAnimationFrame(frame);
      else node.textContent = formatInt(target);
    }
    node.textContent = '0';
    window.requestAnimationFrame(frame);
  }

  function render(view) {
    var section = document.getElementById('homeStats');
    var grid = document.getElementById('homeStatGrid');
    var source = document.getElementById('homeStatSource');
    if (!section || !grid || !source) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    tiles(view.stats).forEach(function (tile) {
      var li = el('li', 'home-stat home-stat--' + tile.key);
      var num = el('span', 'home-stat-num', formatInt(tile.value));
      li.appendChild(num);
      li.appendChild(el('span', 'home-stat-label', tile.label));
      li.appendChild(el('span', 'home-stat-note', tile.note));
      grid.appendChild(li);
      countUp(num, tile.value);
    });
    source.textContent = describeSource(view);
    section.hidden = false;
  }

  fetch('/api/nofo/stats', { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (body) {
      var view = body && body.success && body.data;
      if (view && view.stats && typeof view.stats.openOrForecasted === 'number') render(view);
    })
    .catch(function () { /* no numbers: the section stays hidden */ });
})(typeof window !== 'undefined' ? window : globalThis);
