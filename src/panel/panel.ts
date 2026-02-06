// Panel logic for Frames Inspector

import { FIELD_INFO } from './field-info';

// Types
interface ColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  width: number;
}

interface CapturedMessage {
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

interface FrameInfo {
  frameId: number | string;
  url: string;
  parentFrameId: number;
  title: string;
  origin: string;
  iframes: { src: string; id: string; domPath: string }[];
  isOpener?: boolean;
  children?: FrameInfo[];
}

interface Settings {
  showExtraMessageInfo: boolean;
  enableFrameRegistration: boolean;
  showRegistrationMessages: boolean;
}

interface WindowFrameRegistration {
  frameId: number;
  tabId?: number;
}

// Column definitions
const ALL_COLUMNS: ColumnDef[] = [
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

// State
let messages: CapturedMessage[] = [];
let filteredMessages: CapturedMessage[] = [];
let selectedMessageId: string | null = null;
let visibleColumns: Record<string, boolean> = {};
let sortColumn = 'timestamp';
let sortDirection: 'asc' | 'desc' = 'asc';
let filterText = '';
let preserveLog = false;
let activeTab = 'data';
let isRecording = true;

// View state
let currentView = 'messages';

// Hierarchy state (renamed from 'frames' to avoid collision with window.frames)
let frameHierarchy: FrameInfo[] = [];
let selectedFrameId: number | string | null = null;

// Settings state
let settings: Settings = {
  showExtraMessageInfo: false,
  enableFrameRegistration: true,
  showRegistrationMessages: false
};

// Map windowId -> {frameId, tabId} from registration messages
const windowFrameMap = new Map<string, WindowFrameRegistration>();

// Field info popup state
let popupShowTimeout: ReturnType<typeof setTimeout> | null = null;
let popupHideTimeout: ReturnType<typeof setTimeout> | null = null;
let isMouseOverPopup = false;
let isMouseOverLabel = false;
let currentPopupFieldId: string | null = null;
let currentPopupLabelElement: HTMLElement | null = null;

// DOM elements (non-null assertions - these elements must exist in the HTML)
const headerRow = document.getElementById('header-row')!;
const messageTbody = document.getElementById('message-tbody')!;
const filterInput = document.getElementById('filter-input') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn')!;
const preserveLogCheckbox = document.getElementById('preserve-log-checkbox') as HTMLInputElement;
const detailPane = document.getElementById('detail-pane')!;
const tabContent = document.getElementById('tab-content')!;
const columnMenu = document.getElementById('column-menu')!;
const cellMenu = document.getElementById('cell-menu')!;
const filterByValue = document.getElementById('filter-by-value')!;
const resizeHandle = document.getElementById('resize-handle')!;
const closeDetailBtn = document.getElementById('close-detail-btn')!;
const recordBtn = document.getElementById('record-btn')!;

// Sidebar and view elements
const sidebar = document.querySelector('.sidebar')!;
const messagesView = document.getElementById('messages-view')!;
const hierarchyView = document.getElementById('hierarchy-view')!;
const settingsView = document.getElementById('settings-view')!;
const refreshHierarchyBtn = document.getElementById('refresh-hierarchy-btn')!;
const frameTbody = document.getElementById('frame-tbody')!;
const frameDetailPane = document.getElementById('frame-detail-pane')!;
const frameDetailContent = document.getElementById('frame-detail-content')!;
const closeFrameDetailBtn = document.getElementById('close-frame-detail-btn')!;
const showExtraInfoCheckbox = document.getElementById('show-extra-info-checkbox') as HTMLInputElement;
const enableFrameRegistrationCheckbox = document.getElementById('enable-frame-registration-checkbox') as HTMLInputElement;
const showRegistrationMessagesCheckbox = document.getElementById('show-registration-messages-checkbox') as HTMLInputElement;
const fieldInfoPopup = document.getElementById('field-info-popup')!;

// Initialize visible columns from defaults or storage
function initColumns(): void {
  ALL_COLUMNS.forEach(col => {
    visibleColumns[col.id] = col.defaultVisible;
  });

  // Load from storage
  chrome.storage.local.get(['visibleColumns'], (result) => {
    if (result.visibleColumns) {
      visibleColumns = { ...visibleColumns, ...result.visibleColumns };
    }
    renderHeader();
    renderMessages();
  });
}

// Save column preferences
function saveColumnPrefs(): void {
  chrome.storage.local.set({ visibleColumns });
}

// Format timestamp
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// Format size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Check if a message is a registration message
function isRegistrationMessage(msg: CapturedMessage): boolean {
  return (msg.data as { type?: string })?.type === '__frames_inspector_register__';
}

// Get direction icon based on sourceType
function getDirectionIcon(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'parent': return '↘';
    case 'top': return '↘';
    case 'child': return '↖';
    case 'self': return '↻';
    case 'opener': return '←';
    default: return '?';
  }
}

// Get cell value for a message and column
function getCellValue(msg: CapturedMessage, colId: string): string {
  switch (colId) {
    case 'timestamp': return formatTimestamp(msg.timestamp);
    case 'direction': return getDirectionIcon(msg.source?.type);
    case 'targetUrl': return msg.target.url;
    case 'targetOrigin': return msg.target.origin;
    case 'targetTitle': return msg.target.documentTitle || '';
    case 'sourceOrigin': return msg.source?.origin || '';
    case 'sourceType': return msg.source?.type || '';
    case 'sourceFrameId': {
      let frameId = msg.source?.frameId;
      if (frameId === undefined && msg.source?.windowId) {
        const registration = windowFrameMap.get(msg.source.windowId);
        if (registration) {
          frameId = registration.frameId;
        }
      }
      return frameId !== undefined ? `frame[${frameId}]` : '';
    }
    case 'sourceIframeSrc': return msg.source?.iframeSrc || '';
    case 'sourceIframeId': return msg.source?.iframeId || '';
    case 'sourceIframeDomPath': return msg.source?.iframeDomPath || '';
    case 'messageType': return msg.messageType || '';
    case 'dataPreview': return msg.dataPreview;
    case 'dataSize': return formatSize(msg.dataSize);
    default: return '';
  }
}

// Column widths state (persisted)
let columnWidths: Record<string, number> = {};

// Initialize column widths from defaults
function initColumnWidths(): void {
  ALL_COLUMNS.forEach(col => {
    columnWidths[col.id] = col.width;
  });

  chrome.storage.local.get(['columnWidths'], (result) => {
    if (result.columnWidths) {
      columnWidths = { ...columnWidths, ...result.columnWidths };
    }
  });
}

// Save column widths
function saveColumnWidths(): void {
  chrome.storage.local.set({ columnWidths });
}

// Render table header
function renderHeader(): void {
  headerRow.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    if (!visibleColumns[col.id]) return;

    const th = document.createElement('th');
    th.textContent = col.label;
    th.dataset.column = col.id;
    th.style.width = (columnWidths[col.id] || col.width) + 'px';

    if (sortColumn === col.id) {
      th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    th.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('column-resize-handle')) {
        handleSort(col.id);
      }
    });
    th.addEventListener('contextmenu', (e) => showColumnMenu(e));

    // Add resize handle
    const handle = document.createElement('div');
    handle.className = 'column-resize-handle';
    handle.addEventListener('mousedown', (e) => startColumnResize(e, col.id, th));
    th.appendChild(handle);

    headerRow.appendChild(th);
  });
}

