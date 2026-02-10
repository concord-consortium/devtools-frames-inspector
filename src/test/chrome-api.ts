// Chrome API test primitives — vi.fn()-free.
// These can run in both vitest and a real browser (for Playwright-based testing).

// ---------------------------------------------------------------------------
// ChromeEvent — mimics chrome.events.Event (addListener/removeListener)
// ---------------------------------------------------------------------------

export class ChromeEvent<T extends (...args: any[]) => any> {
  private listeners: T[] = [];

  addListener(cb: T): void {
    this.listeners.push(cb);
  }

  removeListener(cb: T): void {
    this.listeners = this.listeners.filter(l => l !== cb);
  }

  hasListener(cb: T): boolean {
    return this.listeners.includes(cb);
  }

  hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  /** Test helper: invoke all registered listeners */
  fire(...args: Parameters<T>): ReturnType<T>[] {
    return this.listeners.map(l => l(...args));
  }
}

// ---------------------------------------------------------------------------
// Port pairs — connected mock ports for panel ↔ background communication
// ---------------------------------------------------------------------------

export interface MockPort {
  name: string;
  postMessage(msg: any): void;
  onMessage: ChromeEvent<(msg: any) => void>;
  onDisconnect: ChromeEvent<() => void>;
  disconnect(): void;
  sender?: { tab?: { id: number }; frameId?: number; documentId?: string };
}

export function createPortPair(
  name: string,
  sender?: MockPort['sender']
): [MockPort, MockPort] {
  const port1OnMessage = new ChromeEvent<(msg: any) => void>();
  const port2OnMessage = new ChromeEvent<(msg: any) => void>();
  const port1OnDisconnect = new ChromeEvent<() => void>();
  const port2OnDisconnect = new ChromeEvent<() => void>();

  const port1: MockPort = {
    name,
    postMessage(msg: any) { port2OnMessage.fire(msg); },
    onMessage: port1OnMessage,
    onDisconnect: port1OnDisconnect,
    disconnect() { port2OnDisconnect.fire(); },
    sender,
  };

  const port2: MockPort = {
    name,
    postMessage(msg: any) { port1OnMessage.fire(msg); },
    onMessage: port2OnMessage,
    onDisconnect: port2OnDisconnect,
    disconnect() { port1OnDisconnect.fire(); },
    sender,
  };

  return [port1, port2];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Flush pending microtasks (resolved promises) */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
