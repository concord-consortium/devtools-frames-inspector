// Injected into page context to intercept postMessage calls
// Communicates with content script via CustomEvents

(function() {
  const EVENT_NAME = '__postmessage_devtools__';

  // Collect frame metadata
  function getFrameMetadata() {
    return {
      url: window.location.href,
      origin: window.location.origin,
      documentTitle: document.title || ''
    };
  }

  // Generate unique ID
  function generateId() {
    return crypto.randomUUID();
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
      direction: 'receiving',
      self: getFrameMetadata(),
      targetOrigin: null,
      sourceOrigin: event.origin,
      sourceType: getSourceRelationship(event.source),
      data: event.data,
      dataPreview: createDataPreview(event.data),
      dataSize: calculateSize(event.data),
      messageType: extractMessageType(event.data)
    };

    sendCapturedMessage(capturedMessage);
  }, true);
})();