// Column resize state
let resizingColumn: string | null = null;
let resizingTh: HTMLElement | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;

function startColumnResize(e: MouseEvent, colId: string, th: HTMLElement): void {
  e.preventDefault();
  e.stopPropagation();

  resizingColumn = colId;
  resizingTh = th;
  resizeStartX = e.clientX;
  resizeStartWidth = th.offsetWidth;

  document.body.style.cursor = 'col-resize';
  (e.target as HTMLElement).classList.add('resizing');
}

document.addEventListener('mousemove', (e) => {
  if (!resizingColumn || !resizingTh) return;

  const diff = e.clientX - resizeStartX;
  const newWidth = Math.max(40, resizeStartWidth + diff);

  resizingTh.style.width = newWidth + 'px';
  columnWidths[resizingColumn] = newWidth;
});

document.addEventListener('mouseup', () => {
  if (resizingColumn) {
    document.body.style.cursor = '';
    document.querySelectorAll('.column-resize-handle.resizing').forEach(el => {
      el.classList.remove('resizing');
    });
    saveColumnWidths();
    resizingColumn = null;
    resizingTh = null;
  }
});

// Render messages
function renderMessages(): void {
  messageTbody.innerHTML = '';

  filteredMessages.forEach(msg => {
    const tr = document.createElement('tr');
    tr.dataset.id = msg.id;

    if (msg.id === selectedMessageId) {
      tr.classList.add('selected');
    }

    ALL_COLUMNS.forEach(col => {
      if (!visibleColumns[col.id]) return;

      const td = document.createElement('td');
      td.textContent = getCellValue(msg, col.id);
      td.dataset.column = col.id;

      if (col.id === 'direction') {
        td.classList.add(`dir-${msg.source?.type || 'unknown'}`);
      }

      td.addEventListener('contextmenu', (e) => showCellMenu(e, msg, col.id));

      tr.appendChild(td);
    });

    tr.addEventListener('click', () => selectMessage(msg.id));
    messageTbody.appendChild(tr);
  });
}

