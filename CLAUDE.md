# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Frames Inspector - Chrome DevTools extension (Manifest V3) for inspecting frames and postMessage communication between iframes. Provides a Network-tab-like UI with sortable/filterable table and detail panel.

## Development

Uses Vite for building TypeScript/React. Load dist/ as unpacked extension in Chrome.

**Build and test:**
```bash
npm run build   # Build to dist/
cd test && python -m http.server 8000
# Open http://localhost:8000/test-page.html in Chrome
# DevTools → Frames tab to see captured messages
```

**Reload after changes:** Run `npm run build`, then go to `chrome://extensions/` and click the refresh icon on the extension.

## Architecture

### Dynamic Injection

The extension uses programmatic script injection to minimize impact on pages:

- Content script is injected only when the Frames panel is opened for a tab
- Popups opened from monitored tabs get buffering enabled automatically (captures early messages before panel connects)
- Once monitoring starts, it persists until page reload (even if DevTools closes)

### Message Flow

```
Isolated World                Service Worker      DevTools
──────────────                ──────────────      ────────
content.js ──runtime.msg──►   background.js ──►   panel.js
(message listener)            (routes by tabId)   (UI)
```

**Key files:**
- `content.ts` - Content script that listens for `message` events, identifies source type (parent, child, self, etc.), and forwards to service worker
- `background.ts` - Service worker that routes messages to appropriate DevTools panel by tab ID
- `panel.tsx` - Panel UI: React-based table rendering, filtering, column customization, detail view

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
- `frame:frame[N]` - Filter by frame ID (matches sourceFrameId or targetFrameId in current tab)
- `frame:tab[T].frame[N]` - Filter by tab and frame ID (matches sourceTabId/sourceFrameId; targets are always current tab)
- `-term` - Exclude messages containing term
- Plain text - Search in data preview

## Workflow Preferences

- **Design documents:** After generating a design/plan document, show it to the user for review before committing. Do not auto-commit design docs.
