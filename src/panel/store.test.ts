import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from './store';

// Mock chrome.storage.local (used by setCurrentView and other persisting actions)
vi.stubGlobal('chrome', {
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  devtools: { inspectedWindow: { tabId: 42 } },
});

const TAB_ID = 42;

describe('store.buildFrameFilter', () => {
  it('returns frames filter with tab and frame id', () => {
    expect(store.buildFrameFilter(TAB_ID, 3))
      .toBe('frames:"tab[42].frame[3]"');
  });
});

describe('store.navigateToFrameMessages', () => {
  beforeEach(() => {
    store.setFilter('');
    store.setFocusedFrame(null);
    store.setCurrentView('endpoints');
  });

  it('sets focused frame, filter, and switches to log view', () => {
    store.navigateToFrameMessages(TAB_ID, 3);

    expect(store.focusedFrame).toEqual({ tabId: TAB_ID, frameId: 3 });
    expect(store.filterText).toBe('frames:"tab[42].frame[3]"');
    expect(store.currentView).toBe('log');
  });
});

describe('store.viewFrameInEndpoints', () => {
  beforeEach(() => {
    store.selectFrame(null);
    store.selectNode(null);
    store.setCurrentView('log');
  });

  it('selects the frame and switches to endpoints view', () => {
    store.viewFrameInEndpoints(TAB_ID, 3);

    expect(store.selectedFrameKey).toBe(`${TAB_ID}:3`);
    expect(store.selectedNode).toEqual({ type: 'iframe', tabId: TAB_ID, frameId: 3 });
    expect(store.currentView).toBe('endpoints');
  });

  it('selects root frame as tab node', () => {
    store.viewFrameInEndpoints(TAB_ID, 0);

    expect(store.selectedNode).toEqual({ type: 'tab', tabId: TAB_ID });
    expect(store.currentView).toBe('endpoints');
  });
});

describe('store.navigateToNodeMessages', () => {
  beforeEach(() => {
    store.setFilter('');
    store.setFocusedFrame(null);
    store.setCurrentView('endpoints');
  });

  it('tab node sets frame filter for frame[0]', () => {
    store.navigateToNodeMessages({ type: 'tab', tabId: TAB_ID });

    expect(store.focusedFrame).toEqual({ tabId: TAB_ID, frameId: 0 });
    expect(store.filterText).toBe('frames:"tab[42].frame[0]"');
    expect(store.currentView).toBe('log');
  });

  it('iframe node sets frame filter for that frame', () => {
    store.navigateToNodeMessages({ type: 'iframe', tabId: TAB_ID, frameId: 5 });

    expect(store.focusedFrame).toEqual({ tabId: TAB_ID, frameId: 5 });
    expect(store.filterText).toBe('frames:"tab[42].frame[5]"');
  });

  it('document node sets documentId filter', () => {
    store.navigateToNodeMessages({ type: 'document', documentId: 'doc-123' });

    expect(store.focusedFrame).toBeNull();
    expect(store.filterText).toBe('documentId:doc-123');
  });

  it('unknown-document node sets sourceId filter', () => {
    store.navigateToNodeMessages({ type: 'unknown-document', sourceId: 'win-abc' });

    expect(store.focusedFrame).toBeNull();
    expect(store.filterText).toBe('source.sourceId:win-abc');
  });
});

describe('store reload-recovery flags', () => {
  beforeEach(() => {
    store.setExtensionContextInvalidated(false);
    store.clearStaleFrames();
  });

  it('extensionContextInvalidated defaults to false and can be set', () => {
    expect(store.extensionContextInvalidated).toBe(false);
    store.setExtensionContextInvalidated(true);
    expect(store.extensionContextInvalidated).toBe(true);
  });

  it('addStaleFrame and clearStaleFrame manage the set', () => {
    store.addStaleFrame(1);
    store.addStaleFrame(3);
    expect(Array.from(store.staleFrameIds).sort()).toEqual([1, 3]);

    store.clearStaleFrame(1);
    expect(Array.from(store.staleFrameIds)).toEqual([3]);

    store.clearStaleFrames();
    expect(store.staleFrameIds.size).toBe(0);
  });

  it('hasStaleFrames is true when set is non-empty', () => {
    expect(store.hasStaleFrames).toBe(false);
    store.addStaleFrame(2);
    expect(store.hasStaleFrames).toBe(true);
  });
});
