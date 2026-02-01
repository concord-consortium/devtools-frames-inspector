// Content script - bridges injected.js to the service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

(function() {
  // Guard against multiple injections
  if (window.__postmessage_devtools_content__) return;
  window.__postmessage_devtools_content__ = true;

  const EVENT_NAME = '__postmessage_devtools__';

  // Inject the script into the page's main world
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
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

  // Handle get-frame-info requests from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
