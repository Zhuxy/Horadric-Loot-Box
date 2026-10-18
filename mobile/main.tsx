// Mobile entry (npm run dev:mobile / build:mobile): a second Vite root sharing
// src/core and src/state with the desktop app. The mobile UI itself is designed
// later; this shell only proves the entry, the build pipeline and core sharing.
//
// File flow (decided 2026-10-18): the app's own Documents folder is the
// workspace, exposed to the Files app (UIFileSharingEnabled +
// LSSupportsOpeningDocumentsInPlace); saves are copied in/out there. The
// platform/ios.ts implementation and the export button come with that design.
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Core from '../src/core';
import '../src/index.css';

declare const __APP_VERSION__: string;

const coreSymbols = Object.keys(Core).length;

function Shell() {
  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <h1 className="font-display text-2xl text-ink-100">Horadric Loot Box</h1>
      <p className="text-sm text-ink-400">mobile entry · v{__APP_VERSION__}</p>
      <p className="text-sm text-ink-300">
        Entry OK — sharing <span className="text-ink-100">{coreSymbols}</span> core symbols
        with the desktop app.
      </p>
      <p className="text-xs text-ink-500 max-w-xs">
        Mobile UI is designed next. Nothing here yet except the wiring.
      </p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
