# Field Info Popups Design

## Overview

Add hover-triggered info popups to field names in the message context pane, with documentation that can be used both in the UI and to generate markdown reference docs.

## Data Structure

Field documentation stored in `FIELD_INFO` object using existing field IDs as keys:

```javascript
const FIELD_INFO = {
  targetUrl: {
    label: 'Target URL',
    description: 'The full URL of the window that received this message.',
    technical: 'Obtained from window.location.href of the receiving frame.',
    filter: null
  },
  sourceOrigin: {
    label: 'Source Origin',
    description: 'The origin of the window that sent this message.',
    technical: 'Obtained from MessageEvent.origin. May be "null" for data: or file: URLs.',
    filter: 'source:example.com'
  },
  // ... other fields
};
```

## Popup Behavior

- **Trigger:** Hover on field name (`<th>` element in context table)
- **Delay:** ~200ms before popup appears (prevents accidental triggers)
- **Positioning:** Below the field name, right edge aligned with field name's right edge, no gap between label and popup
- **Persistence:** Stays visible while mouse is over field name OR over the popup itself; disappears immediately when mouse leaves both
- **Overflow:** Popup can extend outside the context pane boundaries

## Popup Styling

Card style matching Elements pane CSS property tooltips:

- White background
- Black text
- Rounded corners (~4px)
- Thin gray outline (~1px solid #ccc)
- Subtle shadow (e.g., `0 2px 8px rgba(0,0,0,0.15)`)
- Max-width ~300px

## Popup Content Layout

Three sections separated by paragraph spacing (~8-12px), no dividers:

1. **Description** - Normal text explaining what the field means
2. **Technical details** - Slightly smaller or muted color text explaining how value is obtained and limitations
3. **Filter syntax** - `Filter:` label with monospace value (only shown if field has filter syntax)

Sections only rendered if they have content.

## Markdown Generation

Script at `scripts/generate-field-docs.js` iterates `FIELD_INFO` to generate `docs/message-fields.md`:

```markdown
# Message Field Reference

## Target URL

The full URL of the window that received this message.

Obtained from window.location.href of the receiving frame.

---

## Source Origin

The origin of the window that sent this message.

Obtained from MessageEvent.origin. May be "null" for data: or file: URLs.

**Filter:** `source:example.com`

---
```

## Implementation Notes

- `FIELD_INFO` defined in separate `field-info.js` file, loaded by `panel.html`
- `renderContextTab()` uses `FIELD_INFO[fieldId].label` for display instead of hardcoded strings (single source of truth)
- `renderContextTab()` updated to make field names hoverable and manage popup lifecycle
- Popup element can be a single reusable DOM element that gets repositioned and content-updated on hover
- Use `mouseenter`/`mouseleave` events with timeout management for the 200ms delay
