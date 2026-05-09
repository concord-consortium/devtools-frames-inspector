// Background script connection for Messages Inspector panel

import { runInAction } from 'mobx';
import { store } from './store';
import { Message } from './Message';
import { frameStore, Frame, FrameDocument, OwnerElement } from './models';
import { CapturedMessage, FrameInfo, IMessage } from './types';

// Chrome throws this exact text from chrome.runtime.connect() when the
// extension has been reloaded/updated since this DevTools page loaded.
// There is no structured error code or chrome.runtime.lastError on
// synchronous throws — the message string is the API.
const EXTENSION_INVALIDATED_MARKER = 'Extension context invalidated';

let port: chrome.runtime.Port | null = null;

export function connect(): void {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  store.setTabId(tabId);

  // Two-stage detection of extension-context invalidation:
  // 1) fast path: chrome.runtime?.id is undefined (or throws) when this panel
  //    page is from an extension version that has been reloaded/updated.
  // 2) race fallback: chrome.runtime.connect(...) below catches the rarer
  //    case where the runtime appeared alive at the pre-check but is
  //    invalidated by the time we connect.
  let runtimeId: string | undefined;
  try {
    runtimeId = chrome.runtime?.id;
  } catch {
    runtimeId = undefined;
  }
  if (!runtimeId) {
    store.setExtensionContextInvalidated(true);
    return;
  }

  try {
    port = chrome.runtime.connect({ name: 'postmessage-panel' });
  } catch (e) {
    if (String(e).includes(EXTENSION_INVALIDATED_MARKER)) {
      store.setExtensionContextInvalidated(true);
      return;
    }
    setTimeout(connect, 1000);
    return;
  }

  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg: { type: string; payload?: CapturedMessage | FrameInfo[]; error?: string; frameId?: number }) => {
    if (msg.type === 'message' && msg.payload) {
      processIncomingMessage(msg.payload as IMessage);
    } else if (msg.type === 'clear') {
      store.clearMessages();
    } else if (msg.type === 'frame-hierarchy' && msg.payload) {
      store.setFrameHierarchy(msg.payload as FrameInfo[]);
    } else if (msg.type === 'log-iframe-element-failed') {
      const text = '[messages] could not log iframe — failed to reach parent document: ' + (msg.error ?? '');
      chrome.devtools.inspectedWindow.eval(`console.log(${JSON.stringify(text)})`);
    } else if (msg.type === 'stale-frame' && typeof msg.frameId === 'number') {
      const frameId = msg.frameId;
      store.addStaleFrame(frameId);
    } else if (msg.type === 'stale-frame-cleared' && typeof msg.frameId === 'number') {
      const frameId = msg.frameId;
      store.clearStaleFrame(frameId);
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);
  });
}

// Process a raw IMessage from the background script:
// 1. Create/update Frame and FrameDocument instances in the FrameStore
// 2. Snapshot owner elements
// 3. Create a Message model instance
// 4. Handle registration if applicable
// 5. Push to the store
export function processIncomingMessage(msg: IMessage): void {
  runInAction(() => _processIncomingMessage(msg));
}

