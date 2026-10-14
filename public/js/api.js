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
      throw new Error(data.error || 'API request failed');
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
 * { role: 'user' | 'assistant', content: string }.
 */
async function askChat(messages) {
  return await apiFetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}
