// Integration tests: content script → background service worker → panel
//
// These tests exercise the real background-core.ts and content-core.ts code
// with mock Chrome APIs wired together by ChromeExtensionEnv.
//
// Test frame hierarchy:
//   Parent (frameId=0) — https://parent.example.com
//   └── Child (frameId=1) — https://child.example.com

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChromeExtensionEnv, flushPromises } from './test/chrome-extension-env';
import { HarnessRuntime } from './test/harness-runtime';
import { HarnessActions } from './test/harness-actions';
import { initContentScript } from './content-core';
import { initBackgroundScript } from './background-core';

describe('content → background → panel integration', () => {
  let env: ChromeExtensionEnv;
  let runtime: HarnessRuntime;
  let actions: HarnessActions;

  beforeEach(() => {
    env = new ChromeExtensionEnv(initContentScript);
    // Disable frame registration to keep tests focused on message routing
    env.storageData.enableFrameRegistration = false;
    initBackgroundScript(env.createBackgroundChrome());
    runtime = new HarnessRuntime(env);
    actions = new HarnessActions(runtime);
  });

  // --- Frame + window setup helpers ---

  function setupTwoFrames() {
    const topFrame = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent Page' });
    const childFrame = actions.addIframe(topFrame, { url: 'https://child.example.com/', iframeId: 'child-iframe', title: 'Child Page' });

    return { topFrame, childFrame, parentWin: topFrame.window!, childWin: childFrame.window! };
  }

  // --- Tests ---

  it('delivers a child→parent postMessage to the panel', async () => {
    const { topFrame, childFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    // Child sends a message that parent receives
    parentWin.dispatchMessage(
      { type: 'hello-from-child', value: 42 },
      'https://child.example.com',
      childWin
    );
    await flushPromises();

    const msgPayloads = messages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);

    const payload = msgPayloads[0].payload;
    expect(payload.data).toEqual({ type: 'hello-from-child', value: 42 });
    expect(payload.source.type).toBe('child');
    expect(payload.source.origin).toBe('https://child.example.com');
    expect(payload.source.iframe?.src).toBe('https://child.example.com/');
    expect(payload.source.iframe?.id).toBe('child-iframe');
    expect(payload.target.origin).toBe('https://parent.example.com');
    expect(payload.target.frameId).toBe(0);
    expect(payload.target.documentId).toBe(topFrame.currentDocument!.documentId);
  });

  it('delivers a parent→child postMessage to the panel', async () => {
    const { topFrame, childFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    // Parent sends a message that child receives
    childWin.dispatchMessage(
      { type: 'hello-from-parent' },
      'https://parent.example.com',
      parentWin
    );
    // Background enriches parent messages with webNavigation lookup (async)
    await flushPromises();

    const msgPayloads = messages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);

    const payload = msgPayloads[0].payload;
    expect(payload.data).toEqual({ type: 'hello-from-parent' });
    expect(payload.source.type).toBe('parent');
    expect(payload.source.origin).toBe('https://parent.example.com');
    // Background enriches source with parent's frameId and documentId
    expect(payload.source.frameId).toBe(0);
    expect(payload.source.documentId).toBe(topFrame.currentDocument!.documentId);
    expect(payload.target.origin).toBe('https://child.example.com');
    expect(payload.target.frameId).toBe(childFrame.frameId);
    expect(payload.target.documentId).toBe(childFrame.currentDocument!.documentId);
  });

  it('delivers messages from multiple content scripts in the same test', async () => {
    const { topFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    // Child→Parent message
    parentWin.dispatchMessage({ type: 'msg-1' }, 'https://child.example.com', childWin);
    await flushPromises();
    // Parent→Child message
    childWin.dispatchMessage({ type: 'msg-2' }, 'https://parent.example.com', parentWin);
    await flushPromises();

    const msgPayloads = messages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(2);
    expect(msgPayloads[0].payload.data).toEqual({ type: 'msg-1' });
    expect(msgPayloads[0].payload.source.type).toBe('child');
    expect(msgPayloads[1].payload.data).toEqual({ type: 'msg-2' });
    expect(msgPayloads[1].payload.source.type).toBe('parent');
  });

  it('assigns stable sourceIds to repeated messages from the same source', async () => {
    const { topFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    parentWin.dispatchMessage({ type: 'first' }, 'https://child.example.com', childWin);
    parentWin.dispatchMessage({ type: 'second' }, 'https://child.example.com', childWin);
    await flushPromises();

    const payloads = messages.filter(m => m.type === 'message').map(m => m.payload);
    expect(payloads).toHaveLength(2);
    // Same source window should get the same sourceId
    expect(payloads[0].source.sourceId).toBe(payloads[1].source.sourceId);
    // And it should be a non-empty string
    expect(payloads[0].source.sourceId).toBeTruthy();
  });

  it('clears panel messages on main frame navigation', async () => {
    const { topFrame } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    actions.navigate(topFrame, { url: 'https://parent.example.com/new' });
    await flushPromises();

    const clearMsgs = messages.filter(m => m.type === 'clear');
    expect(clearMsgs).toHaveLength(1);
  });

  it('does not clear messages on subframe navigation', async () => {
    const { topFrame, childFrame } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    actions.navigate(childFrame, { url: 'https://child.example.com/new' });
    await flushPromises();

    const clearMsgs = messages.filter(m => m.type === 'clear');
    expect(clearMsgs).toHaveLength(0);
  });

  it('sets target.tabId on captured messages', async () => {
    const { topFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    parentWin.dispatchMessage({ type: 'test' }, 'https://child.example.com', childWin);
    await flushPromises();

    const payload = messages.filter(m => m.type === 'message')[0].payload;
    expect(payload.target.tabId).toBe(topFrame.tab.id);
  });

  it('sets source.tabId for same-tab messages', async () => {
    const { topFrame, parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    // child→parent (same tab)
    parentWin.dispatchMessage({ type: 'test' }, 'https://child.example.com', childWin);
    await flushPromises();

    const payload = messages.filter(m => m.type === 'message')[0].payload;
    expect(payload.source.tabId).toBe(topFrame.tab.id);
  });

  it('delivers an opened→opener message to the opener panel', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    await flushPromises();

    const openerWin = topFrame.window!;
    const popupWin = popupFrame.window!;

    // Simulate the popup's content script sending its opener registration
    // (In production this happens via send-message → content script → postMessage)
    openerWin.dispatchMessage(
      { type: '__messages_inspector_register__', targetType: 'opener', frameId: 0, tabId: popupFrame.tab.id, documentId: popupFrame.currentDocument!.documentId },
      'https://popup.example.com',
      popupWin
    );

    // Popup sends a message received by opener
    openerWin.dispatchMessage(
      { type: 'hello-from-popup' },
      'https://popup.example.com',
      popupWin
    );
    await flushPromises();

    const msgPayloads = messages.filter(m =>
      m.type === 'message' && m.payload.data?.type !== '__messages_inspector_register__'
    );
    expect(msgPayloads).toHaveLength(1);
    expect(msgPayloads[0].payload.source.type).toBe('opened');
  });

  it('routes opener→popup messages to the opener tab panel', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    await flushPromises();

    const popupWin = popupFrame.window!;

    // Opener sends a message that popup receives — captured in popup's tab
    popupWin.dispatchMessage(
      { type: 'init-from-opener' },
      'https://opener.example.com',
      topFrame.window!
    );
    await flushPromises();

    // Should appear in opener's panel too (cross-tab routing)
    const openerMsgs = openerMessages.filter(m => m.type === 'message' && m.payload.data?.type === 'init-from-opener');
    expect(openerMsgs).toHaveLength(1);
    expect(openerMsgs[0].payload.source.type).toBe('opener');
  });

  it('enriches opener source with documentId from webNavigation', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    const { messages: popupMessages } = env.connectPanel(popupFrame.tab.id);
    await flushPromises();

    // Opener sends a message that popup receives
    popupFrame.window!.dispatchMessage(
      { type: 'init-from-opener' },
      'https://opener.example.com',
      topFrame.window!
    );
    await flushPromises();

    const msgPayloads = popupMessages.filter(m => m.type === 'message' && m.payload.data?.type === 'init-from-opener');
    expect(msgPayloads).toHaveLength(1);

    const payload = msgPayloads[0].payload;
    expect(payload.source.type).toBe('opener');
    expect(payload.source.tabId).toBe(topFrame.tab.id);
    expect(payload.source.frameId).toBe(0);
    // documentId should be enriched via webNavigation.getFrame lookup
    expect(payload.source.documentId).toBe(topFrame.currentDocument!.documentId);
  });

  it('routes opened→opener messages to the opened tab panel', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    await flushPromises();

    // Connect popup panel too
    const { messages: popupMessages } = env.connectPanel(popupFrame.tab.id);
    await flushPromises();

    const openerWin = topFrame.window!;
    const popupWin = popupFrame.window!;

    // Simulate popup's registration arriving at opener (triggers openedWindowToTab mapping)
    openerWin.dispatchMessage(
      { type: '__messages_inspector_register__', targetType: 'opener', frameId: 0, tabId: popupFrame.tab.id, documentId: popupFrame.currentDocument!.documentId },
      'https://popup.example.com',
      popupWin
    );

    // Popup sends message to opener — captured in opener's tab
    openerWin.dispatchMessage(
      { type: 'hello-from-popup' },
      'https://popup.example.com',
      popupWin
    );
    await flushPromises();

    // Should appear in popup's panel too (cross-tab routing)
    const popupMsgs = popupMessages.filter(m => m.type === 'message' && m.payload.data?.type === 'hello-from-popup');
    expect(popupMsgs).toHaveLength(1);
  });

  it('routes opener→opened to opener panel when popup opened before DevTools', async () => {
    // Scenario: popup opened BEFORE DevTools is connected.
    // onCreatedNavigationTarget fires but the panel condition fails,
    // so openerRelationships is NOT established. Registration still flows,
    // establishing openedWindowToTab. The opener→opened cross-tab routing
    // should still work (via registration-based relationship).
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });

    // Open popup BEFORE connecting any panels
    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });

    // NOW connect panels (after popup was already opened)
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    env.connectPanel(popupFrame.tab.id);
    await flushPromises();

    const openerWin = topFrame.window!;
    const popupWin = popupFrame.window!;

    // Registration flows from popup to opener
    openerWin.dispatchMessage(
      { type: '__messages_inspector_register__', targetType: 'opener', frameId: 0, tabId: popupFrame.tab.id, documentId: popupFrame.currentDocument!.documentId },
      'https://popup.example.com',
      popupWin
    );

    // Opened window sends to opener (cross-tab routing via openedWindowToTab works)
    openerWin.dispatchMessage(
      { type: 'hello-from-popup' },
      'https://popup.example.com',
      popupWin
    );
    await flushPromises();

    // Opener responds to opened window
    popupWin.dispatchMessage(
      { type: 'response', from: 'opener' },
      'https://opener.example.com',
      openerWin
    );
    await flushPromises();

    // Opener panel should show the response (cross-tab routing for opener messages)
    const openerResponseMsgs = openerMessages.filter(m =>
      m.type === 'message' && m.payload.data?.type === 'response'
    );
    expect(openerResponseMsgs).toHaveLength(1);
    expect(openerResponseMsgs[0].payload.source.type).toBe('opener');
  });

  it('includes opener in frame hierarchy for popup tabs', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    await flushPromises();

    // Connect popup panel and request hierarchy
    const { port: popupPort, messages: popupMessages } = env.connectPanel(popupFrame.tab.id);
    await flushPromises();

    popupPort.postMessage({ type: 'get-frame-hierarchy', tabId: popupFrame.tab.id });
    await flushPromises();

    const hierarchyMsg = popupMessages.find(m => m.type === 'frame-hierarchy');
    expect(hierarchyMsg).toBeDefined();

    const frames = hierarchyMsg!.payload;
    // Should have 2 entries: the opener and the popup's own frame 0
    expect(frames).toHaveLength(2);

    const openerEntry = frames.find((f: any) => f.isOpener);
    expect(openerEntry).toBeDefined();
    expect(openerEntry.tabId).toBe(topFrame.tab.id); // opener's tab
    expect(openerEntry.frameId).toBe(0);    // opener's frame
  });

  it('buffers messages for tabs opened from monitored tabs', async () => {
    const { topFrame } = setupTwoFrames();
    env.connectPanel(topFrame.tab.id);
    await flushPromises();

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    await flushPromises();

    // Message sent before popup panel connects — should be buffered
    popupFrame.window!.dispatchMessage({ type: 'early-msg' }, 'https://popup.example.com', popupFrame.window!);

    // Now connect a panel for the popup tab
    const { messages: popupMessages } = env.connectPanel(popupFrame.tab.id);
    await flushPromises();

    // Buffered message should have been flushed to the panel
    const msgPayloads = popupMessages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);
    expect(msgPayloads[0].payload.data).toEqual({ type: 'early-msg' });
    expect(msgPayloads[0].payload.buffered).toBe(true);
  });

  it('self message does not create unknown document', async () => {
    const topFrame = actions.createTab({ url: 'https://self.example.com/', title: 'Self Page' });
    const { messages } = env.connectPanel(topFrame.tab.id);
    await flushPromises();

    // Self message: window posts to itself
    topFrame.window!.postMessage({ type: 'self-ping' }, '*');
    await flushPromises();

    const msgPayloads = messages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);

    const payload = msgPayloads[0].payload;
    expect(payload.source.type).toBe('self');
    expect(payload.data).toEqual({ type: 'self-ping' });

    // Background should enrich source with same frameId/documentId as target
    expect(payload.source.frameId).toBe(payload.target.frameId);
    expect(payload.source.documentId).toBe(payload.target.documentId);
    expect(payload.source.tabId).toBe(payload.target.tabId);
  });
});

