# Source URL Phase 0: Refactor and Add Source Info

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor message capture to use parallel `target` and `source` objects, and include iframe element properties for child sources.

**Architecture:** Rename `getFrameMetadata` to `getTargetInfo`. Create `getSourceInfo(event)` that returns a `source` object with type, origin, and for child iframes: iframe element properties (src, id, DOM path). Update panel to display source properties in Context tab and as table columns.

**Tech Stack:** Vanilla JavaScript

**Scope:** No load events or mutation observers. Just restructuring and adding static iframe properties.

**Message structure after this phase:**
```javascript
{
  target: { url, origin, documentTitle },
  source: { type, origin, iframeSrc, iframeId, iframeDomPath },
  // ... other fields
}
```

---

## Task 1: Rename getFrameMetadata to getTargetInfo

**Files:**
- Modify: `injected.js`

**Step 1: Rename the function**

In `injected.js`, rename `getFrameMetadata` to `getTargetInfo`:

```javascript
// Collect target frame info (the frame receiving the message)
function getTargetInfo() {
  return {
    url: window.location.href,
    origin: window.location.origin,
    documentTitle: document.title || ''
  };
}
```

**Step 2: Update the call site**

In the message listener, change `target: getFrameMetadata()` to `target: getTargetInfo()`:

```javascript
const capturedMessage = {
  id: generateId(),
  timestamp: Date.now(),
  target: getTargetInfo(),
  // ... rest unchanged for now
};
```

**Step 3: Test manually**

1. Reload extension
2. Open test page, trigger some messages
3. Verify messages still appear in panel with correct target info

**Step 4: Commit**

```bash
git add injected.js
git commit -m "refactor: rename getFrameMetadata to getTargetInfo"
```

---

## Task 2: Add getDomPath Helper

**Files:**
- Modify: `injected.js`

**Step 1: Add getDomPath function**

Add a helper function to generate a CSS selector path for an element:

```javascript
// Generate a CSS selector path for an element
function getDomPath(element) {
  const parts = [];
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    if (element.id) {
      selector += '#' + element.id;
      parts.unshift(selector);
      break; // id is unique, stop here
    }
    // Position among same-type siblings
    let sibling = element;
    let nth = 1;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.nodeName === element.nodeName) nth++;
    }
    if (nth > 1) selector += ':nth-of-type(' + nth + ')';
    parts.unshift(selector);
    element = element.parentElement;
  }
  return parts.join(' > ');
}
```

**Step 2: Commit**

```bash
git add injected.js
git commit -m "feat: add getDomPath helper for iframe identification"
```

---

## Task 3: Create getSourceInfo Function

**Files:**
- Modify: `injected.js`

**Step 1: Add getSourceInfo function**

Add a function that gathers all source information from the message event, returning a `source` object:

```javascript
// Collect source info from a message event
function getSourceInfo(event) {
  const sourceType = getSourceRelationship(event.source);

  const source = {
    type: sourceType,
    origin: event.origin,
    iframeSrc: null,
    iframeId: null,
    iframeDomPath: null
  };

  // For child frames, find the iframe element and include its properties
  if (sourceType === 'child') {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.contentWindow === event.source) {
        source.iframeSrc = iframe.src || null;
        source.iframeId = iframe.id || null;
        source.iframeDomPath = getDomPath(iframe);
        break;
      }
    }
  }

  return source;
}
```

**Step 2: Commit**

```bash
git add injected.js
git commit -m "feat: add getSourceInfo to collect source details as object"
```

---

## Task 4: Update Message Listener to Use Source Object

**Files:**
- Modify: `injected.js`

**Step 1: Refactor the message listener**

Update the message event listener to use the new `source` object structure. Remove the old `sourceOrigin` and `sourceType` top-level properties:

```javascript
// Listen for incoming messages
window.addEventListener('message', (event) => {
  const capturedMessage = {
    id: generateId(),
    timestamp: Date.now(),
    target: getTargetInfo(),
    source: getSourceInfo(event),
    data: event.data,
    dataPreview: createDataPreview(event.data),
    dataSize: calculateSize(event.data),
    messageType: extractMessageType(event.data)
  };

  sendCapturedMessage(capturedMessage);
}, true);
```

**Step 2: Test manually**

