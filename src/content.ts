// Content script - intercepts postMessage and forwards to service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

import { BackgroundToContentMessage, RawCapturedMessage, FrameInfoResponse, OpenerInfo, PostMessageCapturedMessage } from './types';

// Extend Window interface for our guard property
declare global {
  interface Window {
    __postmessage_devtools_content__?: boolean;
  }
}

(function() {
  // Guard against multiple injections
  if (window.__postmessage_devtools_content__) return;
  window.__postmessage_devtools_content__ = true;

  const sourceWindows = new WeakMap<Window, { windowId: string }>();

  interface RegistrationMessage {
    type: '__frames_inspector_register__';
    frameId: number;
    tabId: number;
    documentId?: string;
  }

  // Send registration messages to parent and opener
  function sendRegistrationMessages(registrationMessage: RegistrationMessage): void {
    // Send to parent if we're in an iframe
    if (window.parent !== window) {
      window.parent.postMessage({
        ...registrationMessage,
        targetType: 'parent'
      }, '*');
    }

    // Send to opener if we were opened by another window
    if (window.opener) {
      window.opener.postMessage({
        ...registrationMessage,
        targetType: 'opener'
      }, '*');
    }
  }

  // Generate a CSS selector path for an element
  function getDomPath(element: Element | null): string {
    const parts: string[] = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.id) {
        selector += '#' + element.id;
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

  // Get or create a stable windowId for a source window
  function getWindowId(sourceWindow: Window | MessageEventSource | null): string | null {
    if (!sourceWindow) return null;

    let entry = sourceWindows.get(sourceWindow as Window);
    if (!entry) {
      entry = { windowId: generateId() };
      sourceWindows.set(sourceWindow as Window, entry);
    }
    return entry.windowId;
  }

  // Create data preview (truncated string representation)
  function createDataPreview(data: unknown, maxLength = 100): string {
    try {
      const str = JSON.stringify(data);
      if (str.length <= maxLength) return str;
      return str.substring(0, maxLength) + '...';
    } catch {
      return String(data).substring(0, maxLength);
    }
  }

  // Calculate approximate size in bytes
  function calculateSize(data: unknown): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  // Extract message type from data (looks for .type property)
  function extractMessageType(data: unknown): string | null {
    if (data && typeof data === 'object' && 'type' in data && typeof (data as { type: unknown }).type === 'string') {
      return (data as { type: string }).type;
    }
    return null;
  }

  // Determine the relationship between this window and the message source
  function getSourceRelationship(eventSource: MessageEventSource | null): string {
    if (!eventSource) return 'unknown';
    if (eventSource === window) return 'self';
    if (eventSource === window.parent && window.parent !== window) return 'parent';
    if (eventSource === window.top && window.top !== window) return 'top';
    if (window.opener && eventSource === window.opener) return 'opener';
    for (let i = 0; i < window.frames.length; i++) {
      if (eventSource === window.frames[i]) return 'child';
    }
    return 'unknown';
  }

  interface SourceInfo {
    type: string;
    origin: string;
    windowId: string | null;
    iframeSrc: string | null;
    iframeId: string | null;
    iframeDomPath: string | null;
  }

  // Collect target frame info (the frame receiving the message)
  function getTargetInfo() {
    return {
      url: window.location.href,
      origin: window.location.origin,
      documentTitle: document.title || ''
    };
  }

  // Collect source info from a message event
  function getSourceInfo(event: MessageEvent): SourceInfo {
    const sourceType = getSourceRelationship(event.source);

    const source: SourceInfo = {
      type: sourceType,
      origin: event.origin,
      windowId: getWindowId(event.source),
      iframeSrc: null,
      iframeId: null,
      iframeDomPath: null
    };

    // For child frames, find the iframe element and include its properties
    if (sourceType === 'child') {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          source.iframeSrc = iframe.src || null;
          source.iframeId = iframe.id || null;
          source.iframeDomPath = getDomPath(iframe);
          break;
        }
      }
    }

    return source;
  }

  // Listen for incoming postMessage events
  window.addEventListener('message', (event: MessageEvent) => {
    // Stop propagation of registration messages to prevent app from seeing them
    if (event.data?.type === '__frames_inspector_register__') {
      event.stopImmediatePropagation();
    }

    const capturedMessage: RawCapturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      target: getTargetInfo(),
      source: getSourceInfo(event),
      data: event.data,
      dataPreview: createDataPreview(event.data),
      dataSize: calculateSize(event.data),
      messageType: extractMessageType(event.data)
    };

    const message: PostMessageCapturedMessage = {
      type: 'postmessage-captured',
      payload: capturedMessage
    };
    chrome.runtime.sendMessage(message);
  }, true);

  // Get opener info if available
  function getOpenerInfo(): OpenerInfo | null {
    if (!window.opener) return null;

    const info: OpenerInfo = { origin: null };

    // window.origin is accessible cross-origin (unlike location.origin)
    try {
      info.origin = window.opener.origin;
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
    if (message.type === 'frame-identity') {
      // Wait 500ms before sending registration to ensure parent is ready
      setTimeout(() => sendRegistrationMessages({
        type: '__frames_inspector_register__',
        frameId: message.frameId,
        tabId: message.tabId,
        documentId: message.documentId
      }), 500);
    }

    if (message.type === 'get-frame-info') {
      const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => ({
        src: iframe.src || '',
        id: iframe.id || '',
        domPath: getDomPath(iframe)
      }));

      const response: FrameInfoResponse = {
        title: document.title,
        origin: window.location.origin,
        iframes: iframes
      };

      // Include opener info only for main frame
      if (window === window.top) {
        response.opener = getOpenerInfo();
      }

      sendResponse(response);
    }
    return true; // Keep channel open for async response
  });
})();

export {};
