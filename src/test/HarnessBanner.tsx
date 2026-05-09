import React, { useEffect, useState } from 'react';
import gitBranch from 'virtual:git-branch';

export const HARNESS_EXAMPLES = [
  'harness.sendChildToParent({ type: "hello" })',
  'harness.sendParentToChild({ type: "hi" })',
  'harness.childWin.parent.postMessage(data, "*")',
  'harness.actions.addIframe(harness.topFrame, { url: "https://other.com/" })',
];

type Phase = 'normal' | 'reloaded';

export function HarnessBanner() {
  const [phase, setPhase] = useState<Phase>(() => {
    const harness = (window as any).harness;
    return harness?.getSimulationPhase?.() ?? 'normal';
  });

  useEffect(() => {
    const harness = (window as any).harness;
    if (!harness?.addPhaseChangeListener) return;
    return harness.addPhaseChangeListener((p: Phase) => setPhase(p));
  }, []);

  const buttonStyle: React.CSSProperties = {
    background: '#333',
    color: '#fff',
    border: '1px solid #555',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '2px 8px',
    cursor: 'pointer',
    marginLeft: 12,
  };

  const handleClick = () => {
    const harness = (window as any).harness;
    if (!harness) return;
    if (phase === 'normal') {
      harness.simulateExtensionReload();
    } else {
      harness.simulateReopenDevtools();
    }
  };

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
      Test Harness{gitBranch ? ` (${gitBranch})` : ''}
      <button
        style={buttonStyle}
        onClick={handleClick}
        data-testid="harness-simulate-reload-btn"
      >
        {phase === 'normal' ? 'Reload extension' : 'Reopen DevTools'}
      </button>
    </div>
  );
}
