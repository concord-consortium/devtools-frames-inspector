// Integration tests for the frame model: Store#addMessage → FrameStore
//
// Tests call store.addMessage() with IMessage objects matching what the background
// script produces, then verify the resulting FrameStore state and Message computed
// properties.
//
// Test frame hierarchy:
//   A (top frame, frameId=0)       — https://parent.example.com
//   └── B (child of A, frameId=1)  — https://child-b.example.com
//       └── C (child of B, frameId=2) — https://child-c.example.com

import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { frameStore } from './models';
import type { IMessage } from '../types';

const TAB_ID = 42;

// --- Frame definitions ---

const FRAME_A = {
  frameId: 0,
  documentId: 'doc-A',
  url: 'https://parent.example.com/page',
  origin: 'https://parent.example.com',
  title: 'Parent Page',
};

const FRAME_B = {
  frameId: 1,
  documentId: 'doc-B',
  url: 'https://child-b.example.com/iframe',
  origin: 'https://child-b.example.com',
  title: 'Child B',
  windowId: 'win-B',
  iframeDomPath: 'body > iframe:nth-of-type(1)',
  iframeSrc: 'https://child-b.example.com/iframe',
  iframeId: 'iframe-b',
};

const FRAME_C = {
  frameId: 2,
  documentId: 'doc-C',
  url: 'https://child-c.example.com/nested',
  origin: 'https://child-c.example.com',
  title: 'Child C',
  windowId: 'win-C',
  iframeDomPath: 'body > iframe:nth-of-type(1)',
  iframeSrc: 'https://child-c.example.com/nested',
  iframeId: 'iframe-c',
};

// --- Message factories ---
// These build IMessage objects matching what the background script sends to the panel.

let msgId = 0;

/**
 * Child sends postMessage to parent.
 *
 * Captured by the parent's content script. Background enriches target with
 * sender.documentId and sender.frameId (both are the parent's). Source only
 * has the windowId assigned by the parent's content script and iframe element info.
 */
function childMsg(
  source: typeof FRAME_B,
  target: typeof FRAME_A,
  data: Record<string, unknown> = { type: 'test-event' },
): IMessage {
  return {
    id: `msg-${++msgId}`,
    timestamp: Date.now() + msgId,
    target: {
      url: target.url,
      origin: target.origin,
      documentTitle: target.title,
      frameId: target.frameId,
      documentId: target.documentId,
    },
    source: {
      type: 'child',
      origin: source.origin,
      windowId: source.windowId,
      iframeSrc: source.iframeSrc,
      iframeId: source.iframeId,
      iframeDomPath: source.iframeDomPath,
    },
    data,
    dataPreview: JSON.stringify(data).substring(0, 100),
    dataSize: JSON.stringify(data).length,
    messageType: (data as { type?: string }).type ?? null,
  };
}

/**
 * Parent sends postMessage to child.
 *
 * Captured by the child's content script. Background enriches source with the
 * parent's frameId and documentId (looked up via webNavigation).
 */
function parentMsg(
  source: typeof FRAME_A,
  target: typeof FRAME_B,
  data: Record<string, unknown> = { type: 'test-response' },
): IMessage {
  return {
    id: `msg-${++msgId}`,
    timestamp: Date.now() + msgId,
    target: {
      url: target.url,
      origin: target.origin,
      documentTitle: target.title,
      frameId: target.frameId,
      documentId: target.documentId,
    },
    source: {
      type: 'parent',
      origin: source.origin,
      windowId: null,
      iframeSrc: null,
      iframeId: null,
      iframeDomPath: null,
      frameId: source.frameId,
      documentId: source.documentId,
    },
    data,
    dataPreview: JSON.stringify(data).substring(0, 100),
    dataSize: JSON.stringify(data).length,
    messageType: (data as { type?: string }).type ?? null,
  };
}

/**
 * Child sends registration postMessage to parent.
 *
 * This is a regular child→parent message whose data payload carries the child's
 * frameId and tabId. The background enriches target with sender.documentId, which
 * is the PARENT's documentId (the frame whose content script captured the message).
 */
function registrationMsg(
  source: typeof FRAME_B,
  target: typeof FRAME_A,
): IMessage {
  return childMsg(source, target, {
    type: '__frames_inspector_register__',
    frameId: source.frameId,
    tabId: TAB_ID,
    documentId: source.documentId,
  });
}

// --- Tests ---

