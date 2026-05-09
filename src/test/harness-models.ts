// Test harness models — vi.fn()-free representations of Tab, Frame, Document, Window, IFrame.
// These can run in both vitest and a real browser (for Playwright-based testing).

import { ChromeEvent } from './chrome-api';

// ---------------------------------------------------------------------------
// HarnessTab
// ---------------------------------------------------------------------------

export class HarnessTab {
  readonly id: number;
  readonly frames = new Map<number, HarnessFrame>();

  /** Fired when a frame in this tab navigates or loads. Assigned by ChromeExtensionEnv to bgOnCommitted. */
  onCommitted: ChromeEvent<(details: { tabId: number; frameId: number; url: string; transitionType: string; transitionQualifiers: string[] }) => void> =
    new ChromeEvent();

  constructor(id: number) {
    this.id = id;
  }

  addFrame(frame: HarnessFrame): void {
    this.frames.set(frame.frameId, frame);
  }

  getFrame(frameId: number): HarnessFrame | undefined {
    return this.frames.get(frameId);
  }

  getAllFrames(): HarnessFrame[] {
    return [...this.frames.values()];
  }
}

// ---------------------------------------------------------------------------
// HarnessFrame
// ---------------------------------------------------------------------------

export class HarnessFrame {
  readonly tab: HarnessTab;
  readonly frameId: number;
  readonly parentFrameId: number;
  currentDocument: HarnessDocument | undefined;
  window: HarnessWindow | undefined;

  /** Proxy info set during iframe/opener wiring, used when creating windows in onCommitted */
  _parentFrame?: HarnessFrame;
  _parentProxyForSelf?: CrossOriginWindowProxy;
  _openerFrame?: HarnessFrame;
  _openerProxyForSelf?: CrossOriginWindowProxy;

  constructor(tab: HarnessTab, frameId: number, parentFrameId: number) {
    this.tab = tab;
    this.frameId = frameId;
    this.parentFrameId = parentFrameId;
  }

  toFrameInfo(): { tabId: number; frameId: number; parentFrameId: number; documentId: string | undefined; url: string } {
    return {
      tabId: this.tab.id,
      frameId: this.frameId,
      parentFrameId: this.parentFrameId,
      documentId: this.currentDocument?.documentId,
      url: this.currentDocument?.url ?? '',
    };
  }
}

// ---------------------------------------------------------------------------
// HarnessDocument
// ---------------------------------------------------------------------------

export class HarnessDocument {
  readonly documentId: string;
  readonly url: string;
  readonly title: string;

  constructor(documentId: string, url: string, title: string = '') {
    this.documentId = documentId;
    this.url = url;
    this.title = title;
  }
}

// ---------------------------------------------------------------------------
// CrossOriginWindowProxy — models the restricted cross-origin window reference
// ---------------------------------------------------------------------------

/**
 * Simulates the cross-origin WindowProxy that browsers return for
 * window.parent, window.opener, and window.frames[i] when origins differ.
 * Only postMessage and a few properties are accessible.
 *
 * Created in pairs via createProxyPair() — each proxy knows the correct
 * event.source to use when delivering messages (the peer proxy).
 */
export class CrossOriginWindowProxy {
  private _target: HarnessFrame;

  /** The peer proxy: proxy of the caller window as seen by the target's content script */
  _peerProxy!: CrossOriginWindowProxy;

  constructor(target: HarnessFrame) {
    this._target = target;
  }

  postMessage(data: any, _targetOrigin: string): void {
    // Deliver asynchronously like real postMessage.
    // event.source is the peer proxy so equality checks in content-core.ts work.
    setTimeout(() => {
      const targetWin = this._target.window;
      if (!targetWin) return;
      const callerOrigin = this._peerProxy._target.window?.location.origin ?? '';
      targetWin.dispatchMessage(data, callerOrigin, this._peerProxy);
    }, 0);
  }

  // window.origin is accessible cross-origin in real browsers
  get origin(): string { return this._target.window?.location.origin ?? ''; }

  get closed(): boolean { return false; }
}

