// Background script connection for Frames Inspector panel

import { store } from './store';
import { Message } from './Message';
import { frameStore, FrameDocument, OwnerElement } from './models';
import { CapturedMessage, FrameInfo, IMessage } from './types';

let port: chrome.runtime.Port | null = null;

export function connect(): void {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  store.setTabId(tabId);

  port = chrome.runtime.connect({ name: 'postmessage-panel' });
  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg: { type: string; payload?: CapturedMessage | FrameInfo[] }) => {
    if (msg.type === 'message' && msg.payload) {
      processIncomingMessage(msg.payload as IMessage, tabId);
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

// Process a raw IMessage from the background script:
// 1. Create/update Frame and FrameDocument instances in the FrameStore
// 2. Snapshot owner elements
// 3. Create a Message model instance
// 4. Handle registration if applicable
// 5. Push to the store
export function processIncomingMessage(msg: IMessage, tabId: number): void {
  // --- Target ---
  const targetDoc = frameStore.getOrCreateDocumentById(msg.target.documentId!);
  targetDoc.url = msg.target.url;
  targetDoc.origin = msg.target.origin;
  targetDoc.title = msg.target.documentTitle;

  const targetFrame = frameStore.getOrCreateFrame(tabId, msg.target.frameId);
  if (!targetDoc.frame) {
    targetDoc.frame = targetFrame;
    targetFrame.currentDocument = targetDoc;
  }

  const targetOwnerElement = targetFrame.currentOwnerElement;

  // --- Source ---
  if (msg.source.documentId) {
    const sourceDoc = frameStore.getOrCreateDocumentById(msg.source.documentId);
    sourceDoc.origin = msg.source.origin;
    if (msg.source.windowId) {
      sourceDoc.windowId = msg.source.windowId;
      frameStore.documentsByWindowId.set(msg.source.windowId, sourceDoc);
    }
  } else if (msg.source.windowId) {
    const sourceDoc = frameStore.getOrCreateDocumentByWindowId(msg.source.windowId);
    sourceDoc.origin = msg.source.origin;
  }

  // --- Source owner element (child messages) ---
  let sourceOwnerElement: OwnerElement | undefined = undefined;
  if (msg.source.type === 'child') {
    sourceOwnerElement = OwnerElement.fromRaw(
      msg.source.iframeDomPath,
      msg.source.iframeSrc,
      msg.source.iframeId
    );

    // Update Frame's currentOwnerElement if it has changed (e.g., due to navigation)
    if (sourceOwnerElement && msg.source.windowId) {
      const sourceDoc = frameStore.getDocumentByWindowId(msg.source.windowId);
      if (sourceDoc?.frame) {
        if (!sourceOwnerElement.equals(sourceDoc.frame.currentOwnerElement)) {
          sourceDoc.frame.currentOwnerElement = sourceOwnerElement;
        }
      }
    }
  }

  // --- Parent messages: reference source Frame's currentOwnerElement ---
  if (msg.source.type === 'parent' && msg.source.documentId) {
    const sourceDoc = frameStore.getDocumentById(msg.source.documentId);
    if (sourceDoc?.frame) {
      sourceOwnerElement = sourceDoc.frame.currentOwnerElement;
    }
  }

  // --- Create Message ---
  const message = new Message(msg, targetOwnerElement, sourceOwnerElement);

  // --- Handle registration ---
  if (message.isRegistrationMessage && message.sourceWindowId) {
    processRegistration(message);
  }

  store.addMessage(message);
}

function processRegistration(message: Message): void {
  const regData = message.registrationData!;
  const windowId = message.sourceWindowId!;

  const docByWindow = frameStore.getDocumentByWindowId(windowId);
  const docByDocId = frameStore.getDocumentById(regData.documentId);

  if (docByWindow && docByDocId && docByWindow !== docByDocId) {
    docByDocId.windowId = windowId;
    if (docByWindow.origin && !docByDocId.origin) {
      docByDocId.origin = docByWindow.origin;
    }
    frameStore.documentsByWindowId.set(windowId, docByDocId);
  } else if (docByWindow && !docByDocId) {
    docByWindow.documentId = regData.documentId;
    frameStore.documents.set(regData.documentId, docByWindow);
  } else if (!docByWindow && docByDocId) {
    docByDocId.windowId = windowId;
    frameStore.documentsByWindowId.set(windowId, docByDocId);
  } else if (!docByWindow && !docByDocId) {
    const doc = new FrameDocument({ documentId: regData.documentId, windowId });
    frameStore.documents.set(regData.documentId, doc);
    frameStore.documentsByWindowId.set(windowId, doc);
  }

  const frame = frameStore.getOrCreateFrame(regData.tabId, regData.frameId);
  const doc = frameStore.documents.get(regData.documentId)!;
  doc.frame = frame;
  frame.currentDocument = doc;

  const newOwner = message.sourceOwnerElement;
  if (newOwner) {
    if (!newOwner.equals(frame.currentOwnerElement)) {
      frame.currentOwnerElement = newOwner;
    }
  }
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