// ---------------------------------------------------------------------------
// Automatic frame registration tests
// These use fake timers to control the 500ms registration delay and test the
// full end-to-end flow including background-initiated registration messages.
// ---------------------------------------------------------------------------

describe('automatic frame registration', () => {
  let env: ChromeExtensionEnv;
  let actions: HarnessActions;

  beforeEach(() => {
    vi.useFakeTimers();
    env = new ChromeExtensionEnv(initContentScript);
    // Leave enableFrameRegistration at default (enabled)
    initBackgroundScript(env.createBackgroundChrome());
    const runtime = new HarnessRuntime(env);
    actions = new HarnessActions(runtime);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('popup→opener registration message itself has source type "opened"', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    await vi.advanceTimersByTimeAsync(0);

    actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });

    // Advance past registration timeout so the popup's registration message
    // reaches the opener panel
    await vi.advanceTimersByTimeAsync(1000);

    // The registration message from the popup should arrive on the opener panel
    // with sourceType 'opened' (not 'unknown')
    const registrations = openerMessages.filter(m =>
      m.type === 'message' && m.payload.data?.type === '__messages_inspector_register__'
        && m.payload.data?.targetType === 'opener'
    );
    expect(registrations).toHaveLength(1);
    expect(registrations[0].payload.source.type).toBe('opened');
  });

  it('connecting popup panel does not send duplicate registration to opener', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    await vi.advanceTimersByTimeAsync(0);

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });

    // Let the first registration complete
    await vi.advanceTimersByTimeAsync(1000);

    // Now connect the popup's panel (simulates user opening DevTools on the popup)
    env.connectPanel(popupFrame.tab.id);
    await vi.advanceTimersByTimeAsync(1000);

    // The opener should only see ONE registration message from the popup,
    // not two (one from buffering injection, one from panel connection)
    const openerRegistrations = openerMessages.filter(m =>
      m.type === 'message' && m.payload.data?.type === '__messages_inspector_register__'
        && m.payload.data?.targetType === 'opener'
    );
    expect(openerRegistrations).toHaveLength(1);
  });

  it('popup→opener message has source type "opened" and is routed to popup panel', async () => {
    const topFrame = actions.createTab({ url: 'https://opener.example.com/', title: 'Opener' });
    const { messages: openerMessages } = env.connectPanel(topFrame.tab.id);
    await vi.advanceTimersByTimeAsync(0);

    const popupFrame = actions.openPopup(topFrame, { url: 'https://popup.example.com/', title: 'Popup' });
    const { messages: popupMessages } = env.connectPanel(popupFrame.tab.id);

    // Advance past the 500ms registration timeout and let all nested timers
    // (postMessage delivery, promise chains) complete
    await vi.advanceTimersByTimeAsync(1000);

    // Popup sends a message to opener (via the cross-origin proxy)
    const openerProxy = popupFrame.window!.opener!;
    (openerProxy as any).postMessage({ type: 'ping' }, '*');
    await vi.advanceTimersByTimeAsync(100);

    // Opener panel should show the message with source type 'opened'
    const openerPings = openerMessages.filter(m =>
      m.type === 'message' && m.payload.data?.type === 'ping'
    );
    expect(openerPings).toHaveLength(1);
    expect(openerPings[0].payload.source.type).toBe('opened');

    // Cross-tab routing: popup panel should also see the message
    const popupPings = popupMessages.filter(m =>
      m.type === 'message' && m.payload.data?.type === 'ping'
    );
    expect(popupPings).toHaveLength(1);
  });
});

