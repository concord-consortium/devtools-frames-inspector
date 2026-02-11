import React from 'react';

export const HARNESS_EXAMPLES = [
  'harness.sendChildToParent({ type: "hello" })',
  'harness.sendParentToChild({ type: "hi" })',
  'harness.childWin.parent.postMessage(data, "*")',
  'harness.topFrame.addIframe({ url: "https://other.com/" })',
];

export function HarnessSidebar() {
  return (
    <div style={{
      width: 280,
      minWidth: 280,
      background: '#1e1e1e',
      color: '#ccc',
      fontFamily: 'monospace',
      fontSize: 12,
      padding: 12,
      overflowY: 'auto',
      borderRight: '1px solid #333',
      boxSizing: 'border-box',
    }}>
      <h2 style={{ margin: '0 0 10px', fontSize: 13, color: '#fff' }}>
        Test Harness
      </h2>
      <p style={{ margin: '0 0 8px', color: '#6a9955', fontStyle: 'italic' }}>
        Use <code style={{ color: '#9cdcfe' }}>window.harness</code> to interact:
      </p>
      {HARNESS_EXAMPLES.map((example, i) => (
        <code key={i} style={{
          display: 'block',
          padding: '3px 6px',
          margin: '2px 0',
          background: '#2a2a2a',
          borderRadius: 3,
          color: '#9cdcfe',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {example}
        </code>
      ))}
    </div>
  );
}
