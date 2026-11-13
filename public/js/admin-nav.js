/**
 * Adds an "Admin login" link to the main navigation, or a "Log out" button once the server says you are logged in.
 * Exposes window.AdminNav for the pages that will show admin-only things later.
 *
 *   AdminNav.isAdmin()   -> true only after the server has confirmed an admin session (false until then)
 *   AdminNav.refresh()   -> asks the server again
 *   document event "adminchange" with { admin } fires when the answer changes
 *
 * This only decides what to SHOW. The cookie is HttpOnly, so this script cannot see it; it asks GET /api/admin/session.
 * What an admin may actually do is decided by the server (requireAdmin), never by this file.
 *
 * "Admin login" opens in a new tab, like the floating menu's links: on the Find grants and Assess pages the conversation
 * lives only in this tab, so following a link in place would lose it. When you come back to this tab after logging in,
 * the nav updates by itself. Everything is built with textContent; nothing comes from an HTML string.
 */
(function () {
  'use strict';

  var list = document.querySelector('nav[aria-label="Main"] ul');
  if (!list) return;

  var LOGIN_URL = '/admin-login.html';
  var RECHECK_AFTER_MS = 3000;

  var item = null;
  var admin = null; // null until the server has answered once
  var lastCheck = 0;

  function render(isAdmin) {
    var changed = admin !== null && admin !== isAdmin;
    admin = isAdmin;

    var li = document.createElement('li');
    li.className = 'nav-admin';
    if (isAdmin) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-admin-button';
      button.textContent = 'Log out';
      button.addEventListener('click', function () { logout(button); });
      li.appendChild(button);
    } else {
      var link = document.createElement('a');
      link.href = LOGIN_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Admin login';
      li.appendChild(link);
    }
    if (item && item.parentNode) item.parentNode.replaceChild(li, item);
    else list.appendChild(li);
    item = li;

    if (changed) document.dispatchEvent(new CustomEvent('adminchange', { detail: { admin: isAdmin } }));
  }

  async function check() {
    lastCheck = Date.now();
    try {
      var response = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store' });
      var payload = await response.json();
      render(!!(response.ok && payload && payload.success === true && payload.data && payload.data.admin === true));
    } catch (e) {
      // The server could not be asked: keep what is shown, or offer the login link if nothing is shown yet.
      if (admin === null) render(false);
    }
  }

  async function logout(button) {
    button.disabled = true;
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) { /* the check below shows what is true */ }
    await check();
  }

  // After logging in (or out) in another tab, catch up when this tab is looked at again.
  function recheck() {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > RECHECK_AFTER_MS) check();
  }
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('focus', recheck);

  window.AdminNav = {
    isAdmin: function () { return admin === true; },
    refresh: check
  };

  check();
})();
