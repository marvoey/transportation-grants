// Search page logic

document.getElementById('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const params = {};

  if (formData.get('applicantType')) params.applicantType = formData.get('applicantType');
  if (formData.get('keywords')) params.keywords = formData.get('keywords');
  if (formData.get('minAmount')) params.minAmount = parseInt(formData.get('minAmount'), 10);
  if (formData.get('maxAmount')) params.maxAmount = parseInt(formData.get('maxAmount'), 10);

  const resultsDiv = document.getElementById('results');
  showLoading('results');

  try {
    const response = await searchGrants(params);
    displayResults(response.data);
  } catch (error) {
    showError('results', error.message || 'Failed to search grants');
  }
});

function displayResults(grants) {
  const resultsDiv = document.getElementById('results');

  if (!grants || grants.length === 0) {
    resultsDiv.innerHTML = '<div class="card"><p>No grants found matching your criteria.</p></div>';
    return;
  }

  let html = `<h3>Found ${grants.length} Grant(s)</h3><div class="card-grid">`;

  grants.forEach(grant => {
    const deadline = grant.deadline ? formatDate(grant.deadline) : 'No deadline specified';
    const amount = grant.amount ? formatCurrency(grant.amount) : 'Amount not specified';
    const description = truncate(grant.description || 'No description available', 150);

    html += `
      <div class="card">
        <h3>${escapeHtml(grant.title)}</h3>
        <p><strong>Organization:</strong> ${escapeHtml(grant.organization)}</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p><strong>Deadline:</strong> ${deadline}</p>
        <p>${escapeHtml(description)}</p>
        <button onclick="viewDetails('${grant.id}')">View Details</button>
        ${grant.link ? `<a href="${grant.link}" target="_blank"><button class="mt-2">View on SAM.gov</button></a>` : ''}
      </div>
    `;
  });

  html += '</div>';
  resultsDiv.innerHTML = html;
}

function viewDetails(grantId) {
  window.location.href = `/details.html?id=${grantId}`;
}
