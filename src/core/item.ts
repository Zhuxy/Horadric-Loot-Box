import { BitReader, BitWriter, concatBytes, readBitsAt, writeBitsAt } from './bits';
import { decodeItemCode, encodeItemCode } from './huffman';
import { GD, itemDef, statDef, type ItemDef } from './gamedata';

export const ItemFlag = {
  Identified: 0x00000010,
  Socketed: 0x00000800,
  NoSell: 0x00001000,
  Named: 0x00008000,
  IsEar: 0x00010000,
  StarterItem: 0x00020000,
  Init: 0x00080000,
  CompactSave: 0x00200000,
  Ethereal: 0x00400000,
  Personalized: 0x01000000,
  LowQuality: 0x02000000,
  Runeword: 0x04000000,
  Chronicle: 0x10000000,
  ChronicleCompact: 0x20000000,
} as const;

export enum Quality {
  Inferior = 1,
  Normal = 2,
  Superior = 3,
  Magic = 4,
  Set = 5,
  Rare = 6,
  Unique = 7,
  Crafted = 8,
  Tempered = 9,
}

export enum ItemMode {
  Stored = 0,
  Equipped = 1,
  Belt = 2,
  Ground = 3,
  Cursor = 4,
  Dropping = 5,
  Socketed = 6,
}

/** Store page as held in memory (the file stores page + 1). */
export enum StorePage {
  Inventory = 0,
  Equip = 1,
  Trade = 2,
  Cube = 3,
  Stash = 4,
  Belt = 5,
  None = -1,
}

export const BODY_LOCATIONS = [
  'None', 'Head', 'Neck', 'Torso', 'Right Hand', 'Left Hand', 'Right Ring', 'Left Ring', 'Belt', 'Feet', 'Gloves',
  'Right Hand (Switch)', 'Left Hand (Switch)',
];

export interface ItemStat {
  id: number;
  param: number;
  value: number;
}

export interface D2Item {
  /** Save format version the item was encoded with (e.g. 105). */
  saveVersion: number;
  /** The item's own bytes (byte-aligned), not including socketed children. Position edits are applied here. */
  raw: Uint8Array;
  sockets: D2Item[];

  flags: number;
  formatVersion: number;
  mode: ItemMode;
  bodyLoc: number;
  x: number;
  y: number;
  page: StorePage;
  code: string;
  def?: ItemDef;
  compact: boolean;
  identified: boolean;
  ethereal: boolean;
  socketed: boolean;
  runeword: boolean;
  personalizedName?: string;
  ear?: { cls: number; level: number; name: string };
  gold?: number;

  id?: number;
  itemLevel: number;
  quality: Quality;
  gfx?: number;
  autoAffix?: number;
  lowQualityId?: number;
  superiorId?: number;
  prefixes: number[];
  suffixes: number[];
  uniqueId?: number;
  setId?: number;
  rareName?: [number, number];
  runewordId?: number;
  defense?: number;
  maxDurability?: number;
  durability?: number;
  quantity?: number;
  socketCount: number;
  setMask?: number;
  stats: ItemStat[];
  setBonusStats: ItemStat[][];
  runewordStats: ItemStat[];
  advancedStackSize?: number;
  /** v102+: bit offset (inside `raw`) of the advanced-stash stack flag, the item's last field. */
  advBit?: number;
  /** Bit offset (inside `raw`) of the 32-bit item id, for non-compact items. */
  idBit?: number;
  /** Bit offset (inside `raw`) where a personalized/ear name starts (7- or 8-bit characters). */
  nameBit?: number;
  /** Bit offset (inside `raw`) where the quantity field starts (also when the version has no such field). */
  quantityBit?: number;
  chronicle?: { id: number; timestamp?: number; recipients: number };
  /** Number of socketed children declared in the item header. */
  filledSockets: number;
}

// Bit offsets inside every D2R (v97+) item: flags(32) + format version(3) + mode(3) + location data.
const MODE_BIT = 35;
const LOC_BIT = 38;

export const PAIRED: Record<number, number[]> = {
  17: [18], // max damage% -> min damage%
  48: [49], // fire min/max
  50: [51], // lightning min/max
  52: [53], // magic min/max
  54: [55, 56], // cold min/max/length
  57: [58, 59], // poison min/max/length
};

