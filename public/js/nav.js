// Adds the "Projects" navigation link only when the project workspace is enabled.
// With the feature off the link is never rendered.
(function () {
  const list = document.querySelector('header nav ul');
  if (!list) return;
  fetch('/api/features')
    .then((r) => r.json())
    .then((body) => {
      if (!body || !body.success || !body.data.projectDiscovery) return;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '/project.html';
      a.textContent = 'Projects';
      if (location.pathname === '/project.html') a.setAttribute('aria-current', 'page');
      li.appendChild(a);
      list.appendChild(li);
    })
    .catch(() => {});
})();
