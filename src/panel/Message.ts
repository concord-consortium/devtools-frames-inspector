// Message class - Observable message with computed properties

import { makeAutoObservable, observable } from 'mobx';
import { windowFrameRegistry } from './WindowFrameRegistry';
import { IMessage } from '../types';

class Message implements IMessage {
  // Store all IMessage properties directly
  id: string;
  timestamp: number;
  target: IMessage['target'];
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
  buffered?: boolean;

  // Store source separately to override frameId with computed value
  private _source: IMessage['source'];

  constructor(msg: IMessage) {
    // Copy all properties directly
    this.id = msg.id;
    this.timestamp = msg.timestamp;
    this.target = msg.target;
    this.data = msg.data;
    this.dataPreview = msg.dataPreview;
    this.dataSize = msg.dataSize;
    this.messageType = msg.messageType;
    this.buffered = msg.buffered;
    this._source = msg.source;

    makeAutoObservable<this, '_source'>(this, {
      target: observable.ref, // Target object itself is not deeply observable
      data: observable.ref, // Data is not deeply observable
      _source: observable.ref // Source is immutable payload data
    });
  }

  // Check if this is a registration message (cached getter)
  get isRegistrationMessage(): boolean {
    return (this.data as { type?: string })?.type === '__frames_inspector_register__';
  }

  // Get registration data (cached getter, only valid if isRegistrationMessage is true)
  get registrationData(): { frameId: number; tabId: number } | null {
    if (!this.isRegistrationMessage) return null;
    const data = this.data as { frameId: number; tabId: number };
    return { frameId: data.frameId, tabId: data.tabId };
  }

  // Source with computed frameId
  get source(): IMessage['source'] {
    return {
      ...this._source,
      frameId: this.computedFrameId
    };
  }

  // Computed frameId - automatically updates when windowFrameRegistry changes
  private get computedFrameId(): number | undefined {
    // If message has native frameId (e.g., parent messages), use it
    if (this._source.frameId !== undefined) {
      return this._source.frameId;
    }

    // Otherwise, look up from registration map (e.g., child messages)
    if (this._source.windowId) {
      const registration = windowFrameRegistry.get(this._source.windowId);
      if (registration) {
        return registration.frameId;
      }
    }

    return undefined;
  }
}

export { Message };
