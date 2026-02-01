# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome DevTools extension (Manifest V3) for inspecting postMessage communication between iframes. Provides a Network-tab-like UI with sortable/filterable table and detail panel.

## Development

No build system - vanilla JavaScript. Load as unpacked extension in Chrome.

**Testing the extension:**
```bash
cd test && python -m http.server 8000
# Open http://localhost:8000/test-page.html in Chrome
# DevTools → PostMessage tab to see captured messages
```

**Reload after changes:** Go to `chrome://extensions/` and click the refresh icon on the extension.

## Architecture

### Dynamic Injection

The extension uses programmatic script injection to minimize impact on pages:

- Scripts are injected only when the PostMessage panel is opened for a tab
- Popups opened from monitored tabs get buffering enabled automatically (captures early messages before panel connects)
- Once monitoring starts, it persists until page reload (even if DevTools closes)

### Message Flow

Message flow uses a two-script approach because content scripts can't directly intercept page JavaScript:

```
Page Context                    Isolated World                Service Worker      DevTools
─────────────                   ──────────────                ──────────────      ────────
injected.js ──CustomEvent──►    content.js ──runtime.msg──►   background.js ──►   panel.js
(message listener)              (event bridge)                (routes by tabId)   (UI)
```

**Key files:**
- `injected.js` - Injected into page's main world, listens for `message` events and identifies source type (parent, child, self, etc.)
- `content.js` - Content script that receives CustomEvents from injected.js and forwards to service worker
- `background.js` - Service worker that routes messages to appropriate DevTools panel by tab ID
- `panel.js` - Panel UI logic: table rendering, filtering (`type:`, `origin:`, `dir:` prefixes), column customization, detail view

## Design Constraints

- **Cross-origin is the ONLY use case that matters.** This extension exists specifically for debugging cross-origin postMessage communication. Same-origin scenarios are trivial to debug with standard DevTools.
  - NEVER add features that only work for same-origin iframes or windows
  - NEVER add fallback text like "(cross-origin)" or "(unavailable)" - if information isn't available cross-origin, find a way to get it or leave it blank
  - NEVER add special styling (opacity, italics, etc.) to indicate cross-origin limitations
  - If a feature can't work cross-origin, it's not worth adding
  - Always test features with cross-origin iframes first

## Filter Syntax

- `type:value` - Filter by `data.type`
- `target:value` - Filter by target origin
- `source:value` - Filter by source origin
- `sourceType:parent` / `sourceType:child` / `sourceType:self` / `sourceType:opener` / `sourceType:top` - Filter by source type
- `-term` - Exclude messages containing term
- Plain text - Search in data preview
