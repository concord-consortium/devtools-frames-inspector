// Content script - bridges injected.js to the service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

import { BackgroundToContentMessage, CapturedMessage, FrameInfoResponse, OpenerInfo, PostMessageCapturedMessage } from './types';

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

  const EVENT_NAME = '__postmessage_devtools__';

  // Inject the script into the page's main world
  function injectScript(): void {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  interface RegistrationMessage {
    type: '__frames_inspector_register__';
    frameId: number;
    tabId: number;
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

  // Listen for messages from the injected script
  window.addEventListener(EVENT_NAME, (event: Event) => {
    const message: PostMessageCapturedMessage = {
      type: 'postmessage-captured',
      payload: (event as CustomEvent<CapturedMessage>).detail
    };
    chrome.runtime.sendMessage(message);
  });

  // Inject immediately
  injectScript();

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
        tabId: message.tabId
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
