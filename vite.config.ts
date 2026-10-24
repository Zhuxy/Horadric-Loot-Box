import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Tauri expects a fixed port in dev and relative asset paths in production builds.
// `--mode web` builds the trade-only web page from web/ into dist-web (published to GitHub Pages).
// `--mode mobile` builds the mobile entry from mobile/ into dist-mobile (used by `tauri ios build --config src-tauri/tauri.ios.conf.json`).
const altRoot = (mode: string) => (mode === 'web' ? 'web' : mode === 'mobile' ? 'mobile' : null);
const altPort = (mode: string) => (mode === 'web' ? 5175 : mode === 'mobile' ? 5174 : 5173);
const altOutDir = (mode: string) =>
  mode === 'web' ? '../dist-web' : mode === 'mobile' ? '../dist-mobile' : 'dist';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  clearScreen: false,
  // mobile ships only its icon: the OCR engine (6.7 MB) and demo saves in public/ are desktop/web-only
  ...(altRoot(mode) ? { root: altRoot(mode), publicDir: mode === 'mobile' ? '../public-mobile' : '../public' } : {}),
  server: {
    // Tauri uses the Mac's LAN address when a booted simulator is detected as a device.
    host: mode === 'mobile' ? process.env.TAURI_DEV_HOST || 'localhost' : undefined,
    port: altPort(mode),
    strictPort: true,
    // Don't watch Rust build output: on Windows, cargo locks DLLs in target/ and the watcher crashes with EBUSY.
    watch: { ignored: ['**/src-tauri/**', '**/node_modules/**', '**/dist/**', '**/scratch/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2021', outDir: altOutDir(mode), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
}));
