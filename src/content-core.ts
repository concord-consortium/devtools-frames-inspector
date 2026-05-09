// Content script core logic — extracted for testability.
// In production, content.ts calls initContentScript(window, chrome).
// In tests, call with mock window and chrome objects to simulate multiple content scripts.

import {
  REGISTRATION_MESSAGE_TYPE, BackgroundToContentMessage, IframeElementInfo,
  RawCapturedMessage, FrameInfoResponse, OpenerInfo, PostMessageCapturedMessage,
  ContentToBackgroundMessage, INJECT_ACTION_KEY, SW_ID_KEY, InjectAction,
  PROBE_EVENT_NAME, PROBE_RESPONSE_EVENT_NAME,
} from './types';

/** Minimal window interface needed by the content script */
export interface ContentWindow {
  parent: any;
  top: any;
  opener: any;
  location: { href: string; origin: string };
  document: {
    title: string;
    querySelector(selector: string): Element | null;
    querySelectorAll(selector: string): NodeListOf<Element>;
  };
  frames: { length: number; [index: number]: any };
  addEventListener(type: string, callback: (event: any) => void, capture?: boolean): void;
  dispatchEvent(event: any): boolean;
  __pm_devtools_inject_action__?: 'init' | 'skip' | 'stale';
  __pm_devtools_sw_id__?: string;
}

/** Minimal chrome API interface needed by the content script */
export interface ContentChrome {
  runtime: {
    sendMessage(message: ContentToBackgroundMessage): void;
    onMessage: {
      addListener(callback: (
        message: BackgroundToContentMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: FrameInfoResponse) => void
      ) => boolean | void): void;
    };
  };
}

