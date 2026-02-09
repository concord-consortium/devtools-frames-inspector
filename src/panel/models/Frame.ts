// Frame - Stable identity for an iframe, keyed by (tabId, frameId)

import { makeAutoObservable } from 'mobx';
import { FrameDocument } from './FrameDocument';
import { OwnerElement } from './OwnerElement';

export class Frame {
  readonly tabId: number;
  readonly frameId: number;
  parentFrameId: number;
  currentDocument: FrameDocument | undefined;
  currentOwnerElement: OwnerElement | undefined;
  children: Frame[] = [];

  constructor(tabId: number, frameId: number, parentFrameId: number = -1) {
    this.tabId = tabId;
    this.frameId = frameId;
    this.parentFrameId = parentFrameId;

    makeAutoObservable(this, {
      tabId: false,
      frameId: false,
    });
  }

  static key(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`;
  }

  get key(): string {
    return Frame.key(this.tabId, this.frameId);
  }
}
