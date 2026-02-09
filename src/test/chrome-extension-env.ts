// Chrome extension test harness — simulates the Chrome runtime environment
// for integration testing content scripts, background service worker, and panel.
//
// Wires up:
// - content script chrome.runtime.sendMessage → background's chrome.runtime.onMessage
// - background's chrome.tabs.sendMessage → content script's chrome.runtime.onMessage
// - panel chrome.runtime.connect → background's chrome.runtime.onConnect (via port pairs)

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// ChromeEvent — mimics chrome.events.Event (addListener/removeListener)
// ---------------------------------------------------------------------------

export class ChromeEvent<T extends (...args: any[]) => any> {
  private listeners: T[] = [];

  addListener = vi.fn((cb: T) => {
    this.listeners.push(cb);
  });

  removeListener = vi.fn((cb: T) => {
    this.listeners = this.listeners.filter(l => l !== cb);
  });

  hasListener = vi.fn((cb: T) => this.listeners.includes(cb));
  hasListeners = vi.fn(() => this.listeners.length > 0);

  /** Test helper: invoke all registered listeners */
  fire(...args: Parameters<T>): ReturnType<T>[] {
    return this.listeners.map(l => l(...args));
  }
}

// ---------------------------------------------------------------------------
// Port pairs — connected mock ports for panel ↔ background communication
// ---------------------------------------------------------------------------

export interface MockPort {
  name: string;
  postMessage(msg: any): void;
  onMessage: ChromeEvent<(msg: any) => void>;
  onDisconnect: ChromeEvent<() => void>;
  disconnect(): void;
  sender?: { tab?: { id: number }; frameId?: number; documentId?: string };
}

export function createPortPair(
  name: string,
  sender?: MockPort['sender']
): [MockPort, MockPort] {
  const port1OnMessage = new ChromeEvent<(msg: any) => void>();
  const port2OnMessage = new ChromeEvent<(msg: any) => void>();
  const port1OnDisconnect = new ChromeEvent<() => void>();
  const port2OnDisconnect = new ChromeEvent<() => void>();

  const port1: MockPort = {
    name,
    postMessage: vi.fn((msg: any) => port2OnMessage.fire(msg)),
    onMessage: port1OnMessage,
    onDisconnect: port1OnDisconnect,
    disconnect: vi.fn(() => port2OnDisconnect.fire()),
    sender,
  };

  const port2: MockPort = {
    name,
    postMessage: vi.fn((msg: any) => port1OnMessage.fire(msg)),
    onMessage: port2OnMessage,
    onDisconnect: port2OnDisconnect,
    disconnect: vi.fn(() => port1OnDisconnect.fire()),
    sender,
  };

  return [port1, port2];
}

// ---------------------------------------------------------------------------
// Mock window — lightweight window mock for content script testing
// ---------------------------------------------------------------------------

export interface MockWindowOptions {
  location: { href: string; origin: string };
  title?: string;
  /** Another mock window. Defaults to self (top-level frame). */
  parent?: any;
  opener?: any | null;
  iframes?: Array<{ src: string; id: string; contentWindow: any }>;
}

export interface MockWindow {
  location: { href: string; origin: string };
  opener: any | null;
  parent: any;
  top: any;
  frames: any;
  document: {
    title: string;
    querySelectorAll: ReturnType<typeof vi.fn>;
  };
  addEventListener: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  /** Test helper: dispatch a MessageEvent to this window's 'message' listeners */
  dispatchMessage(data: any, origin: string, source: any): void;
  /** Internal iframe elements for querySelectorAll */
  _iframes: any[];
  /** Guard property used by content script */
  __postmessage_devtools_content__?: boolean;
}

export function createMockWindow(options: MockWindowOptions): MockWindow {
  const messageListeners: ((event: any) => void)[] = [];

  const iframes = (options.iframes || []).map(iframe => ({
    src: iframe.src,
    id: iframe.id,
    contentWindow: iframe.contentWindow,
    // Minimal DOM Element properties needed by getDomPath
    nodeName: 'IFRAME',
    nodeType: 1, // Node.ELEMENT_NODE
    parentElement: null,
    previousElementSibling: null,
  }));

  const win: MockWindow = {
    location: { ...options.location },
    opener: options.opener ?? null,
    parent: null as any, // set below
    top: null as any,    // set below
    frames: null as any, // set below
    _iframes: iframes,
    document: {
      title: options.title ?? '',
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === 'iframe') return win._iframes;
        return [];
      }),
    },
    addEventListener: vi.fn((type: string, cb: Function, _capture?: boolean) => {
      if (type === 'message') messageListeners.push(cb as any);
    }),
    postMessage: vi.fn(),
    dispatchMessage(data: any, origin: string, source: any) {
      const event = {
        data,
        origin,
        source,
        stopImmediatePropagation: vi.fn(),
      };
      for (const cb of messageListeners) {
        cb(event);
      }
    },
  };

  // Self-referential defaults
  win.parent = options.parent ?? win;
  win.top = win; // simplified: top is self unless explicitly set

  // frames array: contentWindows from iframes, with numeric indexing + length
  const framesArr: any = iframes.map(f => f.contentWindow);
  framesArr.length = iframes.length;
  win.frames = framesArr;

  return win;
}

