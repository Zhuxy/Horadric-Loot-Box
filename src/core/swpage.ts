import { ItemMode, StorePage, itemBytes, parseItemBytes, withPlacement, type D2Item } from './item';

/**
 * D2R Mobile's extra personal-stash pages (dm_pages.c in the d2r-mobile source).
 *
 * The game gives the personal stash 5 pages. The "current" page lives in the .d2s itself;
 * the other four pages' item bitstreams live in a sidecar file `<CharName>.swpage` next to
 * the .d2s. Which page is current is recorded ONLY in this file's header — the .d2s does
 * not know its own page number.
 *
 * File layout (little-endian):
 *   header 8 bytes: 'SWPG', u8 version (1|2), u8 current page (0–4), u8 pending flag (v2), u8 reserved
 *   then all 5 pages in order, each: u16 count; per item u8 x, u8 y, u16 bitstream length, bitstream
 *   (a bitstream is exactly `itemBytes`: the item's raw bytes followed by its socketed items)
 *   if version 2 and the pending flag is set, a journal of an unfinished page turn follows
 *   (from/to/timestamp + three page snapshots) which the game settles on its next launch.
 *   We never parse or produce that journal: a pending file is read-only here.
 */
export interface StashPagesState {
  /** Absolute page (0–4) whose items live in the .d2s. */
  current: number;
  /** The file carried an unsettled page-turn journal (or failed to parse): display only, never written. */
  pending: boolean;
  /** The sidecar file existed on disk when loaded (or has been written since). */
  existed: boolean;
  /** Items per absolute page. `pages[current]` is always empty — those items are in the .d2s. */
  pages: D2Item[][];
}

export const STASH_PAGE_COUNT = 5;

export function emptyStashPages(current = 0, existed = false): StashPagesState {
  return { current, pending: false, existed, pages: Array.from({ length: STASH_PAGE_COUNT }, () => []) };
}

/** Parses a .swpage sidecar. Throws on bad magic, unsupported version or truncation. */
export function parseSwpage(bytes: Uint8Array, saveVersion: number): StashPagesState {
  if (bytes.length < 8 || bytes[0] !== 0x53 || bytes[1] !== 0x57 || bytes[2] !== 0x50 || bytes[3] !== 0x47)
    throw new Error('Not a .swpage file (bad magic)');
  const version = bytes[4];
  if (version !== 1 && version !== 2) throw new Error(`Unsupported .swpage version ${version}`);
  const current = bytes[5];
  if (current >= STASH_PAGE_COUNT) throw new Error(`.swpage current page ${current} out of range`);
  const pending = version === 2 && bytes[6] !== 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  const pages: D2Item[][] = [];
  for (let pg = 0; pg < STASH_PAGE_COUNT; pg++) {
    if (pos + 2 > bytes.length) throw new Error('.swpage truncated (page count)');
    const n = view.getUint16(pos, true);
    pos += 2;
    const items: D2Item[] = [];
    for (let i = 0; i < n; i++) {
      if (pos + 4 > bytes.length) throw new Error('.swpage truncated (item header)');
      const x = bytes[pos];
      const y = bytes[pos + 1];
      const len = view.getUint16(pos + 2, true);
      pos += 4;
      if (!len || pos + len > bytes.length) throw new Error('.swpage truncated (item body)');
      const blob = bytes.subarray(pos, pos + len);
      pos += len;
      // the entry header's x/y is authoritative (the bitstream carries the same position from
      // when the game wrote it out; if they ever disagree, where the game will look is the header)
      items.push(withPlacement(parseItemBytes(blob, saveVersion), { mode: ItemMode.Stored, page: StorePage.Stash, x, y }));
    }
    pages.push(items);
  }
  // By construction the current page's slot in the file is empty (its items are in the .d2s).
  // If a file ever carries items there anyway, something is off (an interrupted write on the
  // game side): keep the items, but force the whole state read-only so nothing here is
  // written back until the game has settled its own bookkeeping.
  return { current, pending: pending || pages[current].length > 0, existed: true, pages };
}

/**
 * Serializes the sidecar (always version 2, never with a pending journal — page turns only
 * happen inside the game). The current page's slot is written empty by construction.
 */
export function serializeSwpage(state: StashPagesState): Uint8Array {
  const chunks: Uint8Array[] = [];
  const header = new Uint8Array(8);
  header.set([0x53, 0x57, 0x50, 0x47, 2, state.current, 0, 0]);
  chunks.push(header);
  let total = 8;
  for (let pg = 0; pg < STASH_PAGE_COUNT; pg++) {
    const items = pg === state.current ? [] : (state.pages[pg] ?? []);
    const count = new Uint8Array(2);
    new DataView(count.buffer).setUint16(0, items.length, true);
    chunks.push(count);
    total += 2;
    for (const item of items) {
      const blob = itemBytes(item);
      if (blob.length > 0xffff) throw new Error(`Item ${item.code} bitstream too large for .swpage`);
      const entry = new Uint8Array(4);
      entry[0] = item.x;
      entry[1] = item.y;
      new DataView(entry.buffer).setUint16(2, blob.length, true);
      chunks.push(entry, blob);
      total += 4 + blob.length;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
