import {
  GD,
  ItemMode,
  StorePage,
  StashTabType,
  activeItems,
  characterStats,
  groupOfType,
  itemSize,
  itemTypeOf,
  socketStats,
  statByName,
  type D2Character,
  type D2Item,
  type D2SharedStash,
  type ItemStat,
  type Vault,
  type VaultEntry,
} from '../../src/core';
import { desc, potLabel, type GoldRef, type Loc, type Store } from '../../src/state/store';

export const CELL = 28;
export const TRAY_CELL = 40;
export const TRAY_COLS = 6;
/** App-private vault that holds the equipment tray (hidden from the vault tab). */
export const TRAY_NAME = 'MobileTray';

/** Slot coordinates in cells, copied from the desktop paper doll (`src/ui/Equipment.tsx`). */
export const px = (v: number) => Math.round(v * (CELL + 1.5));

export type GridArea = 'inventory' | 'stash' | 'cube' | 'shared';

export type ItemLoc =
  | { docId: string; kind: 'equip'; bodyLoc: number }
  | { docId: string; kind: 'merc'; bodyLoc: number }
  | { docId: string; kind: 'belt'; slot: number }
  | { docId: string; kind: 'grid'; area: GridArea; tab: number }
  | { docId: string; kind: 'vault' };

export const locKey = (loc: ItemLoc) =>
  loc.kind === 'equip' || loc.kind === 'merc'
    ? `${loc.docId}:${loc.kind}:${loc.bodyLoc}`
    : loc.kind === 'belt'
      ? `${loc.docId}:belt:${loc.slot}`
      : loc.kind === 'grid'
        ? `${loc.docId}:grid:${loc.area}:${loc.tab}`
        : `${loc.docId}:vault`;

export function toStoreLoc(loc: ItemLoc): Loc {
  switch (loc.kind) {
    case 'equip':
      return { docId: loc.docId, area: 'equip', bodyLoc: loc.bodyLoc };
    case 'merc':
      return { docId: loc.docId, area: 'merc', bodyLoc: loc.bodyLoc };
    case 'belt':
      return { docId: loc.docId, area: 'belt', x: loc.slot };
    case 'vault':
      return { docId: loc.docId, area: 'vault' };
    case 'grid':
      return loc.area === 'shared'
        ? { docId: loc.docId, area: 'shared', tab: loc.tab }
        : { docId: loc.docId, area: loc.area };
  }
}

export function itemAtSlot(store: Store, docId: string, area: 'equip' | 'merc', bodyLoc: number): D2Item | undefined {
  const doc = store.docs.get(docId)?.doc;
  if (doc?.kind !== 'character') return undefined;
  return (area === 'merc' ? doc.mercItems : doc.items).find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === bodyLoc);
}

export function beltCapacity(ch: D2Character): number {
  const belt = ch.items.find((i) => i.mode === ItemMode.Equipped && i.bodyLoc === 8);
  return belt?.def?.beltBoxes ?? 4;
}

export function beltRows(ch: D2Character): number {
  return Math.max(1, Math.ceil(beltCapacity(ch) / 4));
}

// ---------------------------------------------------------------- documents

export function characterDocs(store: Store): { id: string; ch: D2Character }[] {
  const out: { id: string; ch: D2Character }[] = [];
  for (const [id, e] of store.docs) if (e.doc?.kind === 'character') out.push({ id, ch: e.doc });
  return out.sort((a, b) => Number(b.ch.gameVersion === 3) - Number(a.ch.gameVersion === 3) || b.ch.level - a.ch.level || a.ch.name.localeCompare(b.ch.name));
}

export function stashDocs(store: Store): { id: string; stash: D2SharedStash }[] {
  const out: { id: string; stash: D2SharedStash }[] = [];
  for (const [id, e] of store.docs) if (e.doc?.kind === 'stash') out.push({ id, stash: e.doc });
  return out.sort((a, b) => Number(b.stash.modern && !b.stash.hardcore) - Number(a.stash.modern && !a.stash.hardcore) || Number(a.stash.hardcore) - Number(b.stash.hardcore));
}

