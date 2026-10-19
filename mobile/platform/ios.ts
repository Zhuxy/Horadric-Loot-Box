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
 * - art: art_detect_installs scans drive_c -> omitted. Artwork comes from a
 *   resource pack the user copies into Documents (SPEC §8), wired later.
 *
 * The Rust side (detect_save_folders -> app Documents, security-scoped writes)
 * is iOS bring-up work; the frontend just calls the same commands.
 */
export const iosPlatform: Platform = {
  ...tauriPlatform,
  id: 'tauri',
  label: 'iOS',
  isGameRunning: async () => false,
  revealBackups: undefined,
  updates: undefined,
  art: undefined,
};
