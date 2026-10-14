// Deadlines page logic

const daysSlider = document.getElementById('daysAhead');
const daysLabel = document.getElementById('daysLabel');

daysSlider.addEventListener('input', (e) => {
  daysLabel.textContent = e.target.value;
});

document.getElementById('deadlineForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const daysAhead = parseInt(formData.get('daysAhead'), 10);
  const applicantType = formData.get('applicantType') || null;

  showLoading('results');

  try {
    const response = await getUpcomingDeadlines(daysAhead, applicantType);
    displayDeadlines(response.data);
  } catch (error) {
    showError('results', error.message || 'Failed to fetch deadlines');
  }
});

// Load on page load
window.addEventListener('load', async () => {
  showLoading('results');
  try {
    const response = await getUpcomingDeadlines(30);
    displayDeadlines(response.data);
  } catch (error) {
    showError('results', error.message || 'Failed to fetch deadlines');
  }
});

function displayDeadlines(deadlines) {
  const resultsDiv = document.getElementById('results');

  if (!deadlines || deadlines.length === 0) {
    resultsDiv.innerHTML = '<div class="card"><p>No upcoming deadlines found in the selected timeframe.</p></div>';
    return;
  }

  let html = `<div class="card"><h3>Found ${deadlines.length} Grant Deadline(s)</h3></div>`;
  html += '<div class="timeline">';

  deadlines.forEach(deadline => {
    const days = deadline.daysUntilDeadline;
    const isUrgent = days <= 7;
    const urgentClass = isUrgent ? 'urgent' : '';
    const amount = deadline.amount ? formatCurrency(deadline.amount) : 'Amount not specified';

    html += `
      <div class="timeline-item ${urgentClass}">
        <div class="card">
          <h4>${escapeHtml(deadline.title)}</h4>
          <p><strong>Deadline:</strong> ${formatDate(deadline.deadline)}
            ${isUrgent ? '<span class="badge badge-danger">URGENT</span>' : ''}
          </p>
          <p><strong>Days Until Deadline:</strong> ${days} day${days !== 1 ? 's' : ''}</p>
          <p><strong>Organization:</strong> ${escapeHtml(deadline.organization)}</p>
          <p><strong>Amount:</strong> ${amount}</p>
          <button onclick="viewDetails('${deadline.id}')">View Details</button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  resultsDiv.innerHTML = html;
}

function viewDetails(grantId) {
  window.location.href = `/details.html?id=${grantId}`;
}