function _processIncomingMessage(msg: IMessage): void {
  // --- Target ---
  if (msg.target.documentId) {
    const targetDoc = frameStore.getOrCreateDocumentById(msg.target.documentId);
    targetDoc.url = msg.target.url;
    targetDoc.origin = msg.target.origin;
    targetDoc.title = msg.target.documentTitle;

    const targetFrame = frameStore.getOrCreateFrame(msg.target.tabId, msg.target.frameId);
    if (!targetDoc.frame) {
      targetDoc.frame = targetFrame;
      if (!targetFrame.documents.includes(targetDoc)) {
        targetFrame.documents.push(targetDoc);
      }
    }
  }

  // Snapshot the target's owner element (iframe hosting the target frame)
  let targetOwnerElement: OwnerElement | undefined = undefined;
  const targetFrame = frameStore.getFrame(msg.target.tabId, msg.target.frameId);
  if (targetFrame) {
    const ownerIFrame = frameStore.findOwnerIFrame(targetFrame);
    if (ownerIFrame) {
      targetOwnerElement = new OwnerElement(ownerIFrame.domPath, ownerIFrame.src, ownerIFrame.id);
    }
  }

  // --- Source ---
  let sourceDoc: InstanceType<typeof FrameDocument> | undefined;

  if (msg.source.documentId) {
    sourceDoc = frameStore.getOrCreateDocumentById(msg.source.documentId);
    sourceDoc.origin = msg.source.origin;
    if (msg.source.sourceId) {
      frameStore.documentsBySourceId.set(msg.source.sourceId, sourceDoc);
      sourceDoc.addSourceIdRecord({
        sourceId: msg.source.sourceId,
        sourceType: msg.source.type,
        targetTabId: msg.target.tabId,
        targetFrameId: msg.target.frameId,
        targetDocumentId: msg.target.documentId,
      });
    }
  } else if (msg.source.sourceId) {
    const existing = frameStore.getDocumentBySourceId(msg.source.sourceId);
    if (existing && existing.origin && msg.source.origin && existing.origin !== msg.source.origin) {
      // Navigation detected — new document for same WindowProxy
      sourceDoc = new FrameDocument({ origin: msg.source.origin });
      frameStore.documentsBySourceId.set(msg.source.sourceId, sourceDoc);
    } else {
      sourceDoc = frameStore.getOrCreateDocumentBySourceId(msg.source.sourceId);
      sourceDoc.origin = msg.source.origin;
    }
    sourceDoc.addSourceIdRecord({
      sourceId: msg.source.sourceId,
      sourceType: msg.source.type,
      targetTabId: msg.target.tabId,
      targetFrameId: msg.target.frameId,
      targetDocumentId: msg.target.documentId,
    });
  }

  // Link source FrameDocument to a Frame when tabId and frameId are available
  // (e.g., opener/opened messages enriched by background with cross-tab info)
  if (sourceDoc && !sourceDoc.frame && msg.source.tabId != null && msg.source.frameId != null) {
    const sourceFrame = frameStore.getOrCreateFrame(msg.source.tabId, msg.source.frameId);
    sourceDoc.frame = sourceFrame;
    if (!sourceFrame.documents.includes(sourceDoc)) {
      sourceFrame.documents.push(sourceDoc);
    }
  }

  // --- Link Tab opener/opened relationships ---
  if (msg.source.tabId != null && msg.target.tabId !== msg.source.tabId) {
    if (msg.source.type === 'opener' || msg.source.type === 'opened') {
      const sourceTab = frameStore.getOrCreateTab(msg.source.tabId);
      const targetTab = frameStore.getOrCreateTab(msg.target.tabId);
      if (msg.source.type === 'opener') {
        // Source is opener, target is opened
        if (!targetTab.openerTab) {
          targetTab.openerTab = sourceTab;
          if (!sourceTab.openedTabs.includes(targetTab)) {
            sourceTab.openedTabs.push(targetTab);
          }
        }
      } else {
        // Source is opened, target is opener
        if (!sourceTab.openerTab) {
          sourceTab.openerTab = targetTab;
          if (!targetTab.openedTabs.includes(sourceTab)) {
            targetTab.openedTabs.push(sourceTab);
          }
        }
      }
    }
  }

  // --- Source owner element ---
  let sourceOwnerElement: OwnerElement | undefined = undefined;
  if (msg.source.type === 'child') {
    sourceOwnerElement = OwnerElement.fromRaw(msg.source.iframe);

    // Create/update IFrame entity on target's current document
    if (msg.target.documentId && msg.source.sourceId) {
      const targetDoc = frameStore.getDocumentById(msg.target.documentId);
      if (targetDoc) {
        frameStore.getOrCreateIFrame(targetDoc, msg.source.sourceId, msg.source.iframe ?? undefined);
      }
    }
  } else if (msg.source.type === 'parent' && msg.source.frameId != null) {
    // Parent is itself hosted in an iframe — look up its owner element
    const sourceTabId = msg.source.tabId ?? msg.target.tabId;
    const sourceFrame = frameStore.getFrame(sourceTabId, msg.source.frameId);
    if (sourceFrame) {
      const ownerIFrame = frameStore.findOwnerIFrame(sourceFrame);
      if (ownerIFrame) {
        sourceOwnerElement = new OwnerElement(ownerIFrame.domPath, ownerIFrame.src, ownerIFrame.id);
      }
    }
  }

  // --- Create Message ---
  const message = new Message(msg, targetOwnerElement, sourceOwnerElement);

  // --- Handle registration ---
  if (message.isRegistrationMessage && message.sourceSourceId) {
    processRegistration(message);
  }

  // --- Infer parent-child relationships ---
  inferParentFrameId(msg);

  store.addMessage(message);
}

