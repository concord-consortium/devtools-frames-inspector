// Shared types for Frames Inspector

export interface CapturedMessage {
  id: string;
  timestamp: number;
  target: {
    url: string;
    origin: string;
    documentTitle: string;
    frameId?: number;
    frameInfoError?: string;
  };
  source: {
    type: string;
    origin: string;
    windowId: string | null;
    iframeSrc: string | null;
    iframeId: string | null;
    iframeDomPath: string | null;
    frameId?: number;
    frameInfoError?: string;
  };
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
  buffered?: boolean;
}

export interface FrameInfo {
  frameId: number | string;
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
  payload: CapturedMessage;
}

export type ContentToBackgroundMessage = PostMessageCapturedMessage;