// Handle sort
function handleSort(colId: string): void {
  if (sortColumn === colId) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = colId;
    sortDirection = 'asc';
  }

  applyFilterAndSort();
  renderHeader();
  renderMessages();
}

// Apply filter and sort to messages
function applyFilterAndSort(): void {
  // Filter
  filteredMessages = messages.filter(msg => {
    if (isRegistrationMessage(msg) && !settings.showRegistrationMessages) {
      return false;
    }
    return matchesFilter(msg, filterText);
  });

  // Sort
  filteredMessages.sort((a, b) => {
    const aVal = getSortValue(a, sortColumn);
    const bVal = getSortValue(b, sortColumn);

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

// Get sortable value
function getSortValue(msg: CapturedMessage, colId: string): string | number {
  switch (colId) {
    case 'timestamp': return msg.timestamp;
    case 'dataSize': return msg.dataSize;
    default: return getCellValue(msg, colId).toLowerCase();
  }
}

// Parse frame filter value like "frame[123]" or "tab[23].frame[123]"
function parseFrameFilterValue(value: string): { tabId: number | null; frameId: number } | null {
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
function matchesTerm(msg: CapturedMessage, term: string): boolean {
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
        return (msg.source?.type || 'unknown') === value;
      case 'source':
        return (msg.source?.origin || '').toLowerCase().includes(value);
      case 'frame': {
        const parsed = parseFrameFilterValue(value);
        if (!parsed) return false;

        const filterTabId = parsed.tabId !== null ? parsed.tabId : tabId;
        const filterFrameId = parsed.frameId;

        let sourceFrameId = msg.source?.frameId;
        let sourceTabId = tabId;
        if (msg.source?.windowId) {
          const registration = windowFrameMap.get(msg.source.windowId);
          if (registration) {
            if (sourceFrameId === undefined) {
              sourceFrameId = registration.frameId;
            }
            if (registration.tabId !== undefined) {
              sourceTabId = registration.tabId;
            }
          }
        }

        if (sourceFrameId === filterFrameId && sourceTabId === filterTabId) {
          return true;
        }

        const targetFrameId = msg.target.frameId;
        if (targetFrameId === filterFrameId && tabId === filterTabId) {
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
function matchesFilter(msg: CapturedMessage, filter: string): boolean {
  if (!filter) return true;

  const terms = filter.toLowerCase().split(/\s+/).filter(t => t);

  return terms.every(term => {
    if (term.startsWith('-') && term.length > 1) {
      return !matchesTerm(msg, term.substring(1));
    }
    return matchesTerm(msg, term);
  });
}

// Select a message
function selectMessage(id: string): void {
  selectedMessageId = id;

  messageTbody.querySelectorAll('tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === id);
  });

  const msg = messages.find(m => m.id === id);
  if (msg) {
    detailPane.classList.remove('hidden');
    renderDetailPane(msg);
  }
}

// Render detail pane
function renderDetailPane(msg: CapturedMessage): void {
  if (activeTab === 'data') {
    renderDataTab(msg);
  } else {
    renderContextTab(msg);
  }
}

// Render Data tab
function renderDataTab(msg: CapturedMessage): void {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(msg.data, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy JSON', 1500);
  };

  const tree = document.createElement('div');
  tree.className = 'json-tree';
  tree.appendChild(renderJsonValue(msg.data));

  tabContent.innerHTML = '';
  tabContent.appendChild(copyBtn);
  tabContent.appendChild(tree);
}

// Render JSON value recursively
function renderJsonValue(value: unknown, key: string | number | null = null): HTMLElement {
  const container = document.createElement('div');

  if (value === null) {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-null">null</span>`
      : '<span class="json-null">null</span>';
  } else if (typeof value === 'boolean') {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-boolean">${value}</span>`
      : `<span class="json-boolean">${value}</span>`;
  } else if (typeof value === 'number') {
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-number">${value}</span>`
      : `<span class="json-number">${value}</span>`;
  } else if (typeof value === 'string') {
    const escaped = value.replace(/"/g, '\\"');
    container.innerHTML = key !== null
      ? `<span class="json-key">"${key}"</span>: <span class="json-string">"${escaped}"</span>`
      : `<span class="json-string">"${escaped}"</span>`;
  } else if (Array.isArray(value)) {
    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';

    const children = document.createElement('div');
    children.className = 'json-children';

    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}Array(${value.length})`;
    container.appendChild(toggle);

    value.forEach((item, i) => {
      children.appendChild(renderJsonValue(item, i));
    });
    container.appendChild(children);
  } else if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';

    const children = document.createElement('div');
    children.className = 'json-children';

    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}{...}`;
    container.appendChild(toggle);

    keys.forEach(k => {
      children.appendChild(renderJsonValue((value as Record<string, unknown>)[k], k));
    });
    container.appendChild(children);
  } else {
    container.textContent = String(value);
  }

  return container;
}

// Render Context tab
function renderContextTab(msg: CapturedMessage): void {
  const sourceType = msg.source?.type || 'unknown';

  const rows: [string | null, string | null][] = [];

  if (settings.showExtraMessageInfo) {
    rows.push(['messageId', msg.id]);
  }

  rows.push(
    ['timestamp', new Date(msg.timestamp).toISOString()],
    ['messageType', msg.messageType || '(none)'],
    ['dataSize', formatSize(msg.dataSize)]
  );

  if (settings.showExtraMessageInfo) {
    rows.push(['buffered', msg.buffered ? 'Yes' : 'No']);
    if (msg.source?.windowId) {
      rows.push(['windowId', msg.source.windowId]);
    }
  }

  rows.push(
    [null, null],
    ['targetUrl', msg.target.url],
    ['targetOrigin', msg.target.origin],
    ['targetTitle', msg.target.documentTitle || '(none)'],
    ['targetFrame', msg.target.frameId !== undefined ? `frame[${msg.target.frameId}]` : '(unknown)']
  );

  if (msg.target.frameInfoError) {
    rows.push(['targetFrameError', msg.target.frameInfoError]);
  }

  rows.push(
    [null, null],
    ['sourceType', `${getDirectionIcon(sourceType)} ${sourceType}`],
    ['sourceOrigin', msg.source?.origin || '(unknown)']
  );

  let sourceFrameId = msg.source?.frameId;
  let sourceTabId: number | undefined = undefined;
  if (msg.source?.windowId) {
    const registration = windowFrameMap.get(msg.source.windowId);
    if (registration) {
      if (sourceFrameId === undefined) {
        sourceFrameId = registration.frameId;
      }
      sourceTabId = registration.tabId;
    }
  }
  if (sourceFrameId !== undefined) {
    rows.push(['sourceFrame', `frame[${sourceFrameId}]`]);
  }
  if (sourceTabId !== undefined) {
    rows.push(['sourceTab', `tab[${sourceTabId}]`]);
  }

  if (sourceType === 'child') {
    if (msg.source?.iframeSrc) {
      rows.push(['sourceIframeSrc', msg.source.iframeSrc]);
    }
    if (msg.source?.iframeId) {
      rows.push(['sourceIframeId', msg.source.iframeId]);
    }
    if (msg.source?.iframeDomPath) {
      rows.push(['sourceIframeDomPath', msg.source.iframeDomPath]);
    }
  }

  const table = document.createElement('table');
  table.className = 'context-table';

  rows.forEach(([fieldId, value]) => {
    const tr = document.createElement('tr');
    if (fieldId === null && value === null) {
      tr.innerHTML = '<td colspan="2" class="context-separator"></td>';
    } else {
      const fieldInfo = fieldId ? FIELD_INFO[fieldId] : undefined;
      const label = fieldInfo ? fieldInfo.label : fieldId || '';

      const th = document.createElement('th');
      if (fieldInfo && fieldId) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.classList.add('has-info');
        labelSpan.dataset.fieldId = fieldId;

        labelSpan.addEventListener('mouseenter', () => {
          isMouseOverLabel = true;
          if (popupHideTimeout) {
            clearTimeout(popupHideTimeout);
            popupHideTimeout = null;
          }
          if (popupShowTimeout) {
            clearTimeout(popupShowTimeout);
          }
          if (currentPopupFieldId === fieldId) {
            return;
          }
          popupShowTimeout = setTimeout(() => {
            showFieldInfoPopup(fieldId, labelSpan);
          }, 200);
        });

        labelSpan.addEventListener('mouseleave', () => {
          isMouseOverLabel = false;
          if (popupShowTimeout) {
            clearTimeout(popupShowTimeout);
            popupShowTimeout = null;
          }
          popupHideTimeout = setTimeout(checkPopupVisibility, 50);
        });

        th.appendChild(labelSpan);
      } else {
        th.textContent = label;
      }

      const td = document.createElement('td');
      td.textContent = value || '';

      tr.appendChild(th);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });

  tabContent.innerHTML = '';
  tabContent.appendChild(table);
}

// Show field info popup
function showFieldInfoPopup(fieldId: string, labelElement: HTMLElement): void {
  const fieldInfo = FIELD_INFO[fieldId];
  if (!fieldInfo) return;

  let html = `<div class="field-description">${fieldInfo.description}</div>`;
  if (fieldInfo.technical) {
    html += `<div class="field-technical">${fieldInfo.technical}</div>`;
  }
  if (fieldInfo.filter) {
    html += `<div class="field-filter">Filter: <code>${fieldInfo.filter}</code></div>`;
  }
  fieldInfoPopup.innerHTML = html;

  const labelRect = labelElement.getBoundingClientRect();

  fieldInfoPopup.classList.add('visible');
  const popupRect = fieldInfoPopup.getBoundingClientRect();

  const left = labelRect.right - popupRect.width;

  let top: number;
  if (labelRect.bottom + popupRect.height <= window.innerHeight) {
    top = labelRect.bottom;
  } else {
    top = labelRect.top - popupRect.height;
  }

  fieldInfoPopup.style.left = Math.max(0, left) + 'px';
  fieldInfoPopup.style.top = Math.max(0, top) + 'px';

  currentPopupFieldId = fieldId;
  currentPopupLabelElement = labelElement;
}

// Hide field info popup
function hideFieldInfoPopup(): void {
  fieldInfoPopup.classList.remove('visible');
  currentPopupFieldId = null;
  currentPopupLabelElement = null;
}

// Check if popup should remain visible
function checkPopupVisibility(): void {
  if (!isMouseOverPopup && !isMouseOverLabel) {
    hideFieldInfoPopup();
  }
}

// Update popup position (used on scroll)
function updatePopupPosition(): void {
  if (!currentPopupLabelElement) return;

  const labelRect = currentPopupLabelElement.getBoundingClientRect();
  const popupRect = fieldInfoPopup.getBoundingClientRect();

  const left = labelRect.right - popupRect.width;

  let top: number;
  if (labelRect.bottom + popupRect.height <= window.innerHeight) {
    top = labelRect.bottom;
  } else {
    top = labelRect.top - popupRect.height;
  }

  fieldInfoPopup.style.left = Math.max(0, left) + 'px';
  fieldInfoPopup.style.top = Math.max(0, top) + 'px';
}

// Popup hover listeners
fieldInfoPopup.addEventListener('mouseenter', () => {
  isMouseOverPopup = true;
  if (popupHideTimeout) {
    clearTimeout(popupHideTimeout);
    popupHideTimeout = null;
  }
});

fieldInfoPopup.addEventListener('mouseleave', () => {
  isMouseOverPopup = false;
  popupHideTimeout = setTimeout(checkPopupVisibility, 50);
});

// Update popup position on scroll
tabContent.addEventListener('scroll', () => {
  updatePopupPosition();
});

// Show column menu
function showColumnMenu(e: MouseEvent): void {
  e.preventDefault();

  columnMenu.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `
      <label>
        <input type="checkbox" ${visibleColumns[col.id] ? 'checked' : ''}>
        ${col.label}
      </label>
    `;

    const input = item.querySelector('input')!;
    input.addEventListener('change', (e) => {
      visibleColumns[col.id] = (e.target as HTMLInputElement).checked;
      saveColumnPrefs();
      renderHeader();
      renderMessages();
    });

    columnMenu.appendChild(item);
  });

  columnMenu.style.left = e.clientX + 'px';
  columnMenu.style.top = e.clientY + 'px';
  columnMenu.classList.add('visible');
}

// Show cell menu
let cellMenuContext: { msg: CapturedMessage; colId: string } | null = null;

function showCellMenu(e: MouseEvent, msg: CapturedMessage, colId: string): void {
  e.preventDefault();

  cellMenuContext = { msg, colId };

  cellMenu.style.left = e.clientX + 'px';
  cellMenu.style.top = e.clientY + 'px';
  cellMenu.classList.add('visible');
}

// Hide menus on click outside
document.addEventListener('click', () => {
  columnMenu.classList.remove('visible');
  cellMenu.classList.remove('visible');
});

// Filter by value
filterByValue.addEventListener('click', () => {
  if (!cellMenuContext) return;

  const { msg, colId } = cellMenuContext;
  let filterStr = '';

  switch (colId) {
    case 'messageType':
      filterStr = `type:${msg.messageType || ''}`;
      break;
    case 'targetOrigin':
      filterStr = `target:${msg.target.origin}`;
      break;
    case 'sourceOrigin':
      filterStr = `source:${msg.source?.origin || ''}`;
      break;
    case 'direction':
    case 'sourceType':
      filterStr = `sourceType:${msg.source?.type || 'unknown'}`;
      break;
    default:
      filterStr = getCellValue(msg, colId);
  }

  filterInput.value = filterStr;
  filterText = filterStr;
  applyFilterAndSort();
  renderMessages();
});

// Add a new message
function addMessage(msg: CapturedMessage): void {
  if (!isRecording) return;

  if (isRegistrationMessage(msg) && msg.source?.windowId) {
    const data = msg.data as { frameId: number; tabId?: number };
    windowFrameMap.set(msg.source.windowId, {
      frameId: data.frameId,
      tabId: data.tabId
    });
  }

  messages.push(msg);
  applyFilterAndSort();
  renderMessages();
}

// Clear all messages
function clearMessages(): void {
  messages = [];
  filteredMessages = [];
  selectedMessageId = null;
  detailPane.classList.add('hidden');
  renderMessages();
}

// Event listeners
filterInput.addEventListener('input', (e) => {
  filterText = (e.target as HTMLInputElement).value;
  applyFilterAndSort();
  renderMessages();
});

clearBtn.addEventListener('click', clearMessages);

preserveLogCheckbox.addEventListener('change', (e) => {
  preserveLog = (e.target as HTMLInputElement).checked;
  if (port) {
    port.postMessage({ type: 'preserveLog', tabId, value: preserveLog });
  }
});

// Record toggle
recordBtn.addEventListener('click', () => {
  isRecording = !isRecording;
  recordBtn.classList.toggle('recording', isRecording);
  recordBtn.title = isRecording ? 'Stop recording' : 'Record messages';
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = (btn as HTMLElement).dataset.tab || 'data';

    const msg = messages.find(m => m.id === selectedMessageId);
    if (msg) {
      renderDetailPane(msg);
    }
  });
});

// Detail pane resize handle
let isResizingPane = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizingPane = true;
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizingPane) return;

  const container = document.querySelector('.main-content') as HTMLElement;
  const containerWidth = container.offsetWidth;
  const newDetailWidth = containerWidth - e.clientX;
  const pct = Math.max(20, Math.min(70, (newDetailWidth / containerWidth) * 100));

  detailPane.style.width = pct + '%';
});

