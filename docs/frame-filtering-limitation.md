# Frame Filtering Limitation

This document explains why filtering messages by specific frame is not currently supported, and provides technical background for developers interested in implementing this feature.

## For Extension Users

### Why can't I filter messages to/from a specific iframe?

When your page has multiple iframes, you might want to filter the message log to show only messages going to or from a particular frame. Unfortunately, this feature is not currently possible due to a limitation in Chrome's extension APIs.

The extension can identify the *type* of source (parent, child, self, opener, top) using the `sourceType:` filter, but it cannot uniquely identify *which* child iframe a message came from or went to when you have multiple iframes.

### What you can do instead

- **Filter by origin**: Use `source:` or `target:` filters to narrow down by domain
- **Filter by message type**: Use `type:` to filter by the `data.type` field if your messages include one
- **Filter by source type**: Use `sourceType:parent`, `sourceType:child`, etc.

### Help improve this

If frame-specific filtering would be valuable to you, please vote for the underlying browser feature request:

**[w3c/webextensions#12 - Allow retrieving frameID from iframe element](https://github.com/w3c/webextensions/issues/12)**

This feature is already implemented in Firefox and Safari. Chrome support would enable this extension to add frame filtering.

---

## For Extension Developers

### The Technical Problem

To filter messages by specific frame, we need to correlate:
1. The `window` or `iframe` element involved in a postMessage (available in page context)
2. Chrome's internal `frameId` (available in extension APIs)

Chrome does not provide a way to map between these two.

### What we have access to

In `injected.js` (page context), when a message arrives:
- `event.source` - the Window object that sent the message
- For child frames, we can find the corresponding `iframe` element via `Array.from(frames).find(f => f.contentWindow === event.source)`

In extension APIs:
- `chrome.webNavigation.getAllFrames()` - returns frameId, url, parentFrameId for all frames
- `sender.frameId` in message handlers - the frameId of the sending content script

### The missing link

There is no Chrome API to ask "what is the frameId of this Window object or iframe element?"

Firefox and Safari have `browser.runtime.getFrameId(target)` which accepts a `WindowProxy` or iframe element and returns the frameId. Chrome has not implemented this.

### Workarounds considered

| Approach | Why it doesn't work well |
|----------|-------------------------|
| URL matching via `webNavigation.getAllFrames()` | Multiple iframes can have the same URL |
| `window.name` correlation | Not reliably set, can conflict |
| Token-based postMessage handshake | Requires child cooperation, authenticity concerns |
| `webRequest.onBeforeRequest` timing | Race conditions with multiple same-URL iframes |

#### Token handshake

1. Parent generates unique token per iframe element
2. Parent sends token via `iframe.contentWindow.postMessage({token}, '*')`
3. Child content script receives postMessage, sends `chrome.runtime.sendMessage({token})`
4. Background captures `sender.frameId`, forwards `{token, frameId}` to parent
5. Parent now maps: token → iframe element → frameId

Problems:
- Child must cooperate with the postMessage protocol
- Page JavaScript could intercept or spoof messages
- Adds complexity and potential timing issues
- Still doesn't help for messages we're passively observing

#### Chrome DevTools Protocol (CDP)

Chrome DevTools itself uses the Chrome DevTools Protocol to get frame owner information. The Application panel's "Frames" section shows an "owner element" field for iframes, displayed as a CSS selector for the iframe element. This uses the **`DOM.getFrameOwner`** CDP method:

- Takes a `frameId` as input
- Returns `backendNodeId` and `nodeId` for the iframe element
- Additional CDP calls can retrieve attributes to build a CSS selector

**Why extensions can't use this:**

The only way for Chrome extensions to access CDP is via the `chrome.debugger` API. However, attaching the debugger displays a persistent yellow banner at the top of the page:

> "[Extension name] started debugging this browser"

This banner:
- Cannot be dismissed by the user
- Remains visible the entire time the debugger is attached
- Is intentionally intrusive as a security measure

Even though DevTools extensions run inside DevTools (which is already using CDP internally), they don't get access to that existing CDP connection. Extensions are sandboxed and must use `chrome.debugger.attach()` like any other extension, which triggers the banner.

This makes CDP impractical for a DevTools extension—users would see a warning banner despite already having DevTools open.

**References:**
- [CDP DOM.getFrameOwner](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getFrameOwner)
- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)

### If Chrome implements `runtime.getFrameId()`

Even with this API, implementation is not straightforward due to context isolation:

**The context boundary problem:**
- `runtime.getFrameId()` is available in content scripts (isolated world)
- `event.source` (the Window that sent a message) is captured in `injected.js` (page's main world)
- You cannot pass Window object references between these contexts - only serializable data via CustomEvent

**Possible approaches:**

1. **DOM marker approach (most viable for child frames)**: The DOM is shared between the injected script and content script, even though JavaScript objects aren't. For messages from child iframes:
   - Injected script finds the iframe: `[...document.querySelectorAll('iframe')].find(f => f.contentWindow === event.source)`
   - Injected script marks it: `iframe.dataset.frameMarker = uniqueId`
   - Injected script passes `uniqueId` via CustomEvent to content script
   - Content script finds it: `document.querySelector(`[data-frame-marker="${uniqueId}"]`)`
   - Content script calls `chrome.runtime.getFrameId(iframeElement)`
   - Clean up the marker

   **Limitation**: This only works for child frames where we have access to the iframe element. It doesn't help for messages from `opener` (separate window, no shared DOM).

   **Note on parent frames**: For messages where `sourceType` is `parent`, we don't need the DOM marker approach. The content script can determine its own `parentFrameId` via extension APIs (e.g., `webNavigation.getFrame()` or from the frame info when the content script initializes). The parent's frameId is simply the current frame's `parentFrameId`.

2. **Content script as message listener**: The content script could listen for `message` events directly and call `runtime.getFrameId(event.source)`. However, content scripts may miss messages that page JavaScript intercepts or stops propagation on. The current architecture uses an injected script precisely to capture messages before page code can interfere.

3. **Pre-build iframe-to-frameId map**: The content script could enumerate all iframe elements via `document.querySelectorAll('iframe')` and call `runtime.getFrameId(iframe)` on each to build a map. The injected script would then need to identify the source iframe by some serializable property (URL, name, position) and pass that to the content script for lookup. This reintroduces fuzzy matching problems.

4. **Hybrid approach**: Use both an injected script (for reliable message capture) and content script message listener (for frameId). Correlate the two by timestamp and message content. This adds complexity and potential race conditions.

**If it worked**, the panel could:
- Show frameId in a column
- Support `frameId:123` filter syntax
- Group messages by frame

**Summary**: If Chrome implements `runtime.getFrameId()`, frame filtering would be possible for:
- **Child frames**: Via the DOM marker approach
- **Parent frames**: Via the current frame's `parentFrameId`
- **Top frames**: The top frame is always frameId 0
- **Opener frames**: Still not possible (separate window, no shared DOM or frame hierarchy)

### Resources

- [w3c/webextensions#12](https://github.com/w3c/webextensions/issues/12) - Feature request (vote here!)
- [runtime.getFrameId() - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getFrameId) - Firefox/Safari documentation
- [chrome.runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime) - Chrome docs (no getFrameId)
- [Chromium Extensions Group Discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/k4uiAiNalxg) - Historical discussion of workarounds
