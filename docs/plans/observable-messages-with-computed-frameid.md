# Plan: Make Messages Observable with Computed FrameId

## Problem Statement

When a message arrives from a child frame before that frame's registration message, the `source.frameId` is initially undefined. Once the registration arrives, the `windowFrameMap` is updated with the frameId, but existing table rows don't re-render because:

1. `windowFrameMap` is a plain JS `Map` (not `observable.map()`), so reads aren't tracked
2. Messages are plain objects, so computed properties can't be reactive

## Goal

Make messages reactive so that when new information becomes available (like frameId from a later registration), views automatically update.

## Proposed Approach: Observable Message Class with Computed Properties

Create a `Message` class that implements an `IMessage` interface and provides a computed `frameId` property. This avoids iterating through thousands of messages on every registration.

### Design

#### IMessage Interface

First, convert `CapturedMessage` type to an interface that can be used by content/background scripts:

```typescript
// In src/types.ts
interface IMessage {
  id: string;
  timestamp: number;
  target: {
    url: string;
    origin: string;
    documentTitle: string;
    frameId: number;
    frameInfoError?: string;
  };
  source: {
    type: string;
    origin: string;
    windowId: string | null;
    iframeSrc: string | null;
    iframeId: string | null;
    iframeDomPath: string | null;
    frameId?: number;  // Computed for child messages
    frameInfoError?: string;
  } | null;
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
  buffered?: boolean;
}
```

#### WindowFrameRegistry Singleton

```typescript
// In src/panel/WindowFrameRegistry.ts
import { observable } from 'mobx';
import { WindowFrameRegistration } from './types';

class WindowFrameRegistry {
  frameMap = observable.map<string, WindowFrameRegistration>();

  register(windowId: string, registration: WindowFrameRegistration): void {
    this.frameMap.set(windowId, registration);
  }

  get(windowId: string): WindowFrameRegistration | undefined {
    return this.frameMap.get(windowId);
  }
}

// Export singleton instance
export const windowFrameRegistry = new WindowFrameRegistry();
```

#### Message Class

```typescript
// In src/panel/Message.ts
import { makeAutoObservable, observable } from 'mobx';
import { windowFrameRegistry } from './WindowFrameRegistry';
import { IMessage } from '../types';

class Message implements IMessage {
  // Store all IMessage properties directly
  id: string;
  timestamp: number;
  target: IMessage['target'];
  data: unknown;
  dataPreview: string;
  dataSize: number;
  messageType: string | null;
  buffered?: boolean;

  // Store source separately to override frameId with computed value
  private _source: IMessage['source'];

  constructor(msg: IMessage) {
    // Copy all properties directly
    this.id = msg.id;
    this.timestamp = msg.timestamp;
    this.target = msg.target;
    this.data = msg.data;
    this.dataPreview = msg.dataPreview;
    this.dataSize = msg.dataSize;
    this.messageType = msg.messageType;
    this.buffered = msg.buffered;
    this._source = msg.source;

    makeAutoObservable(this, {
      _source: observable.ref, // Source object itself is not deeply observable
      target: observable.ref, // Target object itself is not deeply observable
      data: observable.ref // Data is not deeply observable
    });
  }

  // Check if this is a registration message (cached getter)
  get isRegistrationMessage(): boolean {
    return (this.data as { type?: string })?.type === '__frames_inspector_register__';
  }

  // Get registration data (cached getter, only valid if isRegistrationMessage is true)
  get registrationData(): { frameId: number; tabId: number } | null {
    if (!this.isRegistrationMessage) return null;
    const data = this.data as { frameId: number; tabId: number };
    return { frameId: data.frameId, tabId: data.tabId };
  }

  // Source with computed frameId
  get source(): IMessage['source'] {
    if (!this._source) return this._source;

    return {
      ...this._source,
      frameId: this.computedFrameId
    };
  }

  // Computed frameId - automatically updates when windowFrameRegistry changes
  private get computedFrameId(): number | undefined {
    // If message has native frameId (e.g., parent messages), use it
    if (this._source?.frameId !== undefined) {
      return this._source.frameId;
    }

    // Otherwise, look up from registration map (e.g., child messages)
    if (this._source?.windowId) {
      const registration = windowFrameRegistry.get(this._source.windowId);
      if (registration) {
        return registration.frameId;
      }
    }

    return undefined;
  }
}

export { Message };
```

### Changes

#### 1. Create IMessage interface (`types.ts`)

Convert the existing `CapturedMessage` type to an `IMessage` interface.

#### 2. Create WindowFrameRegistry singleton (`panel/WindowFrameRegistry.ts`)

Add the WindowFrameRegistry class shown above. This breaks the circular dependency between Store and Message.

#### 3. Add Message class (`panel/Message.ts`)

Add the Message class shown above with:
- `isRegistrationMessage` computed getter (cached, moved from Store)
- `registrationData` computed getter (cached)
- Computed `frameId` via `source` getter that accesses `windowFrameRegistry` directly

#### 4. Update Store (`store.ts`)

