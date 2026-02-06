// Hierarchy view component

import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { store } from '../../store';
import { requestFrameHierarchy } from '../../connection';
import { FrameInfo } from '../../types';

// Frame row component
const FrameRow = observer(({ frame, depth }: { frame: FrameInfo; depth: number }) => {
  const isSelected = frame.frameId === store.selectedFrameId;

  const handleClick = () => {
    store.selectFrame(frame.frameId);
  };

  const indentClass = `frame-indent-${Math.min(depth, 4)}`;

  return (
    <>
      <tr
        data-frame-id={String(frame.frameId)}
        className={isSelected ? 'selected' : ''}
        onClick={handleClick}
      >
        <td className={indentClass} style={frame.isOpener ? { fontStyle: 'italic' } : undefined}>
          {frame.isOpener ? 'opener' : `frame[${frame.frameId}]`}
        </td>
        <td>{frame.url}</td>
        <td>{frame.origin}</td>
        <td>{frame.title}</td>
        <td>{frame.parentFrameId === -1 ? '-' : `frame[${frame.parentFrameId}]`}</td>
      </tr>
      {frame.children?.map(child => (
        <FrameRow key={String(child.frameId)} frame={child} depth={depth + 1} />
      ))}
    </>
  );
});

// Frame table component
const FrameTable = observer(() => {
  const frameTree = store.buildFrameTree();

  return (
    <div className="table-pane">
      <table id="frame-table">
        <thead>
          <tr>
            <th>Frame</th>
            <th>URL</th>
            <th>Origin</th>
            <th>Title</th>
            <th>Parent</th>
          </tr>
        </thead>
        <tbody>
          {frameTree.map(frame => (
            <FrameRow key={String(frame.frameId)} frame={frame} depth={0} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

// Frame detail pane
const FrameDetailPane = observer(() => {
  const frame = store.selectedFrame;

  const handleClose = () => {
    store.selectFrame(null);
  };

  if (!frame) {
    return (
      <div className="detail-pane hidden">
        <div className="detail-tabs">
          <span className="detail-title">Frame Details</span>
          <button className="close-detail-btn" title="Close">×</button>
        </div>
        <div className="tab-content">
          <div className="placeholder">Select a frame to view details</div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-pane">
      <div className="detail-tabs">
        <span className="detail-title">Frame Details</span>
        <button className="close-detail-btn" title="Close" onClick={handleClose}>×</button>
      </div>
      <div className="tab-content">
        <div className="frame-properties">
          <table className="context-table">
            <tbody>
              <tr><th>Frame ID</th><td>{frame.frameId}</td></tr>
              <tr><th>URL</th><td>{frame.url}</td></tr>
              <tr><th>Origin</th><td>{frame.origin}</td></tr>
              <tr><th>Title</th><td>{frame.title || '(none)'}</td></tr>
              <tr><th>Parent</th><td>{frame.parentFrameId === -1 ? '-' : `frame[${frame.parentFrameId}]`}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="frame-iframes">
          <h4>Child iframes ({frame.iframes.length})</h4>
          {frame.iframes.length === 0 ? (
            <p className="placeholder">No iframes in this frame</p>
          ) : (
            frame.iframes.map((iframe, index) => (
              <div key={index} className="iframe-item">
                <div><strong>src:</strong> {iframe.src || '(empty)'}</div>
                <div><strong>id:</strong> {iframe.id || '(none)'}</div>
                <div><strong>path:</strong> {iframe.domPath}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

// Pane resize handle
const ResizeHandle = () => {
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const container = document.querySelector('#hierarchy-view .main-content') as HTMLElement;
      if (!container) return;

      const containerWidth = container.offsetWidth;
      const newDetailWidth = containerWidth - e.clientX;
      const pct = Math.max(20, Math.min(70, (newDetailWidth / containerWidth) * 100));

      const detailPane = container.querySelector('.detail-pane') as HTMLElement;
      if (detailPane) {
        detailPane.style.width = pct + '%';
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = '';
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div
      className="resize-handle"
      onMouseDown={handleMouseDown}
    />
  );
};

// Top bar for hierarchy view
const HierarchyTopBar = () => {
  const handleRefresh = () => {
    requestFrameHierarchy();
  };

  return (
    <div className="top-bar">
      <button className="icon-btn" title="Refresh" onClick={handleRefresh}>
        <span className="refresh-icon"></span>
      </button>
    </div>
  );
};

// Main HierarchyView component
export const HierarchyView = observer(() => {
  const isActive = store.currentView === 'hierarchy';

  // Request hierarchy when view becomes active
  useEffect(() => {
    if (isActive) {
      requestFrameHierarchy();
    }
  }, [isActive]);

  return (
    <div id="hierarchy-view" className={`view hierarchy-view ${isActive ? 'active' : ''}`}>
      <HierarchyTopBar />
      <div className="main-content">
        <FrameTable />
        <ResizeHandle />
        <FrameDetailPane />
      </div>
    </div>
  );
});