function inferParentFrameId(msg: IMessage): void {
  if (msg.source.type === 'parent' && msg.source.frameId != null) {
    // Parent → child: target frame is a child of source frame
    // Parent is always in the same tab as child; source.tabId may not be set
    const sourceTabId = msg.source.tabId ?? msg.target.tabId;
    const targetFrame = frameStore.getFrame(msg.target.tabId, msg.target.frameId);
    const sourceFrame = frameStore.getOrCreateFrame(sourceTabId, msg.source.frameId);
    if (targetFrame && targetFrame.parentFrameId === undefined) {
      targetFrame.parentFrameId = sourceFrame.frameId;
      if (msg.source.documentId) {
        targetFrame.parentDocumentId = msg.source.documentId;
      }
    }
  }

  if (msg.source.type === 'child') {
    // Child → parent: source frame is a child of target frame
    let sourceFrame: Frame | undefined;
    if (msg.source.tabId != null && msg.source.frameId != null) {
      sourceFrame = frameStore.getFrame(msg.source.tabId, msg.source.frameId);
    }

    const targetFrame = frameStore.getFrame(msg.target.tabId, msg.target.frameId);
    if (sourceFrame && targetFrame && sourceFrame.parentFrameId === undefined) {
      sourceFrame.parentFrameId = targetFrame.frameId;
      if (msg.target.documentId) {
        sourceFrame.parentDocumentId = msg.target.documentId;
      }
    }
  }
}

function processRegistration(message: Message): void {
  const regData = message.registrationData!;
  const sourceId = message.sourceSourceId!;

  // If the existing doc for this sourceId already has a different documentId,
  // it represents a previously navigated-away document — don't touch it.
  let docBySourceId = frameStore.getDocumentBySourceId(sourceId);
  if (docBySourceId?.documentId && docBySourceId.documentId !== regData.documentId) {
    docBySourceId = undefined;
  }
  const docByDocId = frameStore.getDocumentById(regData.documentId);

  if (docBySourceId && docByDocId && docBySourceId !== docByDocId) {
    if (docBySourceId.origin && !docByDocId.origin) {
      docByDocId.origin = docBySourceId.origin;
    }
    docByDocId.mergeSourceIdRecords(docBySourceId);
    docByDocId.changes.push({
      time: Date.now(),
      type: 'merge',
      createdAtOfMerged: docBySourceId.createdAt,
    });
    frameStore.documentsBySourceId.set(sourceId, docByDocId);
    // Remove the superseded sourceId-only doc from its frame's documents array
    if (docBySourceId.frame) {
      const idx = docBySourceId.frame.documents.indexOf(docBySourceId);
      if (idx !== -1) docBySourceId.frame.documents.splice(idx, 1);
    }
  } else if (docBySourceId && !docByDocId) {
    docBySourceId.documentId = regData.documentId;
    frameStore.documents.set(regData.documentId, docBySourceId);
    docBySourceId.changes.push({ time: Date.now(), type: 'promotion' });
  } else if (!docBySourceId && docByDocId) {
    docByDocId.addSourceIdRecord({
      sourceId,
      sourceType: 'child',
      targetTabId: message.target.tabId,
      targetFrameId: message.target.frameId,
      targetDocumentId: message.target.documentId,
    });
    frameStore.documentsBySourceId.set(sourceId, docByDocId);
  } else if (!docBySourceId && !docByDocId) {
    const doc = new FrameDocument({ documentId: regData.documentId });
    doc.addSourceIdRecord({
      sourceId,
      sourceType: 'child',
      targetTabId: message.target.tabId,
      targetFrameId: message.target.frameId,
      targetDocumentId: message.target.documentId,
    });
    frameStore.documents.set(regData.documentId, doc);
    frameStore.documentsBySourceId.set(sourceId, doc);
  }

  const frame = frameStore.getOrCreateFrame(regData.tabId, regData.frameId);
  const doc = frameStore.documents.get(regData.documentId)!;
  doc.frame = frame;
  if (!frame.documents.includes(doc)) {
    frame.documents.push(doc);
  }

  // Link IFrame entity to this child frame
  // Find IFrame on parent document that has matching sourceId
  if (message.target.documentId) {
    const parentDoc = frameStore.getDocumentById(message.target.documentId);
    if (parentDoc) {
      const iframe = parentDoc.iframes.find(i => i.sourceIdFromParent === sourceId);
      if (iframe) {
        iframe.childFrame = frame;
      }
    }
  }

  // After registration links sourceId → Frame, infer parent from the registration target
  // Only for same-tab registrations — cross-tab frames (opener/opened) don't share a hierarchy
  if (frame.parentFrameId === undefined && frame.tabId === message.target.tabId) {
    const targetFrame = frameStore.getFrame(message.target.tabId, message.target.frameId);
    if (targetFrame) {
      frame.parentFrameId = targetFrame.frameId;
    }
  }

  // Track which parent document this child frame belongs to
  if (message.target.documentId) {
    frame.parentDocumentId = message.target.documentId;
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

export function sendLogIframeElement(documentId: string, domPath: string): void {
  if (port) {
    port.postMessage({ type: 'log-iframe-element', tabId: store.tabId, documentId, domPath });
  }
}
