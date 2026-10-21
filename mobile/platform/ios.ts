import { tauriPlatform } from '../../src/platform/tauri';
import type { Platform } from '../../src/platform/types';

/**
 * iOS platform: the Tauri command bridge, minus everything that is meaningless
 * inside the iOS sandbox (SPEC §2).
 *
 * - isGameRunning: sysinfo can't see other processes in the sandbox; the game
 *   can't run alongside anyway -> always false, no invoke needed.
 * - revealBackups: spawns `open`, banned on iOS -> omitted.
 * - updates: tauri-plugin-updater is desktop-only -> omitted.
 * - art: the player imports extracted sprites into Documents/resources; the
 *   existing Rust art backend decodes them for the webview.
 *
 * The Rust side opens Documents/save. The Settings tab invokes native folder
 * import/export commands, which handle security-scoped access on iOS.
 */
export const iosPlatform: Platform = {
  ...tauriPlatform,
  id: 'tauri',
  label: 'iOS',
  isGameRunning: async () => false,
  revealBackups: undefined,
  updates: undefined,
  art: {
    ...tauriPlatform.art!,
    detectInstalls: async () => [],
    pickFolder: async () => null,
  },
};
