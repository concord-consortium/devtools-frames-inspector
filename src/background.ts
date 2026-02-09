// Service worker for Frames Inspector — thin wrapper around background-core.
// Routes messages between content scripts and DevTools panel.

import { initBackgroundScript } from './background-core';

initBackgroundScript(chrome);
