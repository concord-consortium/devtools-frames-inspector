// Integration tests: content script → background service worker → panel
//
// These tests exercise the real background-core.ts and content-core.ts code
// with mock Chrome APIs wired together by ChromeExtensionEnv.
//
// Test frame hierarchy:
//   Parent (frameId=0) — https://parent.example.com
//   └── Child (frameId=1) — https://child.example.com

import { describe, it, expect, beforeEach } from 'vitest';
import { ChromeExtensionEnv, HarnessWindow, HarnessIFrame, flushPromises } from './test/chrome-extension-env';
import { initContentScript } from './content-core';
import { initBackgroundScript } from './background-core';

const TAB_ID = 1;

describe('content → background → panel integration', () => {
  let env: ChromeExtensionEnv;

  beforeEach(() => {
    env = new ChromeExtensionEnv();
    // Disable frame registration to keep tests focused on message routing
    env.storageData.enableFrameRegistration = false;
    initBackgroundScript(env.createBackgroundChrome());
  });

  // --- Frame + window setup helpers ---

  function setupTwoFrames() {
    // Register frames in webNavigation
    const parentFrame = env.addFrame({
      tabId: TAB_ID, frameId: 0, parentFrameId: -1,
      documentId: 'doc-parent', url: 'https://parent.example.com/',
    });
    const childFrame = env.addFrame({
      tabId: TAB_ID, frameId: 1, parentFrameId: 0,
      documentId: 'doc-child', url: 'https://child.example.com/',
    });

    // Create harness windows
    const childWin = new HarnessWindow({
      location: { href: 'https://child.example.com/', origin: 'https://child.example.com' },
      title: 'Child Page',
    });
    const parentWin = new HarnessWindow({
      location: { href: 'https://parent.example.com/', origin: 'https://parent.example.com' },
      title: 'Parent Page',
    });
    parentWin.addIframe(new HarnessIFrame('https://child.example.com/', 'child-iframe', childWin));
    childWin.parent = parentWin;

    // Create content script chrome APIs and initialize content scripts
    const parentChrome = env.createContentChrome(parentFrame);
    const childChrome = env.createContentChrome(childFrame);
    initContentScript(parentWin as unknown as Window, parentChrome);
    initContentScript(childWin as unknown as Window, childChrome);

    return { parentWin, childWin, parentChrome, childChrome };
  }

  // --- Tests ---

  it('delivers a child→parent postMessage to the panel', async () => {
    const { parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
    await flushPromises();

    // Child sends a message that parent receives
    parentWin.dispatchMessage(
      { type: 'hello-from-child', value: 42 },
      'https://child.example.com',
      childWin
    );

    const msgPayloads = messages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);

    const payload = msgPayloads[0].payload;
    expect(payload.data).toEqual({ type: 'hello-from-child', value: 42 });
    expect(payload.messageType).toBe('hello-from-child');
    expect(payload.source.type).toBe('child');
    expect(payload.source.origin).toBe('https://child.example.com');
    expect(payload.source.iframeSrc).toBe('https://child.example.com/');
    expect(payload.source.iframeId).toBe('child-iframe');
    expect(payload.target.origin).toBe('https://parent.example.com');
    expect(payload.target.frameId).toBe(0);
    expect(payload.target.documentId).toBe('doc-parent');
  });

  it('delivers a parent→child postMessage to the panel', async () => {
    const { parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
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
    expect(payload.source.documentId).toBe('doc-parent');
    expect(payload.target.origin).toBe('https://child.example.com');
    expect(payload.target.frameId).toBe(1);
    expect(payload.target.documentId).toBe('doc-child');
  });

  it('delivers messages from multiple content scripts in the same test', async () => {
    const { parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
    await flushPromises();

    // Child→Parent message
    parentWin.dispatchMessage({ type: 'msg-1' }, 'https://child.example.com', childWin);
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

  it('assigns stable windowIds to repeated messages from the same source', async () => {
    const { parentWin, childWin } = setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
    await flushPromises();

    parentWin.dispatchMessage({ type: 'first' }, 'https://child.example.com', childWin);
    parentWin.dispatchMessage({ type: 'second' }, 'https://child.example.com', childWin);

    const payloads = messages.filter(m => m.type === 'message').map(m => m.payload);
    expect(payloads).toHaveLength(2);
    // Same source window should get the same windowId
    expect(payloads[0].source.windowId).toBe(payloads[1].source.windowId);
    // And it should be a non-empty string
    expect(payloads[0].source.windowId).toBeTruthy();
  });

  it('clears panel messages on main frame navigation', async () => {
    setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
    await flushPromises();

    // Simulate main frame navigation
    env.bgOnCommitted.fire({ tabId: TAB_ID, frameId: 0, url: 'https://parent.example.com/new' });

    const clearMsgs = messages.filter(m => m.type === 'clear');
    expect(clearMsgs).toHaveLength(1);
  });

  it('does not clear messages on subframe navigation', async () => {
    setupTwoFrames();
    const { messages } = env.connectPanel(TAB_ID);
    await flushPromises();

    // Simulate subframe navigation
    env.bgOnCommitted.fire({ tabId: TAB_ID, frameId: 1, url: 'https://child.example.com/new' });

    const clearMsgs = messages.filter(m => m.type === 'clear');
    expect(clearMsgs).toHaveLength(0);
  });

  it('buffers messages for tabs opened from monitored tabs', async () => {
    setupTwoFrames();
    env.connectPanel(TAB_ID);
    await flushPromises();

    const POPUP_TAB_ID = 2;
    const popupFrame = env.addFrame({
      tabId: POPUP_TAB_ID, frameId: 0, parentFrameId: -1,
      documentId: 'doc-popup', url: 'https://popup.example.com/',
    });

    // Simulate popup opened from monitored tab
    env.bgOnCreatedNavTarget.fire({ sourceTabId: TAB_ID, tabId: POPUP_TAB_ID, url: 'https://popup.example.com/' });

    // Create content script in popup
    const popupWin = new HarnessWindow({
      location: { href: 'https://popup.example.com/', origin: 'https://popup.example.com' },
      title: 'Popup',
    });
    const popupChrome = env.createContentChrome(popupFrame);
    initContentScript(popupWin as unknown as Window, popupChrome);

    // Message sent before popup panel connects — should be buffered
    popupWin.dispatchMessage({ type: 'early-msg' }, 'https://popup.example.com', popupWin);

    // Now connect a panel for the popup tab
    const { messages: popupMessages } = env.connectPanel(POPUP_TAB_ID);
    await flushPromises();

    // Buffered message should have been flushed to the panel
    const msgPayloads = popupMessages.filter(m => m.type === 'message');
    expect(msgPayloads).toHaveLength(1);
    expect(msgPayloads[0].payload.data).toEqual({ type: 'early-msg' });
    expect(msgPayloads[0].payload.buffered).toBe(true);
  });
});
