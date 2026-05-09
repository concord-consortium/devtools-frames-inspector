import { observer } from 'mobx-react-lite';
import { store } from '../../store';

export const Banners = observer(() => {
  const showReloadDevtools = store.extensionContextInvalidated;
  const showPageReload = store.hasStaleFrames;
  if (!showReloadDevtools && !showPageReload) return null;

  return (
    <div className="banners">
      {showReloadDevtools && (
        <div className="banner banner-error" role="status">
          The Messages Inspector extension was reloaded. Close and reopen DevTools to continue capturing.
        </div>
      )}
      {showPageReload && (
        <div className="banner banner-warning" role="status">
          This page has stale content scripts from a previous extension version. Reload the page to resume capturing.
        </div>
      )}
    </div>
  );
});