/**
 * Create a pair of cross-origin proxies for two related windows.
 *
 * Given windows A and B:
 * - aForB: proxy of A, used by B (e.g. child's view of parent)
 *   calling aForB.postMessage() dispatches on A with source = bForA
 * - bForA: proxy of B, used by A (e.g. parent's view of child)
 *   calling bForA.postMessage() dispatches on B with source = aForB
 */
export function createProxyPair(
  frameA: HarnessFrame, frameB: HarnessFrame
): { aForB: CrossOriginWindowProxy; bForA: CrossOriginWindowProxy } {
  const aForB = new CrossOriginWindowProxy(frameA);
  const bForA = new CrossOriginWindowProxy(frameB);

  // Wire the circular reference: each proxy's peer is the other
  aForB._peerProxy = bForA;
  bForA._peerProxy = aForB;

  return { aForB, bForA };
}

// ---------------------------------------------------------------------------
// HarnessWindow
// ---------------------------------------------------------------------------

export interface HarnessWindowOptions {
  location: { href: string; origin: string };
  title?: string;
}

export interface HarnessDocumentElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function createDocumentElementMock(): HarnessDocumentElement {
  const attrs = new Map<string, string>();
  return {
    getAttribute(name: string): string | null {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
    setAttribute(name: string, value: string): void {
      attrs.set(name, value);
    },
  };
}

export class HarnessWindow {
  location: { href: string; origin: string };
  top: HarnessWindow;
  document: {
    title: string;
    documentElement: HarnessDocumentElement;
    querySelector(selector: string): Element | null;
    querySelectorAll(selector: string): NodeListOf<Element>;
  };

  /** Mirrors window.origin — shorthand for location.origin */
  get origin(): string { return this.location.origin; }

  private _parentFrame: HarnessFrame | null = null;
  private _parentProxy: CrossOriginWindowProxy | null = null;
  private _openerFrame: HarnessFrame | null = null;
  private _openerProxy: CrossOriginWindowProxy | null = null;

  private messageListeners: ((event: any) => void)[] = [];
  // Listeners for non-'message' event types (e.g. probe events). Keyed by
  // type name. Dispatched synchronously by dispatchEvent.
  private eventListeners: Map<string, Array<(event: any) => void>> = new Map();
  // Detached div — never appended to the document.
  // If you do the iframe src URLs will actually load.
  private _iframeContainer = document.createElement('div');

  /** Proxies of child frames, keyed by HarnessFrame (stable across navigations).
   *  Used by dispatchMessage() to resolve raw window sources to proxies. */
  private _childProxies = new Map<HarnessFrame, CrossOriginWindowProxy>();
  private _openedWindowProxies = new Map<HarnessFrame, CrossOriginWindowProxy>();

  constructor(options: HarnessWindowOptions) {
    this.location = { ...options.location };
    this.top = this; // simplified: top is self unless explicitly set

    const container = this._iframeContainer;
    this.document = {
      title: options.title ?? '',
      documentElement: createDocumentElementMock(),
      querySelector(selector: string) {
        return container.querySelector(selector);
      },
      querySelectorAll(selector: string) {
        return container.querySelectorAll(selector);
      },
    };
  }

  get parent(): HarnessWindow | CrossOriginWindowProxy {
    if (this._parentProxy) return this._parentProxy;
    return this;
  }

  get opener(): HarnessWindow | CrossOriginWindowProxy | null {
    if (this._openerProxy) return this._openerProxy;
    return null;
  }

  addEventListener(type: string, cb: (event: any) => void, _capture?: boolean): void {
    if (type === 'message') {
      this.messageListeners.push(cb);
      return;
    }
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type)!.push(cb);
  }

  removeEventListener(type: string, cb: (event: any) => void, _capture?: boolean): void {
    if (type === 'message') {
      this.messageListeners = this.messageListeners.filter(l => l !== cb);
      return;
    }
    const list = this.eventListeners.get(type);
    if (!list) return;
    this.eventListeners.set(type, list.filter(l => l !== cb));
  }

