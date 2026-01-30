// Content script to intercept postMessage calls and message events

(function() {
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

  // Send captured message to background script
  function sendCapturedMessage(capturedMessage) {
    try {
      chrome.runtime.sendMessage({
        type: 'postmessage-captured',
        payload: capturedMessage
      });
    } catch (e) {
      // Extension context may be invalidated, ignore
    }
  }

  // Intercept outgoing postMessage calls
  const originalPostMessage = window.postMessage.bind(window);
  window.postMessage = function(message, targetOrigin, transfer) {
    const capturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      direction: 'sending',
      self: getFrameMetadata(),
      targetOrigin: targetOrigin,
      sourceOrigin: null,
      data: message,
      dataPreview: createDataPreview(message),
      dataSize: calculateSize(message),
      messageType: extractMessageType(message)
    };

    sendCapturedMessage(capturedMessage);

    return originalPostMessage(message, targetOrigin, transfer);
  };

  // Listen for incoming messages
  window.addEventListener('message', (event) => {
    const capturedMessage = {
      id: generateId(),
      timestamp: Date.now(),
      direction: 'receiving',
      self: getFrameMetadata(),
      targetOrigin: null,
      sourceOrigin: event.origin,
      data: event.data,
      dataPreview: createDataPreview(event.data),
      dataSize: calculateSize(event.data),
      messageType: extractMessageType(event.data)
    };

    sendCapturedMessage(capturedMessage);
  }, true);
})();