document.addEventListener('mouseup', () => {
  if (isResizingPane) {
    isResizingPane = false;
    document.body.style.cursor = '';
  }
});

// Close detail button
closeDetailBtn.addEventListener('click', () => {
  detailPane.classList.add('hidden');
  selectedMessageId = null;
  messageTbody.querySelectorAll('tr.selected').forEach(tr => {
    tr.classList.remove('selected');
  });
});

// Switch between views
function switchView(viewName: string): void {
  currentView = viewName;

  document.querySelectorAll('.sidebar-item').forEach(item => {
    const el = item as HTMLElement;
    el.classList.toggle('active', el.dataset.view === viewName);
  });

  messagesView.classList.toggle('active', viewName === 'messages');
  hierarchyView.classList.toggle('active', viewName === 'hierarchy');
  settingsView.classList.toggle('active', viewName === 'settings');

  chrome.storage.local.set({ currentView: viewName });

  if (viewName === 'hierarchy') {
    refreshHierarchy();
  }
}

// Refresh hierarchy data
function refreshHierarchy(): void {
  port.postMessage({ type: 'get-frame-hierarchy', tabId });
}

// Build tree structure from flat frame list
function buildFrameTree(frames: FrameInfo[]): FrameInfo[] {
  const frameMap = new Map<number | string, FrameInfo>(
    frames.map(f => [f.frameId, { ...f, children: [] }])
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

// Render frame table
function renderFrameTable(): void {
  frameTbody.innerHTML = '';

  const roots = buildFrameTree(frameHierarchy);

  function renderFrame(frame: FrameInfo, depth: number): void {
    const tr = document.createElement('tr');
    tr.dataset.frameId = String(frame.frameId);

    if (frame.frameId === selectedFrameId) {
      tr.classList.add('selected');
    }

    const labelTd = document.createElement('td');
    labelTd.classList.add(`frame-indent-${Math.min(depth, 4)}`);
    if (frame.isOpener) {
      labelTd.textContent = 'opener';
      labelTd.style.fontStyle = 'italic';
    } else {
      labelTd.textContent = `frame[${frame.frameId}]`;
    }
    tr.appendChild(labelTd);

    const urlTd = document.createElement('td');
    urlTd.textContent = frame.url;
    tr.appendChild(urlTd);

    const originTd = document.createElement('td');
    originTd.textContent = frame.origin;
    tr.appendChild(originTd);

    const titleTd = document.createElement('td');
    titleTd.textContent = frame.title;
    tr.appendChild(titleTd);

    const parentTd = document.createElement('td');
    parentTd.textContent = frame.parentFrameId === -1 ? '-' : `frame[${frame.parentFrameId}]`;
    tr.appendChild(parentTd);

    tr.addEventListener('click', () => selectFrame(frame.frameId));
    frameTbody.appendChild(tr);

    for (const child of frame.children || []) {
      renderFrame(child, depth + 1);
    }
  }

  for (const root of roots) {
    renderFrame(root, 0);
  }
}

// Select a frame and show details
function selectFrame(frameId: number | string): void {
  selectedFrameId = frameId;

  frameTbody.querySelectorAll('tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.frameId === String(frameId));
  });

  const frame = frameHierarchy.find(f => f.frameId === frameId);
  if (frame) {
    frameDetailPane.classList.remove('hidden');
    renderFrameDetail(frame);
  }
}

// Render frame detail pane
function renderFrameDetail(frame: FrameInfo): void {
  const html = `
    <div class="frame-properties">
      <table class="context-table">
        <tr><th>Frame ID</th><td>${frame.frameId}</td></tr>
        <tr><th>URL</th><td>${frame.url}</td></tr>
        <tr><th>Origin</th><td>${frame.origin}</td></tr>
        <tr><th>Title</th><td>${frame.title || '(none)'}</td></tr>
        <tr><th>Parent</th><td>${frame.parentFrameId === -1 ? '-' : 'frame[' + frame.parentFrameId + ']'}</td></tr>
      </table>
    </div>
    <div class="frame-iframes">
      <h4>Child iframes (${frame.iframes.length})</h4>
      ${frame.iframes.length === 0 ? '<p class="placeholder">No iframes in this frame</p>' :
        frame.iframes.map(iframe => `
          <div class="iframe-item">
            <div><strong>src:</strong> ${iframe.src || '(empty)'}</div>
            <div><strong>id:</strong> ${iframe.id || '(none)'}</div>
            <div><strong>path:</strong> ${iframe.domPath}</div>
          </div>
        `).join('')
      }
    </div>
  `;

  frameDetailContent.innerHTML = html;
}

// Sidebar click handlers
sidebar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const item = target.closest('.sidebar-item') as HTMLElement | null;
  if (item && item.dataset.view) {
    switchView(item.dataset.view);
  }
});

