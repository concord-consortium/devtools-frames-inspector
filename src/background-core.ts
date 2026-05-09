// Background script core logic — extracted for testability.
// In production, background.ts calls initBackgroundScript(chrome).
// In tests, call with a mock BackgroundChrome to avoid needing globalThis.chrome.

import {
  IMessage, ContentToBackgroundMessage, SendMessageMessage, FrameInfo, FrameInfoResponse,
  GetFrameInfoMessage, OpenerInfo,
  REGISTRATION_MESSAGE_TYPE, INJECT_ACTION_KEY, SW_ID_KEY, SW_STARTUP_ID_STORAGE_KEY,
  PROBE_EVENT_NAME, PROBE_RESPONSE_EVENT_NAME,
} from './types';

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
    executeScript(options: {
      target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
      files?: string[];
      func?: (...args: any[]) => any;
      args?: any[];
      injectImmediately?: boolean;
    }): Promise<any[]>;
  };
  tabs: {
    sendMessage(tabId: number, msg: any, options?: { frameId?: number; documentId?: string }): Promise<any>;
    onRemoved: { addListener(cb: (tabId: number) => void): void };
  };
  webNavigation: {
    getAllFrames(details: { tabId: number }): Promise<Array<{ frameId: number; parentFrameId: number; documentId?: string; url: string }> | null>;
    getFrame(details: { tabId: number; frameId: number }): Promise<{ documentId?: string; parentFrameId?: number; url?: string } | null>;
    onCommitted: { addListener(cb: (details: { tabId: number; frameId: number; url: string; transitionType: string; transitionQualifiers: string[] }) => void): void };
    onCreatedNavigationTarget: { addListener(cb: (details: { sourceTabId: number; sourceFrameId: number; tabId: number; url: string }) => void): void };
  };
  storage: {
    local: { get(keys: string | string[]): Promise<Record<string, any>> };
    session: {
      get(keys: string | string[]): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
    };
  };
}

