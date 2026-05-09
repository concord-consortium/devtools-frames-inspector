import { describe, it, expect, vi } from 'vitest';
import { initContentScript } from './content-core';
import { INJECT_ACTION_KEY } from './types';

function makeWindow(): any {
  const win: any = {
    location: { href: 'https://example.com/', origin: 'https://example.com' },
    document: { title: '', querySelector: () => null, querySelectorAll: () => [] as any },
    parent: null, top: null, opener: null,
    frames: { length: 0 },
    addEventListener: vi.fn(),
  };
  win.parent = win;
  win.top = win;
  return win;
}

function makeChrome() {
  return {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
  };
}

describe('initContentScript inject-action protocol', () => {
  it('sends stale-frame and adds no listeners when action is "stale"', () => {
    const win = makeWindow();
    const chrome = makeChrome();
    win[INJECT_ACTION_KEY] = 'stale';

    initContentScript(win, chrome);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'stale-frame' });
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
    // The action flag is consumed (cleared) so a later re-injection is unaffected.
    expect(win[INJECT_ACTION_KEY]).toBeUndefined();
  });

  it('does nothing when action is "skip"', () => {
    const win = makeWindow();
    const chrome = makeChrome();
    win[INJECT_ACTION_KEY] = 'skip';

    initContentScript(win, chrome);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(win[INJECT_ACTION_KEY]).toBeUndefined();
  });

  it('inits and sends content-script-ready when action is "init"', () => {
    const win = makeWindow();
    const chrome = makeChrome();
    win[INJECT_ACTION_KEY] = 'init';

    initContentScript(win, chrome);

    expect(win.addEventListener).toHaveBeenCalled();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'content-script-ready' });
  });

  it('falls back to init when no action flag is set (back-compat)', () => {
    const win = makeWindow();
    const chrome = makeChrome();
    // No action flag — happens if bootstrap was never run (e.g. legacy flow).

    initContentScript(win, chrome);

    expect(win.addEventListener).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'content-script-ready' });
  });
});