```typescript
import { Message } from './Message';
import { windowFrameRegistry } from './WindowFrameRegistry';

class PanelStore {
  // Change from:
  messages: CapturedMessage[] = [];
  windowFrameMap = new Map<string, WindowFrameRegistration>();

  // To:
  messages: Message[] = [];
  // windowFrameMap removed - now using windowFrameRegistry singleton

  // Update addMessage
  addMessage(msg: IMessage): void {
    if (!this.isRecording) return;

    // Create Message instance first
    const message = new Message(msg);

    // Handle registration messages
    if (message.isRegistrationMessage && message.source?.windowId) {
      const regData = message.registrationData;
      if (regData) {
        windowFrameRegistry.register(message.source.windowId, {
          frameId: regData.frameId,
          tabId: regData.tabId,
          ownerDomPath: message.source.iframeDomPath || undefined,
          ownerSrc: message.source.iframeSrc || undefined,
          ownerId: message.source.iframeId || undefined
        });
      }
    }

    this.messages.push(message);
  }

  // Remove isRegistrationMessage method - now on Message class
}
```

#### 5. Update getOwnerInfo to use windowFrameRegistry (`store.ts`)

```typescript
getOwnerInfo(frameId: number | string): WindowFrameRegistration | undefined {
  for (const reg of windowFrameRegistry.frameMap.values()) {
    if (reg.frameId === frameId && reg.tabId === this.tabId) {
      return reg;
    }
  }
  return undefined;
}
```

#### 6. Update getCellValue sourceFrameId case (`store.ts`)

```typescript
case 'sourceFrameId': {
  const frameId = msg.source?.frameId;
  return frameId !== undefined ? `frame[${frameId}]` : '';
}
```

The lookup fallback is no longer needed since `message.source.frameId` is now computed.

#### 7. Update matchesTerm frame filter to use windowFrameRegistry (`store.ts`)

```typescript
case 'frame': {
  // ... existing code ...
  if (msg.source?.windowId) {
    const registration = windowFrameRegistry.get(msg.source.windowId);
    // ... rest of logic
  }
}
```

#### 8. Update type signatures throughout codebase

- Content/background scripts: Use `IMessage` interface
- Panel code: Use `Message` class where messages are stored/displayed

### Files to Modify

| File | Changes |
|------|---------|
| `src/types.ts` | Convert `CapturedMessage` type to `IMessage` interface |
| `src/panel/WindowFrameRegistry.ts` (new) | Add `WindowFrameRegistry` singleton class |
| `src/panel/Message.ts` (new) | Add `Message` class that implements `IMessage` |
| `src/panel/store.ts` | Import `Message` and `windowFrameRegistry`, remove `windowFrameMap`, update `messages` type to `Message[]`, update `addMessage`, remove `isRegistrationMessage`, update `getOwnerInfo` and filter logic |
| `src/content.ts` | Update type imports to use `IMessage` (should be minimal changes) |
| `src/background.ts` | Update type imports to use `IMessage` (should be minimal changes) |

### Benefits

1. **Automatic UI updates**: When registration arrives, map update triggers re-computation of `computedFrameId`, which triggers re-render of affected rows
2. **Lazy evaluation**: FrameId is only computed when accessed (during render), not on every registration
3. **Scalable**: No need to iterate through thousands of messages - MobX handles dependency tracking
4. **Clean separation**: Raw message data stays immutable, computed properties are reactive
5. **Future extensibility**: Other computed properties can be added the same way

### How MobX Makes This Efficient

1. When a row renders, it accesses `message.source.frameId`
2. This calls the `source` getter, which calls `computedFrameId`
3. MobX tracks that this computation depends on `windowFrameRegistry.frameMap.get(windowId)`
4. When a new registration updates the registry, MobX knows which computeds depend on that key
5. Only the affected computeds (and their dependent components) re-render

### Considerations

- **No circular dependency**: `WindowFrameRegistry` singleton breaks the circular dependency between `Store` and `Message`
- **Type compatibility**: `Message` implements `IMessage`, so it's compatible with existing code that expects message objects
- **Memory overhead**: `Message` instances store properties directly (not wrapped), with only computed properties adding overhead
- **Clean design**: Properties are stored directly on the class, avoiding the need for pass-through getters for every property
- **Interface vs Type**: Converting to an interface allows the `Message` class to implement it while content/background scripts just use the interface
- **Message-centric logic**: `isRegistrationMessage()` now lives on the `Message` class where it belongs

## Verification

1. Build the extension: `npm run build`
2. Load in Chrome and open test page with cross-origin iframes
3. Test scenario:
   - Ensure child iframe sends messages before its registration
   - Verify the sourceFrameId column is initially blank for those messages
   - After registration arrives, verify the column updates automatically
   - Use React DevTools to verify only affected rows re-render
4. Performance test:
   - Generate many messages (1000+)
   - Add registrations and verify no performance degradation
   - Verify MobX is lazily computing frameIds (not pre-computing all)
5. Verify existing functionality:
   - Filtering by `frame:frame[N]`
   - Detail pane shows correct frame info
   - Registration messages work correctly

## Alternative Considered: Direct Updates

An alternative would be to directly update `source.frameId` on messages when registration arrives. This was rejected because:
- Requires iterating through all messages on every registration (O(n) per registration)
- With thousands of messages, this becomes expensive
- The computed approach is O(1) per registration, with lazy evaluation
