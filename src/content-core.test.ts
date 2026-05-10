import { describe, it, expect, vi } from 'vitest';
import { initContentScript, getDomPath } from './content-core';
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

describe('getDomPath', () => {
  // The selectors getDomPath produces must round-trip through querySelector
  // unchanged — that's the contract. Each test asserts both the literal
  // selector string and that it actually resolves back to the original node.

  function expectRoundTrip(el: Element, expected: string) {
    expect(getDomPath(el)).toBe(expected);
    expect(document.querySelector(expected)).toBe(el);
  }

  it('uses the id branch with attribute-selector form', () => {
    document.body.innerHTML = '<iframe id="simple-id"></iframe>';
    const iframe = document.querySelector('iframe')!;
    expectRoundTrip(iframe, 'iframe[id="simple-id"]');
  });

  it('handles ids that start with a digit (the case that motivated the change)', () => {
    document.body.innerHTML = '<iframe id="18358-ManagedInteractive"></iframe>';
    const iframe = document.querySelector('iframe')!;
    expectRoundTrip(iframe, 'iframe[id="18358-ManagedInteractive"]');
  });

  it('escapes double quotes inside ids', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'has"quote';
    document.body.replaceChildren(iframe);
    expectRoundTrip(iframe, 'iframe[id="has\\"quote"]');
  });

  it('escapes backslashes inside ids', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'back\\slash';
    document.body.replaceChildren(iframe);
    expectRoundTrip(iframe, 'iframe[id="back\\\\slash"]');
  });

  it('falls back to nth-of-type when no id is present', () => {
    document.body.innerHTML = `
      <div>
        <iframe></iframe>
        <iframe></iframe>
      </div>
    `;
    const second = document.querySelectorAll('iframe')[1];
    // Path walks up to <html>, so prefix isn't fixed — just assert the tail.
    const path = getDomPath(second);
    expect(path.endsWith('div > iframe:nth-of-type(2)')).toBe(true);
    expect(document.querySelector(path)).toBe(second);
  });

  it('stops at the first ancestor with an id', () => {
    document.body.innerHTML = `
      <div id="container">
        <span>
          <iframe></iframe>
        </span>
      </div>
    `;
    const iframe = document.querySelector('iframe')!;
    expectRoundTrip(iframe, 'div[id="container"] > span > iframe');
  });
});
