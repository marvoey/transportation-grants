// Details page logic

window.addEventListener('load', async () => {
  const id = getQueryParam('id');
  const program = getQueryParam('program');

  if (!id && !program) {
    showError('details', 'No grant ID or program number specified');
    return;
  }

  showLoading('details');

  try {
    const response = await getGrantDetails(id || program);
    displayDetails(response.data);
  } catch (error) {
    showError('details', error.message || 'Failed to load grant details');
  }
});

function displayDetails(grant) {
  const detailsDiv = document.getElementById('details');

  let html = `
    <div class="card">
      <h2>${escapeHtml(grant.title)}</h2>
      <p><strong>Organization:</strong> ${escapeHtml(grant.organization)}</p>
      ${grant.programNumber ? `<p><strong>Program Number:</strong> ${escapeHtml(grant.programNumber)}</p>` : ''}
    </div>
  `;

  // Description
  if (grant.description || grant.objectives) {
    html += `
      <div class="card">
        <h3>Description</h3>
        <p>${escapeHtml(grant.description || grant.objectives)}</p>
      </div>
    `;
  }

  // Funding
  if (grant.amount) {
    html += `
      <div class="card">
        <h3>Funding Information</h3>
        ${grant.amount.min ? `<p><strong>Minimum Award:</strong> ${formatCurrency(grant.amount.min)}</p>` : ''}
        ${grant.amount.max ? `<p><strong>Maximum Award:</strong> ${formatCurrency(grant.amount.max)}</p>` : ''}
        ${grant.amount.average ? `<p><strong>Average Award:</strong> ${formatCurrency(grant.amount.average)}</p>` : ''}
        ${grant.amount.total ? `<p><strong>Total Available:</strong> ${formatCurrency(grant.amount.total)}</p>` : ''}
      </div>
    `;
  }

  // Eligibility
  if (grant.eligibility) {
    html += `
      <div class="card">
        <h3>Eligibility</h3>
        ${grant.eligibility.description ? `<p>${escapeHtml(grant.eligibility.description)}</p>` : ''}
        ${grant.eligibility.applicantTypes && grant.eligibility.applicantTypes.length > 0 ?
          `<p><strong>Eligible Applicants:</strong> ${grant.eligibility.applicantTypes.join(', ')}</p>` : ''}
        ${grant.eligibility.requirements ? `<p><strong>Requirements:</strong> ${escapeHtml(grant.eligibility.requirements)}</p>` : ''}
      </div>
    `;
  }

  // Deadlines
  if (grant.deadline || grant.applicationProcedures?.deadlines) {
    html += `
      <div class="card">
        <h3>Deadlines</h3>
        ${grant.deadline ? `<p><strong>Application Deadline:</strong> ${formatDate(grant.deadline)}</p>` : ''}
        ${grant.applicationProcedures?.deadlines ? `<p>${escapeHtml(grant.applicationProcedures.deadlines)}</p>` : ''}
      </div>
    `;
  }

  // Application Procedures
  if (grant.applicationProcedures) {
    html += `
      <div class="card">
        <h3>How to Apply</h3>
        ${grant.applicationProcedures.description ? `<p>${escapeHtml(grant.applicationProcedures.description)}</p>` : ''}
        ${grant.applicationProcedures.howToApply ? `<p>${escapeHtml(grant.applicationProcedures.howToApply)}</p>` : ''}
      </div>
    `;
  }

  // Contacts
  if (grant.contacts) {
    html += `<div class="card"><h3>Contact Information</h3>`;

    if (grant.contacts.pointOfContact) {
      html += `
        <p><strong>Point of Contact:</strong><br>
        ${grant.contacts.pointOfContact.name ? escapeHtml(grant.contacts.pointOfContact.name) + '<br>' : ''}
        ${grant.contacts.pointOfContact.email ? `Email: ${escapeHtml(grant.contacts.pointOfContact.email)}<br>` : ''}
        ${grant.contacts.pointOfContact.phone ? `Phone: ${escapeHtml(grant.contacts.pointOfContact.phone)}` : ''}
        </p>
      `;
    }

    if (grant.contacts.headquarters) {
      html += `
        <p><strong>Headquarters:</strong><br>
        ${grant.contacts.headquarters.office ? escapeHtml(grant.contacts.headquarters.office) + '<br>' : ''}
        ${grant.contacts.headquarters.phone ? `Phone: ${escapeHtml(grant.contacts.headquarters.phone)}<br>` : ''}
        ${grant.contacts.headquarters.email ? `Email: ${escapeHtml(grant.contacts.headquarters.email)}` : ''}
        </p>
      `;
    }

    html += `</div>`;
  }

  // Resources
  if (grant.resources) {
    html += `
      <div class="card">
        <h3>Resources</h3>
        ${grant.resources.website ? `<p><a href="${grant.resources.website}" target="_blank">Program Website</a></p>` : ''}
        ${grant.resources.applicationLink ? `<p><a href="${grant.resources.applicationLink}" target="_blank">Apply on SAM.gov</a></p>` : ''}
      </div>
    `;
  }

  detailsDiv.innerHTML = html;
}