/** Add an iframe to an existing mock window */
export function addIframeToWindow(
  parentWin: MockWindow,
  iframe: { src: string; id: string; contentWindow: any }
): void {
  parentWin._iframes.push({
    src: iframe.src,
    id: iframe.id,
    contentWindow: iframe.contentWindow,
    nodeName: 'IFRAME',
    nodeType: 1,
    parentElement: null,
    previousElementSibling: null,
  });
  const framesArr: any = parentWin._iframes.map((f: any) => f.contentWindow);
  framesArr.length = parentWin._iframes.length;
  parentWin.frames = framesArr;
}

// ---------------------------------------------------------------------------
// ChromeExtensionEnv — wires content scripts, background, and panel together
// ---------------------------------------------------------------------------

export interface FrameConfig {
  tabId: number;
  frameId: number;
  parentFrameId: number;
  documentId: string;
  url: string;
}

export class ChromeExtensionEnv {
  // Events for the background service worker's listener registrations
  readonly bgOnConnect = new ChromeEvent<(port: any) => void>();
  readonly bgRuntimeOnMessage = new ChromeEvent<(msg: any, sender: any) => void>();
  readonly bgOnCommitted = new ChromeEvent<(details: any) => void>();
  readonly bgOnCreatedNavTarget = new ChromeEvent<(details: any) => void>();
  readonly bgOnTabRemoved = new ChromeEvent<(tabId: number) => void>();

  /** Mock storage data — returned by chrome.storage.local.get */
  storageData: Record<string, any> = {};

  // Frame registry for webNavigation mock responses
  private frames = new Map<string, FrameConfig>();

  // Content script onMessage events, keyed by "tabId:frameId"
  private contentOnMessage = new Map<string, ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>>();

  /** Register a frame in the mock webNavigation database */
  addFrame(config: FrameConfig): void {
    this.frames.set(`${config.tabId}:${config.frameId}`, config);
  }

  /**
   * Creates the global `chrome` mock for the background service worker.
   * Assign to globalThis.chrome before importing background.ts.
   */
  createBackgroundChrome(): any {
    const env = this;
    return {
      runtime: {
        onConnect: env.bgOnConnect,
        onMessage: env.bgRuntimeOnMessage,
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([]),
      },
      tabs: {
        sendMessage: vi.fn(async (tabId: number, msg: any, options?: { frameId?: number }) => {
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
            // If listener didn't call sendResponse synchronously, resolve undefined
            if (!responded) resolve(undefined);
          });
        }),
        onRemoved: env.bgOnTabRemoved,
      },
      webNavigation: {
        getAllFrames: vi.fn(async ({ tabId }: { tabId: number }) => {
          return [...env.frames.values()].filter(f => f.tabId === tabId);
        }),
        getFrame: vi.fn(async ({ tabId, frameId }: { tabId: number; frameId: number }) => {
          return env.frames.get(`${tabId}:${frameId}`) ?? null;
        }),
        onCommitted: env.bgOnCommitted,
        onCreatedNavigationTarget: env.bgOnCreatedNavTarget,
      },
      storage: {
        local: {
          get: vi.fn((keys: string | string[]) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, any> = {};
            for (const key of keyArr) {
              if (key in env.storageData) {
                result[key] = env.storageData[key];
              }
            }
            return Promise.resolve(result);
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  }

  /**
   * Creates a chrome API object for a content script running in a specific frame.
   *
   * - sendMessage routes to background's onMessage listeners with appropriate sender info
   * - onMessage receives messages from background's tabs.sendMessage
   */
  createContentChrome(tabId: number, frameId: number, documentId: string) {
    const env = this;
    const sender = {
      tab: { id: tabId },
      frameId,
      documentId,
    };

    const onMessage = new ChromeEvent<(msg: any, sender: any, sendResponse: any) => any>();
    env.contentOnMessage.set(`${tabId}:${frameId}`, onMessage);

    return {
      runtime: {
        sendMessage: vi.fn((msg: any) => {
          env.bgRuntimeOnMessage.fire(msg, sender);
        }),
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

/** Flush pending microtasks (resolved promises) */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
