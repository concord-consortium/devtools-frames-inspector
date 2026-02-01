// Service worker for PostMessage DevTools
// Routes messages between content scripts and DevTools panel

// Store panel connections by tab ID
const panelConnections = new Map();

// Store preserve log preference by tab ID
const preserveLogPrefs = new Map();

// Buffer messages for tabs without a panel connection
const messageBuffers = new Map();
// Tabs that should have buffering enabled (opened from a monitored tab)
const bufferingEnabledTabs = new Set();
// TODO: some messages can be big a buffer size of 1000 seems excessive
// this should only be needed when a popup is opened and we want to capture
// messages sent immediately on load before the panel connects
const MAX_BUFFER_SIZE = 1000; // Max messages to buffer per tab

// Track which frames have been injected to avoid double-injection
const injectedFrames = new Map(); // tabId -> Set of frameIds

// Inject content script into a specific tab and frame
async function injectContentScript(tabId, frameId = null) {
  try {
    const target = { tabId };
    if (frameId !== null) {
      target.frameIds = [frameId];
    } else {
      target.allFrames = true;
    }

    // Track injected frames
    if (!injectedFrames.has(tabId)) {
      injectedFrames.set(tabId, new Set());
    }

    // Check if already injected (for specific frame injection)
    if (frameId !== null && injectedFrames.get(tabId).has(frameId)) {
      return;
    }

    await chrome.scripting.executeScript({
      target,
      files: ['content.js'],
      injectImmediately: true
    });

    // Mark as injected
    if (frameId !== null) {
      injectedFrames.get(tabId).add(frameId);
    }
  } catch (e) {
    // Injection can fail for chrome:// pages, etc.
  }
}

// Handle connections from DevTools panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postmessage-panel') return;

  // Panel sends its tab ID in the first message
  port.onMessage.addListener((msg) => {
    if (msg.type === 'init') {
      panelConnections.set(msg.tabId, port);
      preserveLogPrefs.set(msg.tabId, false);

      // Inject content script into all frames of this tab
      injectContentScript(msg.tabId);

      // Flush any buffered messages (buffered flag already set in payload)
      const bufferedMessages = messageBuffers.get(msg.tabId);
      if (bufferedMessages && bufferedMessages.length > 0) {
        for (const payload of bufferedMessages) {
          port.postMessage({ type: 'message', payload });
        }
        messageBuffers.delete(msg.tabId);
      }
      // No longer need buffering for this tab since panel is connected
      bufferingEnabledTabs.delete(msg.tabId);

      port.onDisconnect.addListener(() => {
        panelConnections.delete(msg.tabId);
        preserveLogPrefs.delete(msg.tabId);
      });
    } else if (msg.type === 'preserveLog') {
      preserveLogPrefs.set(msg.tabId, msg.value);
    } else if (msg.type === 'get-frame-hierarchy') {
      getFrameHierarchy(msg.tabId).then(hierarchy => {
        port.postMessage({
          type: 'frame-hierarchy',
          payload: hierarchy
        });
      });
    }
  });
});

// Get frame hierarchy for a tab
async function getFrameHierarchy(tabId) {
  try {
    // Get all frames from webNavigation
    const webNavFrames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!webNavFrames) return [];

    // Request frame info from each frame's content script
    const frameInfoPromises = webNavFrames.map(async (frame) => {
      try {
        const info = await chrome.tabs.sendMessage(tabId,
          { type: 'get-frame-info' },
          { frameId: frame.frameId }
        );
        return {
          frameId: frame.frameId,
          url: frame.url,
          parentFrameId: frame.parentFrameId,
          title: info?.title || '',
          origin: info?.origin || '',
          iframes: info?.iframes || []
        };
      } catch (e) {
        // Content script may not be loaded in this frame
        let origin = '';
        try {
          origin = new URL(frame.url).origin;
        } catch {}
        return {
          frameId: frame.frameId,
          url: frame.url,
          parentFrameId: frame.parentFrameId,
          title: '',
          origin: origin,
          iframes: []
        };
      }
    });

    const frames = await Promise.all(frameInfoPromises);
    return frames;
  } catch (e) {
    console.error('Failed to get frame hierarchy:', e);
    return [];
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'postmessage-captured') return;

  const tabId = sender.tab?.id;
  const frameId = sender.frameId;

  if (!tabId) return;

  // Enrich the payload with frameId on target and buffered flag
  const enrichedPayload = {
    ...message.payload,
    target: {
      ...message.payload.target,
      frameId: frameId
    }
  };

  const panel = panelConnections.get(tabId);
  if (panel) {
    enrichedPayload.buffered = false;
    panel.postMessage({
      type: 'message',
      payload: enrichedPayload
    });
  } else if (bufferingEnabledTabs.has(tabId)) {
    // Buffer the message for when panel connects (only for tabs opened from monitored tabs)
    enrichedPayload.buffered = true;
    if (!messageBuffers.has(tabId)) {
      messageBuffers.set(tabId, []);
    }
    const buffer = messageBuffers.get(tabId);
    if (buffer.length < MAX_BUFFER_SIZE) {
      buffer.push(enrichedPayload);
    }
  }
});

// Enable buffering for tabs opened from monitored tabs
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  const sourceTabId = details.sourceTabId;
  const newTabId = details.tabId;

  // Check if the source tab has a panel connection (is monitored)
  if (panelConnections.has(sourceTabId)) {
    bufferingEnabledTabs.add(newTabId);
  }
});

// Handle navigation events - inject scripts and clear messages as needed
chrome.webNavigation.onCommitted.addListener((details) => {
  const { tabId, frameId } = details;
  const isMonitored = panelConnections.has(tabId);
  const needsBuffering = bufferingEnabledTabs.has(tabId);

  // Inject content script for monitored or buffering-enabled tabs
  if (isMonitored || needsBuffering) {
    // Clear injection tracking for this frame since it's a new navigation
    if (injectedFrames.has(tabId)) {
      injectedFrames.get(tabId).delete(frameId);
    }
    injectContentScript(tabId, frameId);
  }

  // Clear messages only for main frame navigations (unless preserve log is on)
  if (frameId === 0) {
    const preserveLog = preserveLogPrefs.get(tabId);
    if (!preserveLog) {
      const panel = panelConnections.get(tabId);
      if (panel) {
        panel.postMessage({ type: 'clear' });
      }
    }
  }
});

// Clean up buffer, buffering state, and injection tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  messageBuffers.delete(tabId);
  bufferingEnabledTabs.delete(tabId);
  injectedFrames.delete(tabId);
});
