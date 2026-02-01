// Injected into page context to intercept postMessage calls
// Communicates with content script via CustomEvents

(function() {
  const EVENT_NAME = '__postmessage_devtools__';

  // Collect target frame info (the frame receiving the message)
  function getTargetInfo() {
    return {
      url: window.location.href,
      origin: window.location.origin,
      documentTitle: document.title || ''
    };
  }

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

  // Generate unique ID (12 chars = 72 bits of entropy)
  function generateId() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += alphabet[bytes[i] & 63];
    }
    return id;
  }

  // Create data preview (truncated string representation)
  function createDataPreview(data, maxLength = 100) {
    try {
      const str = JSON.stringify(data);
      if (str.length <= maxLength) return str;
      return str.substring(0, maxLength) + '...';
    } catch {
      return String(data).substring(0, maxLength);
    }
  }

  // Calculate approximate size in bytes
  function calculateSize(data) {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  // Extract message type from data (looks for .type property)
  function extractMessageType(data) {
    if (data && typeof data === 'object' && typeof data.type === 'string') {
      return data.type;
    }
    return null;
  }

  // Determine the relationship between this window and the message source
  function getSourceRelationship(eventSource) {
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

  // Collect source info from a message event
  function getSourceInfo(event) {
    const sourceType = getSourceRelationship(event.source);

    const source = {
      type: sourceType,
      origin: event.origin,
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

  // Send captured message to content script via CustomEvent
  function sendCapturedMessage(capturedMessage) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: capturedMessage
    }));
  }

  // Listen for incoming messages
  window.addEventListener('message', (event) => {
    const capturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      target: getTargetInfo(),
      source: getSourceInfo(event),
      data: event.data,
      dataPreview: createDataPreview(event.data),
      dataSize: calculateSize(event.data),
      messageType: extractMessageType(event.data)
    };

    sendCapturedMessage(capturedMessage);
  }, true);
})();
