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

// Re-export for consumers
export { ChromeEvent, createPortPair, flushPromises } from './chrome-api';
export type { MockPort } from './chrome-api';
export { HarnessTab, HarnessFrame, HarnessDocument, HarnessWindow } from './harness-models';

// ---------------------------------------------------------------------------
// ChromeExtensionEnv — wires content scripts, background, and panel together
// ---------------------------------------------------------------------------

export class ChromeExtensionEnv {
  // Events for the background service worker's listener registrations
  readonly bgOnConnect = new ChromeEvent<(port: any) => void>();
  readonly bgRuntimeOnMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => void>();
  readonly bgOnCommitted = new ChromeEvent<(details: any) => void>();
  readonly bgOnCreatedNavTarget = new ChromeEvent<(details: any) => void>();
  readonly bgOnTabRemoved = new ChromeEvent<(tabId: number) => void>();

  /** Mock storage data — returned by chrome.storage.local.get */
  storageData: Record<string, any> = {};

  // Tab/frame registry using harness models
  private tabs = new Map<number, HarnessTab>();

  // Content script onMessage events, keyed by "tabId:frameId"
  private contentOnMessage = new Map<string, ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>>();

  /**
   * Create a tab with its top-level frame (frameId=0), document, and window.
   * Returns the top-level HarnessFrame (access .window for the HarnessWindow).
   */
  createTab(config: { tabId: number; url: string; title?: string }): HarnessFrame {
    const tab = new HarnessTab(config.tabId);
    this.tabs.set(config.tabId, tab);

    const origin = new URL(config.url).origin;
    const frame = new HarnessFrame(tab, 0, -1);
    frame.currentDocument = new HarnessDocument(`doc-f0`, config.url, config.title);
    frame.window = new HarnessWindow({
      location: { href: config.url, origin },
      title: config.title,
    });
    tab.addFrame(frame);
    return frame;
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
        async executeScript() { return []; },
      },
      tabs: {
        async sendMessage(tabId: number, msg: any, options?: { frameId?: number }) {
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
            event.fire(msg, {}, sendResponse);
            if (!responded) resolve(undefined);
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

    const onMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>();
    env.contentOnMessage.set(`${tabId}:${frameId}`, onMessage);

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
