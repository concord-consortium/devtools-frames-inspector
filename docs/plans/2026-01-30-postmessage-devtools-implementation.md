# PostMessage DevTools Extension - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome DevTools extension that inspects postMessage traffic between iframes with a Network-tab-like UI.

**Architecture:** Content scripts in all frames intercept postMessage calls and message events, sending captured data through a service worker to a DevTools panel. The panel displays messages in a sortable/filterable table with a detail pane.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript, Chrome DevTools APIs

**Design doc:** `docs/plans/2026-01-30-postmessage-devtools-design.md`

---

## Task 1: Update Manifest and Create Service Worker

**Files:**
- Modify: `manifest.json`
- Create: `background.js`

**Step 1: Update manifest.json with service worker and permissions**

```json
{
  "manifest_version": 3,
  "name": "PostMessage DevTools",
  "version": "1.0.0",
  "description": "A Chrome DevTools extension that exposes postMessage messages similar to the Network tab",
  "devtools_page": "devtools.html",
  "background": {
    "service_worker": "background.js"
  },
  "permissions": ["webNavigation"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start",
      "all_frames": true
    }
  ]
}
```

**Step 2: Create background.js service worker**

```javascript
// Service worker for PostMessage DevTools
// Routes messages between content scripts and DevTools panel

// Store panel connections by tab ID
const panelConnections = new Map();

// Store preserve log preference by tab ID
const preserveLogPrefs = new Map();

// Handle connections from DevTools panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postmessage-panel') return;

  const tabId = port.sender?.tab?.id;

  // Panel sends its tab ID in the first message
  port.onMessage.addListener((msg) => {
    if (msg.type === 'init') {
      panelConnections.set(msg.tabId, port);
      preserveLogPrefs.set(msg.tabId, false);

      port.onDisconnect.addListener(() => {
        panelConnections.delete(msg.tabId);
        preserveLogPrefs.delete(msg.tabId);
      });
    } else if (msg.type === 'preserveLog') {
      preserveLogPrefs.set(msg.tabId, msg.value);
    }
  });
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'postmessage-captured') return;

  const tabId = sender.tab?.id;
  if (!tabId) return;

  const panel = panelConnections.get(tabId);
  if (panel) {
    panel.postMessage({
      type: 'message',
      payload: message.payload
    });
  }
});

// Handle navigation events (clear messages unless preserve log is on)
chrome.webNavigation.onCommitted.addListener((details) => {
  // Only care about main frame navigations
  if (details.frameId !== 0) return;

  const preserveLog = preserveLogPrefs.get(details.tabId);
  if (preserveLog) return;

  const panel = panelConnections.get(details.tabId);
  if (panel) {
    panel.postMessage({ type: 'clear' });
  }
});
```

**Step 3: Test manually**

1. Load extension in Chrome at `chrome://extensions/`
2. Check "Service worker" link appears and is active
3. Check no errors in service worker console

**Step 4: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: add service worker for message routing"
```

---

## Task 2: Implement Content Script Message Interception

**Why two scripts?** Content scripts run in Chrome's "isolated world" - a separate JavaScript context from the page. Wrapping `window.postMessage` in a content script only affects the content script's context, not the page's. To intercept the page's postMessage calls, we must inject code into the page's main world.

**Files:**
- Modify: `manifest.json` (add web_accessible_resources)
- Create: `injected.js` (runs in page context)
- Modify: `content.js` (bridge to service worker)

**Step 1: Update manifest.json to allow injected.js to be loaded**

Add this to manifest.json:

```json
"web_accessible_resources": [
  {
    "resources": ["injected.js"],
    "matches": ["<all_urls>"]
  }
]
```

**Step 2: Create injected.js (runs in page's main world)**

```javascript
// Injected into page context to intercept postMessage calls
// Communicates with content script via CustomEvents

