# Extension Reload Recovery — Design

## Problem

When the extension is reloaded or updated while a Messages panel is open, three things break in ways that aren't visible to the user:

1. The DevTools panel page is still running JS from the old extension context. Its `chrome.runtime` is invalidated and it can no longer talk to the new background script.
2. The new background script has lost all in-memory state (panel connections, buffering-enabled tabs, injection tracking).
3. Content scripts already injected into monitored pages keep listening for `message` events but their `chrome.runtime` is also invalidated. They become silent orphans — they capture nothing and can't report errors.

Today, the only signal the user gets is that messages stop appearing. There's no way for them to know the panel and DevTools must be reopened, or that the page itself must be reloaded to get a working content script.

## Goals

- Show a clear, persistent banner in the panel telling the user to close and reopen DevTools when the extension has been reloaded.
- Detect, after the user reopens DevTools, whether the inspected page still has a stale orphan content script, and show a per-frame banner telling the user to reload the page.
- No false positives in normal operation (panel open, extension not reloaded, page just navigated, etc.).

## Non-Goals

- Auto-recovery — automatically reloading the panel, reinjecting working content scripts, or reloading monitored pages. The roadmap item is the banner; auto-recovery is a separate, larger investigation.
- Recovery for tabs that were being monitored only for buffering (e.g. tabs opened via `window.open` from a monitored tab). After an extension reload the new SW has no record of them, so they revert to unmonitored. When the user eventually opens DevTools on one, the standard sentinel check (below) will fire.

## Design

Two banners, two triggers.

### 1. Panel-level banner: "Extension was reloaded"

Triggered from the panel when the existing port to background dies and reconnection fails because the panel's own runtime is invalidated.

**Detection.** The panel's connection module already auto-reconnects on `port.onDisconnect` (see [src/panel/connection.ts:31-34](src/panel/connection.ts#L31-L34)). After an extension reload the reconnect attempt fails — either `chrome.runtime.connect` throws `Extension context invalidated`, or `chrome.runtime.id` becomes `undefined`. Either signal indicates the panel itself is from a dead extension version and cannot recover.

**Behavior on detection.**
- Stop the reconnect loop.
- Set a flag on the panel store: `extensionContextInvalidated = true`.
- Render a persistent banner at the top of the panel: **"The Messages Inspector extension was reloaded. Close and reopen DevTools to continue capturing."**
- The banner is not dismissible — there is no recovery path from this panel context.

### 2. Frame-level banner: "Page needs reload"

Triggered when the user has reopened DevTools (so a fresh panel is now talking to the new background) and the new content script detects, on injection, that a stale orphan from a previous extension lifetime is still in the page.

**Detection mechanism.** Replace the current boolean guard with a two-step injection. Step 1 is an inline `executeScript({func, args})` "bootstrap" that decides whether to init/skip/stale by probing the page; step 2 is the existing `content.js` which reads the decision and acts on it.

- Background generates `swStartupId` once when the service worker starts (persisted in `chrome.storage.session` so it survives idle SW restarts but is cleared on extension reload).
- Each `injectContentScript` call runs the bootstrap with `swStartupId` in `args`. The bootstrap synchronously dispatches a custom `__messages_inspector_probe__` event on `window` with a random nonce in `event.detail`. DOM events fire all listeners across isolated worlds synchronously, so any orphan content script's response is collected before `dispatchEvent` returns.
- Existing content scripts (registered on prior fresh init) listen for `__messages_inspector_probe__` and respond with `__messages_inspector_probe_response__` carrying their captured `swStartupId` plus the probe's nonce.
- The bootstrap classifies based on responses:
  - **No responses** → `'init'`: no other content scripts present; proceed with fresh init.
  - **All responses' `swId` match the current `swStartupId`** → `'skip'`: same SW lifetime, idempotent re-injection. Content.js bails.
  - **Any response's `swId` differs** → `'stale'`: an orphan from a previous extension lifetime is attached.
- The bootstrap writes `swStartupId` to `window[SW_ID_KEY]` (within-isolated-world; consumed by content.js for its own probe responses) and the action to `window[INJECT_ACTION_KEY]`. Content.js reads the action and acts accordingly.

**Behavior on mismatch.** Content.js sees `action === 'stale'` and:
1. Sends `{ type: 'stale-frame' }` to background via `chrome.runtime.sendMessage` (its runtime is fresh, this works).
2. Returns without registering listeners. The orphan's `message` listeners are still firing on the page — adding a second set would double-process every event, and we're going to ask the user to reload anyway.

**Routing.** Background receives `stale-frame`, finds the panel connection for `tabId`, and forwards `{ type: 'stale-frame', frameId }`. Panel receives it and adds `frameId` to a `staleFrames` set on the store.

**UI.** Render a banner near the top of the panel: **"This page has stale content scripts from a previous extension version. Reload the page to resume capturing."** If multiple frames are stale, list them or just say "this page" — a single banner per tab is sufficient because the user reloads the whole page anyway.

