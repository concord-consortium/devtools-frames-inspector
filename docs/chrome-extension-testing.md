# Testing Chrome Extensions: Landscape and Rationale for a Custom Harness

## The Problem

Chrome extensions (Manifest V3) run code across multiple isolated contexts — content scripts, a background service worker, and DevTools panels — that communicate via Chrome-specific APIs (`chrome.runtime.sendMessage`, `chrome.runtime.connect` ports, `chrome.tabs.sendMessage`). Testing the message flow between these contexts requires simulating the Chrome runtime environment.

## Existing Libraries (as of early 2026)

| Library | Vitest? | MV3 support | Port-based messaging | Multi-context | Maintained |
|---------|---------|-------------|---------------------|---------------|------------|
| `vitest-chrome` | Yes | Outdated `@types/chrome` | Not supported | No | Unclear (1 release, Aug 2023) |
| `@mobile-next/jest-chrome` | No (Jest) | Yes | Not documented | No | Yes (Jun 2025) |
| `sinon-chrome` | Framework-agnostic | No (pre-MV3) | Known broken ([issue #61](https://github.com/acvetkov/sinon-chrome/issues/61)) | No | No (last release 2019) |
| `jest-webextension-mock` | No (Jest) | Not documented | Not documented | No | Yes (new maintainer 2024) |
| `webextensions-api-fake` | No (Sinon) | No (Firefox-oriented) | Unknown | No | No (last release 2020) |

### Key gaps across all libraries

1. **No library simulates multiple contexts.** Every library creates a single mocked `chrome` global. None simulate separate content script, service worker, and DevTools panel contexts with messages flowing between them.

2. **Port-based messaging (`chrome.runtime.connect` / `onConnect`) is poorly supported or broken.** This is the exact API used for panel ↔ background communication in this extension. `sinon-chrome` has a known bug where `runtime.connect()` returns `undefined`. Other libraries don't document port support at all.

3. **DevTools-specific APIs** (`chrome.devtools.inspectedWindow`, `chrome.devtools.panels`) are niche and not covered by any library.

4. **Framework mismatch.** Most maintained options target Jest. This project uses Vitest. The only Vitest-native option (`vitest-chrome`) is early-stage with outdated type definitions.

## What Chrome officially recommends

Chrome's [unit testing docs](https://developer.chrome.com/docs/extensions/how-to/test/unit-testing) suggest:

1. Extract logic that doesn't depend on Chrome APIs and test it normally.
2. For code using Chrome APIs: write custom mocks.
3. For complex integration: use end-to-end testing with Puppeteer.

Their examples only cover simple cases like mocking `chrome.tabs.query()`. They don't address testing message passing, ports, or multi-context communication.

For e2e, Puppeteer can load extensions and interact with service workers, but accessing DevTools panels programmatically is fragile and depends on unofficial APIs. Playwright has similar limitations — it requires headed mode for extensions and has no DevTools panel support.

## Why a custom harness is the right choice for this project

This extension's core functionality is **message routing across three contexts**:

```
Content Script  →  Service Worker  →  DevTools Panel
(per-frame)        (routes by tab)    (displays messages)
```

Testing this requires:
- Multiple content script instances with different window environments (different frames)
- A service worker that routes messages by tab/frame ID and enriches them via `webNavigation`
- Panel connections via ports with bidirectional messaging
- The ability to control all of this in a single test process

No existing library provides this. The custom harness (`ChromeExtensionEnv`) is ~200 lines and provides:

- **`ChromeEvent<T>`** — generic event mock matching Chrome's `addListener`/`removeListener` pattern
- **Connected port pairs** — `postMessage` on one end fires `onMessage` on the other, exactly like real Chrome ports
- **Per-frame content script chrome mocks** — `sendMessage` routes to the background's `onMessage` with correct `sender` metadata (tabId, frameId, documentId)
- **Background chrome mock** — includes `tabs.sendMessage` that routes to the correct content script, plus `webNavigation`, `scripting`, and `storage` mocks
- **Mock windows** — lightweight objects with the properties content scripts actually use (location, parent, frames, document, postMessage)

The alternative — Puppeteer e2e tests — would require a running Chrome instance, real page navigation, and fragile DevTools panel automation. Tests would take seconds instead of milliseconds and be much harder to debug.

## Maintenance cost

The harness mocks only the Chrome APIs this extension actually uses. When the extension adds new API usage, the corresponding mock needs to be added. This is straightforward because:

- Each Chrome API mock is a few lines (typically a `vi.fn()` with a simple implementation)
- The `ChromeEvent` class handles all event-pattern APIs generically
- The port pair factory handles any new port-based connections

The current harness supports the full content → background → panel message flow, navigation events, message buffering, and frame registration — covering the extension's core functionality.