(function() {
  const EVENT_NAME = '__postmessage_devtools__';

  // Collect frame metadata
  function getFrameMetadata() {
    return {
      url: window.location.href,
      origin: window.location.origin,
      documentTitle: document.title || ''
    };
  }

  // Generate unique ID
  function generateId() {
    return crypto.randomUUID();
  }

  // Create data preview (truncated string representation)
  function createDataPreview(data, maxLength = 100) {
    try {
      const str = JSON.stringify(data);
      if (str.length <= maxLength) return str;
      return str.substring(0, maxLength) + '...';
    } catch {
      return String(data).substring(0, maxLength);
    }
  }

  // Calculate approximate size in bytes
  function calculateSize(data) {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  // Extract message type from data (looks for .type property)
  function extractMessageType(data) {
    if (data && typeof data === 'object' && typeof data.type === 'string') {
      return data.type;
    }
    return null;
  }

  // Send captured message to content script via CustomEvent
  function sendCapturedMessage(capturedMessage) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: capturedMessage
    }));
  }

  // Intercept outgoing postMessage calls
  const originalPostMessage = window.postMessage.bind(window);
  window.postMessage = function(message, targetOrigin, transfer) {
    const capturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      direction: 'sending',
      self: getFrameMetadata(),
      targetOrigin: targetOrigin,
      sourceOrigin: null,
      data: message,
      dataPreview: createDataPreview(message),
      dataSize: calculateSize(message),
      messageType: extractMessageType(message)
    };

    sendCapturedMessage(capturedMessage);

    return originalPostMessage(message, targetOrigin, transfer);
  };

  // Listen for incoming messages
  window.addEventListener('message', (event) => {
    const capturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      direction: 'receiving',
      self: getFrameMetadata(),
      targetOrigin: null,
      sourceOrigin: event.origin,
      data: event.data,
      dataPreview: createDataPreview(event.data),
      dataSize: calculateSize(event.data),
      messageType: extractMessageType(event.data)
    };

    sendCapturedMessage(capturedMessage);
  }, true);
})();
```

**Step 3: Update content.js (bridge between injected script and service worker)**

```javascript
// Content script - bridges injected.js to the service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

(function() {
  const EVENT_NAME = '__postmessage_devtools__';

  // Inject the script into the page's main world
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Listen for messages from the injected script
  window.addEventListener(EVENT_NAME, (event) => {
    try {
      chrome.runtime.sendMessage({
        type: 'postmessage-captured',
        payload: event.detail
      });
    } catch (e) {
      // Extension context may be invalidated, ignore
    }
  });

  // Inject immediately
  injectScript();
})();
```

**Step 4: Test manually**

1. Reload extension
2. Open a page with iframes (or create a test page)
3. Open DevTools console in the page
4. Run: `window.postMessage({ type: 'test', value: 123 }, '*')`
5. Check service worker console shows the message was received

**Step 5: Commit**

```bash
git add manifest.json injected.js content.js
git commit -m "feat: implement postMessage interception with page context injection"
```

---

## Task 3: Initialize DevTools Panel

**Files:**
- Modify: `devtools.js`

**Step 1: Implement devtools.js panel creation**

```javascript
// Create the PostMessage panel in DevTools
chrome.devtools.panels.create(
  'PostMessage',
  null, // No icon for now
  'panel.html',
  (panel) => {
    // Panel created successfully
  }
);
```

**Step 2: Test manually**

1. Reload extension
2. Open DevTools on any page
3. Verify "PostMessage" tab appears in DevTools

**Step 3: Commit**

```bash
git add devtools.js
git commit -m "feat: create DevTools panel"
```

---

## Task 4: Build Panel HTML Structure

**Files:**
- Modify: `panel.html`

**Step 1: Update panel.html with full structure**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PostMessage</title>
  <link rel="stylesheet" href="panel.css">
</head>
<body>
  <!-- Toolbar -->
  <div class="toolbar">
    <input type="text" id="filter-input" class="filter-input" placeholder="Filter (e.g., type:resize, origin:example.com)">
    <button id="clear-btn" class="toolbar-btn" title="Clear">Clear</button>
    <label class="preserve-log-label">
      <input type="checkbox" id="preserve-log-checkbox">
      Preserve log
    </label>
  </div>

  <!-- Main content area -->
  <div class="main-content">
    <!-- Message table (left pane) -->
    <div class="table-pane">
      <table id="message-table">
        <thead>
          <tr id="header-row"></tr>
        </thead>
        <tbody id="message-tbody"></tbody>
      </table>
    </div>

    <!-- Resize handle -->
    <div class="resize-handle" id="resize-handle"></div>

    <!-- Detail panel (right pane) -->
    <div class="detail-pane" id="detail-pane">
      <div class="detail-tabs">
        <button class="tab-btn active" data-tab="data">Data</button>
        <button class="tab-btn" data-tab="context">Context</button>
      </div>
      <div class="tab-content" id="tab-content">
        <div class="placeholder">Select a message to view details</div>
      </div>
    </div>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    <span id="message-count">0 messages</span>
  </div>

  <!-- Column selector context menu (hidden by default) -->
  <div class="column-menu" id="column-menu"></div>

  <!-- Cell context menu (hidden by default) -->
  <div class="cell-menu" id="cell-menu">
    <div class="menu-item" id="filter-by-value">Filter by this value</div>
  </div>

  <script src="panel.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add panel.html
git commit -m "feat: add panel HTML structure with toolbar, table, and detail pane"
```