describe('extension reload recovery', () => {
  let env: ChromeExtensionEnv;
  let runtime: HarnessRuntime;
  let actions: HarnessActions;

  beforeEach(() => {
    env = new ChromeExtensionEnv(initContentScript);
    env.storageData.enableFrameRegistration = false;
    initBackgroundScript(env.createBackgroundChrome());
    runtime = new HarnessRuntime(env);
    actions = new HarnessActions(runtime);
  });

  // Simulate an orphan content script from a previous extension lifetime by
  // installing a probe response listener on the harness window that echoes
  // the supplied (older) swId. Mirrors what an actual orphan would do.
  function simulateOrphan(win: any, swId: string): void {
    win.addEventListener('__messages_inspector_probe__', (e: any) => {
      const nonce = e?.detail?.nonce;
      if (typeof nonce !== 'string') return;
      win.dispatchEvent(new CustomEvent('__messages_inspector_probe_response__', {
        detail: { nonce, swId },
      }));
    });
  }

  it('does not flag stale frames on the very first injection', async () => {
    const top = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent' });
    const { messages } = env.connectPanel(top.tab.id);
    await flushPromises();

    expect(messages.some(m => m.type === 'stale-frame')).toBe(false);
  });

  it('emits stale-frame to the panel when a previous-lifetime probe response listener is found on the frame', async () => {
    const top = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent' });

    // Simulate orphan: a probe response listener installed by a previous
    // extension lifetime is still attached to the top frame's window.
    simulateOrphan(top.window, 'PREVIOUS-LIFETIME');

    const { messages } = env.connectPanel(top.tab.id);
    await flushPromises();

    const stale = messages.filter(m => m.type === 'stale-frame');
    expect(stale).toHaveLength(1);
    expect(stale[0].frameId).toBe(0);
  });

  it('clears stale-frame after a fresh content-script-ready arrives for the frame', async () => {
    const top = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent' });
    simulateOrphan(top.window, 'PREVIOUS-LIFETIME');

    const { messages } = env.connectPanel(top.tab.id);
    await flushPromises();

    expect(messages.filter(m => m.type === 'stale-frame')).toHaveLength(1);

    // Simulate page reload: navigation creates a fresh window, then re-inject runs.
    actions.navigate(top, { url: 'https://parent.example.com/', title: 'Parent' });
    await flushPromises();

    const cleared = messages.filter(m => m.type === 'stale-frame-cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0].frameId).toBe(0);
  });

  it('reuses the same swStartupId across SW restarts (no false stale)', async () => {
    const top = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent' });
    env.connectPanel(top.tab.id);
    await flushPromises();

    // Simulate SW idle restart: re-init background-core against the same env.
    // sessionStorageData persists across this restart; storageData also persists.
    initBackgroundScript(env.createBackgroundChrome());
    const second = env.connectPanel(top.tab.id);
    await flushPromises();

    expect(second.messages.some(m => m.type === 'stale-frame')).toBe(false);
  });

  it('clears stale entries for all frames in a tab when top frame navigates (multi-frame)', async () => {
    const top = actions.createTab({ url: 'https://parent.example.com/', title: 'Parent' });
    const child = actions.addIframe(top, { url: 'https://child.example.com/', iframeId: 'child-iframe', title: 'Child' });

    // Simulate orphan: BOTH top frame and child iframe have probe response
    // listeners from a previous extension lifetime.
    simulateOrphan(top.window, 'PREVIOUS-LIFETIME-TOP');
    simulateOrphan(child.window, 'PREVIOUS-LIFETIME-CHILD');

    const { messages } = env.connectPanel(top.tab.id);
    await flushPromises();

    const stale = messages.filter(m => m.type === 'stale-frame');
    const staleFrameIds = stale.map(m => m.frameId).sort();
    expect(staleFrameIds).toEqual([0, child.frameId].sort());

    // Reload only the top frame. In the harness, navigate(top, ...) fires onCommitted
    // for the top frame and creates a fresh window for it. The child iframe is left
    // in place by the harness, but in production a top-frame reload destroys all
    // subframes — the background-core code clears all stale entries for the tab
    // regardless of whether the harness models the subframe destruction.
    actions.navigate(top, { url: 'https://parent.example.com/', title: 'Parent' });
    await flushPromises();

    const cleared = messages.filter(m => m.type === 'stale-frame-cleared');
    const clearedFrameIds = cleared.map(m => m.frameId).sort();
    expect(clearedFrameIds).toEqual([0, child.frameId].sort());
  });
});
