// FrameStore - Manages Frame and FrameDocument instances with reactive MobX maps

import { makeAutoObservable, observable } from 'mobx';
import { Frame } from './Frame';
import { FrameDocument } from './FrameDocument';
import { OwnerElement } from './OwnerElement';

export class FrameStore {
  // Primary indices
  frames = observable.map<string, Frame>();
  documents = observable.map<string, FrameDocument>();
  // Secondary index for source correlation
  documentsByWindowId = observable.map<string, FrameDocument>();

  constructor() {
    makeAutoObservable(this, {
      frames: false,
      documents: false,
      documentsByWindowId: false,
    });
  }

  getDocumentById(documentId: string | undefined): FrameDocument | undefined {
    if (!documentId) return undefined;
    return this.documents.get(documentId);
  }

  getDocumentByWindowId(windowId: string | undefined | null): FrameDocument | undefined {
    if (!windowId) return undefined;
    return this.documentsByWindowId.get(windowId);
  }

  getFrame(tabId: number, frameId: number): Frame | undefined {
    return this.frames.get(Frame.key(tabId, frameId));
  }

  getOrCreateFrame(tabId: number, frameId: number, parentFrameId: number = -1): Frame {
    const key = Frame.key(tabId, frameId);
    let frame = this.frames.get(key);
    if (!frame) {
      frame = new Frame(tabId, frameId, parentFrameId);
      this.frames.set(key, frame);
    }
    return frame;
  }

  getOrCreateDocumentById(documentId: string): FrameDocument {
    let doc = this.documents.get(documentId);
    if (!doc) {
      doc = new FrameDocument({ documentId });
      this.documents.set(documentId, doc);
    }
    return doc;
  }

  getOrCreateDocumentByWindowId(windowId: string): FrameDocument {
    let doc = this.documentsByWindowId.get(windowId);
    if (!doc) {
      doc = new FrameDocument({ windowId });
      this.documentsByWindowId.set(windowId, doc);
    }
    return doc;
  }

  // Called when a message arrives from the background script.
  // Returns the resolved target/source documents and owner elements for the message.
  processMessage(msg: {
    tabId: number;
    targetDocumentId: string;
    targetFrameId: number;
    targetUrl: string;
    targetOrigin: string;
    targetTitle: string;
    sourceWindowId: string | null;
    sourceDocumentId: string | undefined;
    sourceOrigin: string;
    sourceType: string;
    sourceIframeDomPath: string | null;
    sourceIframeSrc: string | null;
    sourceIframeId: string | null;
  }): {
    targetOwnerElement: OwnerElement | undefined;
    sourceOwnerElement: OwnerElement | undefined;
  } {
    // 1. Target FrameDocument
    const targetDoc = this.getOrCreateDocumentById(msg.targetDocumentId);
    targetDoc.url = msg.targetUrl;
    targetDoc.origin = msg.targetOrigin;
    targetDoc.title = msg.targetTitle;

    // 2. Target Frame
    const targetFrame = this.getOrCreateFrame(msg.tabId, msg.targetFrameId);
    if (!targetDoc.frame) {
      targetDoc.frame = targetFrame;
      targetFrame.currentDocument = targetDoc;
    }

    // 3. Target owner element snapshot
    const targetOwnerElement = targetFrame.currentOwnerElement;

    // 4. Source FrameDocument
    if (msg.sourceDocumentId) {
      const sourceDoc = this.getOrCreateDocumentById(msg.sourceDocumentId);
      sourceDoc.origin = msg.sourceOrigin;
      if (msg.sourceWindowId) {
        sourceDoc.windowId = msg.sourceWindowId;
        this.documentsByWindowId.set(msg.sourceWindowId, sourceDoc);
      }
    } else if (msg.sourceWindowId) {
      const sourceDoc = this.getOrCreateDocumentByWindowId(msg.sourceWindowId);
      sourceDoc.origin = msg.sourceOrigin;
    }

    // 5. Source owner element (child messages)
    let sourceOwnerElement: OwnerElement | undefined = undefined;
    if (msg.sourceType === 'child') {
      sourceOwnerElement = OwnerElement.fromRaw(
        msg.sourceIframeDomPath,
        msg.sourceIframeSrc,
        msg.sourceIframeId
      );

      // Update source Frame's currentOwnerElement if frame is known
      if (sourceOwnerElement && msg.sourceWindowId) {
        const sourceDoc = this.documentsByWindowId.get(msg.sourceWindowId);
        if (sourceDoc?.frame) {
          if (!sourceOwnerElement.equals(sourceDoc.frame.currentOwnerElement)) {
            sourceDoc.frame.currentOwnerElement = sourceOwnerElement;
          }
        }
      }
    }

    // 6. Parent messages: reference source Frame's currentOwnerElement
    if (msg.sourceType === 'parent' && msg.sourceDocumentId) {
      const sourceDoc = this.documents.get(msg.sourceDocumentId);
      if (sourceDoc?.frame) {
        sourceOwnerElement = sourceDoc.frame.currentOwnerElement;
      }
    }

    return { targetOwnerElement, sourceOwnerElement };
  }

