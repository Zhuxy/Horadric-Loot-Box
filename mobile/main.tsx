// Mobile entry (npm run dev:mobile / build:mobile): the real mobile UI (SPEC v1.0),
// sharing src/core and src/state with the desktop app.
//
// File flow (decided 2026-10-18): the app's own Documents folder is the
// workspace, exposed to the Files app (UIFileSharingEnabled +
// LSSupportsOpeningDocumentsInPlace); saves are copied in/out there.
// On iOS the Rust side returns Documents from detect_save_folders.
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '../src/index.css';
import './styles.css';
import { Store } from '../src/state/store';
import { StoreContext } from '../src/ui/context';
import { createDemoPlatform } from '../src/platform/demo';
import { iosPlatform } from './platform/ios';
import { MobileApp } from './ui/App';

function Boot() {
  const [store, setStore] = useState<Store | null>(null);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Real app (Tauri iOS webview): open the Documents workspace.
      try {
        const folders = await iosPlatform.detectSaveFolders();
        const f = folders[0];
        if (!f) throw new Error('empty');
        const s = new Store(iosPlatform);
        await s.openFolder(f);
        setFolder(f);
        setStore(s);
        return;
      } catch {
        // Not under Tauri (desktop browser preview): fall back to demo data.
      }
      try {
        const demo = createDemoPlatform();
        const s = new Store(demo);
        await s.openFolder('demo');
        setFolder('demo (preview)');
        setStore(s);
      } catch (e) {
        setError(`Couldn't load saves: ${(e as Error).message}`);
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="m-app">
        <div className="m-body"><div className="m-empty">{error}</div></div>
      </div>
    );
  }
  if (!store) {
    return (
      <div className="m-app">
        <div className="m-body"><div className="m-empty">载入存档中…</div></div>
      </div>
    );
  }
  return (
    <StoreContext.Provider value={store}>
      <MobileApp folder={folder} />
    </StoreContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
