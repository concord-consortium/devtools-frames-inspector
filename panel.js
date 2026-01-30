// Panel logic for displaying postMessage messages

// Column definitions
const ALL_COLUMNS = [
  { id: 'timestamp', label: 'Time', defaultVisible: true, width: 90 },
  { id: 'direction', label: 'Dir', defaultVisible: true, width: 40 },
  { id: 'selfUrl', label: 'Self URL', defaultVisible: false, width: 200 },
  { id: 'selfOrigin', label: 'Self Origin', defaultVisible: true, width: 150 },
  { id: 'selfTitle', label: 'Self Title', defaultVisible: false, width: 150 },
  { id: 'targetOrigin', label: 'Target Origin', defaultVisible: true, width: 120 },
  { id: 'sourceOrigin', label: 'Source Origin', defaultVisible: true, width: 120 },
  { id: 'messageType', label: 'Type', defaultVisible: true, width: 80 },
  { id: 'dataPreview', label: 'Data', defaultVisible: true, width: 200 },
  { id: 'dataSize', label: 'Size', defaultVisible: false, width: 60 }
];

// State
let messages = [];
let filteredMessages = [];
let selectedMessageId = null;
let visibleColumns = {};
let sortColumn = 'timestamp';
let sortDirection = 'asc';
let filterText = '';
let preserveLog = false;
let activeTab = 'data';

// DOM elements
const headerRow = document.getElementById('header-row');
const messageTbody = document.getElementById('message-tbody');
const messageCount = document.getElementById('message-count');
const filterInput = document.getElementById('filter-input');
const clearBtn = document.getElementById('clear-btn');
const preserveLogCheckbox = document.getElementById('preserve-log-checkbox');
const detailPane = document.getElementById('detail-pane');
const tabContent = document.getElementById('tab-content');
const columnMenu = document.getElementById('column-menu');
const cellMenu = document.getElementById('cell-menu');
const filterByValue = document.getElementById('filter-by-value');
const resizeHandle = document.getElementById('resize-handle');

// Initialize visible columns from defaults or storage
function initColumns() {
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
function saveColumnPrefs() {
  chrome.storage.local.set({ visibleColumns });
}

// Format timestamp
function formatTimestamp(ts) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// Format size
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Get cell value for a message and column
function getCellValue(msg, colId) {
  switch (colId) {
    case 'timestamp': return formatTimestamp(msg.timestamp);
    case 'direction': return msg.direction === 'sending' ? '→' : '←';
    case 'selfUrl': return msg.self.url;
    case 'selfOrigin': return msg.self.origin;
    case 'selfTitle': return msg.self.documentTitle || '';
    case 'targetOrigin': return msg.targetOrigin || '';
    case 'sourceOrigin': return msg.sourceOrigin || '';
    case 'messageType': return msg.messageType || '';
    case 'dataPreview': return msg.dataPreview;
    case 'dataSize': return formatSize(msg.dataSize);
    default: return '';
  }
}

// Render table header
function renderHeader() {
  headerRow.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    if (!visibleColumns[col.id]) return;

    const th = document.createElement('th');
    th.textContent = col.label;
    th.dataset.column = col.id;
    th.style.width = col.width + 'px';

    if (sortColumn === col.id) {
      th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    th.addEventListener('click', () => handleSort(col.id));
    th.addEventListener('contextmenu', (e) => showColumnMenu(e));

    headerRow.appendChild(th);
  });
}

// Render messages
function renderMessages() {
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
        td.classList.add(msg.direction === 'sending' ? 'dir-sending' : 'dir-receiving');
      }

      td.addEventListener('contextmenu', (e) => showCellMenu(e, msg, col.id));

      tr.appendChild(td);
    });

    tr.addEventListener('click', () => selectMessage(msg.id));
    messageTbody.appendChild(tr);
  });

  updateMessageCount();
}

// Update message count in status bar
function updateMessageCount() {
  const total = messages.length;
  const filtered = filteredMessages.length;

  if (filterText && filtered !== total) {
    messageCount.textContent = `${filtered} / ${total} messages`;
  } else {
    messageCount.textContent = `${total} messages`;
  }
}

