# Source FrameId for Child/Opener Messages

## Overview

**Purpose:** Enable the extension to identify the source `frameId` when messages come from child iframes or opened windows, allowing users to filter and correlate messages by specific frame.

**Approach:** Child frames and popups send a registration message to their parent/opener announcing their `frameId` and `tabId`. The receiving frame's `injected.js` assigns a stable `windowId` to each unique source window and includes this with every captured message. The panel correlates registration messages with other messages sharing the same `windowId` to determine the source frame.

**Key constraints:**
- Works cross-origin (the only use case that matters)
- Handles race conditions where real messages arrive before registration
- Registration messages are captured (hidden from app code via `stopImmediatePropagation()`) but forwarded to panel
- No token/nonce needed - message type prefix is sufficient

**What this enables:**
- `sourceFrameId` shown in message details
- Future: `sourceFrameId:123` filter syntax
- Future: Linking messages to specific frames in hierarchy view

**What this doesn't solve:**
- Messages from `window.opener` in separate tabs (different tabId, no shared DOM) - registration still helps identify the opener's frameId within its own tab, but full cross-tab correlation is deferred

## Settings

**New settings in the settings pane:**

1. **"Enable frame registration"** (checkbox, default: enabled)
   - When enabled, content scripts send registration messages to parent/opener
   - When disabled, no registration messages are sent, `sourceFrameId` will be unavailable for child/opener messages

2. **"Show registration messages"** (checkbox, default: disabled)
   - Nested under setting 1, visible but disabled/grayed out when frame registration is off
   - When enabled, registration messages appear in the messages table
   - When disabled, registration messages are captured but hidden from the table

**Why make it optional:**
- Registration messages are extra traffic that some users may not want
- Some users may be debugging apps that are sensitive to unexpected postMessages
- Keeps the extension minimal for users who don't need frame identification

**Settings flow:**
- Settings stored via `chrome.storage.local`
- Background script reads settings and only sends frame info to content scripts when registration is enabled
- Panel reads settings to determine whether to display registration messages

## Changes to `injected.js`

**New state:**
```javascript
const sourceWindows = new WeakMap(); // Window -> {windowId: string}
```

**New behavior in message listener:**

1. **Assign windowId to source windows:**
   - When a message arrives, check if `event.source` is in `sourceWindows`
   - If not, generate a new `windowId` and store `{windowId}` in the WeakMap
   - Include `source.windowId` in every captured message

2. **Handle registration messages:**
   - Detect registration messages by checking `event.data?.type === '__frames_inspector_register__'`
   - Call `event.stopImmediatePropagation()` to prevent app code from seeing it
   - Still capture and forward to content script (like any other message)

**Message payload changes:**
```javascript
{
  // ...existing fields...
  source: {
    // ...existing fields...
    windowId: 'abc123',        // NEW: stable ID for this source window
  }
}
```

## Changes to `content.js`

**New behavior on initialization:**

1. **Listen for frame info from background:**
   - Listen for a message with `{type: 'frame-info', frameId, tabId}`
   - Store these values

