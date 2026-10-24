import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import type { Platform } from '../src/platform';
import { Store } from '../src/state/store';

const CHAR_PATH = 't/ChaosSC.d2s';
const charBytes = () => new Uint8Array(fs.readFileSync('tests/fixtures/ChaosSC.d2s'));

/** In-memory platform with a scriptable backupFolder (skipped queue) and a call log. */
function memPlatform() {
  const files = new Map<string, Uint8Array>([[CHAR_PATH, charBytes()]]);
  const backupCalls: [string, string][] = [];
  const skippedQueue: boolean[] = [];
  const platform: Platform = {
    id: 'demo',
    label: 'test',
    canWrite: true,
    detectSaveFolders: async () => ['t/'],
    pickFolder: async () => 't/',
    listSaves: async () => [...files.entries()].map(([path, d]) => ({ name: path.slice(2), path, size: d.length })),
    readFile: async (p) => {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return f.slice();
    },
    writeFileAtomic: async (p, d) => {
      files.set(p, d.slice());
    },
    backupFolder: async (folder, kind) => {
      backupCalls.push([folder, kind]);
      const skipped = skippedQueue.shift() ?? false;
      return skipped
        ? { skipped: true, files: 0, bytes: 0 }
        : { skipped: false, dir: 'backups/test', files: 1, bytes: 1 };
    },
    listVaults: async () => [],
    readText: async () => '',
    writeVault: async (_f, n, _t) => `v/${n}`,
    isGameRunning: async () => false,
  } as Platform;
  return { platform, files, backupCalls, skippedQueue };
}

async function openStore() {
  const env = memPlatform();
  const store = new Store(env.platform);
  store.toast = () => {};
  await store.openFolder('t/');
  return { ...env, store };
}

const dirtyAndSave = async (store: Store) => {
  store.docs.get(CHAR_PATH)!.dirty = true;
  await store.saveAll();
};

describe('folder-snapshot backups (SPEC §8)', () => {
  test('first save snapshots the folder; the second save does not', async () => {
    const { store, backupCalls } = await openStore();
    await dirtyAndSave(store);
    expect(backupCalls).toEqual([['t/', 'save']]);
    expect(store.folderBackedUp).toBe(true);
    expect(store.lastBackup).toBe('backups/test');
    await dirtyAndSave(store);
    expect(backupCalls).toHaveLength(1);
  });

  test('a skipped first save retries on the next save', async () => {
    const { store, backupCalls, skippedQueue } = await openStore();
    skippedQueue.push(true);
    await dirtyAndSave(store);
    expect(backupCalls).toHaveLength(1);
    expect(store.folderBackedUp).toBe(false);
    await dirtyAndSave(store);
    expect(backupCalls).toHaveLength(2);
    expect(store.folderBackedUp).toBe(true);
  });

  test('reopening the folder resets the session flag', async () => {
    const { store, backupCalls } = await openStore();
    await dirtyAndSave(store);
    expect(store.folderBackedUp).toBe(true);
    await store.openFolder('t/');
    expect(store.folderBackedUp).toBe(false);
    await dirtyAndSave(store);
    expect(backupCalls).toHaveLength(2);
  });
});
