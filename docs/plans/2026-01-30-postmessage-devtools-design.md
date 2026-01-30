# PostMessage DevTools Extension - Design Document

## Overview

A Chrome DevTools extension that inspects postMessage communication between iframes, providing a Network-tab-like experience with a sortable/filterable table and detail panel.

## Goals

- Reduce clutter by showing one row per message in a table UI
- Enable sorting and filtering by message properties
- Provide full message details without losing list context (split-pane)
- Capture both sending and receiving messages across all frames

## Architecture

```
                    Page Context                     Isolated World
                    ────────────                     ──────────────
Frame A  ┌─────────────────────┐   CustomEvent   ┌─────────────────┐
         │  injected.js        │ ───────────────►│  content.js     │──┐
         │  (wraps postMessage)│                 │  (event bridge) │  │
         └─────────────────────┘                 └─────────────────┘  │
                                                                      │
Frame B  ┌─────────────────────┐   CustomEvent   ┌─────────────────┐  │
         │  injected.js        │ ───────────────►│  content.js     │──┼──► Service Worker ──► DevTools Panel
         └─────────────────────┘                 └─────────────────┘  │
                                                                      │
Frame C  ┌─────────────────────┐   CustomEvent   ┌─────────────────┐  │
         │  injected.js        │ ───────────────►│  content.js     │──┘
         └─────────────────────┘                 └─────────────────┘
```

**Components:**

- **Injected Script (`injected.js`)** - Injected into the page's main JavaScript context. Intercepts outgoing `postMessage()` calls by wrapping `window.postMessage`, and listens for incoming `message` events. Dispatches CustomEvents to communicate with the content script.

- **Content Script (`content.js`)** - Runs in Chrome's isolated world. Injects `injected.js` into the page, listens for CustomEvents from the injected script, and forwards captured messages to the service worker via `chrome.runtime.sendMessage`.

- **Service Worker (`background.js`)** - Bridges communication between content scripts and DevTools panel. Routes messages by tab ID. Handles "clear on navigation" by listening to `chrome.webNavigation` events.

- **DevTools Panel (`panel.js`, `panel.html`)** - Receives messages from service worker. Maintains message list, handles filtering/sorting, renders the split-pane UI.

## Data Model

```javascript
{
  id: "uuid",                      // Unique identifier
  timestamp: 1706647200000,        // When captured (ms since epoch)
  direction: "sending" | "receiving",

  // The frame where we captured this message
  self: {
    url: "https://example.com/page",
    origin: "https://example.com",
    documentTitle: "Widget Page"
  },

  // The other end (limited info)
  targetOrigin: "*",               // For sending: the postMessage param
  sourceOrigin: "https://...",     // For receiving: event.origin

  data: { /* payload */ },         // The actual message data
  dataPreview: "...",              // Truncated string for table display
  dataSize: 1240,                  // Approximate bytes
  messageType: "resize"            // Extracted from data.type if present
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Filter bar: _______________] [🗑 Clear] [☐ Preserve log]       │
├───────────────────────────────────┬─────────────────────────────┤
│ Time   | Dir | Self Origin| Type │  ┌─────────┬─────────┐      │
│────────|─────|────────────|──────│  │  Data   │ Context │      │
│ 12:01  | →   | example.com| resize│  ├─────────┴─────────┘      │
│ 12:01  | ←   | widget.com | resize│  │ {                        │
│ 12:02  | →   | example.com| init │  │   "type": "resize",      │
│ 12:02  | ←   | widget.com | init │  │   "width": 800,          │
│        |     |            |      │  │   "height": 600          │
│        |     |            |      │  │ }                        │
├───────────────────────────────────┴─────────────────────────────┤
│ 5 messages                                                      │
└─────────────────────────────────────────────────────────────────┘
```

- **Left pane:** Message table (resizable)
- **Right pane:** Detail panel with tabs (appears when row selected)
- **Toolbar:** Filter bar, clear button, preserve log toggle
- **Status bar:** Message count (and filtered count when filtering)

## Table Columns

| Column | Description | Default Visible |
|--------|-------------|-----------------|
| Timestamp | When captured (HH:MM:SS.mmm) | Yes |
| Direction | Arrow: → sending, ← receiving | Yes |
| Self URL | Full URL of capturing frame | No |
| Self Origin | Origin only | Yes |
| Self Title | Document title of the frame | No |
| Target Origin | targetOrigin param (sending only) | Yes |
| Source Origin | event.origin (receiving only) | Yes |
| Type | Extracted from data.type | Yes |
| Data Preview | Truncated payload | Yes |
| Size | Approximate bytes | No |

**Column interactions:**
- Right-click header to show/hide columns (checkboxes)
- Drag column edges to resize
- Click column header to sort (asc/desc toggle)
- Column preferences saved to `chrome.storage.local`

## Detail Panel Tabs

**Data Tab:**
- Expandable/collapsible JSON tree view
- Syntax highlighting for different value types
- Copy button for full JSON

**Context Tab:**
- Key-value display of all metadata:
  - Direction, Timestamp, Self URL, Self Origin, Self Title
  - Target Origin (if sending) or Source Origin (if receiving)
  - Size

## Filtering

**Filter bar syntax:**

| Query | Meaning |
|-------|---------|
| `resize` | Data preview contains "resize" |
| `type:resize` | messageType equals "resize" |
| `origin:example.com` | Self origin contains "example.com" |
| `target:*` | Target origin is "*" |
| `source:widget.com` | Source origin contains "widget.com" |
| `dir:sending` | Direction is sending |
| `dir:receiving` | Direction is receiving |

- Multiple terms are AND'd together
- Right-click any cell → "Filter by this value" populates the filter bar
- Filter bar and right-click filtering stay synced

## Persistence

- **Default:** Clear messages on page navigation
- **Preserve log toggle:** When enabled, messages persist across navigations
- **Column preferences:** Saved to `chrome.storage.local`

## Manifest Changes

```json
{
  "background": {
    "service_worker": "background.js"
  },
  "permissions": ["webNavigation"],
  "web_accessible_resources": [
    {
      "resources": ["injected.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Note: `web_accessible_resources` is required so that the content script can inject `injected.js` into the page's main world via a `<script>` element.

## Deferred to v2

- Frame hierarchy display (Main > iframe[0])
- iframe element id capture
- Message correlation (matching sending/receiving pairs by content)
- Custom JS expressions for frame labeling
- MessageChannel support

## File Structure

```
├── manifest.json          # Chrome extension manifest (Manifest V3)
├── devtools.html          # DevTools page entry point
├── devtools.js            # Creates the DevTools panel
├── panel.html             # Panel UI structure
├── panel.css              # Panel styles
├── panel.js               # Panel logic (table, filtering, detail view)
├── injected.js            # Injected into page context (postMessage interception)
├── content.js             # Content script (event bridge to service worker)
├── background.js          # Service worker (message routing)
└── icons/                 # Extension icons
```