// Refresh hierarchy button
refreshHierarchyBtn.addEventListener('click', () => {
  refreshHierarchy();
});

// Close frame detail button
closeFrameDetailBtn.addEventListener('click', () => {
  frameDetailPane.classList.add('hidden');
});

// Connect to background script
let port: chrome.runtime.Port;
let tabId: number;

function connect(): void {
  tabId = chrome.devtools.inspectedWindow.tabId;

  port = chrome.runtime.connect({ name: 'postmessage-panel' });
  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg: { type: string; payload?: CapturedMessage | FrameInfo[] }) => {
    if (msg.type === 'message' && msg.payload) {
      addMessage(msg.payload as CapturedMessage);
    } else if (msg.type === 'clear') {
      clearMessages();
    } else if (msg.type === 'frame-hierarchy' && msg.payload) {
      frameHierarchy = msg.payload as FrameInfo[];
      renderFrameTable();
    }
  });

  port.onDisconnect.addListener(() => {
    setTimeout(connect, 1000);
  });
}

// Initialize settings
function initSettings(): void {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
    showExtraInfoCheckbox.checked = settings.showExtraMessageInfo;
    enableFrameRegistrationCheckbox.checked = settings.enableFrameRegistration;
    showRegistrationMessagesCheckbox.checked = settings.showRegistrationMessages;
    showRegistrationMessagesCheckbox.disabled = !settings.enableFrameRegistration;
  });
}

