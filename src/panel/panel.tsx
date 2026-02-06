// React entry point for Frames Inspector panel

import { createRoot } from 'react-dom/client';
import { store } from './store';
import { connect } from './connection';
import { App } from './components/App';

// Initialize panel
async function init(): Promise<void> {
  // Load persisted state from chrome.storage
  await store.loadPersistedState();

  // Connect to background script
  connect();

  // Mount React app
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<App />);
  }
}

init();
