// Types for Frames Inspector panel

// Re-export shared types
export type { IMessage, CapturedMessage, FrameInfo } from '../types';
import type { IMessage } from '../types';

// Registration message data structure
export interface RegistrationMessageData {
  type: '__frames_inspector_register__';
  frameId: number;
  tabId: number;
}

// IMessage with typed registration data
export interface RegistrationCapturedMessage extends IMessage {
  data: RegistrationMessageData;
}

export interface ColumnDef {
  id: string;
  defaultVisible: boolean;
  width: number;
}

export interface Settings {
  showExtraMessageInfo: boolean;
  enableFrameRegistration: boolean;
  showRegistrationMessages: boolean;
}

export type ViewType = 'messages' | 'hierarchy' | 'settings';
export type DetailTabType = 'data' | 'context';
export type SortDirection = 'asc' | 'desc';

// Column definitions
export const ALL_COLUMNS: ColumnDef[] = [
  { id: 'timestamp', defaultVisible: true, width: 90 },
  { id: 'direction', defaultVisible: true, width: 40 },
  { id: 'target.document.url', defaultVisible: false, width: 200 },
  { id: 'target.document.origin', defaultVisible: true, width: 150 },
  { id: 'target.document.title', defaultVisible: false, width: 150 },
  { id: 'source.document.origin', defaultVisible: true, width: 120 },
  { id: 'sourceType', defaultVisible: true, width: 70 },
  { id: 'source.frameId', defaultVisible: false, width: 80 },
  { id: 'source.ownerElement.src', defaultVisible: false, width: 200 },
  { id: 'source.ownerElement.id', defaultVisible: false, width: 100 },
  { id: 'source.ownerElement.domPath', defaultVisible: false, width: 200 },
  { id: 'messageType', defaultVisible: true, width: 80 },
  { id: 'dataPreview', defaultVisible: true, width: 200 },
  { id: 'dataSize', defaultVisible: false, width: 60 }
];
