// Background script connection for Frames Inspector panel

import { store } from './store';
import { CapturedMessage, FrameInfo } from './types';

let port: chrome.runtime.Port | null = null;

export function connect(): void {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  store.setTabId(tabId);

  port = chrome.runtime.connect({ name: 'postmessage-panel' });
  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg: { type: string; payload?: CapturedMessage | FrameInfo[] }) => {
    if (msg.type === 'message' && msg.payload) {
      store.addMessage(msg.payload as CapturedMessage);
    } else if (msg.type === 'clear') {
      store.clearMessages();
    } else if (msg.type === 'frame-hierarchy' && msg.payload) {
      store.setFrameHierarchy(msg.payload as FrameInfo[]);
    }
  });

  port.onDisconnect.addListener(() => {
    setTimeout(connect, 1000);
  });
}

export function sendPreserveLog(value: boolean): void {
  if (port) {
    port.postMessage({ type: 'preserveLog', tabId: store.tabId, value });
  }
}

export function requestFrameHierarchy(): void {
  if (port) {
    port.postMessage({ type: 'get-frame-hierarchy', tabId: store.tabId });
  }
}
