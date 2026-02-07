# Frame Model Design

Unify the concept of a frame across messages and the hierarchy view by introducing Frame, FrameDocument, and OwnerElement model classes.

## Data Model

### Frame
Stable identity for an iframe, keyed by `(tabId, frameId)`. Persists across navigations.

- `tabId: number`
- `frameId: number`
- `parentFrameId: number`
- `currentDocument: FrameDocument | undefined` — latest known document
- `currentOwnerElement: OwnerElement | undefined` — latest known iframe element config
- `children: Frame[]` — child frames (for hierarchy view)

### FrameDocument
A specific document loaded in a frame, keyed by `documentId`. Changes when the frame navigates.

- `documentId: string`
- `url: string | undefined`
- `origin: string | undefined`
- `title: string | undefined`
- `windowId: string | undefined` — stable ID from content script's WeakMap, used for source correlation
- `frame: Frame | undefined` — back-reference, set once association is known

### OwnerElement
Immutable snapshot of the iframe element configuration in the parent's DOM. A new OwnerElement is created when the configuration changes (e.g., iframe is moved in DOM, src attribute changes).

- `domPath: string`
- `src: string | undefined`
- `id: string | undefined`

## Message Model

Messages store raw identifiers and compute references via FrameStore lookups.

### Raw fields
- `targetDocumentId: string` — always available (from `sender.documentId` in background script)
- `sourceWindowId: string | undefined` — always available for sources (from content script WeakMap)
- `sourceDocumentId: string | undefined` — available for parent messages (from background enrichment via `webNavigation.getFrame`); for child messages this remains undefined since registration arrives after the message. The computed `sourceDocument` handles resolution via `windowId` fallback.
- `sourceType: string` — relationship type ('parent', 'child', 'self', 'top', 'unknown'), determined by content script, stays on message
- `sourceOwnerElement: OwnerElement | undefined` — snapshot at message time; for child messages comes from content script, for parent messages from Frame's current OwnerElement
- `targetOwnerElement: OwnerElement | undefined` — snapshot of target Frame's currentOwnerElement at message arrival time

### Computed properties
- `get targetDocument()` — `frameStore.getDocumentById(this.targetDocumentId)`
- `get sourceDocument()` — tries `frameStore.getDocumentById(this.sourceDocumentId)` first, falls back to `frameStore.getDocumentByWindowId(this.sourceWindowId)`
- `get targetFrame()` — `this.targetDocument?.frame`
- `get sourceFrame()` — `this.sourceDocument?.frame`

## FrameStore

Manages Frame and FrameDocument instances with reactive MobX maps.

### Indices
- `frames: Map<string, Frame>` — keyed by `"tabId:frameId"`
- `documents: Map<string, FrameDocument>` — keyed by `documentId`
- `documentsByWindowId: Map<string, FrameDocument>` — secondary index for source correlation

### Lifecycle

**When a message arrives from the background script:**
1. Look up or create the target's FrameDocument by `targetDocumentId`. Set `url`, `origin`, `title` from the message's target fields.
2. Look up or create the target's Frame by `(tabId, frameId)`. Link the FrameDocument to it.
3. Store a reference to the target Frame's `currentOwnerElement` as the message's `targetOwnerElement`. Since OwnerElement is immutable, no copy is needed — when the Frame later gets a new OwnerElement, the message's reference still points to the old one.
4. For the source: if `sourceDocumentId` is known (parent messages), look up or create FrameDocument by documentId. If only `sourceWindowId` is available, look up by windowId; if not found, create a partial FrameDocument with just `origin` and `windowId`.
5. For child messages, the message carries owner element info (domPath, src, id) captured by the content script at message time. Create an OwnerElement from this info and store it as the message's `sourceOwnerElement`. If the source Frame is already known (registration already arrived), compare with the Frame's `currentOwnerElement` — if the domPath or src differs, set this new OwnerElement as the Frame's `currentOwnerElement`. If the source Frame is not yet known (pre-registration), the OwnerElement is still stored on the message; the Frame's `currentOwnerElement` will be set later when registration arrives.
6. For parent messages, store a reference to the source Frame's `currentOwnerElement` as the message's `sourceOwnerElement` (same immutable reference approach as the target).

**When a registration message arrives (carries `frameId`, `tabId`, `documentId`, `windowId`, owner element info):**
1. Look up existing FrameDocument by `windowId` (created earlier from messages — has `origin`, `windowId`, no `documentId`).
2. Look up existing FrameDocument by `documentId` (may exist from hierarchy refresh — has `url`, `title`, `documentId`, no `windowId`).
3. If both exist, merge into the `documentId`-keyed one: copy `windowId` and `origin` from the windowId-based one. Update the `documentsByWindowId` index to point to the merged FrameDocument. Remove the old one.
4. If only one exists, update it with the new information.
5. Look up or create the Frame by `(tabId, frameId)`. Link the FrameDocument as current document.
6. Compare the registration's owner element info with the Frame's `currentOwnerElement`. If different (or no current exists), create a new OwnerElement and set it as the Frame's `currentOwnerElement`. If the values match, keep the existing one.

**When the hierarchy view refreshes (from `webNavigation.getAllFrames()`):**
1. For each frame returned, look up or create Frame and FrameDocument by `documentId`. Fill in any missing properties (`url`, `title`, etc.).
2. Build parent-child relationships between Frames.

## Wire Protocol Changes

### Background script (`background.ts`)
- Attach `sender.documentId` as `targetDocumentId` on every message forwarded to the panel.
- For parent messages: look up `parentDocumentId` via `webNavigation.getFrame({ tabId, frameId: parentFrameId })` and attach it as `sourceDocumentId`.
- For registration messages: attach `sender.documentId` before forwarding to the panel.

### Content script (`content.ts`)
- No significant changes. The `windowId` and source type detection remain as-is.
- Registration messages continue to carry `frameId`, `tabId`, `windowId`, and owner element info. The `documentId` is added by the background script, not the content script.

## Shared UI Component: FrameDetail

A single component used in both the message detail pane and the hierarchy view.

### Props
- `frame: Frame | undefined`
- `document: FrameDocument | undefined` — override for point-in-time snapshot; falls back to `frame.currentDocument`
- `ownerElement: OwnerElement | undefined` — override for point-in-time snapshot; falls back to `frame.currentOwnerElement`
- `sourceType: string | undefined` — only passed in message context

### Rendering
- Resolves effective document and ownerElement (override or current from frame)
- Displays: frameId, url, origin, title, ownerElement fields (domPath, src, id), sourceType if provided
- Fields that are undefined are not rendered (handles partial FrameDocuments)

### Usage

Message detail pane:
```tsx
<FrameDetail
  frame={message.sourceFrame}
  document={message.sourceDocument}
  ownerElement={message.sourceOwnerElement}
  sourceType={message.sourceType}
/>
<FrameDetail
  frame={message.targetFrame}
  document={message.targetDocument}
  ownerElement={message.targetOwnerElement}
/>
```

Hierarchy view:
```tsx
<FrameDetail frame={frame} />
```

## Deferred

- **Opener support**: Openers live in different tabs and require the background script to resolve opener tabId/frameId. Deferred to a follow-up.
- **Historical OwnerElement inference for parent messages**: When a parent message arrives before registration, `sourceOwnerElement` is undefined because the source Frame isn't known yet. A future enhancement could track OwnerElement history with timestamps on each Frame, then retroactively infer the best-guess OwnerElement for these messages based on when they arrived.
