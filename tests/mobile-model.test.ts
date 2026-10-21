import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { ItemMode, StorePage, parseCharacter, type D2Item, type VaultEntry } from '../src/core';
import { categoryOf, filterVault, packTray, skillTrees, tabLabel, type VaultFilter } from '../mobile/ui/model';

const sorc = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
const vaultEntry = (item: D2Item, uid: string): VaultEntry => ({ uid, item, addedAt: '2025-01-01T00:00:00.000Z' });
const filter = (over: Partial<VaultFilter> = {}): VaultFilter => ({ text: '', quality: 'all', category: 'all', lvlMin: '', lvlMax: '', eth: false, sock: false, ...over });

describe('mobile model helpers', () => {
  test('reads the save skill section and groups it by class tab', () => {
    const trees = skillTrees(sorc);
    expect(trees.map((t) => t.title)).toEqual(['火焰系', '闪电系', '冰冷系']);
    const cold = trees.find((t) => t.title === '冰冷系')!;
    expect(cold.rows.find((r) => r.name === 'Ice Blast')?.base).toBe(20);
    expect(cold.rows.find((r) => r.name === 'Ice Blast')?.bonus).toBeGreaterThan(0);
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