1. Reload extension
2. Open test page, trigger messages
3. Panel will be broken at this point (expected - we'll fix in next tasks)

**Step 3: Commit**

```bash
git add injected.js
git commit -m "refactor: use source object in message structure"
```

---

## Task 5: Update Panel to Read from Source Object

**Files:**
- Modify: `panel.js`

**Step 1: Update getCellValue to read from source object**

In `getCellValue`, update the cases that read source properties:

```javascript
case 'sourceOrigin': return msg.source?.origin || '';
case 'sourceType': return msg.source?.type || '';
```

**Step 2: Update getDirectionIcon call**

In `renderMessages`, the direction cell uses `msg.sourceType`. Update to use `msg.source?.type`:

```javascript
if (col.id === 'direction') {
  td.classList.add(`dir-${msg.source?.type || 'unknown'}`);
}
```

**Step 3: Update matchesTerm for filters**

In `matchesTerm`, update the filter cases:

```javascript
case 'sourcetype':
  return (msg.source?.type || 'unknown') === value;
case 'source':
  return (msg.source?.origin || '').toLowerCase().includes(value);
```

**Step 4: Update filterByValue context menu**

In the `filterByValue` click handler, update source-related cases:

```javascript
case 'sourceOrigin':
  filterStr = `source:${msg.source?.origin || ''}`;
  break;
case 'direction':
case 'sourceType':
  filterStr = `sourceType:${msg.source?.type || 'unknown'}`;
  break;
```

**Step 5: Test manually**

1. Reload extension
2. Open test page, trigger messages
3. Verify table displays correctly with source type and origin
4. Test filters: `sourceType:child`, `source:localhost`

**Step 6: Commit**

```bash
git add panel.js
git commit -m "refactor: update panel to read from source object"
```

---

## Task 6: Add Source Iframe Columns

**Files:**
- Modify: `panel.js`

**Step 1: Add column definitions**

In `ALL_COLUMNS`, add new columns for iframe properties (after sourceType):

```javascript
{ id: 'sourceIframeSrc', label: 'Source iframe src', defaultVisible: false, width: 200 },
{ id: 'sourceIframeId', label: 'Source iframe id', defaultVisible: false, width: 100 },
{ id: 'sourceIframeDomPath', label: 'Source iframe path', defaultVisible: false, width: 200 },
```

**Step 2: Add getCellValue cases**

In `getCellValue`, add cases for the new columns:

```javascript
case 'sourceIframeSrc': return msg.source?.iframeSrc || '';
case 'sourceIframeId': return msg.source?.iframeId || '';
case 'sourceIframeDomPath': return msg.source?.iframeDomPath || '';
```

**Step 3: Test manually**

1. Reload extension
2. Open test page with iframes
3. Right-click column header, enable new iframe columns
4. Trigger messages from child iframes
5. Verify iframe properties appear in columns

**Step 4: Commit**

```bash
git add panel.js
git commit -m "feat: add source iframe columns (src, id, path)"
```

---

## Task 7: Update Context Tab for Source Object

**Files:**
- Modify: `panel.js`

**Step 1: Rewrite renderContextTab**

Update `renderContextTab` to use the new source object structure and include iframe properties:

```javascript
// Render Context tab
function renderContextTab(msg) {
  const sourceType = msg.source?.type || 'unknown';

  const rows = [
    ['Timestamp', new Date(msg.timestamp).toISOString()],
    ['Size', formatSize(msg.dataSize)],
    ['', ''], // Separator
    ['Target URL', msg.target.url],
    ['Target Origin', msg.target.origin],
    ['Target Title', msg.target.documentTitle || '(none)'],
    ['', ''], // Separator
    ['Source Type', `${getDirectionIcon(sourceType)} ${sourceType}`],
    ['Source Origin', msg.source?.origin || '(unknown)'],
  ];

  // Add iframe-specific rows for child sources
  if (sourceType === 'child') {
    if (msg.source?.iframeSrc) {
      rows.push(['Source iframe src', msg.source.iframeSrc]);
    }
    if (msg.source?.iframeId) {
      rows.push(['Source iframe id', msg.source.iframeId]);
    }
    if (msg.source?.iframeDomPath) {
      rows.push(['Source iframe path', msg.source.iframeDomPath]);
    }
  }

  const table = document.createElement('table');
  table.className = 'context-table';

  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    if (label === '' && value === '') {
      // Separator row
      tr.innerHTML = '<td colspan="2" class="context-separator"></td>';
    } else {
      tr.innerHTML = `<th>${label}</th><td>${value}</td>`;
    }
    table.appendChild(tr);
  });

  tabContent.innerHTML = '';
  tabContent.appendChild(table);
}
```

**Step 2: Add CSS for separator (optional)**

If needed, add a style for the separator in `panel.css`:

```css
.context-separator {
  height: 8px;
  border: none;
}
```

**Step 3: Test manually**

1. Reload extension
2. Open test page with iframes (some with id attributes)
3. Trigger messages from child iframes
4. Click messages, verify Context tab shows:
   - Target section (URL, origin, title)
   - Source section (type, origin)
   - Iframe properties (src, id, path) for child sources

**Step 4: Commit**

```bash
git add panel.js panel.css
git commit -m "feat: reorganize Context tab with source object and iframe properties"
```

---

## Summary

After completing Phase 0, the extension will have:

**New message structure:**
```javascript
{
  id: "...",
  timestamp: 1234567890,
  target: {
    url: "https://parent.example.com/page",
    origin: "https://parent.example.com",
    documentTitle: "Parent Page"
  },
  source: {
    type: "child",
    origin: "https://child.example.com",
    iframeSrc: "https://child.example.com/embed",
    iframeId: "embed-frame",
    iframeDomPath: "body > div#app > iframe"
  },
  data: { ... },
  dataPreview: "...",
  dataSize: 123,
  messageType: "..."
}
```

**Panel features:**
- New columns: Source iframe src, Source iframe id, Source iframe path (hidden by default)
- Context tab shows organized target and source sections
- Iframe properties displayed for child sources

**Foundation for Phase 1:** The `source.iframeSrc` will become `source.url` (with tracking for changes).
