/**
 * The small play icon that says demo mode is on, at the bottom-right of the page, next to the tray toggle (tray-toggle.js).
 * It replaces the badge at the top of the page. Hovering it, or a screen reader, gives the text: a replayed answer is never
 * presented as live. Built with elements only. Exposes window.DemoIndicator.show(label).
 */
(function () {
  'use strict';

  var shown = false;

  function show(label) {
    if (shown || !document.body) return;
    shown = true;
    var icon = document.createElement('div');
    icon.className = 'demo-play';
    icon.setAttribute('role', 'status');
    icon.setAttribute('aria-label', label);
    icon.title = label;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    var triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    triangle.setAttribute('d', 'M8 5v14l11-7z');
    triangle.setAttribute('fill', 'currentColor');
    svg.appendChild(triangle);
    icon.appendChild(svg);
    document.body.appendChild(icon);
  }

  window.DemoIndicator = {
    show: function (label) {
      if (document.body) show(label);
      else document.addEventListener('DOMContentLoaded', function () { show(label); });
    }
  };
})();