const V100_STACKABLE = new Set(
  (
    'rvs rvl gcv gfv gsv gzv gpv gcy gfy gsy gly gpy gcb gfb gsb glb gpb gcg gfg gsg glg gpg gcr gfr gsr glr gpr gcw ' +
    'gfw gsw glw gpw skc skf sku skl skz r01 r02 r03 r04 r05 r06 r07 r08 r09 r10 r11 r12 r13 r14 r15 r16 r17 r18 r19 ' +
    'r20 r21 r22 r23 r24 r25 r26 r27 r28 r29 r30 r31 r32 r33 pk1 pk2 pk3 dhn bey mbr toa tes ceh bet fed'
  ).split(' '),
);

function readStatList(r: BitReader): ItemStat[] {
  const out: ItemStat[] = [];
  for (;;) {
    const id = r.readBits(9);
    if (id === 0x1ff) break;
    const def = statDef(id);
    if (def.saveBits === 0) throw new Error(`Stat ${id} (${def.key}) has no save bits`);
    const param = def.saveParamBits ? r.readBits(def.saveParamBits) : 0;
    const value = (r.readBits(def.saveBits) - def.saveAdd) * 2 ** def.valShift;
    out.push({ id, param, value });
    for (const pid of PAIRED[id] ?? []) {
      const pd = statDef(pid);
      out.push({ id: pid, param: 0, value: (r.readBits(pd.saveBits) - pd.saveAdd) * 2 ** pd.valShift });
    }
  }
  return out;
}

/** Parses one item and its socketed children, starting at a byte-aligned reader position. */
export function readItem(r: BitReader, saveVersion: number): D2Item {
  if (saveVersion <= 96) throw new Error('Only Diablo II: Resurrected saves (v97+) are supported');
  if (r.bitPos & 7) throw new Error('Item must start byte-aligned');
  const start = r.bytePos;

  let flags = r.readU32();
  const isGamble = (flags & ItemFlag.LowQuality) !== 0;
  flags = flags >>> 0;

  const fmtHigh = r.readBool();
  const fmtVal = r.readBits(2);
  const formatVersion = fmtHigh ? fmtVal + 99 : fmtVal;
  const mode = r.readBits(3) as ItemMode;
  let bodyLoc = 0, x = 0, y = 0, page = StorePage.None as StorePage;
  if (mode === ItemMode.Ground || mode === ItemMode.Dropping) {
    x = r.readBits(16);
    y = r.readBits(16);
  } else {
    bodyLoc = r.readBits(4);
    x = r.readBits(4);
    y = r.readBits(4);
    page = (r.readBits(3) - 1) as StorePage;
  }

  const item: D2Item = {
    saveVersion,
    raw: new Uint8Array(0),
    sockets: [],
    flags,
    formatVersion,
    mode,
    bodyLoc,
    x,
    y,
    page,
    code: '',
    compact: (flags & ItemFlag.CompactSave) !== 0,
    identified: (flags & ItemFlag.Identified) !== 0,
    ethereal: (flags & ItemFlag.Ethereal) !== 0,
    socketed: (flags & ItemFlag.Socketed) !== 0,
    runeword: (flags & ItemFlag.Runeword) !== 0,
    itemLevel: 1,
    quality: Quality.Normal,
    prefixes: [],
    suffixes: [],
    socketCount: 0,
    stats: [],
    setBonusStats: [],
    runewordStats: [],
    filledSockets: 0,
  };
  const charBits = saveVersion > 97 ? 8 : 7;

  try {
    if (item.compact) {
      if (flags & ItemFlag.IsEar) {
        item.code = 'ear';
        const cls = r.readBits(3);
        const level = r.readBits(7);
        item.nameBit = r.bitPos - start * 8;
        item.ear = { cls, level, name: r.readString(charBits) };
      } else {
        item.code = decodeItemCode(r).trim();
        item.def = itemDef(item.code);
        if (!item.def) throw new Error(`Unknown item code '${item.code}'`);
        if (item.def.flags.includes('G')) {
          item.gold = r.readBool() ? r.readU32() : r.readBits(12);
          r.readBool(); // player gold flag
        }
      }
      if (item.def && item.def.quest && item.def.questDiff) {
        const qd = statDef(356);
        r.readBits(qd.saveBits);
      }
      readRealm(r);
      readAdvancedStack(r, item, saveVersion, start);
    } else {
      item.code = decodeItemCode(r).trim();
      item.def = itemDef(item.code);
      if (!item.def) throw new Error(`Unknown item code '${item.code}'`);
      if (isGamble) {
        item.quality = Quality.Inferior;
      } else {
        readComplete(r, item, saveVersion, charBits, start);
      }
    }
  } catch (e) {
    throw new Error(`Failed to parse item '${item.code || '?'}' at byte ${start}: ${(e as Error).message}`);
  }

  r.alignToByte();
  item.raw = r.data.slice(start, r.bytePos);

  for (let i = 0; i < item.filledSockets; i++) item.sockets.push(readItem(r, saveVersion));
  return item;
}

