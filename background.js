// Service worker for PostMessage DevTools
// Routes messages between content scripts and DevTools panel

// Store panel connections by tab ID
const panelConnections = new Map();

// Store preserve log preference by tab ID
const preserveLogPrefs = new Map();

// Handle connections from DevTools panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postmessage-panel') return;

  const tabId = port.sender?.tab?.id;

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
    }
  });
});

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