export function vaultDocs(store: Store): { id: string; vault: Vault }[] {
  const out: { id: string; vault: Vault }[] = [];
  for (const [id, e] of store.docs) if (e.doc?.kind === 'vault' && !isTrayDoc(store, id)) out.push({ id, vault: e.doc });
  return out.sort((a, b) => b.vault.entries.length - a.vault.entries.length || a.vault.name.localeCompare(b.vault.name));
}

export function isTrayDoc(store: Store, docId: string | undefined): boolean {
  if (!docId) return false;
  const doc = store.docs.get(docId)?.doc;
  return doc?.kind === 'vault' && doc.name === TRAY_NAME;
}

export function trayDoc(store: Store): { id: string; vault: Vault } | undefined {
  for (const [id, e] of store.docs) if (e.doc?.kind === 'vault' && e.doc.name === TRAY_NAME) return { id, vault: e.doc };
  return undefined;
}

export function trayEntries(store: Store): VaultEntry[] {
  return trayDoc(store)?.vault.entries ?? [];
}

/** Where a double-click/panel move can put an item on the current screen. */
export function activeGridLoc(
  tab: number,
  sub: 'attrs' | 'equip' | 'merc',
  gridView: 'inv' | 'cube',
  stashSeg: 'personal' | 'shared',
  sharedTab: number,
  charId: string | undefined,
  sharedId: string | undefined,
): ItemLoc | undefined {
  if (tab === 0 && charId && (sub === 'equip' || sub === 'merc')) {
    return { docId: charId, kind: 'grid', area: sub === 'merc' ? 'inventory' : gridView === 'cube' ? 'cube' : 'inventory', tab: 0 };
  }
  if (tab === 1) {
    if (stashSeg === 'personal' && charId) return { docId: charId, kind: 'grid', area: 'stash', tab: 0 };
    if (stashSeg === 'shared' && sharedId) return { docId: sharedId, kind: 'grid', area: 'shared', tab: sharedTab };
  }
  return undefined;
}

/** Page chips read as the game's shared-stash pages (I–VII, then numbers). */
export function tabLabel(tab: number): string {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][tab];
  return `页签 ${roman ?? tab + 1}`;
}

export function areaLabel(store: Store, loc: ItemLoc): string {
  if (loc.kind === 'equip') return '装备';
  if (loc.kind === 'merc') return '佣兵';
  if (loc.kind === 'belt') return '腰带';
  if (loc.kind === 'vault') return isTrayDoc(store, loc.docId) ? '托盘' : '宝库';
  if (loc.kind === 'grid') {
    if (loc.area === 'inventory') return '背包';
    if (loc.area === 'cube') return '赫拉迪克方块';
    if (loc.area === 'stash') return '个人仓库';
    return '共享仓库';
  }
  return '';
}

// ---------------------------------------------------------------- tray packing

export function packTray(entries: VaultEntry[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const free = (x: number, y: number, w: number, h: number) =>
    !placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);
  for (const e of entries) {
    const size = itemSize(e.item);
    const w = Math.min(size.w, TRAY_COLS);
    const h = size.h;
    let done = false;
    for (let y = 0; !done; y++) {
      for (let x = 0; x <= TRAY_COLS - w; x++) {
        if (free(x, y, w, h)) {
          positions.set(e.uid, { x, y });
          placed.push({ x, y, w, h });
          done = true;
          break;
        }
      }
    }
  }
  return positions;
}

// ---------------------------------------------------------------- filters

export const QUALITY_FILTERS = [
  ['all', '全部品质'],
  ['unique', '独特'],
  ['set', '套装'],
  ['rare', '稀有'],
  ['magic', '魔法'],
  ['runeword', '符文之语'],
  ['rune', '符文'],
  ['crafted', '手工'],
  ['gem', '宝石'],
] as const;

export const CATEGORY_FILTERS = [
  ['all', '全部类型'],
  ['weapon', '武器'],
  ['armor', '防具'],
  ['jewelry', '饰品'],
  ['charm', '护符'],
  ['material', '材料'],
] as const;