function readRealm(r: BitReader) {
  if (r.readBool()) for (let i = 0; i < 4; i++) r.readU32();
}

function readAdvancedStack(r: BitReader, item: D2Item, v: number, start: number) {
  item.advBit = r.bitPos - start * 8;
  if (v <= 99) return;
  if (v <= 101) {
    if (!V100_STACKABLE.has(item.code)) return;
  } else {
    if (!r.readBool()) return;
  }
  item.advancedStackSize = r.readBits(8);
}

function readComplete(r: BitReader, item: D2Item, v: number, charBits: 7 | 8, start: number) {
  const def = item.def!;
  item.filledSockets = r.readBits(3);
  item.idBit = r.bitPos - start * 8;
  item.id = r.readU32();
  item.itemLevel = Math.max(1, r.readBits(7));
  item.quality = r.readBits(4) as Quality;
  if (r.readBool()) item.gfx = r.readBits(3);
  if (r.readBool()) item.autoAffix = r.readBits(11);

  switch (item.quality) {
    case Quality.Inferior:
      item.lowQualityId = r.readBits(3);
      break;
    case Quality.Superior:
      item.superiorId = r.readBits(3);
      break;
    case Quality.Magic:
      item.prefixes = [r.readBits(11)];
      item.suffixes = [r.readBits(11)];
      break;
    case Quality.Set:
      item.setId = r.readBits(12);
      break;
    case Quality.Unique:
      item.uniqueId = r.readBits(12);
      break;
    case Quality.Rare:
    case Quality.Crafted: {
      item.rareName = [r.readBits(8), r.readBits(8)];
      for (let i = 0; i < 3; i++) {
        item.prefixes.push(r.readBool() ? r.readBits(11) : 0);
        item.suffixes.push(r.readBool() ? r.readBits(11) : 0);
      }
      break;
    }
    case Quality.Tempered:
      item.rareName = [r.readBits(8), r.readBits(8)];
      break;
    case Quality.Normal:
      if (def.flags.includes('C')) {
        if (r.readBool()) item.prefixes = [r.readBits(11)];
        else item.suffixes = [r.readBits(11)];
      } else if (def.flags.includes('B') && !def.flags.includes('P')) {
        r.readBits(10);
      } else if (def.flags.includes('S')) {
        r.readBits(5);
      }
      break;
  }

  if (item.runeword) item.runewordId = r.readBits(16);
  if (item.flags & ItemFlag.IsEar) {
    const cls = r.readBits(3);
    const level = r.readBits(7);
    item.nameBit = r.bitPos - start * 8;
    item.ear = { cls, level, name: r.readString(charBits) };
  } else if (item.flags & ItemFlag.Personalized) {
    item.nameBit = r.bitPos - start * 8;
    item.personalizedName = r.readString(charBits);
  }
  readRealm(r);

  if (def.flags.includes('A')) {
    const ac = statDef(31), maxd = statDef(73), dur = statDef(72);
    item.defense = r.readBits(ac.saveBits) - ac.saveAdd;
    item.maxDurability = r.readBits(maxd.saveBits) - maxd.saveAdd;
    if (item.maxDurability > 0) item.durability = r.readBits(dur.saveBits) - dur.saveAdd;
  } else if (def.flags.includes('W')) {
    const maxd = statDef(73), dur = statDef(72);
    item.maxDurability = r.readBits(maxd.saveBits) - maxd.saveAdd;
    if (item.maxDurability > 0) item.durability = r.readBits(dur.saveBits) - dur.saveAdd;
  } else if (def.flags.includes('G')) {
    item.gold = r.readBool() ? r.readU32() : r.readBits(12);
    r.readBool();
  }

  item.quantityBit = r.bitPos - start * 8;
  if (v > 104) {
    if (r.readBool()) item.quantity = r.readBits(9);
  } else if (def.stackable) {
    item.quantity = r.readBits(9);
  }

  if (item.socketed) item.socketCount = r.readBits(statDef(194).saveBits);
  if (item.quality === Quality.Set) item.setMask = r.readBits(5);

  item.stats = readStatList(r);
  if (item.quality === Quality.Set && item.setMask) {
    for (let i = 0; i < 5; i++) if (item.setMask & (1 << i)) item.setBonusStats.push(readStatList(r));
  }
  if (item.runeword) item.runewordStats = readStatList(r);

  if (v > 99 && item.flags & ItemFlag.Chronicle) {
    const id = r.readBits(16);
    const compact = (item.flags & ItemFlag.ChronicleCompact) !== 0;
    const timestamp = compact ? undefined : r.readU32();
    let count = compact ? 1 : r.readBits(4);
    if (count > 8) count = 8;
    for (let i = 0; i < count; i++) {
      r.readU32();
      r.readU32();
    }
    item.chronicle = { id, timestamp, recipients: count };
  }
  readAdvancedStack(r, item, v, start);
}