---

## Task 5: Add Panel Base Styles

**Files:**
- Modify: `panel.css`

**Step 1: Implement panel.css with DevTools-like styling**

```css
/* DevTools-like styling for PostMessage panel */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  color: #303942;
  background: #fff;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #cacdd1;
  background: #f3f3f3;
  flex-shrink: 0;
}

.filter-input {
  flex: 1;
  max-width: 400px;
  padding: 4px 8px;
  border: 1px solid #cacdd1;
  border-radius: 2px;
  font-size: 12px;
  outline: none;
}

.filter-input:focus {
  border-color: #1a73e8;
}

.toolbar-btn {
  padding: 4px 12px;
  border: 1px solid #cacdd1;
  border-radius: 2px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.toolbar-btn:hover {
  background: #e8eaed;
}

.preserve-log-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

/* Main content */
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Table pane */
.table-pane {
  flex: 1;
  overflow: auto;
  min-width: 200px;
}

#message-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

#message-table th,
#message-table td {
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid #e8eaed;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#message-table th {
  background: #f3f3f3;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  position: sticky;
  top: 0;
  z-index: 1;
}

#message-table th:hover {
  background: #e8eaed;
}

#message-table tbody tr {
  cursor: pointer;
}

#message-table tbody tr:hover {
  background: #f5f5f5;
}

#message-table tbody tr.selected {
  background: #e3f2fd;
}

/* Direction arrows */
.dir-sending {
  color: #d93025;
}

.dir-receiving {
  color: #1e8e3e;
}

/* Resize handle */
.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: #cacdd1;
  flex-shrink: 0;
}

.resize-handle:hover {
  background: #1a73e8;
}

/* Detail pane */
.detail-pane {
  width: 40%;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #cacdd1;
  overflow: hidden;
}

.detail-pane.hidden {
  display: none;
}

.detail-tabs {
  display: flex;
  border-bottom: 1px solid #cacdd1;
  background: #f3f3f3;
  flex-shrink: 0;
}

.tab-btn {
  padding: 8px 16px;
  border: none;
  background: none;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab-btn:hover {
  background: #e8eaed;
}

.tab-btn.active {
  border-bottom-color: #1a73e8;
  color: #1a73e8;
}

.tab-content {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.placeholder {
  color: #80868b;
  font-style: italic;
  padding: 16px;
  text-align: center;
}

/* JSON tree */
.json-tree {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
}

.json-key {
  color: #881391;
}

.json-string {
  color: #c41a16;
}

.json-number {
  color: #1c00cf;
}

.json-boolean {
  color: #0d47a1;
}

.json-null {
  color: #808080;
}

.json-toggle {
  cursor: pointer;
  user-select: none;
}

.json-toggle::before {
  content: '▼';
  display: inline-block;
  width: 12px;
  font-size: 10px;
}

.json-toggle.collapsed::before {
  content: '▶';
}

.json-children {
  margin-left: 16px;
}

.json-children.hidden {
  display: none;
}

/* Context tab */
.context-table {
  width: 100%;
}

.context-table th {
  text-align: right;
  padding-right: 12px;
  color: #80868b;
  font-weight: normal;
  width: 120px;
  vertical-align: top;
}

.context-table td {
  word-break: break-all;
}

.context-table tr {
  line-height: 1.8;
}

/* Copy button */
.copy-btn {
  padding: 4px 8px;
  margin-bottom: 8px;
  border: 1px solid #cacdd1;
  border-radius: 2px;
  background: #fff;
  font-size: 11px;
  cursor: pointer;
}

.copy-btn:hover {
  background: #e8eaed;
}

/* Status bar */
.status-bar {
  padding: 4px 8px;
  border-top: 1px solid #cacdd1;
  background: #f3f3f3;
  font-size: 11px;
  color: #5f6368;
  flex-shrink: 0;
}

/* Context menus */
.column-menu,
.cell-menu {
  position: fixed;
  background: #fff;
  border: 1px solid #cacdd1;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  z-index: 1000;
  display: none;
  min-width: 150px;
}

.column-menu.visible,
.cell-menu.visible {
  display: block;
}

.menu-item {
  padding: 8px 12px;
  cursor: pointer;
}

.menu-item:hover {
  background: #f5f5f5;
}

.menu-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

/* Sort indicator */
.sort-asc::after {
  content: ' ▲';
  font-size: 10px;
}

.sort-desc::after {
  content: ' ▼';
  font-size: 10px;
}
```