  /**
   * Dispatch a non-'message' event synchronously to all listeners registered
   * for the matching type. Used by the bootstrap probe protocol — DOM events
   * propagate synchronously across isolated worlds in real Chrome, so the
   * harness models that by invoking listeners inline (no setTimeout).
   * Listener errors are swallowed so one failing listener does not block
   * others.
   */
  dispatchEvent(event: any): boolean {
    const type = event?.type;
    if (!type) return true;
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const cb of listeners.slice()) {
        try { cb(event); } catch { /* swallow listener errors */ }
      }
    }
    return true;
  }

  postMessage(data: any, _targetOrigin: string): void {
    // postMessage called directly on a HarnessWindow = self-message
    setTimeout(() => {
      this.dispatchMessage(data, this.location.origin, this);
    }, 0);
  }

  get frames(): any {
    const iframes = this._iframeContainer.querySelectorAll('iframe');
    const arr: any = Array.from(iframes).map(f => f.contentWindow);
    arr.length = iframes.length;
    return arr;
  }

  /**
   * Dispatch a MessageEvent to this window's 'message' listeners.
   * If source is a raw HarnessWindow with a known proxy relationship to this
   * window, the source is automatically translated to the correct proxy so
   * that equality checks in content-core.ts work.
   */
  dispatchMessage(data: any, origin: string, source: any): void {
    let resolvedSource = source;
    if (source instanceof HarnessWindow) {
      // Resolve raw HarnessWindow sources to their cross-origin proxy.
      // Maps are keyed by HarnessFrame (stable), so we match via frame.window.
      for (const [frame, proxy] of this._childProxies) {
        if (frame.window === source) { resolvedSource = proxy; break; }
      }
      if (resolvedSource === source) {
        for (const [frame, proxy] of this._openedWindowProxies) {
          if (frame.window === source) { resolvedSource = proxy; break; }
        }
      }
      if (resolvedSource === source && this._parentFrame?.window === source && this._parentProxy) {
        resolvedSource = this._parentProxy;
      }
      if (resolvedSource === source && this._openerFrame?.window === source && this._openerProxy) {
        resolvedSource = this._openerProxy;
      }
    }

    const event = {
      data,
      origin,
      source: resolvedSource,
      stopImmediatePropagation() { /* no-op */ },
    };
    for (const cb of this.messageListeners) {
      cb(event);
    }
  }

  // --- Internal wiring methods (used by ChromeExtensionEnv) ---

  /** Add an iframe element to this window's DOM. */
  addIframeElement(config: { src: string; id: string; contentWindow: CrossOriginWindowProxy }): void {
    const el = document.createElement('iframe');
    el.src = config.src;
    if (config.id) el.id = config.id;
    Object.defineProperty(el, 'contentWindow', { value: config.contentWindow, configurable: true });
    this._iframeContainer.appendChild(el);
  }

  /** Remove an iframe element whose contentWindow matches the given proxy. */
  removeIframeElement(contentWindow: CrossOriginWindowProxy): void {
    const iframes = this._iframeContainer.querySelectorAll('iframe');
    for (const el of iframes) {
      if ((el.contentWindow as unknown) === contentWindow) {
        el.remove();
        return;
      }
    }
  }

  /** Get the proxy for a child frame (if registered). */
  getChildProxy(childFrame: HarnessFrame): CrossOriginWindowProxy | undefined {
    return this._childProxies.get(childFrame);
  }

  /** Register a proxy for a child frame (for dispatchMessage source resolution). */
  registerChildProxy(childFrame: HarnessFrame, proxy: CrossOriginWindowProxy): void {
    this._childProxies.set(childFrame, proxy);
  }

  /** Set the parent relationship with a cross-origin proxy. */
  setParentProxy(parentFrame: HarnessFrame, proxy: CrossOriginWindowProxy): void {
    this._parentFrame = parentFrame;
    this._parentProxy = proxy;
  }

  /** Register a proxy for an opened window (for dispatchMessage source resolution). */
  registerOpenedWindowProxy(openedFrame: HarnessFrame, proxy: CrossOriginWindowProxy): void {
    this._openedWindowProxies.set(openedFrame, proxy);
  }

  /** Set the opener relationship with a cross-origin proxy. */
  setOpenerProxy(openerFrame: HarnessFrame, proxy: CrossOriginWindowProxy): void {
    this._openerFrame = openerFrame;
    this._openerProxy = proxy;
  }
}