// Save settings
function saveSettings(): void {
  chrome.storage.local.set({ settings });
}

// Settings event handlers
showExtraInfoCheckbox.addEventListener('change', (e) => {
  settings.showExtraMessageInfo = (e.target as HTMLInputElement).checked;
  saveSettings();
  if (selectedMessageId && activeTab === 'context') {
    const msg = messages.find(m => m.id === selectedMessageId);
    if (msg) {
      renderContextTab(msg);
    }
  }
});

enableFrameRegistrationCheckbox.addEventListener('change', (e) => {
  settings.enableFrameRegistration = (e.target as HTMLInputElement).checked;
  showRegistrationMessagesCheckbox.disabled = !(e.target as HTMLInputElement).checked;
  saveSettings();
  chrome.storage.local.set({ enableFrameRegistration: (e.target as HTMLInputElement).checked });
});

showRegistrationMessagesCheckbox.addEventListener('change', (e) => {
  settings.showRegistrationMessages = (e.target as HTMLInputElement).checked;
  saveSettings();
  applyFilterAndSort();
  renderMessages();
});

// Initialize
initColumnWidths();
initColumns();
initSettings();
detailPane.classList.add('hidden');

// Load saved view preference
chrome.storage.local.get(['currentView'], (result) => {
  if (result.currentView) {
    switchView(result.currentView);
  }
});

connect();
