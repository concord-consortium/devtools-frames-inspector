# PostMessage DevTools Extension

A Chrome DevTools extension that inspects postMessage communication between iframes, providing a Network-tab-like experience with a sortable/filterable table and detail panel.

## Features

- **Table View**: Messages displayed in a sortable table with customizable columns
- **Split-Pane UI**: Click a message to see full details while keeping the list visible
- **Filtering**: Filter by type, origin, direction, or free text (e.g., `type:resize`, `dir:sending`)
- **Column Customization**: Right-click header to show/hide columns
- **Bidirectional Capture**: Captures both outgoing `postMessage()` calls and incoming `message` events
- **Preserve Log**: Option to retain messages across page navigations

## Project Structure

```
├── manifest.json      # Chrome extension manifest (Manifest V3)
├── devtools.html      # DevTools page entry point
├── devtools.js        # DevTools panel initialization
├── panel.html         # The PostMessage panel UI
├── panel.css          # Panel styles (DevTools-like appearance)
├── panel.js           # Panel logic (table, filtering, detail view)
├── injected.js        # Injected into page context (postMessage interception)
├── content.js         # Content script (event bridge to service worker)
├── background.js      # Service worker (message routing)
└── test/              # Test pages for manual testing
```

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the project folder
5. Open DevTools on any page - you'll see a "PostMessage" tab

## Usage

1. Open DevTools (F12 or right-click → Inspect)
2. Navigate to the "PostMessage" tab
3. Interact with the page to generate postMessage traffic
4. Messages appear in the table as they're captured

### Filtering

- `resize` - Messages containing "resize" in data preview
- `type:resize` - Messages with `data.type === "resize"`
- `origin:example.com` - Messages from origins containing "example.com"
- `dir:sending` - Outgoing messages only
- `dir:receiving` - Incoming messages only

Multiple terms are AND'd together.

### Testing

Open `test/test-page.html` in Chrome (via a local server) to test the extension with sample iframes.

```bash
cd test && python -m http.server 8000
# Then open http://localhost:8000/test-page.html
```

## How Monitoring Works

The extension is designed to be minimally invasive:

- **On-demand injection**: Scripts are only injected into pages when you open the PostMessage panel for that tab. Pages you don't inspect remain untouched.
- **Popup capture**: When you open a popup from a monitored tab, the extension automatically enables monitoring for the popup and buffers early messages until you view its panel.
- **Persistent monitoring**: Once enabled, monitoring stays active even when the panel isn't visible or DevTools is closed. **Reload the page to disable monitoring.**

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
```

Content scripts run in Chrome's isolated world and cannot directly intercept page JavaScript. The extension uses a two-script approach:

1. **injected.js** - Injected into the page's main world to wrap `window.postMessage` and listen for `message` events
2. **content.js** - Receives CustomEvents from injected.js and forwards them to the service worker
3. **background.js** - Routes messages to the appropriate DevTools panel by tab ID

## Documentation

- [Frame Filtering Limitation](docs/frame-filtering-limitation.md) - Why per-frame filtering isn't currently possible and technical background for contributors