2. **Send registration messages after 500ms delay:**
   - After receiving frame info, wait 500ms (to ensure parent's listener is ready)
   - If `window.parent !== window`, send registration to parent:
     ```javascript
     window.parent.postMessage({
       type: '__frames_inspector_register__',
       frameId,
       tabId
     }, '*')
     ```
   - If `window.opener` exists, send registration to opener:
     ```javascript
     window.opener.postMessage({
       type: '__frames_inspector_register__',
       frameId,
       tabId
     }, '*')
     ```

## Changes to `background.js`

**New behavior after injection:**

1. **Read registration setting from storage:**
   - Check `chrome.storage.local` for registration enabled setting
   - Default to enabled if not set

2. **Conditionally send frame info to content script:**
   - Only if registration is enabled, send message after injection:
     ```javascript
     chrome.tabs.sendMessage(tabId, {
       type: 'frame-info',
       frameId,
       tabId
     }, { frameId })
     ```
   - If registration is disabled, don't send anything

**Settings change listener:**
- Listen for `chrome.storage.onChanged` to detect when setting changes
- Only affects new injections

## Changes to `panel.js`

**New state:**

```javascript
const windowFrameMap = new Map(); // windowId -> {frameId, tabId}
```

**Processing incoming messages:**

1. **Check if it's a registration message:**
   - If `message.data?.type === '__frames_inspector_register__'`
   - Extract `frameId` and `tabId` from `message.data`
   - Store in `windowFrameMap` keyed by `message.source.windowId`

2. **Enrich messages with sourceFrameId on display:**
   - For any message with `source.windowId`, look up in `windowFrameMap`
   - If found, display `source.frameId` in detail view
   - Works retroactively: earlier messages get frameId when their row is selected

**Filtering registration messages:**

- Check "show registration messages" setting
- If disabled, filter out messages where `data?.type === '__frames_inspector_register__'` from display
- Messages are still stored and processed for correlation, just not shown in table

## Registration Message Format

**Message sent by content.js to parent/opener:**

```javascript
{
  type: '__frames_inspector_register__',
  frameId: 5,
  tabId: 42
}
```

**As captured and forwarded to panel:**

```javascript
{
  id: 'xyz789',
  timestamp: 1706886400000,
  target: {
    url: 'https://parent.example.com/page',
    origin: 'https://parent.example.com',
    frameId: 0
  },
  source: {
    type: 'child',          // or 'opener'
    origin: 'https://child.example.com',
    windowId: 'abc123',     // NEW
    iframeSrc: '...',
    iframeId: '...',
    iframeDomPath: '...'
  },
  data: {
    type: '__frames_inspector_register__',
    frameId: 5,
    tabId: 42
  },
  dataPreview: '{"type":"__frames_inspector_register__","frameId":5,"tabId":42}',
  dataSize: 52,
  messageType: '__frames_inspector_register__'
}
```

## Edge Cases

**1. Multiple iframes from same origin:**
- Each iframe has a unique `windowId` (from the WeakMap keyed by window object)
- Even if URLs match, registration correlates correctly because `event.source` is unique per iframe

**2. Iframe removed and re-added:**
- New iframe = new window object = new `windowId`
- New registration message needed
- Old `windowId` becomes stale (window garbage collected, WeakMap entry removed)

**3. Navigation within iframe:**
- Content script re-injected on navigation
- New registration sent (after 500ms delay)
- Same window object, so same `windowId` in parent's WeakMap
- `windowFrameMap` entry updated with new registration data

**4. Panel opened after messages already captured:**
- Buffered messages include `windowId`
- Registration message (if also buffered) allows correlation
- If registration was lost, `sourceFrameId` unavailable for those messages

**5. Registration message lost (sent too early):**
- Messages from that frame will have `windowId` but no `sourceFrameId`
- Extension still functional, just missing that enhancement
- 500ms delay mitigates this in most cases

**6. Setting disabled mid-session:**
- Already-injected frames that received frame-info will still send registration
- New frames won't receive frame-info, so won't send registration

## Open Questions

**To verify during/after implementation:**
- Can `frameId` change while `window` object stays the same (e.g., during iframe navigation)?
- If so, the current design overwrites the old frameId in `windowFrameMap`, potentially losing the ability to identify historic messages from before navigation
- Potential future fix: store a list of `{frameId, tabId, timestamp}` per windowId instead of just the latest, allowing time-based correlation

## Future Enhancements (Out of Scope)

- `sourceFrameId:123` filter syntax
- Linking messages to hierarchy view by frameId
- Full opener support across tabs (different tabId)
- Re-rendering table rows when registration arrives (currently just detail view updates)
- Mapping iframes in hierarchy to their frames in the hierarchy.