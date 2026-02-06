// Messages view component

import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { store } from '../../store';
import { TopBar } from './TopBar';
import { FilterBar } from './FilterBar';
import { MessageTable } from './MessageTable';
import { DetailPane } from './DetailPane';

// Pane resize handle component
const ResizeHandle = () => {
  const [isResizing, setIsResizing] = useState(false);
  const detailPaneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const container = document.querySelector('.main-content') as HTMLElement;
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

export const MessagesView = observer(() => {
  const isActive = store.currentView === 'messages';

  return (
    <div className={`view messages-view ${isActive ? 'active' : ''}`}>
      <TopBar />
      <FilterBar />
      <div className="main-content">
        <MessageTable />
        <ResizeHandle />
        <DetailPane />
      </div>
    </div>
  );
});