**Step 2: Commit**

```bash
git add panel.css
git commit -m "feat: add DevTools-like panel styles"
```

---

## Task 6: Implement Panel Core Logic - Message Display

**Files:**
- Modify: `panel.js`

**Step 1: Implement panel.js with column definitions and message rendering**

```javascript
// Panel logic for displaying postMessage messages

// Column definitions
const ALL_COLUMNS = [
  { id: 'timestamp', label: 'Time', defaultVisible: true, width: 90 },
  { id: 'direction', label: 'Dir', defaultVisible: true, width: 40 },
  { id: 'selfUrl', label: 'Self URL', defaultVisible: false, width: 200 },
  { id: 'selfOrigin', label: 'Self Origin', defaultVisible: true, width: 150 },
  { id: 'selfTitle', label: 'Self Title', defaultVisible: false, width: 150 },
  { id: 'targetOrigin', label: 'Target Origin', defaultVisible: true, width: 120 },
  { id: 'sourceOrigin', label: 'Source Origin', defaultVisible: true, width: 120 },
  { id: 'messageType', label: 'Type', defaultVisible: true, width: 80 },
  { id: 'dataPreview', label: 'Data', defaultVisible: true, width: 200 },
  { id: 'dataSize', label: 'Size', defaultVisible: false, width: 60 }
];

// State
let messages = [];
let filteredMessages = [];
let selectedMessageId = null;
let visibleColumns = {};
let sortColumn = 'timestamp';
let sortDirection = 'asc';
let filterText = '';
let preserveLog = false;
let activeTab = 'data';

// DOM elements
const headerRow = document.getElementById('header-row');
const messageTbody = document.getElementById('message-tbody');
const messageCount = document.getElementById('message-count');
const filterInput = document.getElementById('filter-input');
const clearBtn = document.getElementById('clear-btn');
const preserveLogCheckbox = document.getElementById('preserve-log-checkbox');
const detailPane = document.getElementById('detail-pane');
const tabContent = document.getElementById('tab-content');
const columnMenu = document.getElementById('column-menu');
const cellMenu = document.getElementById('cell-menu');
const filterByValue = document.getElementById('filter-by-value');
const resizeHandle = document.getElementById('resize-handle');

// Initialize visible columns from defaults or storage
function initColumns() {
  ALL_COLUMNS.forEach(col => {
    visibleColumns[col.id] = col.defaultVisible;
  });

  // Load from storage
  chrome.storage.local.get(['visibleColumns'], (result) => {
    if (result.visibleColumns) {
      visibleColumns = { ...visibleColumns, ...result.visibleColumns };
    }
    renderHeader();
    renderMessages();
  });
}

// Save column preferences
function saveColumnPrefs() {
  chrome.storage.local.set({ visibleColumns });
}

// Format timestamp
function formatTimestamp(ts) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// Format size
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Get cell value for a message and column
function getCellValue(msg, colId) {
  switch (colId) {
    case 'timestamp': return formatTimestamp(msg.timestamp);
    case 'direction': return msg.direction === 'sending' ? '→' : '←';
    case 'selfUrl': return msg.self.url;
    case 'selfOrigin': return msg.self.origin;
    case 'selfTitle': return msg.self.documentTitle || '';
    case 'targetOrigin': return msg.targetOrigin || '';
    case 'sourceOrigin': return msg.sourceOrigin || '';
    case 'messageType': return msg.messageType || '';
    case 'dataPreview': return msg.dataPreview;
    case 'dataSize': return formatSize(msg.dataSize);
    default: return '';
  }
}

// Render table header
function renderHeader() {
  headerRow.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    if (!visibleColumns[col.id]) return;

    const th = document.createElement('th');
    th.textContent = col.label;
    th.dataset.column = col.id;
    th.style.width = col.width + 'px';

    if (sortColumn === col.id) {
      th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    th.addEventListener('click', () => handleSort(col.id));
    th.addEventListener('contextmenu', (e) => showColumnMenu(e));

    headerRow.appendChild(th);
  });
}

// Render messages
function renderMessages() {
  messageTbody.innerHTML = '';

  filteredMessages.forEach(msg => {
    const tr = document.createElement('tr');
    tr.dataset.id = msg.id;

    if (msg.id === selectedMessageId) {
      tr.classList.add('selected');
    }

    ALL_COLUMNS.forEach(col => {
      if (!visibleColumns[col.id]) return;

      const td = document.createElement('td');
      td.textContent = getCellValue(msg, col.id);
      td.dataset.column = col.id;

      if (col.id === 'direction') {
        td.classList.add(msg.direction === 'sending' ? 'dir-sending' : 'dir-receiving');
      }

      td.addEventListener('contextmenu', (e) => showCellMenu(e, msg, col.id));

      tr.appendChild(td);
    });

    tr.addEventListener('click', () => selectMessage(msg.id));
    messageTbody.appendChild(tr);
  });

  updateMessageCount();
}

// Update message count in status bar
function updateMessageCount() {
  const total = messages.length;
  const filtered = filteredMessages.length;

  if (filterText && filtered !== total) {
    messageCount.textContent = `${filtered} / ${total} messages`;
  } else {
    messageCount.textContent = `${total} messages`;
  }
}

// Handle sort
function handleSort(colId) {
  if (sortColumn === colId) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = colId;
    sortDirection = 'asc';
  }

  applyFilterAndSort();
  renderHeader();
  renderMessages();
}

// Apply filter and sort to messages
function applyFilterAndSort() {
  // Filter
  filteredMessages = messages.filter(msg => matchesFilter(msg, filterText));

  // Sort
  filteredMessages.sort((a, b) => {
    let aVal = getSortValue(a, sortColumn);
    let bVal = getSortValue(b, sortColumn);

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

// Get sortable value
function getSortValue(msg, colId) {
  switch (colId) {
    case 'timestamp': return msg.timestamp;
    case 'dataSize': return msg.dataSize;
    default: return getCellValue(msg, colId).toLowerCase();
  }
}

// Check if message matches filter
function matchesFilter(msg, filter) {
  if (!filter) return true;

  const terms = filter.toLowerCase().split(/\s+/).filter(t => t);

  return terms.every(term => {
    // Check for field:value syntax
    const colonIdx = term.indexOf(':');
    if (colonIdx > 0) {
      const field = term.substring(0, colonIdx);
      const value = term.substring(colonIdx + 1);

      switch (field) {
        case 'type':
          return (msg.messageType || '').toLowerCase() === value;
        case 'origin':
          return msg.self.origin.toLowerCase().includes(value);
        case 'target':
          return (msg.targetOrigin || '').toLowerCase().includes(value);
        case 'source':
          return (msg.sourceOrigin || '').toLowerCase().includes(value);
        case 'dir':
          return msg.direction === value;
        default:
          return false;
      }
    }

    // General text search in data preview
    return msg.dataPreview.toLowerCase().includes(term);
  });
}

// Select a message
function selectMessage(id) {
  selectedMessageId = id;

  // Update row selection
  messageTbody.querySelectorAll('tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === id);
  });

  // Show detail pane
  const msg = messages.find(m => m.id === id);
  if (msg) {
    detailPane.classList.remove('hidden');
    renderDetailPane(msg);
  }
}

// Render detail pane
function renderDetailPane(msg) {
  if (activeTab === 'data') {
    renderDataTab(msg);
  } else {
    renderContextTab(msg);
  }
}

// Render Data tab
function renderDataTab(msg) {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(msg.data, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy JSON', 1500);
  };

  const tree = document.createElement('div');
  tree.className = 'json-tree';
  tree.appendChild(renderJsonValue(msg.data));

  tabContent.innerHTML = '';
  tabContent.appendChild(copyBtn);
  tabContent.appendChild(tree);
}

// Render JSON value recursively
function renderJsonValue(value, key = null) {
  const container = document.createElement('div');

  if (value === null) {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-null">null</span>`
      : '<span class="json-null">null</span>';
  } else if (typeof value === 'boolean') {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-boolean">${value}</span>`
      : `<span class="json-boolean">${value}</span>`;
  } else if (typeof value === 'number') {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-number">${value}</span>`
      : `<span class="json-number">${value}</span>`;
  } else if (typeof value === 'string') {
    const escaped = value.replace(/"/g, '\\"');
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-string">"${escaped}"</span>`
      : `<span class="json-string">"${escaped}"</span>`;
  } else if (Array.isArray(value)) {
    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';
    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}Array(${value.length})`;
    container.appendChild(toggle);

    const children = document.createElement('div');
    children.className = 'json-children';
    value.forEach((item, i) => {
      children.appendChild(renderJsonValue(item, i));
    });
    container.appendChild(children);
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';
    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}{...}`;
    container.appendChild(toggle);

    const children = document.createElement('div');
    children.className = 'json-children';
    keys.forEach(k => {
      children.appendChild(renderJsonValue(value[k], k));
    });
    container.appendChild(children);
  } else {
    container.textContent = String(value);
  }

  return container;
}

