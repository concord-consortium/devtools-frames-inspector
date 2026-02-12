// Content script entry point — injected into pages by the extension.
// Delegates to content-core.ts which can also be called from tests with mock arguments.

import { initContentScript } from './content-core';

initContentScript(window, chrome);