export type Category = Exclude<(typeof CATEGORY_FILTERS)[number][0], 'all'>;

export function categoryOf(item: D2Item): Category {
  if (item.def?.flags.includes('C')) return 'charm';
  const type = itemTypeOf(item.code);
  const group = groupOfType(type);
  if (group === 'Weapons') return 'weapon';
  if (group === 'Armor' || group === 'Shields') return 'armor';
  if (group === 'Jewelry & Charms') return 'jewelry';
  return 'material';
}

export interface VaultFilter {
  text: string;
  quality: string;
  category: string;
  lvlMin: string;
  lvlMax: string;
  eth: boolean;
  sock: boolean;
}

export const emptyFilter = (text = ''): VaultFilter => ({ text, quality: 'all', category: 'all', lvlMin: '', lvlMax: '', eth: false, sock: false });

export function filterVault(entries: VaultEntry[], f: VaultFilter): VaultEntry[] {
  const needle = f.text.trim().toLowerCase();
  return entries.filter((e) => {
    const d = desc(e.item);
    if (f.quality !== 'all' && d.qualityClass !== f.quality) return false;
    if (f.category !== 'all' && categoryOf(e.item) !== f.category) return false;
    if (needle && !d.search.includes(needle)) return false;
    if (f.lvlMin !== '' && d.requiredLevel < Number(f.lvlMin)) return false;
    if (f.lvlMax !== '' && d.requiredLevel > Number(f.lvlMax)) return false;
    if (f.eth && !e.item.ethereal) return false;
    if (f.sock && e.item.socketCount <= 0) return false;
    return true;
  });
}

// ---------------------------------------------------------------- skills & charms

const statId = (key: string) => statByName(key)?.id;
const ALL_SKILLS = statId('item_allskills');
const ADD_CLASS = statId('item_addclassskills');
const ADD_TAB = statId('item_addskill_tab');
const SINGLE = statId('item_singleskill');

export interface SkillRow {
  id: number;
  name: string;
  base: number;
  bonus: number;
}

export interface SkillTree {
  title: string;
  rows: SkillRow[];
}

/**
 * Base points come straight from the save's skill section (30 bytes, one per class skill);
 * gear bonuses are summed from every stat on worn gear and charms (all skills, class, tab and single-skill).
 */
const TREE_TITLES: Record<string, string[]> = {
  Amazon: ['弓与十字弓', '被动与魔法', '标枪与长矛'],
  Sorceress: ['火焰系', '闪电系', '冰冷系'],
  Necromancer: ['诅咒', '毒素与白骨', '召唤'],
  Paladin: ['战斗技能', '攻击光环', '防御光环'],
  Barbarian: ['战斗技能', '精通', '战吼'],
  Druid: ['召唤', '变形', '元素'],
  Assassin: ['陷阱', '暗影训练', '武术'],
  Warlock: ['恶魔系', '邪术系', '混沌系'],
};

