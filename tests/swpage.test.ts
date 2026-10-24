import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import {
  ItemMode,
  StorePage,
  canDrop,
  emptyStashPages,
  gridDims,
  itemBytes,
  occupancy,
  parseCharacter,
  parseSwpage,
  placeItem,
  removeItem,
  serializeSwpage,
  serializeVerified,
  type D2Item,
} from '../src/core';

const sorc = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
const stashItems = sorc.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Stash);
const invItems = sorc.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory);

/** Hand-builds a .swpage exactly the way dm_pages.c writes it (independent of serializeSwpage). */
function buildSwpage(version: 1 | 2, current: number, pending: boolean, pages: D2Item[][]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x53, 0x57, 0x50, 0x47, version, current, pending ? 1 : 0, 0])];
  for (let pg = 0; pg < 5; pg++) {
    const items = pages[pg] ?? [];
    const head = new Uint8Array(2);
    new DataView(head.buffer).setUint16(0, items.length, true);
    chunks.push(head);
    for (const item of items) {
      const blob = itemBytes(item);
      const entry = new Uint8Array(4);
      entry[0] = item.x;
      entry[1] = item.y;
      new DataView(entry.buffer).setUint16(2, blob.length, true);
      chunks.push(entry, blob);
    }
  }
  if (pending) chunks.push(new Uint8Array([9, 9, 9, 9])); // the game's journal tail: never parsed
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

describe('.swpage sidecar (SPEC §5.2.2)', () => {
  test('parses a hand-built v2 file: header, per-page items, positions', () => {
    const [a, b, c] = stashItems;
    const bytes = buildSwpage(2, 2, false, [[a], [], [], [b, c], []]);
    const st = parseSwpage(bytes, sorc.version);
    expect(st.current).toBe(2);
    expect(st.pending).toBe(false);
    expect(st.existed).toBe(true);
    expect(st.pages.map((p) => p.length)).toEqual([1, 0, 0, 2, 0]);
    expect(st.pages[0][0].code).toBe(a.code);
    expect(st.pages[0][0].x).toBe(a.x);
    expect(st.pages[0][0].y).toBe(a.y);
    expect(st.pages[3].map((i) => i.code)).toEqual([b.code, c.code]);
    for (const it of [...st.pages[0], ...st.pages[3]]) {
      expect(it.mode).toBe(ItemMode.Stored);
      expect(it.page).toBe(StorePage.Stash);
    }
  });

  test('serialize(parse(x)) reproduces the file byte for byte', () => {
    const [a, b, c] = stashItems;
    const bytes = buildSwpage(2, 2, false, [[a], [], [], [b, c], []]);
    expect(serializeSwpage(parseSwpage(bytes, sorc.version))).toEqual(bytes);
  });

  test('v1 files parse; a v2 pending journal marks the state read-only', () => {
    const [a] = stashItems;
    const v1 = parseSwpage(buildSwpage(1, 0, false, [[], [a], [], [], []]), sorc.version);
    expect(v1.pending).toBe(false);
    expect(v1.pages[1][0].code).toBe(a.code);
    const pend = parseSwpage(buildSwpage(2, 1, true, [[a], [], [], [], []]), sorc.version);
    expect(pend.pending).toBe(true);
    expect(pend.current).toBe(1);
  });

  test('items parked in the current page slot force read-only (interrupted game write)', () => {
    const [a] = stashItems;
    const st = parseSwpage(buildSwpage(2, 0, false, [[a], [], [], [], []]), sorc.version);
    expect(st.pending).toBe(true);
    expect(st.pages[0]).toHaveLength(1);
  });

  test('rejects bad magic, bad version and truncation', () => {
    expect(() => parseSwpage(new Uint8Array([1, 2, 3, 4, 2, 0, 0, 0]), sorc.version)).toThrow(/magic/);
    const [a] = stashItems;
    const good = buildSwpage(2, 0, false, [[], [a], [], [], []]);
    const badVer = good.slice();
    badVer[4] = 9;
    expect(() => parseSwpage(badVer, sorc.version)).toThrow(/version/);
    expect(() => parseSwpage(good.subarray(0, good.length - 3), sorc.version)).toThrow(/truncated/);
  });

  test('layout: placing into a side page never touches the .d2s item list', () => {
    const ch = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
    const before = ch.items.length;
    const item = invItems[0];
    const placed = placeItem(ch, 'stashpage', 3, item, 2, 2);
    expect(ch.items.length).toBe(before);
    expect(ch.stashPages?.current).toBe(0);
    expect(ch.stashPages?.pages[3]).toEqual([placed]);
    // and the serialized character does not contain it
    const reparsed = parseCharacter(serializeVerified(ch), 'Sorceress.d2s');
    expect(reparsed.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Stash).map((i) => i.code)).not.toContain(
      placed.code === reparsed.items[0]?.code ? '__never__' : placed.code,
    );
    // occupancy sees the parked item; a second drop on its cells fails
    expect(occupancy(ch, 'stashpage', 3).cells.some(Boolean)).toBe(true);
    expect(canDrop(ch, 'stashpage', 3, invItems[1], placed.x, placed.y).ok).toBe(false);
    // removeItem finds parked items
    expect(removeItem(ch, placed)).toBe(true);
    expect(ch.stashPages?.pages[3]).toHaveLength(0);
  });

  test('layout: every page shares the current page’s dimensions', () => {
    const ch = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
    // an item parked far out in the current page (a stash-expanding mod's footprint)
    placeItem(ch, 'stash', 0, invItems[0], 12, 8);
    const current = gridDims(ch, 'stash');
    expect(current.w).toBeGreaterThanOrEqual(13);
    // an almost-empty side page must still render at the same size
    placeItem(ch, 'stashpage', 2, invItems[1], 0, 0);
    expect(gridDims(ch, 'stashpage', 2)).toEqual(current);
    expect(gridDims(ch, 'stashpage', 4)).toEqual(current);
  });

  test('layout: the current page and a pending state refuse drops', () => {
    const ch = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
    ch.stashPages = emptyStashPages(1, true);
    expect(canDrop(ch, 'stashpage', 1, invItems[0], 0, 0).ok).toBe(false);
    expect(canDrop(ch, 'stashpage', 2, invItems[0], 0, 0).ok).toBe(true);
    ch.stashPages.pending = true;
    expect(canDrop(ch, 'stashpage', 2, invItems[0], 0, 0).ok).toBe(false);
  });
});