/** Reads `count` top-level items (each followed by its socketed children). */
export function readItemList(r: BitReader, count: number, saveVersion: number): D2Item[] {
  const items: D2Item[] = [];
  for (let i = 0; i < count; i++) items.push(readItem(r, saveVersion));
  return items;
}

/** Serializes an item and its socketed children. */
export function itemBytes(item: D2Item): Uint8Array {
  return concatBytes([item.raw, ...item.sockets.map(itemBytes)]);
}

/** Parses a standalone item blob (item + sockets). */
export function parseItemBytes(bytes: Uint8Array, saveVersion: number): D2Item {
  const r = new BitReader(bytes);
  const item = readItem(r, saveVersion);
  if (r.bytePos !== bytes.length) throw new Error(`Item blob has ${bytes.length - r.bytePos} trailing bytes`);
  return item;
}

export interface Placement {
  mode: ItemMode;
  page: StorePage;
  x: number;
  y: number;
  bodyLoc?: number;
}

/**
 * Returns a copy of `item` with its location bits rewritten. Only the position fields change; every other bit
 * of the item is preserved exactly.
 */
export function withPlacement(item: D2Item, p: Placement): D2Item {
  if (item.mode === ItemMode.Ground || item.mode === ItemMode.Dropping) throw new Error('Cannot relocate ground items');
  if (p.mode === ItemMode.Ground || p.mode === ItemMode.Dropping) throw new Error('Cannot place items on the ground');
  const raw = item.raw.slice();
  writeBitsAt(raw, MODE_BIT, 3, p.mode);
  writeBitsAt(raw, LOC_BIT, 4, p.bodyLoc ?? 0);
  writeBitsAt(raw, LOC_BIT + 4, 4, p.x);
  writeBitsAt(raw, LOC_BIT + 8, 4, p.y);
  writeBitsAt(raw, LOC_BIT + 12, 3, p.page === StorePage.None ? 0 : p.page + 1);
  return {
    ...item,
    raw,
    mode: readBitsAt(raw, MODE_BIT, 3),
    bodyLoc: p.bodyLoc ?? 0,
    x: p.x,
    y: p.y,
    page: p.page,
  };
}

/**
 * Re-encodes an item with a different advanced-stash stack size (`undefined` = not a stack), for moving runes,
 * gems and other stackables in and out of the RotW Stackables tab. Every bit before the stack field is copied
 * unchanged; the result is parsed again to prove it is valid.
 */
export function withStackSize(item: D2Item, size: number | undefined): D2Item {
  if (item.advBit === undefined) throw new Error('This item has no stack field (needs a v102+ save).');
  if (item.sockets.length) throw new Error('Socketed items cannot be stacked.');
  if (size !== undefined && (size < 1 || size > 255)) throw new Error(`Stack size ${size} is out of range`);
  const w = new BitWriter(item.raw.length + 4);
  for (let i = 0; i < item.advBit; i += 24) {
    const n = Math.min(24, item.advBit - i);
    w.writeBits(readBitsAt(item.raw, i, n), n);
  }
  w.writeBits(size === undefined ? 0 : 1, 1);
  if (size !== undefined) w.writeBits(size, 8);
  w.alignToByte();
  const out = parseItemBytes(w.toBytes(), item.saveVersion);
  if (out.code !== item.code || out.advancedStackSize !== size) throw new Error('Stack size change did not verify');
  return out;
}

/** A copy of a non-compact item with a new random id (used when a stack is split, so no two items share an id). */
export function withNewId(item: D2Item): D2Item {
  if (item.idBit === undefined) return item;
  const raw = item.raw.slice();
  let id = 0;
  while (!id) id = (Math.random() * 0x100000000) >>> 0;
  writeBitsAt(raw, item.idBit, 16, id & 0xffff);
  writeBitsAt(raw, item.idBit + 16, 16, id >>> 16);
  const out = parseItemBytes(concatBytes([raw, ...item.sockets.map(itemBytes)]), item.saveVersion);
  if (out.id !== id) throw new Error('Item id change did not verify');
  return out;
}

