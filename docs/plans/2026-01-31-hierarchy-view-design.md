# Hierarchy View Design

## Overview

Add a Hierarchy view to the panel that shows a tree of frames on the page, allowing users to understand the frame structure and see iframe elements within each frame.

## Layout

```
┌────────┬────────────────────────────────────────────────┐
│        │ [View-specific toolbar/content]                │
│  📋    │                                                │
│ Messages│                                               │
│        │   Main content area                            │
│  🌲    │   (depends on selected view)                   │
│ Hierarchy│                                              │
│        ├────────────────────────┬───────────────────────┤
│        │                        │ Detail pane           │
│        │                        │                       │
└────────┴────────────────────────┴───────────────────────┘
```

**Sidebar:** ~100px wide, full height, always visible. Contains two items with icon + text label:
- Messages (current view functionality)
- Hierarchy (new view)

**View content:** Each view manages its own toolbar area:
- Messages view: Top bar (record, clear, preserve log) + filter bar + message table
- Hierarchy view: Refresh button + frame tree-table

**No status bar.**

## Hierarchy View

### Frame Tree-Table

A table where rows represent frames, with hierarchy shown via indentation in the first column.

**Columns:**
| Column | Description |
|--------|-------------|
| Frame | Indented label: `frame[0]`, `frame[1]`, etc. |
| URL | Frame's current URL |
| Origin | Extracted origin |
| Title | Document title |
| Parent | `frame[parentFrameId]` or `-` for top |

**Tree structure:**
- Top frame (frameId 0) at root level
- Child frames indented under their parent based on `parentFrameId`

### Frame Detail Pane

When a frame row is clicked, the detail pane shows:

**Frame Properties:**
- Frame ID
- URL
- Origin
- Title
- Parent Frame ID

**Child iframes in this frame:**
List of iframe elements found in the frame's document:
- `src` attribute
- `id` attribute
- DOM path (CSS selector)

## Data Flow

**On hierarchy refresh (user clicks refresh button or switches to Hierarchy view):**

```
Panel                    Background                Content Scripts
  │                          │                          │
  │──get-frame-hierarchy────▶│                          │
  │                          │──getAllFrames()          │
  │                          │◀─frames[]                │
  │                          │                          │
  │                          │──get-frame-info─────────▶│ (to all frames)
  │                          │◀────{title, origin,      │
  │                          │      iframes[]}──────────│
  │                          │                          │
  │◀─frame-hierarchy─────────│                          │
  │  (merged frame data)     │                          │
```

**Data sources:**

| Property | Source |
|----------|--------|
| frameId | `webNavigation.getAllFrames()` |
| url | `webNavigation.getAllFrames()` |
| parentFrameId | `webNavigation.getAllFrames()` |
| title | Content script: `document.title` |
| origin | Content script: `window.location.origin` |
| iframes[] | Content script: `document.querySelectorAll('iframe')` |

**Content script response to `get-frame-info`:**
```javascript
{
  title: document.title,
  origin: window.location.origin,
  iframes: [
    { src: iframe.src, id: iframe.id, domPath: getDomPath(iframe) },
    ...
  ]
}
```

Background merges content script responses with `webNavigation` data using `sender.frameId`.

## Implementation Notes

- Fetching is on-demand only (refresh button), not live-updating
- `getDomPath()` helper already exists in `injected.js` from Phase 0 - can be reused or duplicated in content script
- View state persisted: remember which view was last selected
- Detail pane can be shared between views or separate (simpler to have separate)
