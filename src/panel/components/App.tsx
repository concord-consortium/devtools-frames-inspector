// Root App component for Frames Inspector panel

import { observer } from 'mobx-react-lite';
import { store } from '../store';
import { ViewType } from '../types';
import { LogView } from './LogView';
import { EndpointsView } from './EndpointsView';
import { FieldInfoPopup } from './shared/FieldInfoPopup';
import { Icon } from '../icons/Icon';
import { EndpointsIcon } from '../icons/EndpointsIcon';
import { Banners } from './shared/Banners';

interface SidebarItemProps {
  view: ViewType;
  icon: React.ReactNode;
  label: string;
}

const SidebarItem = observer(({ view, icon, label }: SidebarItemProps) => {
  const isActive = store.currentView === view;

  return (
    <div
      className={`sidebar-item ${isActive ? 'active' : ''}`}
      onClick={() => store.setCurrentView(view)}
    >
      <span className="sidebar-icon">{icon}</span>
      <span className="sidebar-label">{label}</span>
    </div>
  );
});

const Sidebar = () => (
  <div className="sidebar">
    <SidebarItem view="log" icon={<Icon name="viewList" size={20} />} label="Log" />
    <SidebarItem view="endpoints" icon={<EndpointsIcon />} label="Endpoints" />
    <SidebarItem view="settings" icon={<Icon name="settings" size={20} />} label="Settings" />
  </div>
);

const SettingsView = observer(() => (
  <div className={`view settings-view ${store.currentView === 'settings' ? 'active' : ''}`}>
    <div className="settings-content">
      <h3>Settings</h3>
      <label className="settings-item">
        <input
          type="checkbox"
          checked={store.settings.showInternalFields}
          onChange={(e) => store.updateSettings({ showInternalFields: e.target.checked })}
        />
        Show internal fields
      </label>
      <label className="settings-item">
        <input
          type="checkbox"
          checked={store.settings.enableFrameRegistration}
          onChange={(e) => {
            store.updateSettings({ enableFrameRegistration: e.target.checked });
            chrome.storage.local.set({ enableFrameRegistration: e.target.checked });
          }}
        />
        Enable frame registration (identifies source frame for child/opener messages)
      </label>
      <label className="settings-item nested">
        <input
          type="checkbox"
          checked={store.settings.showRegistrationMessages}
          disabled={!store.settings.enableFrameRegistration}
          onChange={(e) => store.updateSettings({ showRegistrationMessages: e.target.checked })}
        />
        Show registration messages in table
      </label>
      <label className="settings-item nested">
        Registration delay (ms):
        <input
          type="number"
          min={0}
          step={10}
          value={store.settings.registrationDelayMs}
          disabled={!store.settings.enableFrameRegistration}
          onChange={(e) => {
            const value = Math.max(0, parseInt(e.target.value, 10) || 0);
            store.updateSettings({ registrationDelayMs: value });
            chrome.storage.local.set({ registrationDelayMs: value });
          }}
          style={{ width: '60px', marginLeft: '6px' }}
        />
      </label>
      <div className="settings-section">
        <h4>Global Filter</h4>
        <p className="settings-description">
          Always applied across all panel instances. Uses the same filter syntax as the toolbar.
        </p>
        <label className="settings-item">
          <input
            type="checkbox"
            checked={store.settings.globalFilterEnabled}
            onChange={(e) => store.updateSettings({ globalFilterEnabled: e.target.checked })}
          />
          Enable global filter
        </label>
        <div className="settings-filter-row">
          <input
            type="text"
            className="settings-filter-input"
            placeholder="e.g., -data.source:react-devtools*"
            value={store.settings.globalFilter}
            disabled={!store.settings.globalFilterEnabled}
            onChange={(e) => store.updateSettings({ globalFilter: e.target.value })}
          />
        </div>
      </div>
    </div>
  </div>
));

export const App = observer(() => (
  <div className="app-root">
    <Banners />
    <div className="app-body">
      <Sidebar />
      <div className="view-container">
        <LogView />
        <EndpointsView />
        <SettingsView />
      </div>
    </div>
    <FieldInfoPopup />
  </div>
));