// Handle sort
function handleSort(colId) {
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
function applyFilterAndSort() {
  // Filter
  filteredMessages = messages.filter(msg => matchesFilter(msg, filterText));

  // Sort
  filteredMessages.sort((a, b) => {
    let aVal = getSortValue(a, sortColumn);
    let bVal = getSortValue(b, sortColumn);

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

// Get sortable value
function getSortValue(msg, colId) {
  switch (colId) {
    case 'timestamp': return msg.timestamp;
    case 'dataSize': return msg.dataSize;
    default: return getCellValue(msg, colId).toLowerCase();
  }
}

// Check if message matches filter
function matchesFilter(msg, filter) {
  if (!filter) return true;

  const terms = filter.toLowerCase().split(/\s+/).filter(t => t);

  return terms.every(term => {
    // Check for field:value syntax
    const colonIdx = term.indexOf(':');
    if (colonIdx > 0) {
      const field = term.substring(0, colonIdx);
      const value = term.substring(colonIdx + 1);

      switch (field) {
        case 'type':
          return (msg.messageType || '').toLowerCase() === value;
        case 'origin':
          return msg.self.origin.toLowerCase().includes(value);
        case 'target':
          return (msg.targetOrigin || '').toLowerCase().includes(value);
        case 'source':
          return (msg.sourceOrigin || '').toLowerCase().includes(value);
        case 'dir':
          return msg.direction === value;
        default:
          return false;
      }
    }

    // General text search in data preview
    return msg.dataPreview.toLowerCase().includes(term);
  });
}

// Select a message
function selectMessage(id) {
  selectedMessageId = id;

  // Update row selection
  messageTbody.querySelectorAll('tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === id);
  });

  // Show detail pane
  const msg = messages.find(m => m.id === id);
  if (msg) {
    detailPane.classList.remove('hidden');
    renderDetailPane(msg);
  }
}

// Render detail pane
function renderDetailPane(msg) {
  if (activeTab === 'data') {
    renderDataTab(msg);
  } else {
    renderContextTab(msg);
  }
}

// Render Data tab
function renderDataTab(msg) {
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
function renderJsonValue(value, key = null) {
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
    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}Array(${value.length})`;
    container.appendChild(toggle);

    const children = document.createElement('div');
    children.className = 'json-children';
    value.forEach((item, i) => {
      children.appendChild(renderJsonValue(item, i));
    });
    container.appendChild(children);
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';
    toggle.onclick = () => {
      toggle.classList.toggle('collapsed');
      children.classList.toggle('hidden');
    };

    const label = key !== null ? `<span class="json-key">"${key}"</span>: ` : '';
    toggle.innerHTML = `${label}{...}`;
    container.appendChild(toggle);

    const children = document.createElement('div');
    children.className = 'json-children';
    keys.forEach(k => {
      children.appendChild(renderJsonValue(value[k], k));
    });
    container.appendChild(children);
  } else {
    container.textContent = String(value);
  }

  return container;
}

// Render Context tab
function renderContextTab(msg) {
  const rows = [
    ['Direction', msg.direction === 'sending' ? 'Sending →' : 'Receiving ←'],
    ['Timestamp', new Date(msg.timestamp).toISOString()],
    ['Self URL', msg.self.url],
    ['Self Origin', msg.self.origin],
    ['Self Title', msg.self.documentTitle || '(none)'],
  ];

  if (msg.direction === 'sending') {
    rows.push(['Target Origin', msg.targetOrigin]);
  } else {
    rows.push(['Source Origin', msg.sourceOrigin]);
  }

  rows.push(['Size', formatSize(msg.dataSize)]);

  const table = document.createElement('table');
  table.className = 'context-table';

  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${label}</th><td>${value}</td>`;
    table.appendChild(tr);
  });

  tabContent.innerHTML = '';
  tabContent.appendChild(table);
}

// Show column menu
function showColumnMenu(e) {
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

    item.querySelector('input').addEventListener('change', (e) => {
      visibleColumns[col.id] = e.target.checked;
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
let cellMenuContext = null;

function showCellMenu(e, msg, colId) {
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
    case 'selfOrigin':
      filterStr = `origin:${msg.self.origin}`;
      break;
    case 'targetOrigin':
      filterStr = `target:${msg.targetOrigin || ''}`;
      break;
    case 'sourceOrigin':
      filterStr = `source:${msg.sourceOrigin || ''}`;
      break;
    case 'direction':
      filterStr = `dir:${msg.direction}`;
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
function addMessage(msg) {
  messages.push(msg);
  applyFilterAndSort();
  renderMessages();
}

// Clear all messages
function clearMessages() {
  messages = [];
  filteredMessages = [];
  selectedMessageId = null;
  detailPane.classList.add('hidden');
  renderMessages();
}

// Event listeners
filterInput.addEventListener('input', (e) => {
  filterText = e.target.value;
  applyFilterAndSort();
  renderMessages();
});

clearBtn.addEventListener('click', clearMessages);

preserveLogCheckbox.addEventListener('change', (e) => {
  preserveLog = e.target.checked;
  // Notify background script
  if (port) {
    port.postMessage({ type: 'preserveLog', tabId, value: preserveLog });
  }
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;

    const msg = messages.find(m => m.id === selectedMessageId);
    if (msg) {
      renderDetailPane(msg);
    }
  });
});

// Resize handle
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const containerWidth = document.querySelector('.main-content').offsetWidth;
  const newDetailWidth = containerWidth - e.clientX;
  const pct = Math.max(20, Math.min(70, (newDetailWidth / containerWidth) * 100));

  detailPane.style.width = pct + '%';
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  document.body.style.cursor = '';
});

// Connect to background script
let port = null;
let tabId = null;

function connect() {
  // Get the tab ID we're inspecting
  tabId = chrome.devtools.inspectedWindow.tabId;

  port = chrome.runtime.connect({ name: 'postmessage-panel' });
  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'message') {
      addMessage(msg.payload);
    } else if (msg.type === 'clear') {
      clearMessages();
    }
  });

  port.onDisconnect.addListener(() => {
    // Try to reconnect after a delay
    setTimeout(connect, 1000);
  });
}

// Initialize
initColumns();
detailPane.classList.add('hidden');
connect();
