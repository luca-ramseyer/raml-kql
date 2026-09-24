import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@vscode/codicons/dist/codicon.css';

import { App } from './App';
import './workbench/workbench.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
