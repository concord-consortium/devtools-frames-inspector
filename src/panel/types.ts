// Types for Frames Inspector panel

// Re-export shared types
export type { CapturedMessage, FrameInfo } from '../types';
import type { CapturedMessage } from '../types';

// Registration message data structure
export interface RegistrationMessageData {
  type: '__frames_inspector_register__';
  frameId: number;
  tabId: number;
}

// CapturedMessage with typed registration data
export interface RegistrationCapturedMessage extends CapturedMessage {
  data: RegistrationMessageData;
}

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  width: number;
}

export interface Settings {
  showExtraMessageInfo: boolean;
  enableFrameRegistration: boolean;
  showRegistrationMessages: boolean;
}

export interface WindowFrameRegistration {
  frameId: number;
  tabId: number;
  // Owner iframe info (the iframe element in the parent that contains this frame)
  ownerDomPath?: string;
  ownerSrc?: string;
  ownerId?: string;
}

export type ViewType = 'messages' | 'hierarchy' | 'settings';
export type DetailTabType = 'data' | 'context';
export type SortDirection = 'asc' | 'desc';

// Column definitions
export const ALL_COLUMNS: ColumnDef[] = [
  { id: 'timestamp', label: 'Time', defaultVisible: true, width: 90 },
  { id: 'direction', label: 'Dir', defaultVisible: true, width: 40 },
  { id: 'targetUrl', label: 'Target URL', defaultVisible: false, width: 200 },
  { id: 'targetOrigin', label: 'Target Origin', defaultVisible: true, width: 150 },
  { id: 'targetTitle', label: 'Target Title', defaultVisible: false, width: 150 },
  { id: 'sourceOrigin', label: 'Source Origin', defaultVisible: true, width: 120 },
  { id: 'sourceType', label: 'Source', defaultVisible: true, width: 70 },
  { id: 'sourceFrameId', label: 'Source Frame', defaultVisible: false, width: 80 },
  { id: 'sourceIframeSrc', label: 'Source iframe src', defaultVisible: false, width: 200 },
  { id: 'sourceIframeId', label: 'Source iframe id', defaultVisible: false, width: 100 },
  { id: 'sourceIframeDomPath', label: 'Source iframe path', defaultVisible: false, width: 200 },
  { id: 'messageType', label: 'Type', defaultVisible: true, width: 80 },
  { id: 'dataPreview', label: 'Data', defaultVisible: true, width: 200 },
  { id: 'dataSize', label: 'Size', defaultVisible: false, width: 60 }
];
