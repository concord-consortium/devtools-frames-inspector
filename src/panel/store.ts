// MobX store for Frames Inspector panel

import { makeAutoObservable } from 'mobx';
import { parse, test as liqeTest, type LiqeQuery } from 'liqe';
import {
  Settings,
  VIEW_TYPES,
  ViewType,
  DetailTabType,
  SortDirection,
  FocusPosition,
  SelectedNode,
  ALL_COLUMNS
} from './types';
import { FrameInfo } from '../types';
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

  // Reload-recovery state
  extensionContextInvalidated = false;
  staleFrameIds = new Set<number>();

  // UI state
  currentView: ViewType = 'log';
  activeDetailTab: DetailTabType = 'data';

  // Column configuration
  visibleColumns: Record<string, boolean> = {};
  columnWidths: Record<string, number> = {};

  // Hierarchy
  selectedFrameKey: string | null = null;
  selectedNode: SelectedNode | null = null;

  // Focused frame (tabId + frameId to distinguish frames across tabs)
  focusedFrame: { tabId: number; frameId: number } | null = null;

  // Settings
  settings: Settings = {
    showInternalFields: false,
    enableFrameRegistration: true,
    showRegistrationMessages: false,
    registrationDelayMs: 500,
    globalFilter: '',
    globalFilterEnabled: true,
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
    let toolbarAst: LiqeQuery | null = null;
    if (this.filterText) {
      try {
        toolbarAst = parse(this.filterText);
      } catch {
        // Invalid query — ignore toolbar filter
      }
    }

    let globalAst: LiqeQuery | null = null;
    if (this.settings.globalFilterEnabled && this.settings.globalFilter) {
      try {
        globalAst = parse(this.settings.globalFilter);
      } catch {
        // Invalid query — ignore global filter
      }
    }

    let result = this.messages.filter(msg => {
      if (msg.isRegistrationMessage && !this.settings.showRegistrationMessages) {
        return false;
      }
      if (globalAst && !liqeTest(globalAst, msg)) return false;
      if (toolbarAst && !liqeTest(toolbarAst, msg)) return false;
      return true;
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

  frameKey(frame: { tabId?: number | null; frameId: number | string }): string {
    return frame.tabId != null ? `${frame.tabId}:${frame.frameId}` : String(frame.frameId);
  }

  // Computed: selected frame
  get selectedFrame(): Frame | undefined {
    if (!this.selectedFrameKey) return undefined;
    const [tabId, frameId] = this.selectedFrameKey.split(':').map(Number);
    if (isNaN(tabId) || isNaN(frameId)) return undefined;
    return frameStore.getFrame(tabId, frameId);
  }

  get hierarchyRoots(): Frame[] {
    return frameStore.hierarchyRoots;
  }

  get nonHierarchyFrames(): Frame[] {
    return frameStore.nonHierarchyFrames;
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
      case 'partnerFrame': {
        const partnerFrame = this.getPartnerFrame(msg);
        if (!partnerFrame) return '';
        const isOtherTab = partnerFrame.tabId != null && partnerFrame.tabId !== this.tabId;
        return isOtherTab
          ? `tab[${partnerFrame.tabId}].frame[${partnerFrame.frameId}]`
          : `frame[${partnerFrame.frameId}]`;
      }
      case 'partnerType': return this.getPartnerType(msg) || '';
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
      case 'opener': return '→';
      case 'opened': return '←';
      default: return '?';
    }
  }

  // Focused frame methods
  setFocusedFrame(frame: { tabId: number; frameId: number } | null): void {
    this.focusedFrame = frame;
  }

  // Build a frames filter string for a specific frame
  buildFrameFilter(tabId: number, frameId: number): string {
    return `frames:"tab[${tabId}].frame[${frameId}]"`;
  }

  // Navigate to log view filtered to a specific frame's messages
  navigateToFrameMessages(tabId: number, frameId: number): void {
    this.setFocusedFrame({ tabId, frameId });
    this.setFilter(this.buildFrameFilter(tabId, frameId));
    this.setCurrentView('log');
  }

  // Navigate to endpoints view and select a specific frame
  viewFrameInEndpoints(tabId: number, frameId: number): void {
    this.selectFrame(`${tabId}:${frameId}`);
    // Also select as a tree node — use 'tab' for root frames, 'iframe' for children
    if (frameId === 0) {
      this.selectNode({ type: 'tab', tabId });
    } else {
      this.selectNode({ type: 'iframe', tabId, frameId });
    }
    this.setCurrentView('endpoints');
  }

  getFocusPosition(msg: Message): FocusPosition {
    if (this.focusedFrame == null) return 'none';

    const sourceFrame = msg.sourceFrame;
    const targetFrame = msg.targetFrame;

    const isSource = sourceFrame?.frameId === this.focusedFrame.frameId
      && sourceFrame?.tabId === this.focusedFrame.tabId;
    const isTarget = targetFrame?.frameId === this.focusedFrame.frameId
      && targetFrame?.tabId === this.focusedFrame.tabId;

    if (isSource && isTarget) return 'both';
    if (isSource) return 'source';
    if (isTarget) return 'target';
    return 'none';
  }

  getPartnerFrame(msg: Message): Frame | undefined {
    const pos = this.getFocusPosition(msg);
    if (pos === 'source') return msg.targetFrame;
    if (pos === 'target') return msg.sourceFrame;
    return undefined;
  }

  getPartnerType(msg: Message): string | null {
    const pos = this.getFocusPosition(msg);
    if (pos === 'none' || pos === 'both') return null;
    // sourceType describes source's relation to the target.
    // When focus is source, partner is target → invert to get target's relation to source.
    // When focus is target, partner is source → sourceType already describes it.
    if (pos === 'source') return this.invertSourceType(msg.sourceType);
    return msg.sourceType;
  }

  private invertSourceType(sourceType: string): string {
    switch (sourceType) {
      case 'parent': return 'child';
      case 'child': return 'parent';
      case 'top': return 'child';
      case 'opener': return 'opened';
      case 'opened': return 'opener';
      case 'self': return 'self';
      default: return sourceType;
    }
  }

  // Actions
  addMessage(message: Message): void {
    if (!this.isRecording) return;
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
    const processable = frames.filter(f => typeof f.frameId === 'number' && f.tabId != null) as Array<FrameInfo & { frameId: number; tabId: number }>;
    frameStore.processHierarchy(processable);
  }

  selectFrame(key: string | null): void {
    this.selectedFrameKey = key;
  }

  selectNode(node: SelectedNode | null): void {
    this.selectedNode = node;
  }

  // Build filter string for a selected node type
  buildNodeFilter(node: SelectedNode): string {
    switch (node.type) {
      case 'tab':
        return this.buildFrameFilter(node.tabId, 0);
      case 'iframe':
      case 'unknown-iframe':
        return this.buildFrameFilter(node.tabId, node.frameId);
      case 'document':
        return `documentId:${node.documentId}`;
      case 'document-by-sourceId':
        return `source.sourceId:${node.sourceId}`;
      case 'iframe-element':
        return `source.sourceId:${node.sourceId}`;
      case 'unknown-document':
        return `source.sourceId:${node.sourceId}`;
    }
  }

  // Navigate to log view filtered to a selected node's messages
  navigateToNodeMessages(node: SelectedNode): void {
    // Set focused frame for frame-based nodes
    if (node.type === 'tab') {
      this.setFocusedFrame({ tabId: node.tabId, frameId: 0 });
    } else if (node.type === 'iframe' || node.type === 'unknown-iframe') {
      this.setFocusedFrame({ tabId: node.tabId, frameId: node.frameId });
    } else {
      this.setFocusedFrame(null);
    }
    this.setFilter(this.buildNodeFilter(node));
    this.setCurrentView('log');
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
          if (result.currentView && VIEW_TYPES.includes(result.currentView)) {
            this.currentView = result.currentView;
          }
          resolve();
        }
      );
    });
  }

  buildFrameTree(): Frame[] {
    return frameStore.hierarchyRoots;
  }

  setExtensionContextInvalidated(value: boolean): void {
    this.extensionContextInvalidated = value;
  }

  addStaleFrame(frameId: number): void {
    this.staleFrameIds.add(frameId);
  }

  clearStaleFrame(frameId: number): void {
    this.staleFrameIds.delete(frameId);
  }

  clearStaleFrames(): void {
    this.staleFrameIds.clear();
  }

  get hasStaleFrames(): boolean {
    return this.staleFrameIds.size > 0;
  }
}

// Create and export singleton store
export const store = new PanelStore();
