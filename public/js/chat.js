// Chat page logic

let chatHistory = [];

// Optional project context (only when the project workspace is enabled).
let projectId = null; // sent with every chat request while a project is selected
let conversationRevision = null; // revision the conversation started with
let contextBlocked = false; // a selected project failed to load: never answer as if it had

document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (contextBlocked) return;

  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  input.disabled = true;

  appendMessage('assistant', '...', true);

  try {
    const response = await askChat(chatHistory, projectId);
    removePendingMessage();

    const reply = response.data.reply;
    const toolCalls = response.data.toolCalls || [];
    appendMessage('assistant', reply, false, toolCalls);
    chatHistory.push({ role: 'assistant', content: reply });
    if (response.data.context) noteContextRevision(response.data.context.revision);
  } catch (error) {
    removePendingMessage();
    if (projectId && error.code === 'PROJECT_NOT_FOUND') {
      // The project was deleted or is no longer reachable mid-conversation.
      showContextError('This project is no longer available, so your message was not answered with its context.');
    } else {
      appendMessage('error', error.message || 'Failed to get a response');
    }
  } finally {
    input.disabled = contextBlocked;
    if (!contextBlocked) input.focus();
  }
});

function appendMessage(role, text, pending = false, toolCalls = []) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');

  if (role === 'error') {
    div.className = 'error';
  } else {
    div.className = `chat-message ${role}`;
  }
  if (pending) {
    div.dataset.pending = 'true';
  }

  if (role === 'assistant') {
    // Assistant replies are markdown from the Anthropic API; render the
    // supported subset to HTML. renderMarkdown escapes all raw text
    // itself, so this stays safe even though the reply reflects
    // untrusted tool/API data by way of the LLM.
    div.innerHTML = renderMarkdown(text);
  } else {
    // The user's own typed input (and local error strings) are shown as
    // plain text — don't reinterpret the user's literal input as markdown.
    div.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  }

  if (role === 'assistant' && toolCalls.length > 0) {
    const toolCallsDiv = document.createElement('div');
    toolCallsDiv.className = 'chat-tool-calls';
    toolCallsDiv.innerHTML = toolCalls
      .map((tc) => {
        const inputStr = escapeHtml(JSON.stringify(tc.input));
        return `<div class="chat-tool-call">🔧 ${escapeHtml(tc.name)}(<code>${inputStr}</code>)</div>`;
      })
      .join('');
    div.appendChild(toolCallsDiv);
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removePendingMessage() {
  const container = document.getElementById('chatMessages');
  const pending = container.querySelector('[data-pending="true"]');
  if (pending) pending.remove();
}

// ---------------------------------------------------------------------------
// Project context. All text below is set with textContent (profile data is untrusted).

function setSendBlocked(blocked) {
  contextBlocked = blocked;
  const input = document.getElementById('chatInput');
  input.disabled = blocked;
  document.querySelector('#chatForm button[type="submit"]').disabled = blocked;
}

function resetConversation() {
  chatHistory = [];
  conversationRevision = null;
  document.getElementById('chatMessages').replaceChildren();
  document.getElementById('chatRevisionNotice').hidden = true;
}

function setProjectInUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('projectId', id);
  else url.searchParams.delete('projectId');
  window.history.replaceState(null, '', url);
}

function hideProjectUi() {
  document.getElementById('chatProjectBanner').hidden = true;
  document.getElementById('chatContextError').hidden = true;
  document.getElementById('chatRevisionNotice').hidden = true;
}

function makeNode(tag, text, attrs) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

function showContextError(message) {
  setSendBlocked(true);
  document.getElementById('chatProjectBanner').hidden = true;
  const box = document.getElementById('chatContextError');
  box.replaceChildren(makeNode('p', message));
  const cont = makeNode('button', 'Continue without a project', { type: 'button' });
  cont.addEventListener('click', () => {
    // Explicit, visible choice: from here on the assistant has no project context.
    projectId = null;
    setProjectInUrl(null);
    document.getElementById('chatProject').value = '';
    hideProjectUi();
    setSendBlocked(false);
    document.getElementById('chatInput').focus();
  });
  box.append(cont);
  box.hidden = false;
}

function renderProjectBanner(project) {
  const readiness = project.readinessAssessment;
  const banner = document.getElementById('chatProjectBanner');
  const status = { draft: 'Draft', ready: 'Ready', archived: 'Archived' }[project.status] || project.status;
  banner.replaceChildren(
    makeNode('p', `Using project: ${project.profile.name} (${status}) — ${readiness.completeCount} of ${readiness.requiredCount} required details complete.`)
  );
  if (readiness.missingFields.length) {
    const labels = readiness.missingFields.map((m) => m.label).join('; ');
    banner.append(makeNode('p', `Missing context: ${labels}. The assistant will ask if it needs any of this.`));
  }
  const edit = makeNode('a', 'edit it in the project workspace', { href: '/project.html?' + new URLSearchParams({ id: project.id }) });
  const note = makeNode('p', 'Chat reads your saved project and never changes it. To change the project, ');
  note.append(edit, '.');
  banner.append(note);
  banner.hidden = false;
}

async function selectProject(id) {
  resetConversation();
  document.getElementById('chatContextError').hidden = true;
  projectId = id || null;
  setProjectInUrl(projectId);
  if (!projectId) {
    hideProjectUi();
    setSendBlocked(false);
    return;
  }
  setSendBlocked(true); // never answer as if the context loaded before it actually has
  try {
    const res = await getProject(projectId);
    renderProjectBanner(res.data.project);
    document.getElementById('chatProject').value = projectId;
    setSendBlocked(false);
    document.getElementById('chatInput').focus();
  } catch (error) {
    showContextError(
      error.code === 'SESSION_REQUIRED' || error.code === 'PROJECT_NOT_FOUND'
        ? 'That project could not be found. It may have been deleted, or this browser may no longer have access to it.'
        : `The project could not be loaded. ${error.message || ''}`.trim()
    );
  }
}

function noteContextRevision(revision) {
  if (conversationRevision === null) {
    conversationRevision = revision;
    return;
  }
  if (revision === conversationRevision) return;
  // The server loads the latest profile on every request, so a different revision means the
  // project was edited mid-conversation. Tell the user and offer a clean start.
  const notice = document.getElementById('chatRevisionNotice');
  notice.replaceChildren(makeNode('p', `Project updated — this conversation now uses revision ${revision}.`));
  const fresh = makeNode('button', 'Start a fresh conversation', { type: 'button' });
  fresh.addEventListener('click', () => {
    resetConversation();
    document.getElementById('chatInput').focus();
  });
  notice.append(fresh);
  notice.hidden = false;
}

async function initProjectContext() {
  const requested = getQueryParam('projectId');
  let enabled = false;
  try {
    const res = await fetch('/api/features');
    enabled = !!(await res.json()).data.projectDiscovery;
  } catch (e) {
    enabled = false;
  }

  if (!enabled) {
    if (requested) {
      showContextError('Project context is not available on this site.');
    }
    return;
  }

  let items = [];
  try {
    items = (await listProjects({ limit: 100 })).data.items;
  } catch (e) {
    items = [];
  }
  const select = document.getElementById('chatProject');
  select.replaceChildren(new Option('No project', ''));
  for (const p of items) {
    const suffix = p.status === 'archived' ? ' (archived)' : '';
    select.append(new Option(`${p.name}${suffix}`, p.id));
  }
  if (items.length || requested) document.getElementById('chatProjectBar').hidden = false;
  select.addEventListener('change', () => selectProject(select.value));

  if (requested) await selectProject(requested);
}

initProjectContext();
