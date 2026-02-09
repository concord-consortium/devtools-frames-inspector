// Test harness models — vi.fn()-free representations of Tab, Frame, Document, Window, IFrame.
// These can run in both vitest and a real browser (for Playwright-based testing).

// ---------------------------------------------------------------------------
// HarnessTab
// ---------------------------------------------------------------------------

export class HarnessTab {
  readonly id: number;
  readonly frames = new Map<number, HarnessFrame>();

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
  parent: HarnessWindow;
  top: HarnessWindow;
  opener: HarnessWindow | null;
  document: { title: string; querySelectorAll(selector: string): any[] };
  __postmessage_devtools_content__?: boolean;

  private messageListeners: ((event: any) => void)[] = [];
  private iframeElements: HarnessIFrame[] = [];

  constructor(options: HarnessWindowOptions) {
    this.location = { ...options.location };
    this.parent = options.parent ?? this;
    this.top = this; // simplified: top is self unless explicitly set
    this.opener = options.opener ?? null;

    const self = this;
    this.document = {
      title: options.title ?? '',
      querySelectorAll(selector: string): any[] {
        if (selector === 'iframe') return self.iframeElements;
        return [];
      },
    };
  }

  addEventListener(type: string, cb: (event: any) => void, _capture?: boolean): void {
    if (type === 'message') this.messageListeners.push(cb);
  }

  postMessage(_data: any, _targetOrigin: string): void {
    // No-op — tests use dispatchMessage to simulate received messages
  }

  get frames(): any {
    const arr: any = this.iframeElements.map(f => f.contentWindow);
    arr.length = this.iframeElements.length;
    return arr;
  }

  /** Test helper: dispatch a MessageEvent to this window's 'message' listeners */
  dispatchMessage(data: any, origin: string, source: any): void {
    const event = {
      data,
      origin,
      source,
      stopImmediatePropagation() { /* no-op */ },
    };
    for (const cb of this.messageListeners) {
      cb(event);
    }
  }

  /** Test helper: add an iframe to this window */
  addIframe(iframe: HarnessIFrame): void {
    this.iframeElements.push(iframe);
  }
}

// ---------------------------------------------------------------------------
// HarnessIFrame
// ---------------------------------------------------------------------------

export class HarnessIFrame {
  readonly src: string;
  readonly id: string;
  readonly contentWindow: HarnessWindow;
  readonly nodeName = 'IFRAME' as const;
  readonly nodeType = 1; // Node.ELEMENT_NODE
  readonly parentElement = null;
  readonly previousElementSibling = null;

  constructor(src: string, id: string, contentWindow: HarnessWindow) {
    this.src = src;
    this.id = id;
    this.contentWindow = contentWindow;
  }
}
