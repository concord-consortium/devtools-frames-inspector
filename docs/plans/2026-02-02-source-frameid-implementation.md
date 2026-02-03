# Source FrameId Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable identification of source frameId for messages from child iframes and openers via registration messages.

**Architecture:** Child frames send registration messages to parent/opener containing their frameId and tabId. The receiving frame's injected.js assigns a windowId to each source window and includes it with every message. The panel correlates registration messages with other messages by windowId.

**Tech Stack:** Vanilla JavaScript, Chrome Extension APIs (Manifest V3)

**Design doc:** [2026-02-02-source-frameid-design.md](2026-02-02-source-frameid-design.md)

---

### Task 1: Add settings UI for frame registration

**Files:**
- Modify: `panel.html:121-130` (settings view)
- Modify: `panel.js:40-43` (settings state)
- Modify: `panel.js:1068-1081` (initSettings, saveSettings)
- Modify: `panel.css` (add disabled checkbox styling)

**Step 1: Add settings HTML**

In `panel.html`, replace the settings-content div (lines 123-129):

```html
<div class="settings-content">
  <h3>Settings</h3>
  <label class="settings-item">
    <input type="checkbox" id="show-extra-info-checkbox">
    Show extra message info (message ID and buffered status)
  </label>
  <label class="settings-item">
    <input type="checkbox" id="enable-frame-registration-checkbox" checked>
    Enable frame registration (identifies source frame for child/opener messages)
  </label>
  <label class="settings-item nested">
    <input type="checkbox" id="show-registration-messages-checkbox">
    Show registration messages in table
  </label>
</div>
```

**Step 2: Add CSS for nested/disabled settings**

Add to `panel.css`:

```css
.settings-item.nested {
  margin-left: 24px;
}

.settings-item.nested input:disabled + span,
.settings-item.nested:has(input:disabled) {
  opacity: 0.5;
}
```

**Step 3: Update settings state in panel.js**

Update the settings object (around line 41):

```javascript
let settings = {
  showExtraMessageInfo: false,
  enableFrameRegistration: true,
  showRegistrationMessages: false
};
```

**Step 4: Add DOM references and event handlers**

After line 78 (showExtraInfoCheckbox), add:

```javascript
const enableFrameRegistrationCheckbox = document.getElementById('enable-frame-registration-checkbox');
const showRegistrationMessagesCheckbox = document.getElementById('show-registration-messages-checkbox');
```

After the showExtraInfoCheckbox change handler (around line 1094), add:

```javascript
enableFrameRegistrationCheckbox.addEventListener('change', (e) => {
  settings.enableFrameRegistration = e.target.checked;
  showRegistrationMessagesCheckbox.disabled = !e.target.checked;
  saveSettings();
  // Notify background of setting change
  chrome.storage.local.set({ enableFrameRegistration: e.target.checked });
});

showRegistrationMessagesCheckbox.addEventListener('change', (e) => {
  settings.showRegistrationMessages = e.target.checked;
  saveSettings();
  applyFilterAndSort();
  renderMessages();
});
```

**Step 5: Update initSettings to load new settings**

Update initSettings function:

```javascript
function initSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
    showExtraInfoCheckbox.checked = settings.showExtraMessageInfo;
    enableFrameRegistrationCheckbox.checked = settings.enableFrameRegistration;
    showRegistrationMessagesCheckbox.checked = settings.showRegistrationMessages;
    showRegistrationMessagesCheckbox.disabled = !settings.enableFrameRegistration;
  });
}
```

**Step 6: Commit**

```bash
git add panel.html panel.js panel.css
git commit -m "add settings UI for frame registration"
```

---

### Task 2: Add windowId tracking to injected.js

**Files:**
- Modify: `injected.js`

**Step 1: Add WeakMap for source windows**

After the EVENT_NAME constant (line 9), add:

```javascript
const sourceWindows = new WeakMap(); // Window -> {windowId}
```

**Step 2: Add function to get or create windowId**

After the generateId function (around line 52), add:

```javascript
// Get or create a stable windowId for a source window
function getWindowId(sourceWindow) {
  if (!sourceWindow) return null;

  let entry = sourceWindows.get(sourceWindow);
  if (!entry) {
    entry = { windowId: generateId() };
    sourceWindows.set(sourceWindow, entry);
  }
  return entry.windowId;
}
```

**Step 3: Update getSourceInfo to include windowId**

Update getSourceInfo function to add windowId:

