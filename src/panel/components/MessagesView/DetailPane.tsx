// Detail pane component for Messages view

import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { store } from '../../store';
import { CapturedMessage } from '../../types';
import { FIELD_INFO } from '../../field-info';
import { JsonTree } from '../shared/JsonTree';
import { FieldLabel } from '../shared/FieldInfoPopup';

// Data tab content
const DataTab = observer(({ message }: { message: CapturedMessage }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(message.data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <button className="copy-btn" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy JSON'}
      </button>
      <JsonTree data={message.data} />
    </>
  );
});

// Context tab content
const ContextTab = observer(({ message }: { message: CapturedMessage }) => {
  const sourceType = message.source?.type || 'unknown';

  // Build rows
  type Row = [string | null, string | null];
  const rows: Row[] = [];

  if (store.settings.showExtraMessageInfo) {
    rows.push(['messageId', message.id]);
  }

  rows.push(
    ['timestamp', new Date(message.timestamp).toISOString()],
    ['messageType', message.messageType || '(none)'],
    ['dataSize', store.formatSize(message.dataSize)]
  );

  if (store.settings.showExtraMessageInfo) {
    rows.push(['buffered', message.buffered ? 'Yes' : 'No']);
    if (message.source?.windowId) {
      rows.push(['windowId', message.source.windowId]);
    }
  }

  rows.push(
    [null, null], // separator
    ['targetUrl', message.target.url],
    ['targetOrigin', message.target.origin],
    ['targetTitle', message.target.documentTitle || '(none)'],
    ['targetFrame', message.target.frameId !== undefined ? `frame[${message.target.frameId}]` : '(unknown)']
  );

  if (message.target.frameInfoError) {
    rows.push(['targetFrameError', message.target.frameInfoError]);
  }

  rows.push(
    [null, null], // separator
    ['sourceType', `${store.getDirectionIcon(sourceType)} ${sourceType}`],
    ['sourceOrigin', message.source?.origin || '(unknown)']
  );

  // Get source frame info
  let sourceFrameId = message.source?.frameId;
  let sourceTabId: number | undefined = undefined;
  if (message.source?.windowId) {
    const registration = store.windowFrameMap.get(message.source.windowId);
    if (registration) {
      if (sourceFrameId === undefined) {
        sourceFrameId = registration.frameId;
      }
      sourceTabId = registration.tabId;
    }
  }
  if (sourceFrameId !== undefined) {
    rows.push(['sourceFrame', `frame[${sourceFrameId}]`]);
  }
  if (sourceTabId !== undefined) {
    rows.push(['sourceTab', `tab[${sourceTabId}]`]);
  }

  // Child-specific fields
  if (sourceType === 'child') {
    if (message.source?.iframeSrc) {
      rows.push(['sourceIframeSrc', message.source.iframeSrc]);
    }
    if (message.source?.iframeId) {
      rows.push(['sourceIframeId', message.source.iframeId]);
    }
    if (message.source?.iframeDomPath) {
      rows.push(['sourceIframeDomPath', message.source.iframeDomPath]);
    }
  }

  return (
    <table className="context-table">
      <tbody>
        {rows.map(([fieldId, value], index) => {
          if (fieldId === null && value === null) {
            return (
              <tr key={index}>
                <td colSpan={2} className="context-separator"></td>
              </tr>
            );
          }

          const fieldInfo = fieldId ? FIELD_INFO[fieldId] : undefined;
          const label = fieldInfo ? fieldInfo.label : fieldId || '';

          return (
            <tr key={index}>
              <th>
                {fieldInfo && fieldId ? (
                  <FieldLabel fieldId={fieldId} label={label} />
                ) : (
                  label
                )}
              </th>
              <td>{value}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

// Main DetailPane component
export const DetailPane = observer(() => {
  const message = store.selectedMessage;
  const isVisible = !!message;

  const handleClose = () => {
    store.selectMessage(null);
  };

  const handleTabClick = (tab: 'data' | 'context') => {
    store.setActiveDetailTab(tab);
  };

  if (!isVisible) {
    return (
      <div className="detail-pane hidden">
        <div className="detail-tabs">
          <button className="tab-btn active">Data</button>
          <button className="tab-btn">Context</button>
          <button className="close-detail-btn" title="Close">×</button>
        </div>
        <div className="tab-content">
          <div className="placeholder">Select a message to view details</div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-pane">
      <div className="detail-tabs">
        <button
          className={`tab-btn ${store.activeDetailTab === 'data' ? 'active' : ''}`}
          onClick={() => handleTabClick('data')}
        >
          Data
        </button>
        <button
          className={`tab-btn ${store.activeDetailTab === 'context' ? 'active' : ''}`}
          onClick={() => handleTabClick('context')}
        >
          Context
        </button>
        <button className="close-detail-btn" title="Close" onClick={handleClose}>
          ×
        </button>
      </div>
      <div className="tab-content">
        {store.activeDetailTab === 'data' ? (
          <DataTab message={message} />
        ) : (
          <ContextTab message={message} />
        )}
      </div>
    </div>
  );
});
