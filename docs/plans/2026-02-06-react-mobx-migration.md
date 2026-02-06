# React + MobX Migration Design

## Overview

Incrementally migrate the panel UI from vanilla TypeScript/DOM manipulation to React with MobX for state management. The extension remains functional throughout the migration.

## Approach: Incremental Migration

- Create MobX store first, connect existing code to it
- Convert components one by one to React
- Each checkpoint results in a working extension
- Commit after each milestone

## MobX Store Structure

```typescript
// src/panel/store.ts
class PanelStore {
  // Messages
  messages: CapturedMessage[] = [];
  selectedMessageId: string | null = null;
  filterText = '';
  sortColumn = 'timestamp';
  sortDirection: 'asc' | 'desc' = 'asc';
  isRecording = true;

  // UI state
  currentView: 'messages' | 'hierarchy' | 'settings' = 'messages';
  activeDetailTab: 'data' | 'context' = 'data';
  detailPaneVisible = false;

  // Column configuration
  visibleColumns: Record<string, boolean> = {};
  columnWidths: Record<string, number> = {};

  // Hierarchy
  frameHierarchy: FrameInfo[] = [];
  selectedFrameId: string | number | null = null;

  // Settings
  settings: Settings = { ... };

  // Computed
  get filteredMessages() { ... }
  get selectedMessage() { ... }

  // Actions
  addMessage(msg) { ... }
  clearMessages() { ... }
  setFilter(text) { ... }
}
```

Single store class with `makeAutoObservable`. Computed properties handle derived state like filtered/sorted messages.

## Component Architecture

```
src/panel/
├── store.ts              # MobX store
├── panel.tsx             # Entry point - creates store, mounts React
├── connection.ts         # Background script connection
├── components/
│   ├── App.tsx           # Root component with sidebar + view switching
│   ├── MessagesView/
│   │   ├── MessagesView.tsx
│   │   ├── TopBar.tsx
│   │   ├── FilterBar.tsx
│   │   ├── MessageTable.tsx
│   │   └── DetailPane.tsx
│   ├── HierarchyView/
│   │   └── HierarchyView.tsx
│   ├── SettingsView/
│   │   └── SettingsView.tsx
│   └── shared/
│       ├── JsonTree.tsx
│       ├── ContextMenu.tsx
│       └── FieldInfoPopup.tsx
```

## Background Connection

Lives outside React, calls store actions:

```typescript
// src/panel/connection.ts
import { store } from './store';

export function connect(): void {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  store.setTabId(tabId);

  port = chrome.runtime.connect({ name: 'postmessage-panel' });
  port.postMessage({ type: 'init', tabId });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'message') {
      store.addMessage(msg.payload);
    } else if (msg.type === 'clear') {
      store.clearMessages();
    } else if (msg.type === 'frame-hierarchy') {
      store.setFrameHierarchy(msg.payload);
    }
  });
}
```

## Persistence

MobX reactions save to chrome.storage on changes:

```typescript
reaction(
  () => this.visibleColumns,
  (cols) => chrome.storage.local.set({ visibleColumns: cols })
);
```

## CSS

Keep existing `panel.css`. React components use same class names - no changes needed.

## Migration Checkpoints

### 1. Foundation
- Add @vitejs/plugin-react
- Create store.ts with MobX store
- Create panel.tsx entry point
- Render minimal App component
- Verify build works, extension loads

### 2. Settings View
- Migrate SettingsView.tsx
- Wire up to store
- Remove old settings DOM code
- Test settings persist correctly

### 3. Messages View (incremental)
- TopBar + FilterBar first
- Then MessageTable
- Then DetailPane with JsonTree
- Each step: verify, then remove old code

### 4. Hierarchy View + Cleanup
- Migrate hierarchy components
- Remove panel.html static elements
- Final cleanup of old panel.ts code

Each checkpoint results in a working, testable extension.
