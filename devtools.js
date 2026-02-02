// Create the Frames panel in DevTools
chrome.devtools.panels.create(
  'Frames',
  null, // No icon for now
  'panel.html',
  (panel) => {
    // Panel created successfully
  }
);
