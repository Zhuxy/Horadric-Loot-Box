import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { ItemMode, StorePage, parseCharacter, skillTreeInfo, type D2Item, type VaultEntry } from '../src/core';
import {
  activeGridLoc,
  categoryOf,
  filterVault,
  locKey,
  packTray,
  tabLabel,
  toStoreLoc,
  treeTitle,
  type VaultFilter,
} from '../mobile/ui/model';

const sorc = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
const vaultEntry = (item: D2Item, uid: string): VaultEntry => ({ uid, item, addedAt: '2025-01-01T00:00:00.000Z' });
const filter = (over: Partial<VaultFilter> = {}): VaultFilter => ({ text: '', quality: 'all', category: 'all', lvlMin: '', lvlMax: '', eth: false, sock: false, ...over });

describe('materials page locations (SPEC §5.2.1)', () => {
  test('a stack loc maps to the store stackables area and keys distinctly', () => {
    const loc = { docId: 'stash1', kind: 'stack', tab: 5 } as const;
    expect(toStoreLoc(loc)).toEqual({ docId: 'stash1', area: 'stackables', tab: 5 });
    expect(locKey(loc)).toBe('stash1:stack:5');
  });

  test('on an Advanced shared tab the tray current-area is the stack, never the tab grid', () => {
    expect(activeGridLoc(1, 'equip', 'inv', 'shared', 5, 'char1', 'stash1', true)).toEqual({
      docId: 'stash1',
      kind: 'stack',
      tab: 5,
    });
    expect(activeGridLoc(1, 'equip', 'inv', 'shared', 5, 'char1', 'stash1', false)).toEqual({
      docId: 'stash1',
      kind: 'grid',
      area: 'shared',
      tab: 5,
    });
    expect(activeGridLoc(1, 'equip', 'inv', 'shared', 0, 'char1', 'stash1')).toEqual({
      docId: 'stash1',
      kind: 'grid',
      area: 'shared',
      tab: 0,
    });
  });
});

describe('personal stash pages locations (SPEC §5.2.2)', () => {
  test('a stashpage grid loc maps to the store stashpage area with the absolute page', () => {
    const loc = { docId: 'char1', kind: 'grid', area: 'stashpage', tab: 3 } as const;
    expect(toStoreLoc(loc)).toEqual({ docId: 'char1', area: 'stashpage', page: 3 });
    expect(locKey(loc)).toBe('char1:grid:stashpage:3');
  });

  test("on the personal segment the tray's current area is the page being looked at", () => {
    // looking at the current page → the plain stash grid; at another page → that side page
    expect(activeGridLoc(1, 'equip', 'inv', 'personal', 0, 'char1', 'stash1', false, 2, 2)).toEqual({
      docId: 'char1',
      kind: 'grid',
      area: 'stash',
      tab: 0,
    });
    expect(activeGridLoc(1, 'equip', 'inv', 'personal', 0, 'char1', 'stash1', false, 3, 2)).toEqual({
      docId: 'char1',
      kind: 'grid',
      area: 'stashpage',
      tab: 3,
    });
  });
});

describe('mobile model helpers', () => {
  test('reads the save skill section and groups it by class tab', () => {
    // the attrs-page overview that used this helper was removed (2026-10-24); the skills page
    // reads core skillTreeInfo + treeTitle directly, so the same expectations live there now
    const trees = skillTreeInfo(sorc).map((t) => ({ title: treeTitle(sorc, t.page), skills: t.skills }));
    expect(trees.map((t) => t.title)).toEqual(['火焰系', '闪电系', '冰冷系']);
    const cold = trees.find((t) => t.title === '冰冷系')!;
    expect(cold.skills.find((r) => r.name === 'Ice Blast')?.base).toBe(20);
    expect(cold.skills.find((r) => r.name === 'Ice Blast')?.bonus).toBeGreaterThan(0);
  });

  test('tray packing never overlaps items', () => {
    const items = sorc.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory).slice(0, 6);
    const entries = items.map((item, i) => vaultEntry(item, `u${i}`));
    const pos = packTray(entries);
    const boxes = entries.map((e) => {
      const p = pos.get(e.uid)!;
      return { x: p.x, y: p.y, w: Math.min(e.item.def?.w ?? 1, 6), h: e.item.def?.h ?? 1 };
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
  });

  test('vault filters and page labels', () => {
    const items = sorc.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory).slice(0, 4);
    const entries = items.map((item, i) => vaultEntry(item, `v${i}`));
    expect(filterVault(entries, filter())).toHaveLength(entries.length);
    expect(filterVault(entries, filter({ category: 'charm' })).every((e) => categoryOf(e.item) === 'charm')).toBe(true);
    expect(filterVault(entries, filter({ sock: true })).every((e) => (e.item.socketCount ?? 0) > 0)).toBe(true);
    expect(tabLabel(0)).toBe('页签 I');
    expect(tabLabel(6)).toBe('页签 VII');
  });
});
