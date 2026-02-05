// Create the Frames panel in DevTools
chrome.devtools.panels.create(
  'Frames',
  null, // No icon for now
  'src/panel/panel.html',
  (panel) => {
    // Panel created successfully
  }
);