export function initContentScript(win: ContentWindow, chrome: ContentChrome): void {
  // Read and consume the action set by the bootstrap injection step.
  // Default to 'init' so direct test calls (without a bootstrap) still work.
  const action: InjectAction = win[INJECT_ACTION_KEY] as InjectAction ?? 'init';
  delete win[INJECT_ACTION_KEY];

  if (action === 'skip') return;

  if (action === 'stale') {
    chrome.runtime.sendMessage({ type: 'stale-frame' });
    return;
  }
  // action === 'init': fall through to fresh init.

  const swId = win[SW_ID_KEY];

  // Probe listener: future re-injections (in the same or a later extension
  // lifetime) detect this content script's existence by dispatching a probe
  // event. We respond with our own swId so the new bootstrap can decide
  // whether we are an orphan from a previous lifetime. Once this content
  // script becomes an orphan (extension reload), this closure still holds
  // the OLD swId — exactly what the new bootstrap needs to detect mismatch.
  win.addEventListener(PROBE_EVENT_NAME, (event: any) => {
    const nonce = event?.detail?.nonce;
    if (typeof nonce !== 'string') return;
    win.dispatchEvent(new CustomEvent(PROBE_RESPONSE_EVENT_NAME, {
      detail: { nonce, swId },
    }));
  });

  const sourceEntries = new WeakMap<object, { sourceId: string; type: string }>();

  // Generate a CSS selector path for an element
  function getDomPath(element: Element | null): string {
    const parts: string[] = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.id) {
        selector += '#' + CSS.escape(element.id);
        parts.unshift(selector);
        break; // id is unique, stop here
      }
      // Position among same-type siblings
      let sibling: Element | null = element;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.nodeName === element.nodeName) nth++;
      }
      if (nth > 1) selector += ':nth-of-type(' + nth + ')';
      parts.unshift(selector);
      element = element.parentElement;
    }
    return parts.join(' > ');
  }

  // Generate unique ID (12 chars = 72 bits of entropy)
  function generateId(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += alphabet[bytes[i] & 63];
    }
    return id;
  }

  // Compute the source type from window reference comparisons
  function computeSourceType(eventSource: object): string {
    if (eventSource === win) return 'self';
    if (eventSource === win.parent && win.parent !== win) return 'parent';
    if (eventSource === win.top && win.top !== win) return 'top';
    if (win.opener && eventSource === win.opener) return 'opener';
    for (let i = 0; i < win.frames.length; i++) {
      if (eventSource === win.frames[i]) return 'child';
    }
    return 'unknown';
  }

  // Get or create a stable entry for a message source
  function resolveSourceEntry(sourceWindow: object): { sourceId: string; type: string } {
    let entry = sourceEntries.get(sourceWindow);
    if (!entry) {
      entry = { sourceId: generateId(), type: computeSourceType(sourceWindow) };
      sourceEntries.set(sourceWindow, entry);
    }
    return entry;
  }

  // Extract DOM properties from an iframe element
  function getIframeElementInfo(iframe: HTMLIFrameElement): IframeElementInfo {
    return {
      src: iframe.src || '',
      id: iframe.id || '',
      domPath: getDomPath(iframe)
    };
  }

  // Collect target frame info (the frame receiving the message)
  function getTargetInfo() {
    return {
      url: win.location.href,
      origin: win.location.origin,
      documentTitle: win.document.title || ''
    };
  }

  // Collect source info from a message event
  function getSourceInfo(event: MessageEvent): RawCapturedMessage['source'] {
    const eventSource = event.source;
    const sourceEntry = eventSource ? resolveSourceEntry(eventSource) : null;
    const sourceType = sourceEntry ? sourceEntry.type : 'unknown';

    let iframe: IframeElementInfo | null = null;

    // For child frames, find the iframe element and include its properties
    if (sourceType === 'child') {
      const iframes = win.document.querySelectorAll('iframe') as NodeListOf<HTMLIFrameElement>;
      for (const el of iframes) {
        if (el.contentWindow === event.source) {
          iframe = getIframeElementInfo(el);
          break;
        }
      }
    }

    return {
      type: sourceType,
      origin: event.origin,
      sourceId: sourceEntry ? sourceEntry.sourceId : null,
      iframe
    };
  }

  // Listen for incoming postMessage events
  win.addEventListener('message', (event: MessageEvent) => {
    // Stop propagation of registration messages to prevent app from seeing them
    if (event.data?.type === REGISTRATION_MESSAGE_TYPE) {
      event.stopImmediatePropagation();
    }

    const capturedMessage: RawCapturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      target: getTargetInfo(),
      source: getSourceInfo(event),
      data: event.data
    };

    const message: PostMessageCapturedMessage = {
      type: 'postmessage-captured',
      payload: capturedMessage
    };
    chrome.runtime.sendMessage(message);
  }, true);

  // Get opener info if available
  function getOpenerInfo(): OpenerInfo | null {
    if (!win.opener) return null;

    const info: OpenerInfo = {
      origin: null,
      sourceId: resolveSourceEntry(win.opener).sourceId
    };

    // window.origin is accessible cross-origin (unlike location.origin)
    try {
      info.origin = win.opener.origin;
    } catch {
      info.origin = null;
    }

    return info;
  }

  // Handle messages from background
  chrome.runtime.onMessage.addListener((
    message: BackgroundToContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: FrameInfoResponse) => void
  ) => {
    if (message.type === 'log-iframe-element') {
      let el: Element | null = null;
      try {
        el = win.document.querySelector(message.domPath);
      } catch {
        // querySelector throws on invalid selectors (e.g., unescaped chars in old domPaths)
      }
      if (el) {
        console.log("[messages]", el);
      } else {
        console.log(`[messages] can't find iframe element at ${message.domPath}`);
      }
      return;
    }

    if (message.type === 'send-message') {
      const { target, message: payload } = message;
      if (target === 'parent' && win.parent !== win) {
        win.parent.postMessage(payload, '*');
      } else if (target === 'opener' && win.opener) {
        win.opener.postMessage(payload, '*');
      }
      return; // No async response needed — don't return true
    }

    if (message.type === 'get-frame-info') {
      const iframes = Array.from(win.document.querySelectorAll('iframe') as NodeListOf<HTMLIFrameElement>).map(iframe => ({
        ...getIframeElementInfo(iframe),
        sourceId: iframe.contentWindow ? resolveSourceEntry(iframe.contentWindow).sourceId : undefined
      }));

      const response: FrameInfoResponse = {
        title: win.document.title,
        origin: win.location.origin,
        iframes: iframes
      };

      // Include opener info only for main frame
      if (win === win.top) {
        response.opener = getOpenerInfo();
      }

      sendResponse(response);
    }
    return true; // Keep channel open for async response
  });

  // Tell background this fresh injection succeeded — used to clear stale-frame state.
  chrome.runtime.sendMessage({ type: 'content-script-ready' });
}