**Clearing.** When a frame navigates, the page reload destroys the orphan (its closure-held `swId` and probe listener go with it), and the new content script (re-injected by the existing `webNavigation.onCommitted` handler) sees no probe response and fresh-inits. To make this observable, the content script sends a new `{ type: 'content-script-ready' }` message at the end of fresh init. Background tracks a per-tab `staleFrames` set; when `content-script-ready` arrives from a frame that was in the set, background removes it and forwards `{ type: 'stale-frame-cleared', frameId }` to the panel. Panel removes the frame from its own `staleFrames`; when the set empties, the banner disappears. As an additional cleanup, when `webNavigation.onCommitted` fires for the top frame (frameId 0), the background clears all stale entries for that tab — top-frame navigation destroys every subframe, and surviving subframes get fresh `frameId`s that wouldn't correlate with the old stale entries via `content-script-ready` alone.

## Components and Data Flow

```
extension reload
      │
      ├─► old panel: port dies → reconnect → throws → show "reopen DevTools" banner
      │
      └─► new SW: starts with fresh swStartupId
              │
              user reopens DevTools
              │
              new panel ──init──► new SW
                                    │
                                    ▼
                executeScript(func: bootstrap, args:[swStartupId])
                                    │
                                    ▼
                  bootstrap dispatches __messages_inspector_probe__
                                    │
                       orphan listener responds with old swId ──── (or no response)
                                    │
                  bootstrap classifies: init | skip | stale
                                    │
                  bootstrap writes window[INJECT_ACTION_KEY] = action
                                    │
                                    ▼
                executeScript(files:['content.js'])
                                    │
                                    ▼
                  content.js reads action
                          │
            init ─────────┤   skip ───── return
                          │
                          └── stale ──► sendMessage('stale-frame')
                                                │
                                                ▼
                                      background → panel
                                                │
                                                ▼
                                      panel banner: "reload page"
```

## Affected Files

- [src/content-core.ts](src/content-core.ts) — replace the boolean guard with the inject-action protocol (read action from `window[INJECT_ACTION_KEY]`); register the probe response listener on fresh init; add `stale-frame` and `content-script-ready` send paths; do not register message listeners on stale.
- [src/background-core.ts](src/background-core.ts) — generate/persist `swStartupId` in `chrome.storage.session`; replace single-step injection with bootstrap + content.js two-step; the bootstrap function (defined inline in the `executeScript({func, args})` call) dispatches the probe, classifies, and writes the action; route `stale-frame` and `content-script-ready` messages to the appropriate panel port; clear all stale entries for a tab on top-frame `onCommitted`.
- [src/panel/connection.ts](src/panel/connection.ts) — detect `Extension context invalidated` / missing `chrome.runtime.id` on reconnect attempts; set store flag; stop reconnect loop. Handle incoming `stale-frame` and `stale-frame-cleared` routing into the store.
- [src/panel/store.ts](src/panel/store.ts) — add `extensionContextInvalidated: boolean` and `staleFrameIds: Set<number>` (observable) plus actions and a `hasStaleFrames` computed.
- [src/panel/components/shared/Banners.tsx](src/panel/components/shared/Banners.tsx) — new component that renders the two banners based on store state. Wired into [src/panel/components/App.tsx](src/panel/components/App.tsx).
- [src/types.ts](src/types.ts) — add `stale-frame`, `stale-frame-cleared`, and `content-script-ready` to the message-type unions; add the constants `SW_ID_KEY`, `INJECT_ACTION_KEY`, `SW_STARTUP_ID_STORAGE_KEY`, `PROBE_EVENT_NAME`, `PROBE_RESPONSE_EVENT_NAME`.

## Testing

- **Unit:** content-core tests for the inject-action protocol: `'stale'` action sends `stale-frame` and adds no listeners; `'skip'` is a no-op; `'init'` registers listeners and sends `content-script-ready`; missing flag defaults to `'init'`.
- **Unit:** background-core test that `swStartupId` is persisted in `chrome.storage.session` and reused across SW idle restarts.
- **Integration:** end-to-end orphan detection — install a probe response listener with a previous-lifetime swId on the harness frame, connect the panel, assert one `stale-frame` arrives. Reset and re-init background (simulate SW restart) with the same `swStartupId` and assert no false-positive `stale-frame`.
- **Integration:** clearing — install orphan, connect, navigate the top frame, assert `stale-frame-cleared` arrives. Multi-frame variant: orphan on top + iframe; navigate top; both clear.
- **Unit:** panel store/connection tests for `extensionContextInvalidated` flag and `staleFrameIds` set lifecycle (added on `stale-frame`, removed on `stale-frame-cleared`).
- **Component:** Banners renders nothing initially; renders red on `extensionContextInvalidated`; renders yellow on `hasStaleFrames`; renders both when both are set.
- **E2E (Playwright):** test-harness simulation of normal → reload extension → reopen DevTools → reload-frame → normal, asserting banner visibility at each step.
- **Manual:** load the extension, open the panel on a test page with iframes, click "Reload" on the extension card in `chrome://extensions/`, confirm the panel banner appears. Reopen DevTools, confirm the per-page banner appears. Reload the page, confirm the per-page banner clears.

## Open Questions

None at this time.
