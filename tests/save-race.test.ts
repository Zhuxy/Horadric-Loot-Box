import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { ItemMode, parseCharacter, type D2Character } from '../src/core';
import type { Platform } from '../src/platform';
import { Store } from '../src/state/store';

const FILES = ['ChaosSC.d2s', 'ModernSharedStashSoftCoreV2.d2i'];

/**
 * A platform whose writes block on a gate the test controls, so an edit can be
 * landed while saveAll is between "serialized" and "written" — the window in
 * which a mid-save edit used to be marked saved without reaching disk.
 */
function gatedPlatform() {
  const files = new Map(FILES.map((f) => [`t/${f}`, new Uint8Array(fs.readFileSync(`tests/fixtures/${f}`))]));
  const vaults = new Map<string, string>();
  let gate: Promise<void> = Promise.resolve();
  let entered = 0;
  const platform: Platform = {
    id: 'demo',
    label: 'test',
    canWrite: true,
    detectSaveFolders: async () => ['t/'],
    pickFolder: async () => 't/',
    listSaves: async () => [...files.entries()].map(([path, d]) => ({ name: path.slice(2), path, size: d.length })),
    readFile: async (p) => files.get(p)!.slice(),
    writeFileAtomic: async (p, d) => {
      entered++;
      await gate;
      files.set(p, d.slice());
    },
    backupFiles: async () => 'none',
    listVaults: async () => [],
    readText: async (p) => vaults.get(p)!,
    writeVault: async (_f, n, t, e) => {
      entered++;
      await gate;
      const p = e ?? `v/${n}`;
      vaults.set(p, t);
      return p;
    },
    isGameRunning: async () => false,
    deleteCharacter: async (p) => {
      files.delete(p);
      return 'backups/test';
    },
  };
  return {
    platform,
    files,
    blockWrites() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return {
        release: () => release(),
        /** Resolves once saveAll is parked inside its first write. */
        async untilEntered() {
          for (let i = 0; i < 200 && !entered; i++) await new Promise((r) => setTimeout(r, 5));
          expect(entered).toBeGreaterThan(0);
        },
      };
    },
  };
}

describe('saveAll mid-save edits', () => {
  test('an edit landing during the write stays dirty and is picked up by the next save', async () => {
    const { platform, files, blockWrites } = gatedPlatform();
    const store = new Store(platform);
    store.toast = () => {};
    await store.openFolder('t/');
    const charId = 't/ChaosSC.d2s';
    const ch = () => store.docs.get(charId)!.doc as D2Character;
    const vaultEntry = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')!;
    const vaultId = vaultEntry.id;
    const worn = (loc: number) => ch().items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === loc)!;

    // first edit: helm goes to the vault (both docs dirty)
    expect(store.move(worn(1), charId, { docId: vaultId, area: 'vault' })).toBe(true);

    // start a save and park it inside the first write
    const gate = blockWrites();
    const saving = store.saveAll();
    await gate.untilEntered();

    // second edit lands mid-save: the ring follows the helm
    expect(store.move(worn(6), charId, { docId: vaultId, area: 'vault' })).toBe(true);
    gate.release();
    await saving;

    // the bytes on disk predate the second edit, so both docs must still be dirty
    expect(store.docs.get(charId)!.dirty).toBe(true);
    expect(vaultEntry.dirty).toBe(true);
    const onDisk = parseCharacter(files.get(charId)!, 'ChaosSC.d2s');
    expect(onDisk.items.some((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 6)).toBe(true);

    // the next save writes the ring too and clears the flags
    await store.saveAll();
    expect(store.docs.get(charId)!.dirty).toBe(false);
    expect(vaultEntry.dirty).toBe(false);
    const after = parseCharacter(files.get(charId)!, 'ChaosSC.d2s');
    expect(after.items.some((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 6)).toBe(false);
  });

  test('a clean save still clears dirty (no false positives from the version check)', async () => {
    const { platform } = gatedPlatform();
    const store = new Store(platform);
    store.toast = () => {};
    await store.openFolder('t/');
    const charId = 't/ChaosSC.d2s';
    const ch = store.docs.get(charId)!.doc as D2Character;
    const vaultEntry = [...store.docs.values()].find((d) => d.doc?.kind === 'vault')!;
    const vaultId = vaultEntry.id;
    const helm = ch.items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 1)!;
    expect(store.move(helm, charId, { docId: vaultId, area: 'vault' })).toBe(true);
    await store.saveAll();
    expect(store.docs.get(charId)!.dirty).toBe(false);
    expect(vaultEntry.dirty).toBe(false);
  });
});