export function initBackgroundScript(chrome: BackgroundChrome): void {
  console.debug('[Messages] background script starting');

  // Store panel connections by tab ID
  const panelConnections = new Map<number, BackgroundPort>();

  // Store preserve log preference by tab ID
  const preserveLogPrefs = new Map<number, boolean>();

  // Per-SW-startup ID. Persisted in chrome.storage.session so it survives idle
  // restarts of the SW but is cleared on extension reload (which is what we
  // want — same ID across idle restarts means no false "stale" reports;
  // different ID after reload means orphan content scripts get detected).
  const swStartupIdReady: Promise<string> = (async () => {
    const result = await chrome.storage.session.get([SW_STARTUP_ID_STORAGE_KEY]);
    let id: string | undefined = result[SW_STARTUP_ID_STORAGE_KEY];
    if (typeof id !== 'string' || !id) {
      id = generateSwStartupId();
      await chrome.storage.session.set({ [SW_STARTUP_ID_STORAGE_KEY]: id });
    }
    return id;
  })();

  function generateSwStartupId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }

  // Buffer messages for tabs without a panel connection
  const messageBuffers = new Map<number, IMessage[]>();
  // Tabs that should have buffering enabled (opened from a monitored tab)
  const bufferingEnabledTabs = new Set<number>();
  const MAX_BUFFER_SIZE = 1000;

  // Track which frames have been injected to avoid double-injection
  const injectedFrames = new Map<number, Set<number>>();

  // For each opened tab, the frame that opened it (via window.open)
  const openedTabs = new Map<number, { tabId: number; frameId: number }>();

  // Per-tab set of frame IDs that reported a stale orphan content script.
  // Cleared when the frame's content-script-ready arrives (it reloaded).
  const staleFrames = new Map<number, Set<number>>();
  // For each opener frame key ("tabId:frameId"), the tabs it opened
  const openerFrames = new Map<string, Set<number>>();

  // Record an opener relationship
  function recordOpenerRelationship(openerTabId: number, openerFrameId: number, openedTabId: number): void {
    console.debug('[Messages] recordOpenerRelationship:', { openerTabId, openerFrameId, openedTabId });
    openedTabs.set(openedTabId, { tabId: openerTabId, frameId: openerFrameId });
    const key = `${openerTabId}:${openerFrameId}`;
    if (!openerFrames.has(key)) openerFrames.set(key, new Set());
    openerFrames.get(key)!.add(openedTabId);
  }

  // Maps "${capturingTabId}:${sourceId}" to the opened window's tab info
  const openedWindowToTab = new Map<string, { tabId: number; frameId: number }>();

  // Inject content script into a specific tab and frame
  async function injectContentScript(tabId: number, frameId: number | null = null): Promise<void> {
    try {
      const id = await swStartupIdReady;
      const target: { tabId: number; frameIds?: number[]; allFrames?: boolean } = { tabId };
      if (frameId !== null) {
        target.frameIds = [frameId];
      } else {
        target.allFrames = true;
      }

      if (!injectedFrames.has(tabId)) injectedFrames.set(tabId, new Set());
      if (frameId !== null && injectedFrames.get(tabId)!.has(frameId)) return;

      // Step 1: bootstrap. Dispatches a custom DOM event on window to probe
      // for orphan content scripts from a previous extension lifetime. DOM
      // events propagate synchronously across isolated worlds, so any orphan
      // content script's response listener (registered on the same shared
      // window) fires during dispatchEvent. The bootstrap collects responses
      // and decides:
      //   - no responses → 'init' (fresh frame)
      //   - all responses match current swId → 'skip' (idempotent re-inject)
      //   - any response differs → 'stale' (orphan from previous lifetime)
      // The function source is serialized and re-executed in the page's
      // isolated world — no closures, must inline constants.
      await chrome.scripting.executeScript({
        target,
        func: (
          id: string,
          swIdKey: string,
          actionKey: string,
          probeEventName: string,
          probeResponseEventName: string,
          // Test-harness overrides. Production Chrome only passes the 5 args
          // above; the default-undefined params fall through to the page's
          // own `self` and `window` globals in the isolated world.
          _selfOverride?: any,
          _windowOverride?: any,
        ) => {
          const w: any = _selfOverride ?? self;
          const win: any = _windowOverride ?? (typeof window !== 'undefined' ? window : self);

          const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          const responses: Array<{ swId: string }> = [];
          const handler = (e: any) => {
            if (e?.detail?.nonce !== nonce) return;
            if (typeof e.detail.swId === 'string') responses.push({ swId: e.detail.swId });
          };
          win.addEventListener(probeResponseEventName, handler);
          try {
            win.dispatchEvent(new CustomEvent(probeEventName, { detail: { nonce } }));
          } finally {
            win.removeEventListener(probeResponseEventName, handler);
          }

          let action: string;
          if (responses.length === 0) {
            action = 'init';
          } else if (responses.every((r) => r.swId === id)) {
            action = 'skip';
          } else {
            action = 'stale';
          }
          w[swIdKey] = id;
          w[actionKey] = action;
        },
        args: [id, SW_ID_KEY, INJECT_ACTION_KEY, PROBE_EVENT_NAME, PROBE_RESPONSE_EVENT_NAME],
        injectImmediately: true,
      });

      // Step 2: content.js. Reads INJECT_ACTION_KEY and acts accordingly.
      await chrome.scripting.executeScript({
        target,
        files: ['content.js'],
        injectImmediately: true,
      });

      if (frameId !== null) {
        injectedFrames.get(tabId)!.add(frameId);
        sendRegistrationMessages(tabId, frameId);
      } else {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        if (frames) {
          const alreadyInjected = injectedFrames.get(tabId)!;
          for (const frame of frames) {
            const isNew = !alreadyInjected.has(frame.frameId);
            alreadyInjected.add(frame.frameId);
            if (isNew) sendRegistrationMessages(tabId, frame.frameId);
          }
        }
      }
    } catch {
      // Injection can fail for chrome:// pages, etc.
    }
  }

  async function sendRegistrationMessages(tabId: number, frameId: number): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['enableFrameRegistration', 'registrationDelayMs']);
      const enabled = result.enableFrameRegistration !== false;
      const delayMs = typeof result.registrationDelayMs === 'number' ? result.registrationDelayMs : 500;

      if (enabled) {
        let documentId: string | undefined;
        try {
          const frameInfo = await chrome.webNavigation.getFrame({ tabId, frameId });
          documentId = frameInfo?.documentId;
        } catch {
          return;
        }
        if (documentId == null) return;

        const registrationBase = {
          type: REGISTRATION_MESSAGE_TYPE,
          frameId,
          tabId,
          documentId,
        };

        const sendMessages = async () => {
          try {
            const parentMsg: SendMessageMessage = {
              type: 'send-message',
              target: 'parent',
              message: { ...registrationBase, targetType: 'parent' },
            };
            await chrome.tabs.sendMessage(tabId, parentMsg, { frameId });

            const openerMsg: SendMessageMessage = {
              type: 'send-message',
              target: 'opener',
              message: { ...registrationBase, targetType: 'opener' },
            };
            await chrome.tabs.sendMessage(tabId, openerMsg, { frameId });
          } catch (e) {
            console.debug('[Messages] sendRegistrationMessages failed for', { tabId, frameId }, e);
          }
        };
        if (delayMs > 0) {
          setTimeout(sendMessages, delayMs);
        } else {
          sendMessages();
        }
      }
    } catch (e) {
      console.warn('[Messages] sendRegistrationMessages failed for', { tabId, frameId }, e);
    }
  }

  // Handle connections from DevTools panel
  chrome.runtime.onConnect.addListener((port: BackgroundPort) => {
    if (port.name !== 'postmessage-panel') return;

    port.onMessage.addListener((msg: { type: string; tabId?: number; value?: boolean; documentId?: string; domPath?: string }) => {
      if (msg.type === 'init' && msg.tabId !== undefined) {
        console.debug('[Messages] panel connected for tab', msg.tabId);
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

        // Replay any frames already known stale for this tab.
        const stale = staleFrames.get(msg.tabId);
        if (stale && stale.size > 0) {
          for (const fid of stale) port.postMessage({ type: 'stale-frame', frameId: fid });
        }

        port.onDisconnect.addListener(() => {
          console.debug('[Messages] panel disconnected for tab', msg.tabId);
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
      } else if (msg.type === 'log-iframe-element' && msg.tabId !== undefined && msg.documentId && msg.domPath) {
        const targetTabId = msg.tabId;
        chrome.tabs.sendMessage(
          targetTabId,
          { type: 'log-iframe-element', domPath: msg.domPath },
          { documentId: msg.documentId },
        ).catch(e => {
          console.debug('[Messages] log-iframe-element failed:', { tabId: targetTabId, documentId: msg.documentId, domPath: msg.domPath }, e);
          const panel = panelConnections.get(targetTabId);
          if (panel) panel.postMessage({ type: 'log-iframe-element-failed', error: e?.message ?? String(e) });
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
            tabId,
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
            tabId,
            url: frame.url,
            parentFrameId: frame.parentFrameId,
            title: '',
            origin: origin,
            iframes: []
          };
        }
      });

      const frames = await Promise.all(frameInfoPromises);

      console.debug('[Messages] hierarchy for tab', tabId, ':', frames.length, 'frames, openerInfo:', openerInfo);

      if (openerInfo) {
        const openerFrame: FrameInfo = {
          frameId: 'opener',
          url: '',
          parentFrameId: -1,
          title: '',
          origin: (openerInfo as OpenerInfo).origin || '',
          sourceId: (openerInfo as OpenerInfo).sourceId,
          iframes: [],
          isOpener: true
        };

        // Enrich opener with info from webNavigation if we know which frame opened us
        const opener = openedTabs.get(tabId);
        console.debug('[Messages] opener enrichment for tab', tabId, ':', opener ?? 'no openedTabs entry');
        if (opener) {
          openerFrame.tabId = opener.tabId;
          openerFrame.frameId = opener.frameId;
          try {
            const navFrame = await chrome.webNavigation.getFrame({ tabId: opener.tabId, frameId: opener.frameId });
            if (navFrame) {
              if (navFrame.documentId) openerFrame.documentId = navFrame.documentId;
              if (navFrame.url) {
                openerFrame.url = navFrame.url;
                if (!openerFrame.origin) {
                  try { openerFrame.origin = new URL(navFrame.url).origin; } catch { /* ignore */ }
                }
              }
            }
          } catch { /* tab may be closed */ }
          try {
            // Get title from content script in the opener frame
            const info = await chrome.tabs.sendMessage(opener.tabId,
              { type: 'get-frame-info' } as GetFrameInfoMessage,
              { frameId: opener.frameId }
            ) as FrameInfoResponse | undefined;
            if (info?.title) openerFrame.title = info.title;
          } catch { /* content script may not be injected */ }
        }

        frames.unshift(openerFrame);
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
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;

    if (message.type === 'stale-frame') {
      if (tabId == null || frameId == null) return;
      if (!staleFrames.has(tabId)) staleFrames.set(tabId, new Set());
      staleFrames.get(tabId)!.add(frameId);
      const panel = panelConnections.get(tabId);
      if (panel) panel.postMessage({ type: 'stale-frame', frameId });
      return;
    }

    if (message.type === 'content-script-ready') {
      if (tabId == null || frameId == null) return;
      const set = staleFrames.get(tabId);
      if (set?.has(frameId)) {
        set.delete(frameId);
        if (set.size === 0) staleFrames.delete(tabId);
        const panel = panelConnections.get(tabId);
        if (panel) panel.postMessage({ type: 'stale-frame-cleared', frameId });
      }
      return;
    }

    if (message.type !== 'postmessage-captured') return;
    if (!tabId || frameId === undefined) return;

    (async () => {
      const msgId = message.payload.id;
      const rawData = message.payload.data as any;
      const messageType = typeof rawData?.type === 'string' ? rawData.type : null;
      console.debug('[Messages] message received:', {
        msgId, tabId, frameId,
        sourceType: message.payload.source.type,
        sourceId: message.payload.source.sourceId,
        sourceOrigin: message.payload.source.origin,
        messageType,
        documentId: sender.documentId
      });

      const enrichedPayload: IMessage = {
        ...message.payload,
        target: {
          ...message.payload.target,
          frameId: frameId,
          tabId: tabId,
          documentId: sender.documentId
        }
      };

      // Record opened window registration data before enrichment so the
      // registration message itself can be enriched with source type 'opened'
      if (messageType === REGISTRATION_MESSAGE_TYPE
          && rawData?.targetType === 'opener'
          && message.payload.source.sourceId) {
        const key = `${tabId}:${message.payload.source.sourceId}`;
        console.debug('[Messages] opener registration:', { msgId, key, registeredTab: rawData.tabId, registeredFrame: rawData.frameId });
        openedWindowToTab.set(key, { tabId: rawData.tabId, frameId: rawData.frameId });

        // Also establish opener relationship from registration, as a fallback
        // for cases where onCreatedNavigationTarget didn't set it up (e.g.,
        // popup opened before the panel was connected).
        // frameId here is the opener's frame (where the message was received).
        recordOpenerRelationship(tabId, frameId, rawData.tabId as number);
      }

      // Detect opened-window source type from registration data
      // (content script can't determine this — background tracks it via openedWindowToTab)
      if (message.payload.source.sourceId) {
        const sourceKey = `${tabId}:${message.payload.source.sourceId}`;
        const openedWindow = openedWindowToTab.get(sourceKey);
        if (openedWindow) {
          console.debug('[Messages] source matched opened window:', { msgId, sourceKey, openedWindow });
          enrichedPayload.source = {
            ...enrichedPayload.source,
            type: 'opened',
            tabId: openedWindow.tabId,
            frameId: openedWindow.frameId
          };
        }
      }

      // For same-tab source types, set source.tabId = target.tabId
      const sourceType = enrichedPayload.source.type;
      if (sourceType === 'parent' || sourceType === 'self' || sourceType === 'top' || sourceType === 'child') {
        enrichedPayload.source = {
          ...enrichedPayload.source,
          tabId: tabId
        };
      } else if (sourceType === 'opener') {
        // Opener is in a related tab — look up its documentId via webNavigation
        const opener = openedTabs.get(tabId);
        console.debug('[Messages] opener lookup:', { msgId, tabId, result: opener ?? 'not found' });
        if (opener) {
          let openerDocumentId: string | undefined;
          try {
            const openerFrame = await chrome.webNavigation.getFrame({ tabId: opener.tabId, frameId: opener.frameId });
            openerDocumentId = openerFrame?.documentId;
          } catch {
            // Opener frame may no longer exist
          }
          enrichedPayload.source = {
            ...enrichedPayload.source,
            tabId: opener.tabId,
            frameId: opener.frameId,
            documentId: openerDocumentId
          }
        }
      }

      if (sourceType === 'self') {
        // Self messages: source and target are the same window.
        // Copy target's frameId and documentId to source.
        enrichedPayload.source = {
          ...enrichedPayload.source,
          frameId: frameId,
          documentId: sender.documentId
        };
      }

      if (sourceType === 'parent') {
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

      console.debug('[Messages] enriched source:', {
        msgId,
        type: enrichedPayload.source.type,
        tabId: enrichedPayload.source.tabId,
        frameId: enrichedPayload.source.frameId,
        documentId: enrichedPayload.source.documentId,
        sourceId: enrichedPayload.source.sourceId
      });

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

      // Cross-tab routing: forward to the source's tab panel if it's a different tab
      if (enrichedPayload.source.tabId && enrichedPayload.source.tabId !== tabId) {
        console.debug('[Messages] cross-tab routing:', { msgId, toTab: enrichedPayload.source.tabId });
        const relatedPanel = panelConnections.get(enrichedPayload.source.tabId);
        if (relatedPanel) {
          relatedPanel.postMessage({
            type: 'message',
            payload: enrichedPayload
          });
        }
      }
    })();
  });

  // Enable buffering for tabs opened from monitored tabs
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    const sourceTabId = details.sourceTabId;
    const sourceFrameId = details.sourceFrameId;
    const newTabId = details.tabId;
    console.debug('[Messages] onCreatedNavigationTarget:', { sourceTabId, sourceFrameId, newTabId, monitored: panelConnections.has(sourceTabId) || bufferingEnabledTabs.has(sourceTabId) });
    if (panelConnections.has(sourceTabId) || bufferingEnabledTabs.has(sourceTabId)) {
      bufferingEnabledTabs.add(newTabId);

      recordOpenerRelationship(sourceTabId, sourceFrameId, newTabId);
    }
  });

  // Handle navigation events
  chrome.webNavigation.onCommitted.addListener((details) => {
    const { tabId, frameId, transitionType, transitionQualifiers } = details;
    console.debug(`[Messages] onCommitted tab=${tabId} frame=${frameId} type=${transitionType} qualifiers=${transitionQualifiers.join(',')} url=${details.url}`);
    const isMonitored = panelConnections.has(tabId);
    const needsBuffering = bufferingEnabledTabs.has(tabId);

    if (isMonitored || needsBuffering) {
      if (injectedFrames.has(tabId)) {
        injectedFrames.get(tabId)!.delete(frameId);
      }
      injectContentScript(tabId, frameId);
    }

    if (frameId === 0) {
      // Top-frame navigation destroys all subframes. Clear any stale-frame
      // entries we've tracked for this tab; their orphans are gone, and
      // any surviving subframes get fresh frameIds we cannot correlate
      // with the old stale entries.
      const stale = staleFrames.get(tabId);
      if (stale && stale.size > 0) {
        const panel = panelConnections.get(tabId);
        for (const fid of stale) {
          if (panel) panel.postMessage({ type: 'stale-frame-cleared', frameId: fid });
        }
        staleFrames.delete(tabId);
      }

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
    staleFrames.delete(tabId);
    messageBuffers.delete(tabId);
    bufferingEnabledTabs.delete(tabId);
    injectedFrames.delete(tabId);

    // Clean up opener relationships
    const opener = openedTabs.get(tabId);
    if (opener) {
      // This tab was opened by opener — remove it from the opener's set
      const key = `${opener.tabId}:${opener.frameId}`;
      openerFrames.get(key)?.delete(tabId);
      if (openerFrames.get(key)?.size === 0) openerFrames.delete(key);
      openedTabs.delete(tabId);
    }
    // Also clean up any tabs this tab opened (as an opener frame)
    // Check all frames in this tab — iterate openerFrames for keys starting with tabId
    for (const [key, openedSet] of openerFrames) {
      if (key.startsWith(`${tabId}:`)) {
        for (const openedTabId of openedSet) {
          openedTabs.delete(openedTabId);
        }
        openerFrames.delete(key);
      }
    }
  });
}