  // Called when a registration message arrives.
  processRegistration(reg: {
    frameId: number;
    tabId: number;
    documentId: string;
    windowId: string;
    ownerDomPath: string | null | undefined;
    ownerSrc: string | null | undefined;
    ownerId: string | null | undefined;
  }): void {
    // 1. Look up existing FrameDocument by windowId
    const docByWindow = this.documentsByWindowId.get(reg.windowId);

    // 2. Look up existing FrameDocument by documentId
    const docByDocId = this.documents.get(reg.documentId);

    // 3. Merge if both exist
    if (docByWindow && docByDocId && docByWindow !== docByDocId) {
      // Merge into the documentId-keyed one
      docByDocId.windowId = reg.windowId;
      if (docByWindow.origin && !docByDocId.origin) {
        docByDocId.origin = docByWindow.origin;
      }
      // Update secondary index to point to merged document
      this.documentsByWindowId.set(reg.windowId, docByDocId);
    } else if (docByWindow && !docByDocId) {
      // Only windowId-based doc exists, give it a documentId
      docByWindow.documentId = reg.documentId;
      this.documents.set(reg.documentId, docByWindow);
    } else if (!docByWindow && docByDocId) {
      // Only documentId-based doc exists, give it a windowId
      docByDocId.windowId = reg.windowId;
      this.documentsByWindowId.set(reg.windowId, docByDocId);
    } else if (!docByWindow && !docByDocId) {
      // Neither exists, create new
      const doc = new FrameDocument({ documentId: reg.documentId, windowId: reg.windowId });
      this.documents.set(reg.documentId, doc);
      this.documentsByWindowId.set(reg.windowId, doc);
    }

    // 5. Frame
    const frame = this.getOrCreateFrame(reg.tabId, reg.frameId);
    const doc = this.documents.get(reg.documentId)!;
    doc.frame = frame;
    frame.currentDocument = doc;

    // 6. Owner element
    const newOwner = OwnerElement.fromRaw(reg.ownerDomPath, reg.ownerSrc, reg.ownerId);
    if (newOwner) {
      if (!newOwner.equals(frame.currentOwnerElement)) {
        frame.currentOwnerElement = newOwner;
      }
    }
  }

  // Called when hierarchy data arrives from webNavigation.getAllFrames()
  processHierarchy(tabId: number, frames: Array<{
    frameId: number;
    documentId?: string;
    url: string;
    parentFrameId: number;
    title: string;
    origin: string;
    iframes: { src: string; id: string; domPath: string }[];
  }>): Frame[] {
    // Create/update frames and documents
    for (const frameData of frames) {
      const frame = this.getOrCreateFrame(tabId, frameData.frameId, frameData.parentFrameId);
      frame.parentFrameId = frameData.parentFrameId;

      if (frameData.documentId) {
        const doc = this.getOrCreateDocumentById(frameData.documentId);
        doc.url = frameData.url;
        doc.origin = frameData.origin;
        doc.title = frameData.title;
        doc.frame = frame;
        frame.currentDocument = doc;
      }
    }

    // Build parent-child relationships
    const roots: Frame[] = [];
    for (const frameData of frames) {
      const frame = this.getFrame(tabId, frameData.frameId)!;
      frame.children = [];
    }
    for (const frameData of frames) {
      const frame = this.getFrame(tabId, frameData.frameId)!;
      if (frameData.parentFrameId === -1) {
        roots.push(frame);
      } else {
        const parent = this.getFrame(tabId, frameData.parentFrameId);
        if (parent) {
          parent.children.push(frame);
        } else {
          roots.push(frame);
        }
      }
    }

    return roots;
  }

  clear(): void {
    this.frames.clear();
    this.documents.clear();
    this.documentsByWindowId.clear();
  }
}

// Singleton instance
export const frameStore = new FrameStore();
