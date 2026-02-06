// Root App component for Frames Inspector panel

import { observer } from 'mobx-react-lite';
import { store } from '../store';
import { ViewType } from '../types';
import { MessagesView } from './MessagesView';
import { HierarchyView } from './HierarchyView';
import { FieldInfoPopup } from './shared/FieldInfoPopup';

interface SidebarItemProps {
  view: ViewType;
  icon: string;
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
    <SidebarItem view="messages" icon="📋" label="Messages" />
    <SidebarItem view="hierarchy" icon="🌲" label="Hierarchy" />
    <SidebarItem view="settings" icon="⚙️" label="Settings" />
  </div>
);

const SettingsView = observer(() => (
  <div className={`view settings-view ${store.currentView === 'settings' ? 'active' : ''}`}>
    <div className="settings-content">
      <h3>Settings</h3>
      <label className="settings-item">
        <input
          type="checkbox"
          checked={store.settings.showExtraMessageInfo}
          onChange={(e) => store.updateSettings({ showExtraMessageInfo: e.target.checked })}
        />
        Show extra message info (message ID and buffered status)
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
    </div>
  </div>
));

export const App = observer(() => (
  <>
    <Sidebar />
    <div className="view-container">
      <MessagesView />
      <HierarchyView />
      <SettingsView />
    </div>
    <FieldInfoPopup />
  </>
));
