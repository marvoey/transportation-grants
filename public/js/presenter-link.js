/**
 * The app page's side of the presenter window (/demo-script.html, opened from the floating menu). The window has Samples and
 * Answers tabs, like the trays on this page. The samples are fixed text, but the answers depend on what the app last asked,
 * so this file keeps the latest questions of each tab ("assessresult" from Assess, "findquestions" from Find grants, the same
 * events the Answers tray listens to), plus which tab is open, and sends them to the presenter window over a same-origin
 * BroadcastChannel whenever they change, and when that window says hello. Nothing leaves the browser.
 * Must load after the page's own scripts are ready to dispatch those events (it only listens).
 */
(function () {
  'use strict';

  if (typeof BroadcastChannel !== 'function') return;
  var channel;
  try { channel = new BroadcastChannel('grantflow-presenter'); } catch (e) { return; }

  var state = { mode: document.body && document.body.dataset.chatMode ? document.body.dataset.chatMode : 'find', latest: { find: null, nofo: null } };

  function send() {
    try {
      // A JSON round trip keeps only plain data, so a stray function or element can never break the message.
      channel.postMessage({ type: 'state', state: JSON.parse(JSON.stringify(state)) });
    } catch (e) {
      /* the presenter window is optional: ignore a failed send */
    }
  }

  document.addEventListener('assessresult', function (event) { state.latest.nofo = event.detail || null; send(); });
  document.addEventListener('findquestions', function (event) { state.latest.find = event.detail || null; send(); });
  document.addEventListener('chatmodechange', function (event) {
    if (event.detail && event.detail.mode) { state.mode = event.detail.mode; send(); }
  });
  channel.onmessage = function (event) {
    if (event.data && event.data.type === 'hello') {
      if (document.body && document.body.dataset.chatMode) state.mode = document.body.dataset.chatMode;
      send();
    }
  };
})();
