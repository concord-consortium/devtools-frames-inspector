// TopBar component for Messages view

import { observer } from 'mobx-react-lite';
import { store } from '../../store';
import { sendPreserveLog } from '../../connection';

export const TopBar = observer(() => {
  const handleRecordClick = () => {
    store.toggleRecording();
  };

  const handleClearClick = () => {
    store.clearMessages();
  };

  const handlePreserveLogChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked;
    store.setPreserveLog(value);
    sendPreserveLog(value);
  };

  return (
    <div className="top-bar">
      <button
        className={`icon-btn ${store.isRecording ? 'recording' : ''}`}
        title={store.isRecording ? 'Stop recording' : 'Record messages'}
        onClick={handleRecordClick}
      >
        <span className="record-icon"></span>
      </button>
      <button
        className="icon-btn"
        title="Clear"
        onClick={handleClearClick}
      >
        <span className="clear-icon"></span>
      </button>
      <div className="separator"></div>
      <label className="preserve-log-label">
        <input
          type="checkbox"
          checked={store.preserveLog}
          onChange={handlePreserveLogChange}
        />
        Preserve log
      </label>
    </div>
  );
});
