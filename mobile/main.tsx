// Mobile entry (npm run dev:mobile / build:mobile): the real mobile UI (SPEC v2.0),
// sharing src/core and src/state with the desktop app.
//
// The iOS workspace is Documents/save. It is exposed in Files and the Settings tab
// imports/exports complete save folders through the native document picker.
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '../src/index.css';
import './styles.css';
import type { Store } from '../src/state/store';
import { StoreContext } from '../src/ui/context';
import { createDemoPlatform } from '../src/platform/demo';
import { iosPlatform } from './platform/ios';
import { isTauri } from '../src/platform/tauri';
import { invoke } from '@tauri-apps/api/core';
import { MobileApp } from './ui/App';
import { MobileStore, scheduleSave } from './ui/mobileStore';

function Boot() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Real app (Tauri iOS webview): open Documents/save.
      try {
        const folders = await iosPlatform.detectSaveFolders();
        const f = folders[0];
        if (!f) throw new Error('empty');
        const s = new MobileStore(iosPlatform);
        await s.openFolder(f);
        const artFolder = await invoke<string | null>('ios_art_folder');
        if (artFolder) await s.loadArt(artFolder);
        setStore(s);
        scheduleSave(s);
        return;
      } catch (e) {
        if (isTauri()) {
          setError(`无法打开存档目录：${String(e)}`);
          return;
        }
        // Desktop browser preview: fall back to demo data.
      }
      try {
        const demo = createDemoPlatform();
        const s = new MobileStore(demo);
        await s.openFolder('demo');
        if (demo.art) await s.loadArt('demo');
        setStore(s);
        scheduleSave(s);
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
      <MobileApp />
    </StoreContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
