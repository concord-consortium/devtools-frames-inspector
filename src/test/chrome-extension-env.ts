// Chrome extension test harness — simulates the Chrome runtime environment
// for integration testing content scripts, background service worker, and panel.
//
// Wires up:
// - content script chrome.runtime.sendMessage → background's chrome.runtime.onMessage
// - background's chrome.tabs.sendMessage → content script's chrome.runtime.onMessage
// - panel chrome.runtime.connect → background's chrome.runtime.onConnect (via port pairs)

import { ChromeEvent, createPortPair } from './chrome-api';
import { HarnessTab, HarnessFrame, HarnessDocument, HarnessWindow } from './harness-models';
import type { MockPort } from './chrome-api';
import type { BackgroundChrome } from '../background-core';
import type { ContentWindow, ContentChrome } from '../content-core';

// Re-export for consumers
export { ChromeEvent, createPortPair, flushPromises } from './chrome-api';
export type { MockPort } from './chrome-api';
export { HarnessTab, HarnessFrame, HarnessDocument, HarnessWindow } from './harness-models';

// ---------------------------------------------------------------------------
// ChromeExtensionEnv — wires content scripts, background, and panel together
// ---------------------------------------------------------------------------

export class ChromeExtensionEnv {
  // Events for the background service worker's listener registrations.
  // Not `readonly` because resetBgEvents() reassigns them when simulating
  // a service-worker restart (e.g., the harness's "Reload extension" button).
  bgOnConnect = new ChromeEvent<(port: any) => void>();
  bgRuntimeOnMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => void>();
  bgOnCommitted = new ChromeEvent<(details: { tabId: number; frameId: number; url: string; transitionType: string; transitionQualifiers: string[] }) => void>();
  bgOnCreatedNavTarget = new ChromeEvent<(details: any) => void>();
  bgOnTabRemoved = new ChromeEvent<(tabId: number) => void>();

  /** Mock storage data — returned by chrome.storage.local.get */
  storageData: Record<string, any> = {};

  /** Mock session storage — returned by chrome.storage.session.get */
  sessionStorageData: Record<string, any> = {};

  // Tab/frame registry using harness models
  private tabs = new Map<number, HarnessTab>();

  // Content script onMessage events, keyed by "tabId:frameId"
  private contentOnMessage = new Map<string, ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>>();
  // Track which window each content script was injected for, to detect navigation
  private contentInjectedWindow = new Map<string, any>();

  /** Content script init function — called by the executeScript mock to inject content scripts. */
  private _initContentScript?: (win: ContentWindow, chrome: ContentChrome) => void;

  constructor(initContentScript?: (win: ContentWindow, chrome: ContentChrome) => void) {
    this._initContentScript = initContentScript;
  }

  /**
   * Register a pre-built HarnessTab with this env (used by HarnessRuntime).
   * Wires the tab's onCommitted event to bgOnCommitted.
   */
  registerTab(tab: HarnessTab): void {
    this.tabs.set(tab.id, tab);
    tab.onCommitted = this.bgOnCommitted;
  }

  /**
   * Reset all background-side event channels. Used by the harness to simulate
   * an SW restart: the next initBackgroundScript() call won't accumulate
   * listeners on top of the previous SW's. Tabs already registered are re-wired
   * to the new bgOnCommitted so navigation events still flow.
   */
  resetBgEvents(): void {
    this.bgOnConnect = new ChromeEvent<(port: any) => void>();
    this.bgRuntimeOnMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => void>();
    this.bgOnCommitted = new ChromeEvent<(details: { tabId: number; frameId: number; url: string; transitionType: string; transitionQualifiers: string[] }) => void>();
    this.bgOnCreatedNavTarget = new ChromeEvent<(details: any) => void>();
    this.bgOnTabRemoved = new ChromeEvent<(tabId: number) => void>();
    for (const tab of this.tabs.values()) {
      tab.onCommitted = this.bgOnCommitted;
    }
  }

