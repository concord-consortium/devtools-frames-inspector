// Content script - bridges injected.js to the service worker
// Runs in Chrome's isolated world, has access to chrome.runtime

(function() {
  const EVENT_NAME = '__postmessage_devtools__';

  // Inject the script into the page's main world
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Listen for messages from the injected script
  window.addEventListener(EVENT_NAME, (event) => {
    try {
      chrome.runtime.sendMessage({
        type: 'postmessage-captured',
        payload: event.detail
      });
    } catch (e) {
      // Extension context may be invalidated, ignore
    }
  });

  // Inject immediately
  injectScript();
})();
