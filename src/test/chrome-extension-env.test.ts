import { describe, it, expect } from 'vitest';
import { ChromeExtensionEnv } from './chrome-extension-env';
import { HarnessRuntime } from './harness-runtime';
import { HarnessActions } from './harness-actions';

describe('ChromeExtensionEnv extensions', () => {
  it('executeScript with func passes the frame window twice as override args', async () => {
    const env = new ChromeExtensionEnv();
    const runtime = new HarnessRuntime(env);
    const actions = new HarnessActions(runtime);
    const frame = actions.createTab({ url: 'https://a.example/', title: 'A' });
    const bg = env.createBackgroundChrome();

    await bg.scripting.executeScript({
      target: { tabId: frame.tab.id, frameIds: [0] },
      func: (id: string, _selfOverride?: any, _windowOverride?: any) => {
        const w = _selfOverride ?? self;
        const win = _windowOverride ?? (typeof window !== 'undefined' ? window : self);
        w.__test_marker_self__ = id;
        win.__test_marker_win__ = id;
      },
      args: ['HELLO'],
    });

    expect((frame.window as any).__test_marker_self__).toBe('HELLO');
    expect((frame.window as any).__test_marker_win__).toBe('HELLO');
  });

  it('storage.session.get returns persisted values; set persists them', async () => {
    const env = new ChromeExtensionEnv();
    const bg = env.createBackgroundChrome();
    await bg.storage.session.set({ swStartupId: 'abc' });
    const result = await bg.storage.session.get(['swStartupId']);
    expect(result).toEqual({ swStartupId: 'abc' });
  });
});
