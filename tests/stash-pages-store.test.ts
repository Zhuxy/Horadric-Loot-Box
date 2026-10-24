import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import {
  ItemMode,
  StorePage,
  emptyStashPages,
  parseCharacter,
  parseSwpage,
  serializeSwpage,
  type D2Character,
  type D2Item,
} from '../src/core';
import type { Platform } from '../src/platform';
import { Store } from '../src/state/store';

const CHAR_PATH = 't/ChaosSC.d2s';
const PAGE_PATH = 't/ChaosSC.swpage';
const charBytes = () => new Uint8Array(fs.readFileSync('tests/fixtures/ChaosSC.d2s'));

/** A .swpage parking two of the fixture character's own stash items on page 3 (index 2), current = page 1. */
function fabricatedSwpage(pending = false): { bytes: Uint8Array; parked: D2Item[] } {
  const ch = parseCharacter(charBytes(), 'ChaosSC.d2s');
  const parked = ch.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Stash).slice(0, 2);
  const st = emptyStashPages(0, true);
  st.pages[2] = parked;
  const bytes = serializeSwpage(st);
  if (pending) bytes[6] = 1; // the game's unfinished-page-turn flag (v2 header byte 6)
  return { bytes, parked };
}

function memPlatform(withPages?: { bytes: Uint8Array }) {
  const files = new Map<string, Uint8Array>([[CHAR_PATH, charBytes()]]);
  if (withPages) files.set(PAGE_PATH, withPages.bytes.slice());
  const backupCalls: [string, string][] = [];
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
      return { skipped: false, dir: 'backups/test', files: 1, bytes: 1 };
    },
    listVaults: async () => [],
    readText: async () => '',
    writeVault: async (_f, n, _t) => `v/${n}`,
    isGameRunning: async () => false,
    deleteCharacter: async (p) => {
      files.delete(p);
      return 'backups/test';
    },
  } as Platform;
  return { platform, files, backupCalls };
}

async function openStore(withPages?: { bytes: Uint8Array; parked: D2Item[] }) {
  const env = memPlatform(withPages);
  const store = new Store(env.platform);
  store.toast = () => {};
  await store.openFolder('t/');
  const ch = () => store.docs.get(CHAR_PATH)!.doc as D2Character;
  return { ...env, store, ch };
}

const invItem = (ch: D2Character) => ch.items.find((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory)!;

describe('personal stash pages in the store (SPEC §5.2.2)', () => {
  test('the sidecar attaches on load; a move into a page saves as a pair', async () => {
    const fab = fabricatedSwpage();
    const { store, ch, files, backupCalls } = await openStore(fab);
    expect(ch().stashPages?.current).toBe(0);
    expect(ch().stashPages?.pages[2].map((i) => i.code)).toEqual(fab.parked.map((i) => i.code));

    const item = invItem(ch());
    expect(store.move(item, CHAR_PATH, { docId: CHAR_PATH, area: 'stashpage', page: 3 })).toBe(true);
    expect(ch().stashPages?.pages[3]).toHaveLength(1);
    expect(ch().items).not.toContain(item);

    await store.saveAll();
    expect(store.docs.get(CHAR_PATH)!.dirty).toBe(false);
    expect(backupCalls).toEqual([['t/', 'save']]);
    const onDisk = parseSwpage(files.get(PAGE_PATH)!, ch().version);
    expect(onDisk.current).toBe(0);
    expect(onDisk.pages[2]).toHaveLength(2);
    expect(onDisk.pages[3].map((i) => i.code)).toEqual([item.code]);
    const diskChar = parseCharacter(files.get(CHAR_PATH)!, 'ChaosSC.d2s');
    expect(diskChar.items.some((i) => i === (undefined as never))).toBe(false);
    expect(diskChar.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory)).toHaveLength(
      ch().items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory).length,
    );
  });

  test('undo returns the item and empties the page', async () => {
    const { store, ch } = await openStore(fabricatedSwpage());
    const item = invItem(ch());
    expect(store.move(item, CHAR_PATH, { docId: CHAR_PATH, area: 'stashpage', page: 4 })).toBe(true);
    store.undo();
    expect(ch().items.some((i) => i.code === item.code && i.page === StorePage.Inventory)).toBe(true);
    expect(ch().stashPages?.pages[4]).toHaveLength(0);
    expect(ch().stashPages?.pages[2]).toHaveLength(2);
  });

  test('a character without a sidecar grows one on first use (current stays page 1)', async () => {
    const { store, ch, files } = await openStore(undefined);
    expect(ch().stashPages).toBeUndefined();
    const item = invItem(ch());
    expect(store.move(item, CHAR_PATH, { docId: CHAR_PATH, area: 'stashpage', page: 1 })).toBe(true);
    await store.saveAll();
    const onDisk = parseSwpage(files.get(PAGE_PATH)!, ch().version);
    expect(onDisk.current).toBe(0);
    expect(onDisk.pages[1].map((i) => i.code)).toEqual([item.code]);
  });

  test('a pending sidecar is read-only both ways and is never rewritten', async () => {
    const fab = fabricatedSwpage(true);
    const { store, ch, files } = await openStore(fab);
    expect(ch().stashPages?.pending).toBe(true);
    const parkedItem = ch().stashPages!.pages[2][0];
    // nothing moves out of a parked page, nothing moves in
    expect(store.check(parkedItem, CHAR_PATH, { docId: CHAR_PATH, area: 'inventory' }).ok).toBe(false);
    expect(store.check(invItem(ch()), CHAR_PATH, { docId: CHAR_PATH, area: 'stashpage', page: 3 }).ok).toBe(false);
    // the .d2s side still edits and saves — and the sidecar bytes stay exactly as they were
    expect(store.move(invItem(ch()), CHAR_PATH, { docId: CHAR_PATH, area: 'stash' })).toBe(true);
    await store.saveAll();
    expect(files.get(PAGE_PATH)).toEqual(fab.bytes);
  });
});