```javascript
function getSourceInfo(event) {
  const sourceType = getSourceRelationship(event.source);

  const source = {
    type: sourceType,
    origin: event.origin,
    windowId: getWindowId(event.source),
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

**Step 4: Add stopImmediatePropagation for registration messages**

Update the message listener to stop propagation for registration messages:

```javascript
// Listen for incoming messages
window.addEventListener('message', (event) => {
  // Stop propagation of registration messages to prevent app from seeing them
  if (event.data?.type === '__frames_inspector_register__') {
    event.stopImmediatePropagation();
  }

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

**Step 5: Commit**

```bash
git add injected.js
git commit -m "add windowId tracking to injected.js"
```

---

### Task 3: Add registration message sending to content.js

**Files:**
- Modify: `content.js`

**Step 1: Add state for frame info**

After the EVENT_NAME constant (line 9), add:

```javascript
let frameInfo = null; // {frameId, tabId} received from background
```

**Step 2: Add registration message sender**

After the injectScript function (around line 19), add:

```javascript
// Send registration messages to parent and opener
function sendRegistrationMessages() {
  if (!frameInfo) return;

  const registrationData = {
    type: '__frames_inspector_register__',
    frameId: frameInfo.frameId,
    tabId: frameInfo.tabId
  };

  // Send to parent if we're in an iframe
  if (window.parent !== window) {
    window.parent.postMessage(registrationData, '*');
  }

  // Send to opener if we were opened by another window
  if (window.opener) {
    window.opener.postMessage(registrationData, '*');
  }
}
```

**Step 3: Add listener for frame-info from background**

Add after the sendRegistrationMessages function:

```javascript
// Listen for frame info from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'frame-info') {
    frameInfo = {
      frameId: message.frameId,
      tabId: message.tabId
    };
    // Wait 500ms before sending registration to ensure parent is ready
    setTimeout(sendRegistrationMessages, 500);
  }

  if (message.type === 'get-frame-info') {
    // ... existing get-frame-info handler stays here
  }
  return true;
});
```

Note: The existing `get-frame-info` handler needs to stay but be part of the same listener. Restructure the listener to handle both message types.

**Step 4: Commit**

```bash
git add content.js
git commit -m "add registration message sending to content.js"
```

---

### Task 4: Update background.js to send frame-info

**Files:**
- Modify: `background.js`

**Step 1: Add function to send frame info**

After the injectContentScript function (around line 55), add:

```javascript
// Send frame info to content script for registration (if enabled)
async function sendFrameInfo(tabId, frameId) {
  try {
    const result = await chrome.storage.local.get(['enableFrameRegistration']);
    // Default to true if not set
    const enabled = result.enableFrameRegistration !== false;

    if (enabled) {
      await chrome.tabs.sendMessage(tabId, {
        type: 'frame-info',
        frameId: frameId,
        tabId: tabId
      }, { frameId: frameId });
    }
  } catch (e) {
    // Content script may not be ready yet, ignore
  }
}
```

**Step 2: Call sendFrameInfo after injection**

Update the injectContentScript function to call sendFrameInfo after successful injection:

```javascript
async function injectContentScript(tabId, frameId = null) {
  try {
    const target = { tabId };
    if (frameId !== null) {
      target.frameIds = [frameId];
    } else {
      target.allFrames = true;
    }

    // Track injected frames
    if (!injectedFrames.has(tabId)) {
      injectedFrames.set(tabId, new Set());
    }

    // Check if already injected (for specific frame injection)
    if (frameId !== null && injectedFrames.get(tabId).has(frameId)) {
      return;
    }

    await chrome.scripting.executeScript({
      target,
      files: ['content.js'],
      injectImmediately: true
    });

    // Mark as injected and send frame info
    if (frameId !== null) {
      injectedFrames.get(tabId).add(frameId);
      sendFrameInfo(tabId, frameId);
    } else {
      // For allFrames injection, get all frames and send info to each
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames) {
        for (const frame of frames) {
          injectedFrames.get(tabId).add(frame.frameId);
          sendFrameInfo(tabId, frame.frameId);
        }
      }
    }
  } catch (e) {
    // Injection can fail for chrome:// pages, etc.
  }
}
```

**Step 3: Commit**

```bash
git add background.js
git commit -m "send frame-info to content scripts after injection"
```

---

### Task 5: Add windowFrameMap and registration handling to panel.js

**Files:**
- Modify: `panel.js`

**Step 1: Add windowFrameMap state**

After the settings state (around line 43), add:

```javascript
// Map windowId -> {frameId, tabId} from registration messages
const windowFrameMap = new Map();
```

**Step 2: Add helper to check if message is registration**

After the formatSize function (around line 116), add:

```javascript
// Check if a message is a registration message
function isRegistrationMessage(msg) {
  return msg.data?.type === '__frames_inspector_register__';
}
```

**Step 3: Update applyFilterAndSort to filter registration messages**

Update the applyFilterAndSort function to filter out registration messages when setting is off:

```javascript
function applyFilterAndSort() {
  // Filter
  filteredMessages = messages.filter(msg => {
    // Filter out registration messages if setting is disabled
    if (isRegistrationMessage(msg) && !settings.showRegistrationMessages) {
      return false;
    }
    return matchesFilter(msg, filterText);
  });

  // Sort
  filteredMessages.sort((a, b) => {
    let aVal = getSortValue(a, sortColumn);
    let bVal = getSortValue(b, sortColumn);

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}
```

**Step 4: Update addMessage to process registration messages**

Update the addMessage function to extract registration data:

```javascript
function addMessage(msg) {
  if (!isRecording) return;

  // Process registration messages to build windowFrameMap
  if (isRegistrationMessage(msg) && msg.source?.windowId) {
    windowFrameMap.set(msg.source.windowId, {
      frameId: msg.data.frameId,
      tabId: msg.data.tabId
    });
  }

  messages.push(msg);
  applyFilterAndSort();
  renderMessages();
}
```

**Step 5: Update renderContextTab to show sourceFrameId from windowFrameMap**

In renderContextTab, update the source frame ID section (around line 511-514):

```javascript
// Add source frame ID if available (from message or windowFrameMap lookup)
let sourceFrameId = msg.source?.frameId;
if (sourceFrameId === undefined && msg.source?.windowId) {
  const registration = windowFrameMap.get(msg.source.windowId);
  if (registration) {
    sourceFrameId = registration.frameId;
  }
}
if (sourceFrameId !== undefined) {
  rows.push(['sourceFrame', `frame[${sourceFrameId}]`]);
}
```

**Step 6: Update getCellValue for sourceFrameId column to use windowFrameMap**

Update the sourceFrameId case in getCellValue:

```javascript
case 'sourceFrameId': {
  let frameId = msg.source?.frameId;
  if (frameId === undefined && msg.source?.windowId) {
    const registration = windowFrameMap.get(msg.source.windowId);
    if (registration) {
      frameId = registration.frameId;
    }
  }
  return frameId !== undefined ? `frame[${frameId}]` : '';
}
```

**Step 7: Commit**

```bash
git add panel.js
git commit -m "add windowFrameMap and registration message handling"
```

---

### Task 6: Add field info for windowId and update sourceFrame

**Files:**
- Modify: `field-info.js`

**Step 1: Add windowId field info**

Add to FIELD_INFO object:

```javascript
windowId: {
  label: 'Window ID',
  description: 'Unique identifier assigned to the source window for this session.',
  technical: 'Generated by injected.js when first seeing a message from a window. Used to correlate messages with registration data.',
  filter: null
},
```

**Step 2: Update sourceFrame description**

Update the sourceFrame entry if it exists, or add it:

```javascript
sourceFrame: {
  label: 'Source Frame',
  description: 'The frameId of the frame that sent this message.',
  technical: 'For parent messages, derived from current frame\'s parentFrameId. For child/opener messages, obtained via registration message correlation using windowId.',
  filter: null
},
```

**Step 3: Commit**

```bash
git add field-info.js
git commit -m "add field info for windowId and update sourceFrame"
```

---

### Task 7: Manual testing

**Step 1: Load extension**

1. Go to `chrome://extensions/`
2. Click refresh icon on the extension

**Step 2: Test with test page**

```bash
cd test && python -m http.server 8000
```

1. Open http://localhost:8000/test-page.html
2. Open DevTools → Frames tab
3. Verify settings appear in Settings view
4. Verify "Enable frame registration" is checked by default
5. Verify "Show registration messages" is unchecked and enabled

**Step 3: Test registration flow**

1. In Messages view, trigger a message from an iframe to parent
2. Check Context tab - sourceFrame should show the iframe's frameId
3. Enable "Show registration messages" in settings
4. Verify registration message appears in table
5. Disable "Enable frame registration"
6. Verify "Show registration messages" becomes grayed out
7. Reload page, verify no registration messages appear

**Step 4: Test retroactive correlation**

1. Disable "Show registration messages"
2. Reload page
3. Quickly trigger messages from iframe before registration arrives
4. Wait for registration (500ms delay)
5. Click on earlier message - Context tab should show sourceFrame

**Step 5: Verify to check during/after**

- Does frameId change when iframe navigates but window stays same?
  - Create test: iframe that navigates, send messages before and after
  - Check if both messages get same sourceFrameId

---

### Task 8: Final commit with any fixes

After testing, make any necessary fixes and commit:

```bash
git add -A
git commit -m "fix: [describe any issues found]"
```

If no fixes needed, skip this task.
