/**
 * Demo mode on the home page. The home page does not replay anything (its numbers come from the server), but when demo mode
 * is on, every link from it into the app opens in demo mode too, so a presenter can start here and follow any link.
 *
 *   /?demo=1   turns demo mode on (remembered in localStorage, the same setting demo-mode.js uses)   /?demo=0  turns it off
 *
 * While it is on, each link to a page of this site (the home page or an .html page) gets "demo=1" added, unless it already
 * names a demo setting (the floating menu's "demo mode off" link keeps its own). A small play icon says demo mode is on
 * (demo-indicator.js, load it first).
 * Load it AFTER floating-menu.js so the menu's links are in the page. Needs nothing else.
 */
(function () {
  'use strict';

  var KEY = 'grantflow.demoMode'; // the same key as demo-mode.js

  var match = /(?:^|[?&])demo=([^&]*)/.exec(window.location.search);
  var flag = match ? decodeURIComponent(match[1]) : null;
  var on = false;
  try {
    if (flag === '1') window.localStorage.setItem(KEY, 'on');
    else if (flag === '0') window.localStorage.setItem(KEY, 'off');
    on = window.localStorage.getItem(KEY) === 'on';
  } catch (e) {
    on = flag === '1'; // storage blocked: the URL flag still works for this page
  }
  if (flag === '0') on = false;
  if (!on) return;

  function tag(link) {
    var raw = link.getAttribute('href');
    if (!raw) return;
    var url;
    try { url = new URL(raw, window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return; // another site
    if (url.pathname !== '/' && !/\.html$/i.test(url.pathname)) return; // not a page of the app (for example /docs)
    if (url.searchParams.has('demo')) return; // it already says which way
    url.searchParams.set('demo', '1');
    link.setAttribute('href', url.pathname + url.search + url.hash);
  }

  function run() {
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), tag);
    if (window.DemoIndicator) window.DemoIndicator.show('Demo mode on: the links open the app with a recorded run, not live');
  }

  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
})();
