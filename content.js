// Content script - bridges injected.js to the service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

(function() {
  // Guard against multiple injections
  if (window.__postmessage_devtools_content__) return;
  window.__postmessage_devtools_content__ = true;

  const EVENT_NAME = '__postmessage_devtools__';

  let frameInfo = null; // {frameId, tabId} received from background

  // Inject the script into the page's main world
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Send registration messages to parent and opener
  function sendRegistrationMessages() {
    if (!frameInfo) return;

    const registrationMessage = {
      type: '__frames_inspector_register__',
      frameId: frameInfo.frameId,
      tabId: frameInfo.tabId
    };

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
  window.addEventListener(EVENT_NAME, (event) => {
    chrome.runtime.sendMessage({
      type: 'postmessage-captured',
      payload: event.detail
    });
  });

  // Inject immediately
  injectScript();

  // Generate a CSS selector path for an element
  function getDomPath(element) {
    const parts = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.id) {
        selector += '#' + element.id;
        parts.unshift(selector);
        break; // id is unique, stop here
      }
      // Position among same-type siblings
      let sibling = element;
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
  function getOpenerInfo() {
    if (!window.opener) return null;

    const info = {};

    // window.origin is accessible cross-origin (unlike location.origin)
    try {
      info.origin = window.opener.origin;
    } catch (e) {
      info.origin = null;
    }

    return info;
  }

  // Handle messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'frame-info') {
      frameInfo = {
        frameId: message.frameId,
        tabId: message.tabId
      };
      // Wait 500ms before sending registration to ensure parent is ready
      setTimeout(sendRegistrationMessages, 500);
    }

    if (message.type === 'get-frame-info') {
      const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => ({
        src: iframe.src || '',
        id: iframe.id || '',
        domPath: getDomPath(iframe)
      }));

      const response = {
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
