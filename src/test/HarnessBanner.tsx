import React from 'react';

export const HARNESS_EXAMPLES = [
  'harness.sendChildToParent({ type: "hello" })',
  'harness.sendParentToChild({ type: "hi" })',
  'harness.childWin.parent.postMessage(data, "*")',
  'harness.topFrame.addIframe({ url: "https://other.com/" })',
];

export function HarnessBanner() {
  return (
    <div style={{
      background: '#1e1e1e',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: 13,
      padding: '6px 0',
      textAlign: 'center',
      borderBottom: '1px solid #333',
    }}>
      Test Harness
    </div>
  );
}
