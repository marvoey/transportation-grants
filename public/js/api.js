/**
 * API Client for DOT Grants Web Interface
 * Provides functions to call the REST API endpoints
 */

const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!data.success) {
      const err = new Error(data.error || 'API request failed');
      // Keep the machine-readable code so callers (e.g. the project workspace) can react to it.
      err.code = data.code;
      err.retryable = data.retryable;
      err.status = response.status;
      throw err;
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Search for DOT grant opportunities
 */
async function searchGrants(params) {
  const query = new URLSearchParams();

  if (params.applicantType) query.append('applicantType', params.applicantType);
  if (params.minAmount) query.append('minAmount', params.minAmount);
  if (params.maxAmount) query.append('maxAmount', params.maxAmount);
  if (params.keywords) query.append('keywords', params.keywords);
  if (params.deadlineAfter) query.append('deadlineAfter', params.deadlineAfter);
  if (params.deadlineBefore) query.append('deadlineBefore', params.deadlineBefore);

  return await apiFetch(`${API_BASE}/grants/search?${query}`);
}

/**
 * Get grant details by ID or program number
 */
async function getGrantDetails(idOrProgram) {
  const query = new URLSearchParams();

  // Detect if it's a program number (format: XX.XXX) or an ID
  if (/^\d+\.\d+$/.test(idOrProgram)) {
    query.append('program', idOrProgram);
  } else {
    query.append('id', idOrProgram);
  }

  return await apiFetch(`${API_BASE}/grants/details?${query}`);
}

/**
 * Check eligibility for an applicant type
 */
async function checkEligibility(applicantType, opportunityId = null, programNumber = null) {
  const query = new URLSearchParams();
  query.append('applicantType', applicantType);

  if (opportunityId) query.append('opportunityId', opportunityId);
  if (programNumber) query.append('programNumber', programNumber);

  return await apiFetch(`${API_BASE}/eligibility/check?${query}`);
}

/**
 * Get upcoming deadlines
 */
async function getUpcomingDeadlines(daysAhead = 30, applicantType = null) {
  const query = new URLSearchParams();
  query.append('daysAhead', daysAhead);

  if (applicantType) query.append('applicantType', applicantType);

  return await apiFetch(`${API_BASE}/deadlines?${query}`);
}

/**
 * Get server health status
 */
async function getHealth() {
  return await apiFetch(`${API_BASE}/health`);
}

/**
 * Ask the natural-language chat assistant a question.
 * `messages` is the full conversation history: an array of
 * { role: 'user' | 'assistant', content: string }. `projectId` optionally
 * selects a saved project whose profile is used as read-only context.
 */
async function askChat(messages, projectId) {
  // projectId is optional; it is added to the body only when set (never to the URL).
  const body = projectId ? { messages, projectId } : { messages };
  return await apiFetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Project discovery workspace (see /project.html). All requests are same-origin
// and carry the anonymous session cookie automatically.

function projectJson(method, url, body) {
  return apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Client-generated idempotency key for a write. */
function newRequestId() {
  return crypto.randomUUID();
}

async function listProjects(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.append('status', params.status);
  if (params.limit) query.append('limit', params.limit);
  if (params.cursor) query.append('cursor', params.cursor);
  return await apiFetch(`${API_BASE}/projects?${query}`);
}

async function getProject(id) {
  return await apiFetch(`${API_BASE}/projects/${encodeURIComponent(id)}`);
}

async function createProject(name, requestId = newRequestId()) {
  return await projectJson('POST', `${API_BASE}/projects`, { name, requestId });
}

async function patchProject(id, body) {
  return await projectJson('PATCH', `${API_BASE}/projects/${encodeURIComponent(id)}`, body);
}

async function setProjectStatus(id, body) {
  return await projectJson('POST', `${API_BASE}/projects/${encodeURIComponent(id)}/status`, body);
}

async function deleteProject(id, expectedRevision, requestId = newRequestId()) {
  const query = new URLSearchParams({ expectedRevision, requestId });
  return await projectJson('DELETE', `${API_BASE}/projects/${encodeURIComponent(id)}?${query}`);
}

// Discovery guide (conversation and reviewable suggestions)

async function listDiscoveryMessages(id, cursor) {
  const query = new URLSearchParams({ limit: 100 });
  if (cursor) query.append('cursor', cursor);
  return await apiFetch(`${API_BASE}/projects/${encodeURIComponent(id)}/discovery/messages?${query}`);
}

async function listDiscoverySuggestions(id, state) {
  const query = new URLSearchParams();
  if (state) query.append('state', state);
  return await apiFetch(`${API_BASE}/projects/${encodeURIComponent(id)}/discovery/suggestions?${query}`);
}

async function sendDiscoveryTurn(id, body) {
  return await projectJson('POST', `${API_BASE}/projects/${encodeURIComponent(id)}/discovery`, body);
}

async function applyDiscoverySuggestion(id, suggestionId, body) {
  return await projectJson(
    'POST',
    `${API_BASE}/projects/${encodeURIComponent(id)}/discovery/suggestions/${encodeURIComponent(suggestionId)}/apply`,
    body
  );
}

async function dismissDiscoverySuggestion(id, suggestionId, body) {
  return await projectJson(
    'POST',
    `${API_BASE}/projects/${encodeURIComponent(id)}/discovery/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
    body
  );
}
