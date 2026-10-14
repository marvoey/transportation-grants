// Chat page logic

let chatHistory = [];

document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  input.disabled = true;

  appendMessage('assistant', '...', true);

  try {
    const response = await askChat(chatHistory);
    removePendingMessage();

    const reply = response.data.reply;
    appendMessage('assistant', reply);
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (error) {
    removePendingMessage();
    appendMessage('error', error.message || 'Failed to get a response');
  } finally {
    input.disabled = false;
    input.focus();
  }
});

function appendMessage(role, text, pending = false) {
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
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removePendingMessage() {
  const container = document.getElementById('chatMessages');
  const pending = container.querySelector('[data-pending="true"]');
  if (pending) pending.remove();
}