// Render Context tab
function renderContextTab(msg) {
  const rows = [
    ['Direction', msg.direction === 'sending' ? 'Sending →' : 'Receiving ←'],
    ['Timestamp', new Date(msg.timestamp).toISOString()],
    ['Self URL', msg.self.url],
    ['Self Origin', msg.self.origin],
    ['Self Title', msg.self.documentTitle || '(none)'],
  ];

  if (msg.direction === 'sending') {
    rows.push(['Target Origin', msg.targetOrigin]);
  } else {
    rows.push(['Source Origin', msg.sourceOrigin]);
  }

  rows.push(['Size', formatSize(msg.dataSize)]);

  const table = document.createElement('table');
  table.className = 'context-table';

  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${label}</th><td>${value}</td>`;
    table.appendChild(tr);
  });

  tabContent.innerHTML = '';
  tabContent.appendChild(table);
}

// Show column menu
function showColumnMenu(e) {
  e.preventDefault();

  columnMenu.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `
      <label>
        <input type="checkbox" ${visibleColumns[col.id] ? 'checked' : ''}>
        ${col.label}
      </label>
    `;

    item.querySelector('input').addEventListener('change', (e) => {
      visibleColumns[col.id] = e.target.checked;
      saveColumnPrefs();
      renderHeader();
      renderMessages();
    });

    columnMenu.appendChild(item);
  });

  columnMenu.style.left = e.clientX + 'px';
  columnMenu.style.top = e.clientY + 'px';
  columnMenu.classList.add('visible');
}

// Show cell menu
let cellMenuContext = null;

function showCellMenu(e, msg, colId) {
  e.preventDefault();

  cellMenuContext = { msg, colId };

  cellMenu.style.left = e.clientX + 'px';
  cellMenu.style.top = e.clientY + 'px';
  cellMenu.classList.add('visible');
}

// Hide menus on click outside
document.addEventListener('click', () => {
  columnMenu.classList.remove('visible');
  cellMenu.classList.remove('visible');
});

// Filter by value
filterByValue.addEventListener('click', () => {
  if (!cellMenuContext) return;

  const { msg, colId } = cellMenuContext;
  let filterStr = '';

  switch (colId) {
    case 'messageType':
      filterStr = `type:${msg.messageType || ''}`;
      break;
    case 'selfOrigin':
      filterStr = `origin:${msg.self.origin}`;
      break;
    case 'targetOrigin':
      filterStr = `target:${msg.targetOrigin || ''}`;
      break;
    case 'sourceOrigin':
      filterStr = `source:${msg.sourceOrigin || ''}`;
      break;
    case 'direction':
      filterStr = `dir:${msg.direction}`;
      break;
    default:
      filterStr = getCellValue(msg, colId);
  }

  filterInput.value = filterStr;
  filterText = filterStr;
  applyFilterAndSort();
  renderMessages();
});

// Add a new message
function addMessage(msg) {
  messages.push(msg);
  applyFilterAndSort();
  renderMessages();
}

// Clear all messages
function clearMessages() {
  messages = [];
  filteredMessages = [];
  selectedMessageId = null;
  detailPane.classList.add('hidden');
  renderMessages();
}

// Event listeners
filterInput.addEventListener('input', (e) => {
  filterText = e.target.value;
  applyFilterAndSort();
  renderMessages();
});

clearBtn.addEventListener('click', clearMessages);

preserveLogCheckbox.addEventListener('change', (e) => {
  preserveLog = e.target.checked;
  // Notify background script
  if (port) {
    port.postMessage({ type: 'preserveLog', tabId, value: preserveLog });
  }
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;

    const msg = messages.find(m => m.id === selectedMessageId);
    if (msg) {
      renderDetailPane(msg);
    }
  });
});

// Resize handle
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const containerWidth = document.querySelector('.main-content').offsetWidth;
  const newDetailWidth = containerWidth - e.clientX;
  const pct = Math.max(20, Math.min(70, (newDetailWidth / containerWidth) * 100));

  detailPane.style.width = pct + '%';
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  document.body.style.cursor = '';
});

// Connect to background script
let port = null;
let tabId = null;

function connect() {
  // Get the tab ID we're inspecting
  tabId = chrome.devtools.inspectedWindow.tabId;

  port = chrome.runtime.connect({ name: 'postmessage-panel' });

  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'message') {
      addMessage(msg.payload);
    } else if (msg.type === 'clear') {
      clearMessages();
    }
  });

  port.onDisconnect.addListener(() => {
    // Try to reconnect after a delay
    setTimeout(connect, 1000);
  });
}

// Initialize
initColumns();
detailPane.classList.add('hidden');
connect();
```

**Step 2: Test manually**

1. Reload extension
2. Open DevTools on any page with iframes (or use a test page)
3. Navigate to PostMessage tab
4. Run in console: `window.postMessage({ type: 'test', value: 123 }, '*')`
5. Verify message appears in table
6. Click message to see detail pane
7. Test filter bar with `type:test`
8. Right-click column header to toggle columns
9. Right-click cell to filter by value

**Step 3: Commit**

```bash
git add panel.js
git commit -m "feat: implement panel message display, filtering, and detail view"
```

---

## Task 7: Create Test Page

**Files:**
- Create: `test/test-page.html`
- Create: `test/iframe.html`

**Step 1: Create test page directory and files**

```bash
mkdir -p test
```

**Step 2: Create test/test-page.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PostMessage Test Page</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    iframe { border: 1px solid #ccc; margin: 10px 0; }
    button { margin: 5px; padding: 8px 16px; }
    .controls { margin: 20px 0; }
  </style>
</head>
<body>
  <h1>PostMessage DevTools Test Page</h1>

  <div class="controls">
    <h3>Send from Main Page</h3>
    <button onclick="sendToIframe('resize')">Send resize</button>
    <button onclick="sendToIframe('init')">Send init</button>
    <button onclick="sendToIframe('custom')">Send custom</button>
    <button onclick="broadcast()">Broadcast to all</button>
  </div>

  <h3>Iframe 1</h3>
  <iframe id="iframe1" src="iframe.html" width="400" height="100"></iframe>

  <h3>Iframe 2</h3>
  <iframe id="iframe2" src="iframe.html" width="400" height="100"></iframe>

  <script>
    function sendToIframe(type) {
      const iframe = document.getElementById('iframe1');
      iframe.contentWindow.postMessage({ type, value: Math.random(), from: 'main' }, '*');
    }

    function broadcast() {
      window.postMessage({ type: 'broadcast', from: 'main' }, '*');
    }

    window.addEventListener('message', (e) => {
      console.log('Main received:', e.data);
    });
  </script>
</body>
</html>
```

**Step 3: Create test/iframe.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test Iframe</title>
  <style>
    body { font-family: sans-serif; padding: 10px; margin: 0; background: #f5f5f5; }
    button { margin: 5px; padding: 4px 8px; }
  </style>
</head>
<body>
  <strong>Iframe</strong>
  <button onclick="sendToParent('ready')">Send ready</button>
  <button onclick="sendToParent('ack')">Send ack</button>

  <script>
    function sendToParent(type) {
      parent.postMessage({ type, from: 'iframe', timestamp: Date.now() }, '*');
    }

    window.addEventListener('message', (e) => {
      console.log('Iframe received:', e.data);
      // Auto-respond with ack
      if (e.data.type && e.data.type !== 'ack') {
        setTimeout(() => sendToParent('ack'), 100);
      }
    });

    // Send ready on load
    sendToParent('ready');
  </script>
</body>
</html>
```

**Step 4: Commit**

```bash
git add test/
git commit -m "feat: add test page with iframes for manual testing"
```

---

## Task 8: Final Testing and Polish

**Step 1: Full manual test checklist**

1. Load extension at `chrome://extensions/`
2. Open `test/test-page.html` in browser (use a local server: `python -m http.server 8000`)
3. Open DevTools and navigate to PostMessage tab
4. Verify:
   - [ ] Messages appear when buttons are clicked
   - [ ] Both sending (→) and receiving (←) show
   - [ ] Clicking a row shows detail pane
   - [ ] Data tab shows expandable JSON
   - [ ] Context tab shows metadata
   - [ ] Filter bar works (`type:ready`, `dir:sending`)
   - [ ] Right-click column header shows column picker
   - [ ] Right-click cell adds filter
   - [ ] Clear button works
   - [ ] Preserve log toggle works (navigate away and back)
   - [ ] Resize handle works
   - [ ] Sorting works (click column headers)

**Step 2: Fix any issues found**

**Step 3: Update README**

Update `README.md` to reflect completed status.

**Step 4: Final commit**

```bash
git add -A
git commit -m "docs: update README with completed status"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Update manifest and create service worker |
| 2 | Implement content script message interception |
| 3 | Initialize DevTools panel |
| 4 | Build panel HTML structure |
| 5 | Add panel CSS styles |
| 6 | Implement panel core logic |
| 7 | Create test page |
| 8 | Final testing and polish |

**Estimated commits:** 8
