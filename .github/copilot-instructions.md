# PostMessage DevTools Extension

This is a Chrome DevTools extension that exposes postMessage messages similar to how the Network tab shows network requests.

## Project Structure

- `manifest.json` - Chrome extension manifest (Manifest V3)
- `devtools.html` - DevTools page entry point
- `devtools.js` - DevTools panel initialization
- `panel.html` - The PostMessage panel UI
- `panel.js` - Panel logic for displaying messages
- `content.js` - Content script to intercept postMessage calls

## Development

1. Load the extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project folder

2. Open DevTools on any page to see the PostMessage panel

## Architecture

The extension uses:
- A content script to intercept `window.postMessage` calls
- A DevTools panel to display intercepted messages
- Chrome extension messaging to communicate between content script and panel
