// Shared types for Frames Inspector panel

export interface ColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  width: number;
}

export interface CapturedMessage {
  id: string;
  timestamp: number;
  target: {
    url: string;
    origin: string;
    documentTitle?: string;
    frameId?: number;
    frameInfoError?: string;
  };
  source?: {
    type: string;
    origin: string;
    windowId?: string;
    iframeSrc?: string;
    iframeId?: string;
    iframeDomPath?: string;
    frameId?: number;
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

export interface Settings {
  showExtraMessageInfo: boolean;
  enableFrameRegistration: boolean;
  showRegistrationMessages: boolean;
}

export interface WindowFrameRegistration {
  frameId: number;
  tabId?: number;
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