// ---------------------------------------------------------------------------
// Version conversion.
//
// A .d2i file is a bare item bitstream with no version header, and the stream
// is not fully compatible across v97-v105. To place an imported item in a file
// we rewrite only the fields that differ between versions and copy every other
// bit (position, sockets, affixes, unknown fields) verbatim.
//
// The version-dependent fields, in the order they are written:
//   - a personalized/ear name is 7-bit per character at v97 and 8-bit at v98+
//   - the quantity field is 9 bits for stackables at v104 and below, and a
//     presence bool + 9 bits at v105
//   - the advanced-stash stack field is absent up to v99, is an 8-bit size for
//     a known set of codes at v100-101, and a presence bool + 8-bit size at v102+

function bitsOf(bytes: Uint8Array): number[] {
  const out = new Array<number>(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = (bytes[i] >>> b) & 1;
  return out;
}

function bytesOf(bits: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

function readBitValue(bits: number[], at: number, count: number): number {
  let v = 0;
  for (let i = 0; i < count; i++) v += bits[at + i] * 2 ** i;
  return v;
}

function intBits(value: number, count: number): number[] {
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = Math.floor(value / 2 ** i) & 1;
  return out;
}

/** Width of the advanced-stash field as stored at the item's own version. */
function advancedStackSourceBits(item: D2Item): number {
  if (item.advBit === undefined) return 0;
  if (item.saveVersion <= 99) return 0;
  if (item.saveVersion <= 101) return V100_STACKABLE.has(item.code) ? 8 : 0;
  return item.advancedStackSize !== undefined ? 9 : 1;
}

/** The advanced-stash field as it should be stored at `target`. */
function advancedStackTargetBits(item: D2Item, target: number): number[] {
  if (item.advBit === undefined || target <= 99) return [];
  if (target <= 101) return V100_STACKABLE.has(item.code) ? intBits(item.advancedStackSize ?? 1, 8) : [];
  return item.advancedStackSize !== undefined ? [1, ...intBits(item.advancedStackSize, 8)] : [0];
}

/** Width of the quantity field as stored at the item's own version. */
function quantitySourceBits(item: D2Item): number {
  if (item.quantityBit === undefined) return 0;
  if (item.saveVersion >= 105) return item.quantity !== undefined ? 10 : 1;
  return item.def?.stackable ? 9 : 0;
}

/** The quantity field as it should be stored at `target`. */
function quantityTargetBits(item: D2Item, target: number): number[] {
  if (item.quantityBit === undefined) return [];
  if (target >= 105) return item.quantity !== undefined ? [1, ...intBits(item.quantity, 9)] : [0];
  if (item.def?.stackable) return intBits(item.quantity ?? 1, 9);
  return [];
}

interface BitEdit {
  at: number;
  remove: number;
  insert: number[];
}

/** Rewrites one item's own bytes (not its socketed children) for `target`. */
function convertItemBytes(item: D2Item, target: number): Uint8Array {
  const edits: BitEdit[] = [];
  if (item.advBit !== undefined)
    edits.push({ at: item.advBit, remove: advancedStackSourceBits(item), insert: advancedStackTargetBits(item, target) });
  if (item.quantityBit !== undefined)
    edits.push({ at: item.quantityBit, remove: quantitySourceBits(item), insert: quantityTargetBits(item, target) });

  // A name string changes width when crossing the v97 <-> v98 boundary.
  if (item.nameBit !== undefined) {
    const srcChars = item.saveVersion > 97 ? 8 : 7;
    const dstChars = target > 97 ? 8 : 7;
    if (srcChars !== dstChars) {
      const bits = bitsOf(item.raw);
      const units: number[] = [];
      let p = item.nameBit;
      for (let i = 0; i < 64; i++) {
        const u = readBitValue(bits, p, srcChars);
        p += srcChars;
        units.push(u);
        if (u === 0) break;
      }
      const insert: number[] = [];
      for (const u of units) insert.push(...intBits(u, dstChars));
      edits.push({ at: item.nameBit, remove: units.length * srcChars, insert });
    }
  }

  // Apply from the end so earlier offsets stay valid as the stream shifts.
  edits.sort((a, b) => b.at - a.at);
  let bits = bitsOf(item.raw);
  // Drop the source version's byte-alignment padding; the parser's content ends at the last real field.
  if (item.advBit !== undefined) bits = bits.slice(0, item.advBit + advancedStackSourceBits(item));
  for (const e of edits) bits = [...bits.slice(0, e.at), ...e.insert, ...bits.slice(e.at + e.remove)];
  return bytesOf(bits);
}

/** Structural fields that must survive a version conversion unchanged. */
function shapeOf(item: D2Item): string {
  return JSON.stringify({
    code: item.code,
    compact: item.compact,
    identified: item.identified,
    ethereal: item.ethereal,
    mode: item.mode,
    quality: item.quality,
    gfx: item.gfx,
    autoAffix: item.autoAffix,
    lowQualityId: item.lowQualityId,
    superiorId: item.superiorId,
    rareName: item.rareName,
    chronicle: item.chronicle,
    itemLevel: item.itemLevel,
    id: item.id,
    uniqueId: item.uniqueId,
    setId: item.setId,
    runewordId: item.runewordId,
    prefixes: item.prefixes,
    suffixes: item.suffixes,
    defense: item.defense,
    maxDurability: item.maxDurability,
    durability: item.durability,
    quantity: item.quantity,
    advancedStackSize: item.advancedStackSize,
    socketCount: item.socketCount,
    setMask: item.setMask,
    stats: item.stats,
    setBonusStats: item.setBonusStats,
    runewordStats: item.runewordStats,
    personalizedName: item.personalizedName,
    ear: item.ear,
    gold: item.gold,
    filledSockets: item.filledSockets,
    sockets: item.sockets.map(shapeOf),
  });
}

/**
 * Re-encodes an imported item (and its socketed children) for another save version, so it can be placed in a
 * file of that version. Only the fields that differ between versions are rewritten; everything else is copied
 * bit for bit. The result is parsed back and compared, so a failed conversion is refused instead of written.
 */
export function transcodeItem(item: D2Item, targetVersion: number): D2Item {
  if (item.saveVersion === targetVersion) return item;
  const bytes = concatBytes([convertItemBytes(item, targetVersion), ...item.sockets.map((s) => convertItemBytes(s, targetVersion))]);
  const out = parseItemBytes(bytes, targetVersion);
  if (shapeOf(out) !== shapeOf(item))
    throw new Error(`Could not convert this item from v${item.saveVersion} to v${targetVersion} without changing it`);
  return out;
}

/** Flags D2R writes on runes and gems (identified, compact, plus a flag the game always sets on them). */
const COMPACT_FLAGS = ItemFlag.Identified | ItemFlag.CompactSave | 0x00800000;

/**
 * Builds a new compact item (a rune or gem) from scratch for a v105 save, in the inventory at 0,0 (use
 * `withPlacement` / `withStackSize` to put it somewhere). The result is parsed back to prove it is valid.
 */
export function createCompactItem(code: string, saveVersion = 105): D2Item {
  const def = itemDef(code);
  if (!def) throw new Error(`Unknown item code '${code}'`);
  if (!def.compact || !(def.flags.includes('R') || def.flags.includes('g'))) throw new Error(`${def.name} can't be created yet (only runes and gems).`);
  if (saveVersion < 105) throw new Error('Items can only be created for Reign of the Warlock saves (v105).');
  const w = new BitWriter(16);
  w.writeU32(COMPACT_FLAGS);
  w.writeBits(1, 1); // format version 101: high bit + 2
  w.writeBits(2, 2);
  w.writeBits(ItemMode.Stored, 3);
  w.writeBits(0, 4); // body location
  w.writeBits(0, 4); // x
  w.writeBits(0, 4); // y
  w.writeBits(StorePage.Inventory + 1, 3);
  encodeItemCode(w, code);
  w.writeBits(0, 1); // no realm data
  w.writeBits(0, 1); // not an advanced-stash stack
  w.alignToByte();
  const item = parseItemBytes(w.toBytes(), saveVersion);
  if (item.code !== code || !item.compact || item.advBit === undefined) throw new Error(`Building ${def.name} did not verify`);
  return item;
}

/** Inventory footprint in cells. */
export function itemSize(item: D2Item): { w: number; h: number } {
  return { w: item.def?.w ?? 1, h: item.def?.h ?? 1 };
}

/** Deep structural fingerprint used to verify that items survive a write unchanged. */
export function fingerprint(item: D2Item): string {
  let h = 2166136261;
  for (const b of itemBytes(item)) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${item.code}:${h.toString(16)}`;
}

export { GD };
