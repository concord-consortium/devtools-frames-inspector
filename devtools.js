// Create the PostMessage panel in DevTools
chrome.devtools.panels.create(
  'PostMessage',
  null, // No icon for now
  'panel.html',
  (panel) => {
    // Panel created successfully
  }
);
