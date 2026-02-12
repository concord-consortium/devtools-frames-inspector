# Plan: Expand Test Harness with Models and Split Background Script

## Context

The test harness currently uses `vi.fn()` from vitest for all mock functions, tying it to vitest. The goal is to replace `vi.fn()` with proper models (Tab, Frame, Document, Window, IFrame) so the harness can run inside a real browser tab for Playwright-based panel testing. The background script also needs to be split (like the content script already is) so it can be initialized with a mock chrome API rather than relying on the global `chrome`.

## Files to Create

- `src/test/harness-models.ts` — Tab, Frame, Document, Window, IFrame models
- `src/test/chrome-api.ts` — ChromeEvent, MockPort, createPortPair (vi.fn-free)
- `src/background-core.ts` — `BackgroundChrome` interface + `initBackgroundScript(chrome)` function

## Files to Modify

- `src/background.ts` — becomes thin wrapper: `initBackgroundScript(chrome)`
- `src/test/chrome-extension-env.ts` — uses models and chrome-api, removes vi.fn()
- `src/integration.test.ts` — uses new APIs (model objects, `initBackgroundScript` directly)
- `vite.config.ts` — update entry point from `background` to `background-core` + keep `background` as entry

## Step 1: Split background.ts → background.ts + background-core.ts

Follow the content script pattern. Define `BackgroundChrome` interface covering all chrome APIs used:

```typescript
// Minimal chrome API surface needed by the background script
export interface BackgroundChrome {
  runtime: {
    onConnect: { addListener(cb: (port: BackgroundPort) => void): void };
    onMessage: { addListener(cb: (msg: ContentToBackgroundMessage, sender: MessageSender) => void): void };
  };
  scripting: {
    executeScript(options: { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; files: string[]; injectImmediately?: boolean }): Promise<any[]>;
  };
  tabs: {
    sendMessage(tabId: number, msg: any, options?: { frameId?: number }): Promise<any>;
    onRemoved: { addListener(cb: (tabId: number) => void): void };
  };
  webNavigation: {
    getAllFrames(details: { tabId: number }): Promise<Array<{ frameId: number; parentFrameId: number; documentId?: string; url: string }> | null>;
    getFrame(details: { tabId: number; frameId: number }): Promise<{ documentId?: string; parentFrameId?: number } | null>;
    onCommitted: { addListener(cb: (details: { tabId: number; frameId: number; url: string }) => void): void };
    onCreatedNavigationTarget: { addListener(cb: (details: { sourceTabId: number; tabId: number; url: string }) => void): void };
  };
  storage: { local: { get(keys: string | string[]): Promise<Record<string, any>> } };
}
```

Move all logic into `export function initBackgroundScript(chrome: BackgroundChrome): void { ... }`. The module-level Maps/Sets become function-scoped (fresh per call — no more `vi.resetModules()`).

`background.ts` becomes:
```typescript
import { initBackgroundScript } from './background-core';
initBackgroundScript(chrome as any);
```

Update `vite.config.ts` to include `background-core` as a library entry and keep `background` as the extension entry point.

**Verify:** Run `npm test` — all tests pass. Run `npm run build` — builds successfully.

## Step 2: Create harness-models.ts

Models in `src/test/harness-models.ts`. No `vi.fn()` anywhere.

### HarnessTab
```
- id: number
- frames: Map<number, HarnessFrame>
- addFrame(frame), getFrame(frameId), getAllFrames()
```

### HarnessFrame
```
- tab: HarnessTab
- frameId: number
- parentFrameId: number
- currentDocument: HarnessDocument | undefined
- window: HarnessWindow | undefined  (set when content script initialized)
- toFrameInfo() → { tabId, frameId, parentFrameId, documentId, url }
```

### HarnessDocument
```
- documentId: string
- url: string
- title: string
```

### HarnessWindow
Replaces `MockWindow`. All methods are plain functions (no vi.fn).

```
- location: { href, origin }
- parent: HarnessWindow (default: self)
- top: HarnessWindow (default: self)
- opener: HarnessWindow | null
- document: { title, querySelectorAll(selector) }
- addEventListener(type, cb, capture?)
- postMessage(data, targetOrigin)
- frames (getter, derived from iframeElements)
- __postmessage_devtools_content__?: boolean

- dispatchMessage(data, origin, source)  // test helper
- addIframe(iframe: HarnessIFrame)
```

### HarnessIFrame
```
- src: string
- id: string
- contentWindow: HarnessWindow
- nodeName: 'IFRAME', nodeType: 1, parentElement: null, previousElementSibling: null
```

**Verify:** Run `npm test` — all tests pass (purely additive, nothing uses these yet).

## Step 3: Create chrome-api.ts and migrate ChromeExtensionEnv

Create `src/test/chrome-api.ts` with:
- `ChromeEvent` — same as current but without `vi.fn()` wrapping methods
- `MockPort` interface and `createPortPair()` — plain functions instead of `vi.fn()`
- `flushPromises()` utility

Update `src/test/chrome-extension-env.ts`:
- Import from `chrome-api.ts` and `harness-models.ts`
- Replace `frames: Map<string, FrameConfig>` with `tabs: Map<number, HarnessTab>`
- `addFrame(config)` creates HarnessTab/Frame/Document models, returns HarnessFrame
- `createBackgroundChrome()` queries models for webNavigation responses, no `vi.fn()`
- `createContentChrome(frame: HarnessFrame)` — takes frame object instead of (tabId, frameId, documentId)
- Remove `MockWindow`, `MockWindowOptions`, `createMockWindow`, `addIframeToWindow` exports (replaced by HarnessWindow/HarnessIFrame)
- Remove `import { vi } from 'vitest'`

## Step 4: Update integration.test.ts

Update `setupTwoFrames()` and buffering test:
- Use `env.addFrame(...)` capturing returned `HarnessFrame` objects
- Use `new HarnessWindow(...)` and `new HarnessIFrame(...)` instead of `createMockWindow`/`addIframeToWindow`
- Use `env.createContentChrome(frame)` instead of `env.createContentChrome(tabId, frameId, documentId)`
- Call `initBackgroundScript(env.createBackgroundChrome())` directly instead of `vi.resetModules()` + `await import('./background')`
- Remove `vi.resetModules()` from beforeEach
- Keep `vi` import only for what's still needed (if anything)

**Verify:** Run `npm test` — all 20 tests pass. Run `npm run build` — builds successfully.

## Risk Assessment

- **No vi.fn() assertions exist** in integration tests — they only check message content/structure, so removing vi.fn() wrappers is safe
- **`as unknown as Window` cast** still needed for HarnessWindow → Window, but the shape is correct
- **`stopImmediatePropagation`** on dispatched message events becomes a plain no-op (no test asserts on it)
- **background-core.ts function scope** means Maps/Sets are fresh per `initBackgroundScript()` call — cleaner than `vi.resetModules()`

## Verification

After all steps:
1. `npm test` — all existing tests pass
2. `npm run build` — builds successfully, `dist/background.js` still works
3. Verify no `vi.fn()` in `harness-models.ts`, `chrome-api.ts`, or `chrome-extension-env.ts`