  /**
   * Creates the chrome API mock for the background service worker.
   * Pass to initBackgroundScript() directly.
   */
  createBackgroundChrome(): BackgroundChrome {
    const env = this;
    return {
      runtime: {
        onConnect: env.bgOnConnect,
        onMessage: env.bgRuntimeOnMessage,
      },
      scripting: {
        async executeScript(options: { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; files?: string[]; func?: (...args: any[]) => any; args?: any[] }) {
          const tab = env.tabs.get(options.target.tabId);
          if (!tab) return [];

          let frames: HarnessFrame[];
          if (options.target.allFrames) {
            frames = tab.getAllFrames();
          } else if (options.target.frameIds) {
            frames = options.target.frameIds
              .map(fid => tab.getFrame(fid))
              .filter((f): f is HarnessFrame => f != null);
          } else {
            return [];
          }

          if (options.func) {
            // Simulate Chrome injecting a function into the page's isolated
            // world. Real Chrome serializes options.func via toString() and
            // calls it with options.args inside the isolated world, where
            // bare `self`/`window` references resolve to the page globals.
            // The harness can't change globalThis.window (non-configurable
            // getter in real browsers), so the convention is: bootstrap-style
            // funcs accept optional trailing overrides for `self` and
            // `window` and fall back to the real globals when absent.
            // We pass the frame's window for both override slots — they are
            // conceptually the same in the isolated world.
            for (const frame of frames) {
              if (!frame.window) continue;
              options.func.apply(null, [
                ...(options.args ?? []),
                frame.window,
                frame.window,
              ]);
            }
            return [];
          }

          if (options.files && env._initContentScript) {
            for (const frame of frames) {
              if (frame.window) {
                env._initContentScript(
                  frame.window,
                  env.createContentChrome(frame),
                );
              }
            }
          }
          return [];
        },
      },
      tabs: {
        async sendMessage(tabId: number, msg: any, options?: { frameId?: number; documentId?: string }) {
          // documentId targeting models real Chrome: locate the frame whose current
          // document has the matching id and dispatch to its content script. If no
          // such document exists or no listener is attached, reject — Chrome's
          // wording at the time of writing is "Could not establish connection.
          // Receiving end does not exist." (we don't depend on the exact wording;
          // anything with .message satisfies callers).
          if (options?.documentId) {
            const tab = env.tabs.get(tabId);
            const frame = tab?.getAllFrames().find(f => f.currentDocument?.documentId === options.documentId);
            const frameKey = frame ? `${tabId}:${frame.frameId}` : null;
            const event = frameKey ? env.contentOnMessage.get(frameKey) : null;
            if (!event) {
              throw new Error('Could not establish connection. Receiving end does not exist.');
            }
            return new Promise<any>(resolve => {
              let responded = false;
              const sendResponse = (r: any) => { responded = true; resolve(r); };
              const returnValues = event.fire(msg, {}, sendResponse);
              const keepOpen = returnValues.some((v: any) => v === true);
              if (!responded && !keepOpen) resolve(undefined);
            });
          }

          // frameId-only path: existing behavior, silent undefined when no listener.
          const frameId = options?.frameId ?? 0;
          const key = `${tabId}:${frameId}`;
          const event = env.contentOnMessage.get(key);
          if (!event) return undefined;

          return new Promise<any>(resolve => {
            let responded = false;
            const sendResponse = (r: any) => {
              responded = true;
              resolve(r);
            };
            const returnValues = event.fire(msg, {}, sendResponse);
            // Model Chrome's return true behavior: if any listener returned true,
            // keep the channel open and wait for sendResponse to be called.
            // If no listener returned true and sendResponse wasn't called,
            // resolve immediately (matching Chrome's default behavior).
            const keepOpen = returnValues.some((v: any) => v === true);
            if (!responded && !keepOpen) resolve(undefined);
          });
        },
        onRemoved: env.bgOnTabRemoved,
      },
      webNavigation: {
        async getAllFrames({ tabId }: { tabId: number }) {
          const tab = env.tabs.get(tabId);
          if (!tab) return null;
          return tab.getAllFrames().map(f => f.toFrameInfo());
        },
        async getFrame({ tabId, frameId }: { tabId: number; frameId: number }) {
          const tab = env.tabs.get(tabId);
          const frame = tab?.getFrame(frameId);
          if (!frame) return null;
          return frame.toFrameInfo();
        },
        onCommitted: env.bgOnCommitted,
        onCreatedNavigationTarget: env.bgOnCreatedNavTarget,
      },
      storage: {
        local: {
          get(keys: string | string[]) {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, any> = {};
            for (const key of keyArr) {
              if (key in env.storageData) {
                result[key] = env.storageData[key];
              }
            }
            return Promise.resolve(result);
          },
        },
        session: {
          get(keys: string | string[]) {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, any> = {};
            for (const key of keyArr) {
              if (key in env.sessionStorageData) result[key] = env.sessionStorageData[key];
            }
            return Promise.resolve(result);
          },
          set(items: Record<string, any>) {
            Object.assign(env.sessionStorageData, items);
            return Promise.resolve();
          },
        },
      },
    };
  }

  /**
   * Creates a chrome API object for a content script running in a specific frame.
   */
  createContentChrome(frame: HarnessFrame) {
    const env = this;
    const tabId = frame.tab.id;
    const frameId = frame.frameId;
    const documentId = frame.currentDocument?.documentId;
    const sender = {
      tab: { id: tabId },
      frameId,
      documentId,
    };

    const key = `${tabId}:${frameId}`;
    const currentWindow = frame.window;
    const previousWindow = env.contentInjectedWindow.get(key);
    // If the frame navigated (new window), create a fresh event to discard old
    // listeners — mirrors Chrome destroying execution contexts on navigation.
    // Otherwise reuse (content script guards against double-injection).
    let onMessage: ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>;
    if (previousWindow && previousWindow !== currentWindow) {
      onMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>();
    } else {
      onMessage = env.contentOnMessage.get(key) ?? new ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>();
    }
    env.contentOnMessage.set(key, onMessage);
    env.contentInjectedWindow.set(key, currentWindow);

    return {
      runtime: {
        sendMessage(msg: any) {
          env.bgRuntimeOnMessage.fire(msg, sender, () => {});
        },
        onMessage,
      },
    };
  }

  /**
   * Simulates a DevTools panel connecting to the background.
   * Returns the panel's port and a messages array that collects all received messages.
   */
  connectPanel(tabId: number): { port: MockPort; messages: any[] } {
    const [panelPort, bgPort] = createPortPair('postmessage-panel');

    // Collect messages sent to panel — register before init so buffered messages are captured
    const messages: any[] = [];
    panelPort.onMessage.addListener((msg: any) => messages.push(msg));

    // Fire onConnect on background side
    this.bgOnConnect.fire(bgPort);

    // Panel sends init
    panelPort.postMessage({ type: 'init', tabId });

    return { port: panelPort, messages };
  }
}
