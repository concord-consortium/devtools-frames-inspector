// MobX store for Frames Inspector panel

import { makeAutoObservable } from 'mobx';
import {
  Settings,
  ViewType,
  DetailTabType,
  SortDirection,
  ALL_COLUMNS
} from './types';
import { IMessage, FrameInfo } from '../types';
import { Message } from './Message';
import { Frame, frameStore } from './models';

class PanelStore {
  // Tab ID for the inspected window
  tabId: number = 0;

  // Messages
  messages: Message[] = [];
  selectedMessageId: string | null = null;
  filterText = '';
  sortColumn = 'timestamp';
  sortDirection: SortDirection = 'asc';
  isRecording = true;
  preserveLog = false;

  // UI state
  currentView: ViewType = 'messages';
  activeDetailTab: DetailTabType = 'data';

  // Column configuration
  visibleColumns: Record<string, boolean> = {};
  columnWidths: Record<string, number> = {};

  // Hierarchy
  frameHierarchy: FrameInfo[] = [];
  selectedFrameId: string | number | null = null;

  // Settings
  settings: Settings = {
    showExtraMessageInfo: false,
    enableFrameRegistration: true,
    showRegistrationMessages: false
  };

  constructor() {
    makeAutoObservable(this);
    this.initColumnDefaults();
  }

  // Initialize column defaults
  private initColumnDefaults(): void {
    ALL_COLUMNS.forEach(col => {
      this.visibleColumns[col.id] = col.defaultVisible;
      this.columnWidths[col.id] = col.width;
    });
  }

  // Set tab ID
  setTabId(tabId: number): void {
    this.tabId = tabId;
  }

  // Computed: filtered and sorted messages
  get filteredMessages(): Message[] {
    let result = this.messages.filter(msg => {
      if (msg.isRegistrationMessage && !this.settings.showRegistrationMessages) {
        return false;
      }
      return this.matchesFilter(msg, this.filterText);
    });

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = this.getSortValue(a, this.sortColumn);
      const bVal = this.getSortValue(b, this.sortColumn);

      if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }

  // Computed: selected message
  get selectedMessage(): Message | undefined {
    return this.messages.find(m => m.id === this.selectedMessageId);
  }

  // Computed: selected frame
  get selectedFrame(): FrameInfo | undefined {
    return this.frameHierarchy.find(f => f.frameId === this.selectedFrameId);
  }

  // Get the Frame model for a given frameId in the current tab
  getFrame(frameId: number): Frame | undefined {
    return frameStore.getFrame(this.tabId, frameId);
  }

  // Get sortable value for a message
  private getSortValue(msg: Message, colId: string): string | number {
    switch (colId) {
      case 'timestamp': return msg.timestamp;
      case 'dataSize': return msg.dataSize;
      default: return this.getCellValue(msg, colId).toLowerCase();
    }
  }

  // Get cell value for display
  getCellValue(msg: Message, colId: string): string {
    switch (colId) {
      case 'timestamp': return this.formatTimestamp(msg.timestamp);
      case 'direction': return this.getDirectionIcon(msg.sourceType);
      case 'target.document.url': return msg.targetDocument?.url || '';
      case 'target.document.origin': return msg.targetDocument?.origin || '';
      case 'target.document.title': return msg.targetDocument?.title || '';
      case 'source.document.origin': return msg.sourceDocument?.origin || '';
      case 'sourceType': return msg.sourceType;
      case 'source.frameId': {
        const frame = msg.sourceFrame;
        return frame ? `frame[${frame.frameId}]` : '';
      }
      case 'source.ownerElement.src': return msg.sourceOwnerElement?.src || '';
      case 'source.ownerElement.id': return msg.sourceOwnerElement?.id || '';
      case 'source.ownerElement.domPath': return msg.sourceOwnerElement?.domPath || '';
      case 'messageType': return msg.messageType || '';
      case 'dataPreview': return msg.dataPreview;
      case 'dataSize': return this.formatSize(msg.dataSize);
      default: return '';
    }
  }

  // Format timestamp
  formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  // Format size
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  // Get direction icon
  getDirectionIcon(sourceType: string): string {
    switch (sourceType) {
      case 'parent': return '↘';
      case 'top': return '↘';
      case 'child': return '↖';
      case 'self': return '↻';
      case 'opener': return '←';
      default: return '?';
    }
  }

  // Parse frame filter value
  private parseFrameFilterValue(value: string): { tabId: number | null; frameId: number } | null {
    const fullMatch = value.match(/^tab\[(\d+)\]\.frame\[(\d+)\]$/);
    if (fullMatch) {
      return { tabId: parseInt(fullMatch[1], 10), frameId: parseInt(fullMatch[2], 10) };
    }

    const frameOnlyMatch = value.match(/^frame\[(\d+)\]$/);
    if (frameOnlyMatch) {
      return { tabId: null, frameId: parseInt(frameOnlyMatch[1], 10) };
    }

    return null;
  }