describe('Frame model integration', () => {
  beforeEach(() => {
    frameStore.clear();
    store.clearMessages();
    store.setTabId(TAB_ID);
    store.isRecording = true;
    msgId = 0;
  });

  // ===================================================================
  // Registration disabled — no registration messages arrive, so child
  // sources are only known by windowId and cannot resolve to a Frame.
  // ===================================================================
  describe('registration disabled', () => {
    it('child→parent: creates target doc+frame, source doc by windowId only', () => {
      store.addMessage(childMsg(FRAME_B, FRAME_A));

      // Target FrameDocument: created by documentId with full info
      const targetDoc = frameStore.getDocumentById(FRAME_A.documentId);
      expect(targetDoc).toBeDefined();
      expect(targetDoc!.url).toBe(FRAME_A.url);
      expect(targetDoc!.origin).toBe(FRAME_A.origin);
      expect(targetDoc!.title).toBe(FRAME_A.title);

      // Target Frame: created and linked to document
      const targetFrame = frameStore.getFrame(TAB_ID, FRAME_A.frameId);
      expect(targetFrame).toBeDefined();
      expect(targetDoc!.frame).toBe(targetFrame);
      expect(targetFrame!.currentDocument).toBe(targetDoc);

      // Source FrameDocument: created by windowId, no documentId or frame link
      const sourceDoc = frameStore.getDocumentByWindowId(FRAME_B.windowId);
      expect(sourceDoc).toBeDefined();
      expect(sourceDoc!.origin).toBe(FRAME_B.origin);
      expect(sourceDoc!.documentId).toBeUndefined();
      expect(sourceDoc!.frame).toBeUndefined();

      // Message: sourceFrame unresolvable without registration
      const msg = store.messages[0];
      expect(msg.sourceFrame).toBeUndefined();
      expect(msg.source.frameId).toBeUndefined();
      expect(msg.sourceDocument).toBe(sourceDoc);

      // Owner element snapshot captured from iframe info
      expect(msg.sourceOwnerElement).toBeDefined();
      expect(msg.sourceOwnerElement!.domPath).toBe(FRAME_B.iframeDomPath);
      expect(msg.sourceOwnerElement!.src).toBe(FRAME_B.iframeSrc);
      expect(msg.sourceOwnerElement!.id).toBe(FRAME_B.iframeId);
    });

    it('parent→child: source doc created by documentId with native frameId', () => {
      store.addMessage(parentMsg(FRAME_A, FRAME_B));

      // Source FrameDocument created by documentId
      const sourceDoc = frameStore.getDocumentById(FRAME_A.documentId);
      expect(sourceDoc).toBeDefined();
      expect(sourceDoc!.origin).toBe(FRAME_A.origin);

      // Message has native source.frameId from webNavigation enrichment
      const msg = store.messages[0];
      expect(msg.source.frameId).toBe(FRAME_A.frameId);
      expect(msg.sourceDocument).toBe(sourceDoc);
    });

    it('multiple messages from same child reuse source FrameDocument', () => {
      store.addMessage(childMsg(FRAME_B, FRAME_A, { type: 'event-1' }));
      store.addMessage(childMsg(FRAME_B, FRAME_A, { type: 'event-2' }));

      expect(store.messages[0].sourceDocument).toBe(store.messages[1].sourceDocument);
      expect(store.messages[0].sourceDocument)
        .toBe(frameStore.getDocumentByWindowId(FRAME_B.windowId));
    });

    it('messages from different children create separate FrameDocuments', () => {
      store.addMessage(childMsg(FRAME_B, FRAME_A));
      store.addMessage(childMsg(FRAME_C, FRAME_A));

      const docB = store.messages[0].sourceDocument;
      const docC = store.messages[1].sourceDocument;
      expect(docB).not.toBe(docC);
      expect(docB!.origin).toBe(FRAME_B.origin);
      expect(docC!.origin).toBe(FRAME_C.origin);
    });
  });

  // ===================================================================
  // Registration enabled — registration messages link a child's windowId
  // to its (tabId, frameId), enabling source frame resolution.
  // ===================================================================
  describe('registration enabled', () => {
    it('child message then registration: source.frameId resolves reactively', () => {
      // Child message arrives first — source only known by windowId
      store.addMessage(childMsg(FRAME_B, FRAME_A));
      const msg = store.messages[0];

      expect(msg.sourceFrame).toBeUndefined();
      expect(msg.source.frameId).toBeUndefined();

      // Registration arrives — links windowId to Frame
      store.addMessage(registrationMsg(FRAME_B, FRAME_A));

      // The SAME message's computed properties now resolve
      expect(msg.sourceFrame).toBeDefined();
      expect(msg.sourceFrame!.frameId).toBe(FRAME_B.frameId);
      expect(msg.source.frameId).toBe(FRAME_B.frameId);

      // Parent's FrameDocument must not be corrupted
      const parentDoc = frameStore.getDocumentById(FRAME_A.documentId);
      expect(parentDoc!.frame!.frameId).toBe(FRAME_A.frameId);
    });

    it('registration then child message: source.frameId resolves immediately', () => {
      // Registration arrives first
      store.addMessage(registrationMsg(FRAME_B, FRAME_A));

      // Child message arrives — source should already be linked
      store.addMessage(childMsg(FRAME_B, FRAME_A));
      const msg = store.messages[1];

      expect(msg.sourceFrame).toBeDefined();
      expect(msg.sourceFrame!.frameId).toBe(FRAME_B.frameId);
      expect(msg.source.frameId).toBe(FRAME_B.frameId);

      // Parent's FrameDocument must not be corrupted
      const parentDoc = frameStore.getDocumentById(FRAME_A.documentId);
      expect(parentDoc!.frame!.frameId).toBe(FRAME_A.frameId);
    });

    // -----------------------------------------------------------------
    // Complex: a frame appears as both source (by windowId) and target
    // (by documentId) before registration merges the two FrameDocuments.
    //
    // Timeline:
    //   1. B→A message: B is source → FrameDocument created by windowId
    //   2. C→B message: B is target → FrameDocument created by documentId
    //   3. Registration for B → should merge the two into one
    // -----------------------------------------------------------------
    describe('frame is both source and target before registration', () => {
      it('merges two FrameDocuments when registration arrives', () => {
        // Step 1: B→A — creates source FrameDocument for B by windowId
        store.addMessage(childMsg(FRAME_B, FRAME_A));

        const docBByWindow = frameStore.getDocumentByWindowId(FRAME_B.windowId);
        expect(docBByWindow).toBeDefined();
        expect(docBByWindow!.documentId).toBeUndefined();

        // Step 2: C→B — creates target FrameDocument for B by documentId
        store.addMessage(childMsg(FRAME_C, FRAME_B));

        const docBByDocId = frameStore.getDocumentById(FRAME_B.documentId);
        expect(docBByDocId).toBeDefined();
        expect(docBByDocId!.url).toBe(FRAME_B.url);

        // Confirm: two separate FrameDocuments for B
        expect(docBByWindow).not.toBe(docBByDocId);

        // Step 3: Registration for B — merges them
        store.addMessage(registrationMsg(FRAME_B, FRAME_A));

        // Both lookups now return the same merged document
        const mergedByWindow = frameStore.getDocumentByWindowId(FRAME_B.windowId);
        const mergedByDocId = frameStore.getDocumentById(FRAME_B.documentId);
        expect(mergedByWindow).toBe(mergedByDocId);

        // Merged document has all properties
        const merged = mergedByDocId!;
        expect(merged.documentId).toBe(FRAME_B.documentId);
        expect(merged.windowId).toBe(FRAME_B.windowId);
        expect(merged.url).toBe(FRAME_B.url);
        expect(merged.origin).toBe(FRAME_B.origin);

        // Linked to B's Frame
        expect(merged.frame).toBeDefined();
        expect(merged.frame!.frameId).toBe(FRAME_B.frameId);

        // B→A message's sourceFrame now resolves
        expect(store.messages[0].sourceFrame!.frameId).toBe(FRAME_B.frameId);
      });

      it('does not corrupt parent frame document', () => {
        store.addMessage(childMsg(FRAME_B, FRAME_A));
        store.addMessage(childMsg(FRAME_C, FRAME_B));
        store.addMessage(registrationMsg(FRAME_B, FRAME_A));

        // A's FrameDocument: url, origin, frame link all unchanged
        const docA = frameStore.getDocumentById(FRAME_A.documentId);
        expect(docA!.url).toBe(FRAME_A.url);
        expect(docA!.origin).toBe(FRAME_A.origin);
        expect(docA!.frame!.frameId).toBe(FRAME_A.frameId);

        // A's Frame still points to A's document
        const frameA = frameStore.getFrame(TAB_ID, FRAME_A.frameId);
        expect(frameA!.currentDocument).toBe(docA);
        expect(frameA!.currentDocument!.origin).toBe(FRAME_A.origin);
      });
    });

    it('registration sets owner element on Frame', () => {
      store.addMessage(registrationMsg(FRAME_B, FRAME_A));

      const frameB = frameStore.getFrame(TAB_ID, FRAME_B.frameId);
      expect(frameB).toBeDefined();
      expect(frameB!.currentOwnerElement).toBeDefined();
      expect(frameB!.currentOwnerElement!.domPath).toBe(FRAME_B.iframeDomPath);
      expect(frameB!.currentOwnerElement!.src).toBe(FRAME_B.iframeSrc);
      expect(frameB!.currentOwnerElement!.id).toBe(FRAME_B.iframeId);
    });
  });
});
