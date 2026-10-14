// Eligibility page logic

document.getElementById('eligibilityForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const applicantType = formData.get('applicantType');
  const programNumber = formData.get('programNumber') || null;

  if (!applicantType) {
    showError('results', 'Please select an applicant type');
    return;
  }

  showLoading('results');

  try {
    const response = await checkEligibility(applicantType, null, programNumber);
    displayResults(response.data, applicantType);
  } catch (error) {
    showError('results', error.message || 'Failed to check eligibility');
  }
});

function displayResults(results, applicantType) {
  const resultsDiv = document.getElementById('results');

  if (!results || results.length === 0) {
    resultsDiv.innerHTML = '<div class="card"><p>No eligibility information found.</p></div>';
    return;
  }

  const eligible = results.filter(r => r.status === 'eligible');
  const conditional = results.filter(r => r.status === 'conditional');
  const notEligible = results.filter(r => r.status === 'not_eligible');

  let html = `
    <div class="card">
      <h2>Eligibility Results for ${getApplicantTypeLabel(applicantType)}</h2>
      <p><strong>Total Programs Checked:</strong> ${results.length}</p>
      <p>
        <span class="badge badge-success">${eligible.length} Eligible</span>
        <span class="badge badge-warning">${conditional.length} Conditional</span>
        <span class="badge badge-danger">${notEligible.length} Not Eligible</span>
      </p>
    </div>
  `;

  // Show eligible first
  if (eligible.length > 0) {
    html += '<h3>Eligible Programs</h3>';
    eligible.forEach(result => {
      html += createResultCard(result);
    });
  }

  // Then conditional
  if (conditional.length > 0) {
    html += '<h3>Conditionally Eligible Programs</h3>';
    conditional.forEach(result => {
      html += createResultCard(result);
    });
  }

  // Then not eligible (collapsed by default)
  if (notEligible.length > 0) {
    html += `<h3>Not Eligible Programs (${notEligible.length})</h3>`;
    html += '<p><em>These programs do not list your organization type as eligible.</em></p>';
  }

  resultsDiv.innerHTML = html;
}

function createResultCard(result) {
  const badge = getEligibilityBadge(result.status);
  const requirements = result.requirements && result.requirements.length > 0
    ? `<p><strong>Requirements:</strong></p><ul>${result.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '';

  return `
    <div class="card">
      <h4>${escapeHtml(result.programTitle || 'Unknown Program')}</h4>
      <p><strong>Program Number:</strong> ${escapeHtml(result.programNumber || 'N/A')}</p>
      <p><strong>Status:</strong> ${badge}</p>
      <p><strong>Reasoning:</strong> ${escapeHtml(result.reasoning)}</p>
      ${requirements}
      ${result.programNumber ? `<button onclick="viewProgram('${result.programNumber}')">View Full Details</button>` : ''}
    </div>
  `;
}

function viewProgram(programNumber) {
  window.location.href = `/details.html?program=${programNumber}`;
}
