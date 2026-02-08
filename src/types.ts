// Shared types for Frames Inspector

// Message as captured by content script (before background enriches it)
export interface RawCapturedMessage {
  id: string;
  timestamp: number;
  target: {
    url: string;
    origin: string;
    documentTitle: string;
  };
  source: {
    type: string;
    origin: string;
    windowId: string | null;
    iframeSrc: string | null;
    iframeId: string | null;
    iframeDomPath: string | null;
  };
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
}

// Message interface - can be implemented by Message class or used as plain object
export interface IMessage {
  id: string;
  timestamp: number;
  target: {
    url: string;
    origin: string;
    documentTitle: string;
    frameId: number;
    documentId?: string;  // From sender.documentId in background script
    frameInfoError?: string;
  };
  source: {
    type: string;
    origin: string;
    windowId: string | null;
    iframeSrc: string | null;
    iframeId: string | null;
    iframeDomPath: string | null;
    frameId?: number;  // Computed for child messages
    documentId?: string;  // For parent messages, from webNavigation lookup
    frameInfoError?: string;
  };
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
  buffered?: boolean;
}

// Alias for backward compatibility during transition
export type CapturedMessage = IMessage;

export interface FrameInfo {
  frameId: number | string;
  documentId?: string;
  url: string;
  parentFrameId: number;
  title: string;
  origin: string;
  iframes: { src: string; id: string; domPath: string }[];
  isOpener?: boolean;
  children?: FrameInfo[];
}

export interface OpenerInfo {
  origin: string | null;
}

// Messages sent from background to content script
export interface FrameIdentityMessage {
  type: 'frame-identity';
  frameId: number;
  tabId: number;
  documentId: string;
}

export interface GetFrameInfoMessage {
  type: 'get-frame-info';
}

export interface FrameInfoResponse {
  title: string;
  origin: string;
  iframes: { src: string; id: string; domPath: string }[];
  opener?: OpenerInfo | null;
}

export type BackgroundToContentMessage = FrameIdentityMessage | GetFrameInfoMessage;

// Messages sent from content script to background
export interface PostMessageCapturedMessage {
  type: 'postmessage-captured';
  payload: RawCapturedMessage;
}

export type ContentToBackgroundMessage = PostMessageCapturedMessage;
