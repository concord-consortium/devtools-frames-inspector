// Service worker for PostMessage DevTools
// Routes messages between content scripts and DevTools panel

// Store panel connections by tab ID
const panelConnections = new Map();

// Store preserve log preference by tab ID
const preserveLogPrefs = new Map();

// Handle connections from DevTools panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postmessage-panel') return;

  // Panel sends its tab ID in the first message
  port.onMessage.addListener((msg) => {
    if (msg.type === 'init') {
      panelConnections.set(msg.tabId, port);
      preserveLogPrefs.set(msg.tabId, false);

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
  if (!tabId) return;

  const panel = panelConnections.get(tabId);
  if (panel) {
    panel.postMessage({
      type: 'message',
      payload: message.payload
    });
  }
});

// Handle navigation events (clear messages unless preserve log is on)
chrome.webNavigation.onCommitted.addListener((details) => {
  // Only care about main frame navigations
  if (details.frameId !== 0) return;

  const preserveLog = preserveLogPrefs.get(details.tabId);
  if (preserveLog) return;

  const panel = panelConnections.get(details.tabId);
  if (panel) {
    panel.postMessage({ type: 'clear' });
  }
});
