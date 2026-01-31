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

## Filter Syntax

- `type:value` - Filter by `data.type`
- `target:value` - Filter by target origin
- `source:value` - Filter by source origin
- `sourceType:parent` / `sourceType:child` / `sourceType:self` / `sourceType:opener` / `sourceType:top` - Filter by source type
- `-term` - Exclude messages containing term
- Plain text - Search in data preview