export function skillTrees(ch: D2Character): SkillTree[] {
  const byClass = Object.entries(GD.skills)
    .filter(([, s]) => s.cls === ch.classId)
    .map(([id, s]) => ({ id: Number(id), ...s }))
    .sort((a, b) => a.id - b.id);
  if (!byClass.length) return [];
  const bytes = ch.head.subarray(ch.statsAt.end + 2, ch.statsAt.end + 2 + byClass.length);
  const base = new Map<number, number>();
  byClass.forEach((s, i) => base.set(s.id, bytes[i] ?? 0));

  const bonus = new Map<number, number>();
  const add = (id: number, n: number) => {
    if (n) bonus.set(id, (bonus.get(id) ?? 0) + n);
  };
  const apply = (s: ItemStat) => {
    if (!s.value) return;
    if (s.id === ALL_SKILLS) byClass.forEach((sk) => add(sk.id, s.value));
    else if (s.id === ADD_CLASS && s.param === ch.classId) byClass.forEach((sk) => add(sk.id, s.value));
    else if (s.id === ADD_TAB && s.param >> 3 === ch.classId) {
      const page = s.param & 7;
      byClass.filter((sk) => sk.page === page).forEach((sk) => add(sk.id, s.value));
    } else if (s.id === SINGLE && GD.skills[s.param]?.cls === ch.classId) add(s.param, s.value);
  };
  const items = activeItems(ch);
  for (const item of items) {
    item.stats.forEach(apply);
    item.runewordStats.forEach(apply);
    for (const socket of item.sockets) socketStats(item, socket).forEach(apply);
  }
  // set bonuses that are active with this many pieces
  const setCount = new Map<string, number>();
  for (const item of items) {
    if (item.mode !== ItemMode.Equipped || item.setId === undefined) continue;
    const key = GD.setItems[item.setId]?.setKey;
    if (key) setCount.set(key, (setCount.get(key) ?? 0) + 1);
  }
  for (const item of items) {
    if (item.setId === undefined) continue;
    const key = GD.setItems[item.setId]?.setKey;
    const n = key ? setCount.get(key) ?? 0 : 0;
    item.setBonusStats.forEach((list, i) => {
      if (n >= i + 2) list.forEach(apply);
    });
  }

  const trees = new Map<number, SkillTree>();
  for (const sk of byClass) {
    const b = base.get(sk.id) ?? 0;
    const g = bonus.get(sk.id) ?? 0;
    if (!b && !g) continue;
    const raw = GD.classes[ch.classId]?.tabs[sk.page - 1] ?? '';
    const fallback = raw.replace(/^[+%]*\+?%?d to /, '').replace(/ Skills$/, '') || '技能';
    const title = TREE_TITLES[ch.className]?.[sk.page - 1] ?? fallback;
    const tree = trees.get(sk.page) ?? { title, rows: [] };
    tree.rows.push({ id: sk.id, name: sk.name, base: b, bonus: g });
    trees.set(sk.page, tree);
  }
  return [...trees.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/** Stats the charms in the backpack contribute, computed separately (SPEC §5.1.3). */
export function charmStats(ch: D2Character): ReturnType<typeof characterStats> | undefined {
  const charms = ch.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory && i.def?.flags.includes('C'));
  if (!charms.length) return undefined;
  const clone: D2Character = {
    ...ch,
    items: charms.map((i) => ({ ...i, mode: ItemMode.Equipped, bodyLoc: 0, page: StorePage.None })),
    mercItems: [],
  };
  return characterStats(clone);
}

// ---------------------------------------------------------------- gold

export function goldAccountLabel(store: Store, ref: GoldRef): string {
  const e = store.docs.get(ref.docId);
  const doc = e?.doc;
  if (ref.kind === 'vault') return `${doc?.kind === 'vault' ? doc.name : '宝库'} · ${potLabel(ref.pot)}`;
  if (ref.kind === 'shared') {
    if (doc?.kind !== 'stash') return '共享仓库 · 金池';
    return doc.modern ? 'RotW 共享仓库 · 金池' : `共享仓库 · ${tabLabel(ref.tab)}`;
  }
  const name = doc?.kind === 'character' ? doc.name : e?.name ?? '';
  return ref.kind === 'inventory' ? `${name} · 携带` : `${name} · 个人仓库`;
}

/** Targets for the transfer sheet: the other three account kinds, same pot. */
export function transferTargets(store: Store, from: GoldRef, charId: string | undefined): GoldRef[] {
  const same = (a: GoldRef, b: GoldRef) => JSON.stringify(a) === JSON.stringify(b);
  return store.goldTargets(from).filter((t) => {
    if (same(t, from)) return false;
    if (isTrayDoc(store, t.docId)) return false;
    if (t.kind === 'inventory' || t.kind === 'stash') return t.docId === charId;
    return true;
  });
}

// ---------------------------------------------------------------- formatting

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function normalizeSlot(loc: string): string {
  return loc.replace(/s$/, '');
}

export function isEditableTab(stash: D2SharedStash, tab: number): boolean {
  return stash.tabs[tab]?.type === StashTabType.Normal;
}
