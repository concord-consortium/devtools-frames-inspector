# Build System Design: React, MobX, TypeScript with Vite

## Overview

Add a modern build system to support React, MobX, and TypeScript for the DevTools panel, while converting all scripts to TypeScript.

## Build Tool Choice

**Vite** - chosen for:
- Fast development builds (esbuild under the hood)
- Excellent React + TypeScript support out of the box
- Simple configuration
- Good HMR support for DevTools panels

## Project Structure

```
devtools-frames-inspector/
├── src/
│   ├── panel/                  # React + TypeScript + MobX (bundled)
│   │   ├── index.tsx          # Entry point
│   │   ├── Panel.tsx          # Main component
│   │   ├── stores/            # MobX stores
│   │   ├── components/        # React components
│   │   └── panel.css
│   ├── injected.ts             # TypeScript (compiled standalone)
│   ├── content.ts              # TypeScript (compiled standalone)
│   ├── background.ts           # TypeScript (compiled standalone)
│   └── devtools.ts             # TypeScript (compiled standalone)
├── dist/                       # Built extension (gitignored)
│   ├── panel/
│   │   ├── index.html
│   │   └── panel.js
│   ├── injected.js
│   ├── content.js
│   ├── background.js
│   ├── devtools.js
│   ├── manifest.json
│   └── ...
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Entry Points

Vite handles multiple entry points:
- **panel/index.tsx** → Bundled with React, MobX, and dependencies
- **injected.ts, content.ts, background.ts, devtools.ts** → Compiled to standalone JS files (no library bundling)

## Development Workflow

### Commands

```bash
npm run dev      # Start Vite dev server with HMR for panel
npm run build    # Production build to dist/
npm run watch    # Watch mode for non-panel scripts
```

### HMR for DevTools Panel

1. `npm run dev` starts Vite on `localhost:5173`
2. In development, panel HTML points to the dev server
3. React component edits hot-reload in the open DevTools panel
4. No extension reload needed for panel changes

### Non-Panel Scripts

Scripts running in other contexts (page, content script, service worker) don't support HMR:
- `npm run watch` recompiles on save
- Manual extension reload at `chrome://extensions` after changes

### Typical Session

1. Run `npm run dev` (and optionally `npm run watch`)
2. Load `dist/` as unpacked extension
3. Edit panel code → instant HMR updates
4. Edit background/content/injected → reload extension

## Dependencies

```json
{
  "devDependencies": {
    "vite": "^5.x",
    "typescript": "^5.x",
    "@types/chrome": "^0.0.x",
    "@vitejs/plugin-react": "^4.x"
  },
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "mobx": "^6.x",
    "mobx-react-lite": "^4.x"
  }
}
```

## TypeScript Configuration

- `"jsx": "react-jsx"` for React 18 JSX transform
- `"strict": true` for full type checking
- Chrome extension types via `@types/chrome`
- Target ES2020+ (Chrome supports modern JS)

## Migration Strategy

### Phase 1: Build System Setup

Mechanical changes, no functionality changes:

1. Initialize npm project with dependencies
2. Create Vite and TypeScript configuration
3. Rename `.js` → `.ts` for non-panel scripts
4. Add minimal type annotations to fix errors
5. Create React entry point that wraps existing panel.js
6. Verify extension works exactly as before

### Phase 2: Incremental Panel Rewrite

Convert panel piece by piece:

1. Create MobX store with existing state shape
2. Convert one component at a time (start with message table)
3. Keep old DOM code working alongside React during transition
4. Remove old code as React components replace functionality

This avoids big-bang rewrite - extension stays functional throughout.
