// Test fixture for e2e/example-extensions.spec.ts. A classic script in a sandboxed frame: the
// workbench posts the result after the user allowed `results.read`.
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'render') return;
  const { table } = event.data;
  const app = document.getElementById('app');
  app.textContent = '';
  const heading = document.createElement('h1');
  heading.textContent = `${String(table.rows.length)} rows`;
  const columns = document.createElement('p');
  columns.textContent = `Columns: ${table.columns.map((c) => c.name).join(', ')}`;
  app.append(heading, columns);
});
