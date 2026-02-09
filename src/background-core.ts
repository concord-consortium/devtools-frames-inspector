// Background script core logic — extracted for testability.
// In production, background.ts calls initBackgroundScript(chrome).
// In tests, call with a mock BackgroundChrome to avoid needing globalThis.chrome.

import { IMessage, ContentToBackgroundMessage, FrameIdentityMessage, FrameInfo, FrameInfoResponse, GetFrameInfoMessage, OpenerInfo } from './types';

/** Minimal chrome API surface needed by the background script */
export interface BackgroundPort {
  name: string;
  postMessage(msg: any): void;
  onMessage: { addListener(cb: (msg: any) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface MessageSender {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

export interface BackgroundChrome {
  runtime: {
    onConnect: { addListener(cb: (port: BackgroundPort) => void): void };
    onMessage: { addListener(cb: (msg: ContentToBackgroundMessage, sender: MessageSender, sendResponse: (...args: any[]) => void) => void): void };
  };
  scripting: {
    executeScript(options: { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; files: string[]; injectImmediately?: boolean }): Promise<any[]>;
  };
  tabs: {
    sendMessage(tabId: number, msg: any, options?: { frameId?: number }): Promise<any>;
    onRemoved: { addListener(cb: (tabId: number) => void): void };
  };
  webNavigation: {
    getAllFrames(details: { tabId: number }): Promise<Array<{ frameId: number; parentFrameId: number; documentId?: string; url: string }> | null>;
    getFrame(details: { tabId: number; frameId: number }): Promise<{ documentId?: string; parentFrameId?: number } | null>;
    onCommitted: { addListener(cb: (details: { tabId: number; frameId: number; url: string }) => void): void };
    onCreatedNavigationTarget: { addListener(cb: (details: { sourceTabId: number; tabId: number; url: string }) => void): void };
  };
  storage: { local: { get(keys: string | string[]): Promise<Record<string, any>> } };
}

export function initBackgroundScript(chrome: BackgroundChrome): void {
  // Store panel connections by tab ID
  const panelConnections = new Map<number, BackgroundPort>();

  // Store preserve log preference by tab ID
  const preserveLogPrefs = new Map<number, boolean>();

  // Buffer messages for tabs without a panel connection
  const messageBuffers = new Map<number, IMessage[]>();
  // Tabs that should have buffering enabled (opened from a monitored tab)
  const bufferingEnabledTabs = new Set<number>();
  const MAX_BUFFER_SIZE = 1000;

  // Track which frames have been injected to avoid double-injection
  const injectedFrames = new Map<number, Set<number>>();

  // Inject content script into a specific tab and frame
  async function injectContentScript(tabId: number, frameId: number | null = null): Promise<void> {
    try {
      const target: { tabId: number; frameIds?: number[]; allFrames?: boolean } = { tabId };
      if (frameId !== null) {
        target.frameIds = [frameId];
      } else {
        target.allFrames = true;
      }

      if (!injectedFrames.has(tabId)) {
        injectedFrames.set(tabId, new Set());
      }

      if (frameId !== null && injectedFrames.get(tabId)!.has(frameId)) {
        return;
      }

      await chrome.scripting.executeScript({
        target,
        files: ['content.js'],
        injectImmediately: true
      });

      if (frameId !== null) {
        injectedFrames.get(tabId)!.add(frameId);
        sendFrameIdentity(tabId, frameId);
      } else {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        if (frames) {
          for (const frame of frames) {
            injectedFrames.get(tabId)!.add(frame.frameId);
            sendFrameIdentity(tabId, frame.frameId);
          }
        }
      }
    } catch {
      // Injection can fail for chrome:// pages, etc.
    }
  }

  async function sendFrameIdentity(tabId: number, frameId: number): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['enableFrameRegistration']);
      const enabled = result.enableFrameRegistration !== false;

      if (enabled) {
        let documentId: string | undefined;
        try {
          const frameInfo = await chrome.webNavigation.getFrame({ tabId, frameId });
          documentId = frameInfo?.documentId;
        } catch {
          return;
        }
        if (documentId == null) return;

        const message: FrameIdentityMessage = {
          type: 'frame-identity',
          frameId: frameId,
          tabId: tabId,
          documentId: documentId
        };
        await chrome.tabs.sendMessage(tabId, message, { frameId: frameId });
      }
    } catch {
      // Content script may not be ready yet, ignore
    }
  }

  // Handle connections from DevTools panel
  chrome.runtime.onConnect.addListener((port: BackgroundPort) => {
    if (port.name !== 'postmessage-panel') return;

    port.onMessage.addListener((msg: { type: string; tabId?: number; value?: boolean }) => {
      if (msg.type === 'init' && msg.tabId !== undefined) {
        panelConnections.set(msg.tabId, port);
        preserveLogPrefs.set(msg.tabId, false);

        injectContentScript(msg.tabId);

        const bufferedMessages = messageBuffers.get(msg.tabId);
        if (bufferedMessages && bufferedMessages.length > 0) {
          for (const payload of bufferedMessages) {
            port.postMessage({ type: 'message', payload });
          }
          messageBuffers.delete(msg.tabId);
        }
        bufferingEnabledTabs.delete(msg.tabId);

        port.onDisconnect.addListener(() => {
          panelConnections.delete(msg.tabId!);
          preserveLogPrefs.delete(msg.tabId!);
        });
      } else if (msg.type === 'preserveLog' && msg.tabId !== undefined) {
        preserveLogPrefs.set(msg.tabId, msg.value ?? false);
      } else if (msg.type === 'get-frame-hierarchy' && msg.tabId !== undefined) {
        getFrameHierarchy(msg.tabId).then(hierarchy => {
          port.postMessage({
            type: 'frame-hierarchy',
            payload: hierarchy
          });
        });
      }
    });
  });

  async function getFrameHierarchy(tabId: number): Promise<FrameInfo[]> {
    try {
      const webNavFrames = await chrome.webNavigation.getAllFrames({ tabId });
      if (!webNavFrames) return [];

      let openerInfo: OpenerInfo | null = null;

      const frameInfoPromises = webNavFrames.map(async (frame): Promise<FrameInfo> => {
        try {
          const message: GetFrameInfoMessage = { type: 'get-frame-info' };
          const info = await chrome.tabs.sendMessage(tabId,
            message,
            { frameId: frame.frameId }
          ) as FrameInfoResponse | undefined;

          if (frame.frameId === 0 && info?.opener) {
            openerInfo = info.opener;
          }

          return {
            frameId: frame.frameId,
            documentId: frame.documentId,
            url: frame.url,
            parentFrameId: frame.parentFrameId,
            title: info?.title || '',
            origin: info?.origin || '',
            iframes: info?.iframes || []
          };
        } catch {
          let origin = '';
          try {
            origin = new URL(frame.url).origin;
          } catch { /* ignore */ }
          return {
            frameId: frame.frameId,
            documentId: frame.documentId,
            url: frame.url,
            parentFrameId: frame.parentFrameId,
            title: '',
            origin: origin,
            iframes: []
          };
        }
      });

      const frames = await Promise.all(frameInfoPromises);

      if (openerInfo) {
        frames.unshift({
          frameId: 'opener',
          url: '',
          parentFrameId: -1,
          title: '',
          origin: (openerInfo as OpenerInfo).origin || '',
          iframes: [],
          isOpener: true
        });
      }

      return frames;
    } catch (e) {
      console.error('Failed to get frame hierarchy:', e);
      return [];
    }
  }

  // Handle messages from content scripts
  chrome.runtime.onMessage.addListener((
    message: ContentToBackgroundMessage,
    sender: MessageSender
  ) => {
    if (message.type !== 'postmessage-captured') return;

    const tabId = sender.tab?.id;
    const frameId = sender.frameId;

    if (!tabId || frameId === undefined) return;

    (async () => {
      const enrichedPayload: IMessage = {
        ...message.payload,
        target: {
          ...message.payload.target,
          frameId: frameId,
          documentId: sender.documentId
        }
      };

      if (message.payload.source.type === 'parent') {
        try {
          const frame = await chrome.webNavigation.getFrame({ tabId, frameId });
          if (!frame) {
            enrichedPayload.target.frameInfoError = 'Frame not found';
          } else if (frame.parentFrameId == null) {
            enrichedPayload.source = {
              ...enrichedPayload.source,
              frameInfoError: 'No parentFrameId'
            };
          } else {
            let parentDocumentId: string | undefined;
            try {
              const parentFrame = await chrome.webNavigation.getFrame({ tabId, frameId: frame.parentFrameId });
              parentDocumentId = parentFrame?.documentId;
            } catch {
              // Parent frame may no longer exist
            }
            enrichedPayload.source = {
              ...enrichedPayload.source,
              frameId: frame.parentFrameId,
              documentId: parentDocumentId
            };
          }
        } catch (e) {
          enrichedPayload.target.frameInfoError = (e instanceof Error ? e.message : 'Failed to get frame info');
        }
      }

      const panel = panelConnections.get(tabId);
      if (panel) {
        enrichedPayload.buffered = false;
        panel.postMessage({
          type: 'message',
          payload: enrichedPayload
        });
      } else if (bufferingEnabledTabs.has(tabId)) {
        enrichedPayload.buffered = true;
        if (!messageBuffers.has(tabId)) {
          messageBuffers.set(tabId, []);
        }
        const buffer = messageBuffers.get(tabId)!;
        if (buffer.length < MAX_BUFFER_SIZE) {
          buffer.push(enrichedPayload);
        }
      }
    })();
  });

  // Enable buffering for tabs opened from monitored tabs
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    const sourceTabId = details.sourceTabId;
    const newTabId = details.tabId;

    if (panelConnections.has(sourceTabId)) {
      bufferingEnabledTabs.add(newTabId);
    }
  });

  // Handle navigation events
  chrome.webNavigation.onCommitted.addListener((details) => {
    const { tabId, frameId } = details;
    const isMonitored = panelConnections.has(tabId);
    const needsBuffering = bufferingEnabledTabs.has(tabId);

    if (isMonitored || needsBuffering) {
      if (injectedFrames.has(tabId)) {
        injectedFrames.get(tabId)!.delete(frameId);
      }
      injectContentScript(tabId, frameId);
    }

    if (frameId === 0) {
      const preserveLog = preserveLogPrefs.get(tabId);
      if (!preserveLog) {
        const panel = panelConnections.get(tabId);
        if (panel) {
          panel.postMessage({ type: 'clear' });
        }
      }
    }
  });

  // Clean up when tab is closed
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    messageBuffers.delete(tabId);
    bufferingEnabledTabs.delete(tabId);
    injectedFrames.delete(tabId);
  });
}