  // Check if message matches a single filter term
  private matchesTerm(msg: Message, term: string): boolean {
    const colonIdx = term.indexOf(':');
    if (colonIdx > 0) {
      const field = term.substring(0, colonIdx);
      const value = term.substring(colonIdx + 1);

      switch (field) {
        case 'type':
          return (msg.messageType || '').toLowerCase() === value;
        case 'target':
          return msg.target.origin.toLowerCase().includes(value);
        case 'sourcetype':
          return msg.source.type === value;
        case 'source':
          return msg.source.origin.toLowerCase().includes(value);
        case 'frame': {
          const parsed = this.parseFrameFilterValue(value);
          if (!parsed) return false;

          const filterTabId = parsed.tabId !== null ? parsed.tabId : this.tabId;
          const filterFrameId = parsed.frameId;

          const sourceFrame = msg.sourceFrame;
          if (sourceFrame && sourceFrame.frameId === filterFrameId && sourceFrame.tabId === filterTabId) {
            return true;
          }

          const targetFrameId = msg.target.frameId;
          if (targetFrameId === filterFrameId && this.tabId === filterTabId) {
            return true;
          }

          return false;
        }
        default:
          return false;
      }
    }

    return msg.dataPreview.toLowerCase().includes(term);
  }

  // Check if message matches filter
  private matchesFilter(msg: Message, filter: string): boolean {
    if (!filter) return true;

    const terms = filter.toLowerCase().split(/\s+/).filter(t => t);

    return terms.every(term => {
      if (term.startsWith('-') && term.length > 1) {
        return !this.matchesTerm(msg, term.substring(1));
      }
      return this.matchesTerm(msg, term);
    });
  }

  // Actions
  addMessage(msg: IMessage): void {
    if (!this.isRecording) return;

    // Process through FrameStore to create/update Frame and FrameDocument instances
    const { targetOwnerElement, sourceOwnerElement } = frameStore.processMessage({
      tabId: this.tabId,
      targetDocumentId: msg.target.documentId!,
      targetFrameId: msg.target.frameId,
      targetUrl: msg.target.url,
      targetOrigin: msg.target.origin,
      targetTitle: msg.target.documentTitle,
      sourceWindowId: msg.source.windowId,
      sourceDocumentId: msg.source.documentId,
      sourceOrigin: msg.source.origin,
      sourceType: msg.source.type,
      sourceIframeDomPath: msg.source.iframeDomPath,
      sourceIframeSrc: msg.source.iframeSrc,
      sourceIframeId: msg.source.iframeId,
    });

    // Create Message instance with owner element snapshots
    const message = new Message(msg, targetOwnerElement, sourceOwnerElement);

    // Handle registration messages
    if (message.isRegistrationMessage && msg.source.windowId) {
      const regData = message.registrationData;
      if (regData) {
        frameStore.processRegistration({
          frameId: regData.frameId,
          tabId: regData.tabId,
          documentId: regData.documentId,
          windowId: msg.source.windowId,
          ownerDomPath: msg.source.iframeDomPath,
          ownerSrc: msg.source.iframeSrc,
          ownerId: msg.source.iframeId,
        });
      }
    }

    this.messages.push(message);
  }

  clearMessages(): void {
    this.messages = [];
    this.selectedMessageId = null;
  }

  selectMessage(id: string | null): void {
    this.selectedMessageId = id;
  }

  setFilter(text: string): void {
    this.filterText = text;
  }

  setSort(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  toggleRecording(): void {
    this.isRecording = !this.isRecording;
  }

  setPreserveLog(value: boolean): void {
    this.preserveLog = value;
  }

  setCurrentView(view: ViewType): void {
    this.currentView = view;
    chrome.storage.local.set({ currentView: view });
  }

  setActiveDetailTab(tab: DetailTabType): void {
    this.activeDetailTab = tab;
  }

  setColumnVisible(columnId: string, visible: boolean): void {
    this.visibleColumns[columnId] = visible;
    chrome.storage.local.set({ visibleColumns: this.visibleColumns });
  }

  setColumnWidth(columnId: string, width: number): void {
    this.columnWidths[columnId] = width;
    chrome.storage.local.set({ columnWidths: this.columnWidths });
  }

  setFrameHierarchy(frames: FrameInfo[]): void {
    this.frameHierarchy = frames;

    // Process non-opener frames through FrameStore
    const numericFrames = frames.filter(f => typeof f.frameId === 'number') as Array<FrameInfo & { frameId: number }>;
    frameStore.processHierarchy(this.tabId, numericFrames);
  }

  selectFrame(frameId: string | number | null): void {
    this.selectedFrameId = frameId;
  }

  updateSettings(partial: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    chrome.storage.local.set({ settings: this.settings });
  }

  // Load persisted state from chrome.storage
  async loadPersistedState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['visibleColumns', 'columnWidths', 'settings', 'currentView'],
        (result) => {
          if (result.visibleColumns) {
            this.visibleColumns = { ...this.visibleColumns, ...result.visibleColumns };
          }
          if (result.columnWidths) {
            this.columnWidths = { ...this.columnWidths, ...result.columnWidths };
          }
          if (result.settings) {
            this.settings = { ...this.settings, ...result.settings };
          }
          if (result.currentView) {
            this.currentView = result.currentView;
          }
          resolve();
        }
      );
    });
  }

  // Build tree structure from flat frame list
  buildFrameTree(): FrameInfo[] {
    const frameMap = new Map<number | string, FrameInfo>(
      this.frameHierarchy.map(f => [f.frameId, { ...f, children: [] }])
    );
    const roots: FrameInfo[] = [];

    for (const frame of frameMap.values()) {
      if (frame.parentFrameId === -1) {
        roots.push(frame);
      } else {
        const parent = frameMap.get(frame.parentFrameId);
        if (parent) {
          parent.children!.push(frame);
        } else {
          roots.push(frame);
        }
      }
    }

    return roots;
  }
}

// Create and export singleton store
export const store = new PanelStore();
