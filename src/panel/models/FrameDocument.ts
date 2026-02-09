// FrameDocument - A specific document loaded in a frame, keyed by documentId

import { makeAutoObservable } from 'mobx';
import type { Frame } from './Frame';

export class FrameDocument {
  documentId: string | undefined;
  url: string | undefined;
  origin: string | undefined;
  title: string | undefined;
  windowId: string | undefined;
  frame: Frame | undefined;

  constructor(init: {
    documentId?: string;
    url?: string;
    origin?: string;
    title?: string;
    windowId?: string;
  }) {
    this.documentId = init.documentId;
    this.url = init.url;
    this.origin = init.origin;
    this.title = init.title;
    this.windowId = init.windowId;

    makeAutoObservable(this);
  }
}
