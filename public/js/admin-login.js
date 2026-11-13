/**
 * Admin login page. Checks who the server says you are, shows the login form or a log-out button, and posts the
 * password as JSON to /api/admin/login. The password is never put in a URL and is cleared from the field as soon as
 * it is sent. The cookie is HttpOnly, so this script never sees it; it only asks the server (GET /api/admin/session).
 *
 * Everything shown is set with textContent. Nothing here is built from an HTML string.
 */
(function () {
  'use strict';

  var form = document.getElementById('adminForm');
  var input = document.getElementById('adminPassword');
  var submit = document.getElementById('adminSubmit');
  var loggedIn = document.getElementById('adminIn');
  var logout = document.getElementById('adminLogout');
  var status = document.getElementById('adminStatus');

  function say(text, isError) {
    status.textContent = text;
    status.className = isError ? 'error' : '';
  }

  function show(admin) {
    form.hidden = admin;
    loggedIn.hidden = !admin;
  }

  async function call(method, path, body) {
    var init = { method: method, credentials: 'same-origin', headers: {}, cache: 'no-store' };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var response = await fetch('/api/admin/' + path, init);
    var payload = null;
    try { payload = await response.json(); } catch (e) { /* a non-JSON answer is handled below */ }
    if (!response.ok || !payload || payload.success !== true) {
      var error = new Error((payload && payload.error) || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  async function refresh() {
    try {
      var data = await call('GET', 'session');
      show(data.admin === true);
      say('', false);
    } catch (e) {
      show(false);
      say(e.message, true);
    }
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var password = input.value;
    input.value = '';
    if (!password) return;
    submit.disabled = true;
    say('Checking…', false);
    try {
      await call('POST', 'login', { password: password });
      show(true);
      say('Logged in.', false);
    } catch (e) {
      say(e.message, true);
      input.focus();
    } finally {
      submit.disabled = false;
    }
  });

  logout.addEventListener('click', async function () {
    logout.disabled = true;
    try {
      await call('POST', 'logout');
      show(false);
      say('Logged out.', false);
    } catch (e) {
      say(e.message, true);
    } finally {
      logout.disabled = false;
    }
  });

  refresh();
})();
