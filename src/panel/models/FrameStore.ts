// FrameStore - Manages Frame and FrameDocument instances with reactive MobX maps

import { makeAutoObservable, observable } from 'mobx';
import { Frame } from './Frame';
import { FrameDocument } from './FrameDocument';

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
