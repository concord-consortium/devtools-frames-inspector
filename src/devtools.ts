// Create the Frames panel in DevTools
chrome.devtools.panels.create(
  'Frames',
  '', // No icon for now
  'panel/index.html',
  (_panel) => {
    // Panel created successfully
  }
);
