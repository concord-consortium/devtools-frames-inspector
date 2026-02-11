// Test harness models — vi.fn()-free representations of Tab, Frame, Document, Window, IFrame.
// These can run in both vitest and a real browser (for Playwright-based testing).

// ---------------------------------------------------------------------------
// HarnessTab
// ---------------------------------------------------------------------------

export class HarnessTab {
  readonly id: number;
  readonly frames = new Map<number, HarnessFrame>();
  private _nextFrameId = 1; // 0 is reserved for top frame

  constructor(id: number) {
    this.id = id;
  }

  nextFrameId(): number {
    return this._nextFrameId++;
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

  constructor(tab: HarnessTab, frameId: number, parentFrameId: number) {
    this.tab = tab;
    this.frameId = frameId;
    this.parentFrameId = parentFrameId;
  }

  /**
   * Add an iframe to this frame. Automatically creates the child frame,
   * document, window, and cross-origin proxy wiring.
   * Returns the child HarnessFrame (access .window for the raw HarnessWindow).
   */
  addIframe(config: { url: string; iframeId?: string; title?: string }): HarnessFrame {
    const frameId = this.tab.nextFrameId();
    const origin = new URL(config.url).origin;

    const childFrame = new HarnessFrame(this.tab, frameId, this.frameId);
    childFrame.currentDocument = new HarnessDocument(`doc-f${frameId}`, config.url, config.title);
    const childWin = new HarnessWindow({
      location: { href: config.url, origin },
      title: config.title,
    });
    childFrame.window = childWin;
    this.tab.addFrame(childFrame);

    // Create cross-origin proxy pair
    const parentWin = this.window!;
    const { aForB: parentProxyForChild, bForA: childProxyForParent } =
      createProxyPair(parentWin, childWin);

    // Wire parent↔child proxy relationships
    childWin.setParentProxy(parentWin, parentProxyForChild);
    parentWin.registerChildProxy(childWin, childProxyForParent);

    // Create iframe element with proxy as contentWindow (matches real browser behavior)
    const iframe = new HarnessIFrame(config.url, config.iframeId ?? '', childProxyForParent);
    parentWin.addIframeElement(iframe);

    return childFrame;
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
  private _target: HarnessWindow;
  private _callerOrigin: string;

  /** The peer proxy: proxy of the caller window as seen by the target's content script */
  _peerProxy!: CrossOriginWindowProxy;

  constructor(target: HarnessWindow, callerOrigin: string) {
    this._target = target;
    this._callerOrigin = callerOrigin;
  }

  postMessage(data: any, _targetOrigin: string): void {
    // Deliver asynchronously like real postMessage.
    // event.source is the peer proxy so equality checks in content-core.ts work.
    setTimeout(() => {
      this._target.dispatchMessage(data, this._callerOrigin, this._peerProxy);
    }, 0);
  }

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
  winA: HarnessWindow, winB: HarnessWindow
): { aForB: CrossOriginWindowProxy; bForA: CrossOriginWindowProxy } {
  const aForB = new CrossOriginWindowProxy(winA, winB.location.origin);
  const bForA = new CrossOriginWindowProxy(winB, winA.location.origin);

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
  parent?: HarnessWindow;
  opener?: HarnessWindow | null;
}

export class HarnessWindow {
  location: { href: string; origin: string };
  top: HarnessWindow;
  document: { title: string; querySelectorAll(selector: string): any[] };
  __postmessage_devtools_content__?: boolean;

  private _rawParent: HarnessWindow;
  private _parentProxy: CrossOriginWindowProxy | null = null;
  private _rawOpener: HarnessWindow | null;
  private _openerProxy: CrossOriginWindowProxy | null = null;

  private messageListeners: ((event: any) => void)[] = [];
  private iframeElements: HarnessIFrame[] = [];

  /** Proxies of child windows, keyed by the raw child HarnessWindow.
   *  Used by dispatchMessage() to resolve raw window sources to proxies. */
  private _childProxies = new Map<HarnessWindow, CrossOriginWindowProxy>();

  constructor(options: HarnessWindowOptions) {
    this.location = { ...options.location };
    this._rawParent = options.parent ?? this;
    this.top = this; // simplified: top is self unless explicitly set
    this._rawOpener = options.opener ?? null;

    const self = this;
    this.document = {
      title: options.title ?? '',
      querySelectorAll(selector: string): any[] {
        if (selector === 'iframe') return [...self.iframeElements];
        return [];
      },
    };
  }

  get parent(): HarnessWindow | CrossOriginWindowProxy {
    return this._parentProxy ?? this._rawParent;
  }

  get opener(): HarnessWindow | CrossOriginWindowProxy | null {
    return this._openerProxy ?? this._rawOpener;
  }

  addEventListener(type: string, cb: (event: any) => void, _capture?: boolean): void {
    if (type === 'message') this.messageListeners.push(cb);
  }

  postMessage(data: any, _targetOrigin: string): void {
    // postMessage called directly on a HarnessWindow = self-message
    setTimeout(() => {
      this.dispatchMessage(data, this.location.origin, this);
    }, 0);
  }

  get frames(): any {
    const arr: any = this.iframeElements.map(f => f.contentWindow);
    arr.length = this.iframeElements.length;
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
      const childProxy = this._childProxies.get(source);
      if (childProxy) {
        resolvedSource = childProxy;
      } else if (source === this._rawParent && this._parentProxy) {
        resolvedSource = this._parentProxy;
      }
      // TODO: opener translation
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
  addIframeElement(iframe: HarnessIFrame): void {
    this.iframeElements.push(iframe);
  }

  /** Register a proxy for a child window (for dispatchMessage source resolution). */
  registerChildProxy(childWin: HarnessWindow, proxy: CrossOriginWindowProxy): void {
    this._childProxies.set(childWin, proxy);
  }

  /** Set the parent relationship with a cross-origin proxy. */
  setParentProxy(rawParent: HarnessWindow, proxy: CrossOriginWindowProxy): void {
    this._rawParent = rawParent;
    this._parentProxy = proxy;
  }
}

// ---------------------------------------------------------------------------
// HarnessIFrame
// ---------------------------------------------------------------------------

export class HarnessIFrame {
  readonly src: string;
  readonly id: string;
  readonly contentWindow: CrossOriginWindowProxy;
  readonly nodeName = 'IFRAME' as const;
  readonly nodeType = 1; // Node.ELEMENT_NODE
  readonly parentElement = null;
  readonly previousElementSibling = null;

  constructor(src: string, id: string, contentWindow: CrossOriginWindowProxy) {
    this.src = src;
    this.id = id;
    this.contentWindow = contentWindow;
  }
}
