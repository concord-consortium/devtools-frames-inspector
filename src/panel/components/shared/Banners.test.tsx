import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Banners } from './Banners';
import { store } from '../../store';

vi.stubGlobal('chrome', {
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  devtools: { inspectedWindow: { tabId: 42 } },
});

describe('Banners', () => {
  beforeEach(() => {
    store.setExtensionContextInvalidated(false);
    store.clearStaleFrames();
  });

  it('renders nothing when no flags set', () => {
    const { container } = render(<Banners />);
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('renders the reload-devtools banner when extensionContextInvalidated', () => {
    store.setExtensionContextInvalidated(true);
    render(<Banners />);
    expect(screen.getByText(/Close and reopen DevTools/i)).toBeTruthy();
  });

  it('renders the page-reload banner when there are stale frames', () => {
    store.addStaleFrame(0);
    render(<Banners />);
    expect(screen.getByText(/Reload the page/i)).toBeTruthy();
  });

  it('shows both banners when both conditions hold', () => {
    store.setExtensionContextInvalidated(true);
    store.addStaleFrame(0);
    render(<Banners />);
    expect(screen.getByText(/Close and reopen DevTools/i)).toBeTruthy();
    expect(screen.getByText(/Reload the page/i)).toBeTruthy();
  });
});
